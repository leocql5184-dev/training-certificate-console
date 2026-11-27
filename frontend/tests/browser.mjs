import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [origin, scenario] = process.argv.slice(2);
const browser = await chromium.launch(process.env.BROWSER_EXECUTABLE
  ? { executablePath: process.env.BROWSER_EXECUTABLE }
  : existsSync(chromium.executablePath()) ? {} : { channel: process.platform === 'win32' ? 'msedge' : 'chrome' });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  const button = name => page.getByRole('button', { name, exact: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  if (scenario === 'directory') {
    const enrollmentRequests = [];
    page.on('request', req => {
      const url = new URL(req.url());
      if (url.pathname === '/api/enrollments') enrollmentRequests.push(url.searchParams.get('learner_id'));
    });
    const firstPage = page.waitForResponse(r => new URL(r.url()).pathname === '/api/learners');
    await button('Learner directory').click();
    const first = await (await firstPage).json();
    assert.equal(first.total, 100006);
    assert.equal(first.items.length, 20);
    await button('Next').click();
    await page.getByText('Page 2 of 5001', { exact: true }).waitFor();
    await page.getByPlaceholder('Search learners by name').fill('Alex Lee');
    const alex = page.getByRole('row').filter({ hasText: 'alex.lee@east.test' });
    await alex.waitFor();
    assert.deepEqual(enrollmentRequests, []);
    const records = page.waitForResponse(r => new URL(r.url()).pathname === '/api/enrollments');
    await alex.getByRole('button', { name: 'Learning records' }).click();
    const rows = await (await records).json();
    assert.equal(rows.length, 3);
    assert.ok(rows.every(row => row.learner_id === 'east-learner-1'));
    await page.locator('.learner-records').getByText('Safety 101').waitFor();
    assert.deepEqual(enrollmentRequests, ['east-learner-1']);
    await page.getByLabel('Switch administrator and tenant').selectOption('bob');
    await button('Learner directory').click();
    await page.getByText('alex.lee@west.test').waitFor();
    const cross = await page.request.get(origin + '/api/enrollments?learner_id=east-learner-1',
      { headers: { 'X-Actor-Id': 'bob' } });
    assert.equal(cross.status(), 200);
    assert.deepEqual(await cross.json(), []);
  } else {
    // Hold the first response after the API commits, then simulate a lost success response.
    const keys = [];
    let release;
    const held = new Promise(resolve => { release = resolve; });
    await page.route('**/api/courses/*/issue', async route => {
      keys.push(route.request().headers()['idempotency-key']);
      if (keys.length > 1) return route.continue();
      const committed = await route.fetch();
      assert.equal(committed.status(), 200);
      await held;
      await route.fulfill({ status: 503, json: { detail: 'Test: response interrupted' } });
    });
    await button('Bulk issue').click();
    await page.getByLabel('Select course to issue').selectOption('east-course-safety');
    await button('Issue 2 certificates').click();
    await button('Issuing…').waitFor();
    assert.ok(await button('Issuing…').isDisabled());
    await button('Issuing…').dispatchEvent('click');
    release();
    await button('Retry issuance').click();
    await page.getByRole('heading', { name: 'Issuance complete' }).waitFor();
    assert.ok(keys[0]);
    assert.deepEqual(keys, [keys[0], keys[0]]);
    await button('Done').click();
    await page.getByPlaceholder(/Search/).fill('OCE-EAST-2026-010001');
    await button('View Alex Lee / Safety 101 certificate').click();
    const revocations = [];
    page.on('request', r => { if (r.url().endsWith('/revoke')) revocations.push(r.url()); });
    await button('Revoke certificate').click();
    await button('Cancel').click();
    assert.equal(revocations.length, 0);
    await button('Revoke certificate').click();
    await button('Confirm revocation').click();
    await page.getByText(/This certificate has been revoked/).waitFor();
    assert.equal(revocations.length, 1);
    await page.route('**/api/certificates?**', route => route.fulfill({ status: 503, json: { detail: 'Test: list temporarily unavailable' } }), { times: 1 });
    await page.reload();
    await page.getByText('Test: list temporarily unavailable').waitFor();
    await button('Reload').click();
    await page.locator('.certificates-table tbody tr').first().waitFor();
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
