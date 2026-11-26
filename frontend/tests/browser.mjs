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
    await button('学员目录').click();
    const first = await (await firstPage).json();
    assert.equal(first.total, 100006);
    assert.equal(first.items.length, 20);
    await button('下一页').click();
    await page.getByText('2 / 5001 页', { exact: true }).waitFor();
    await page.getByPlaceholder('搜索学员姓名').fill('Alex Lee');
    const alex = page.getByRole('row').filter({ hasText: 'alex.lee@east.test' });
    await alex.waitFor();
    assert.deepEqual(enrollmentRequests, []);
    const records = page.waitForResponse(r => new URL(r.url()).pathname === '/api/enrollments');
    await alex.getByRole('button', { name: '学习记录' }).click();
    const rows = await (await records).json();
    assert.equal(rows.length, 3);
    assert.ok(rows.every(row => row.learner_id === 'east-learner-1'));
    await page.locator('.learner-records').getByText('Safety 101').waitFor();
    assert.deepEqual(enrollmentRequests, ['east-learner-1']);
    await page.getByLabel('切换管理员与租户').selectOption('bob');
    await button('学员目录').click();
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
      await route.fulfill({ status: 503, json: { detail: '测试：响应中断' } });
    });
    await button('批量签发').click();
    await page.getByLabel('选择签发课程').selectOption('east-course-safety');
    await button('签发 2 张证书').click();
    await button('正在签发…').waitFor();
    assert.ok(await button('正在签发…').isDisabled());
    await button('正在签发…').dispatchEvent('click');
    release();
    await button('重试本次签发').click();
    await page.getByRole('heading', { name: '签发操作已完成' }).waitFor();
    assert.ok(keys[0]);
    assert.deepEqual(keys, [keys[0], keys[0]]);
    await button('完成').click();
    await page.getByPlaceholder(/搜索/).fill('OCE-EAST-2026-010001');
    await button('查看 Alex Lee 的 Safety 101 证书').click();
    const revocations = [];
    page.on('request', r => { if (r.url().endsWith('/revoke')) revocations.push(r.url()); });
    await button('撤销证书').click();
    await button('暂不撤销').click();
    assert.equal(revocations.length, 0);
    await button('撤销证书').click();
    await button('确认撤销').click();
    await page.getByText(/这张证书已撤销/).waitFor();
    assert.equal(revocations.length, 1);
    await page.route('**/api/certificates?**', route => route.fulfill({ status: 503, json: { detail: '测试：列表暂不可用' } }), { times: 1 });
    await page.reload();
    await page.getByText('测试：列表暂不可用').waitFor();
    await button('重新加载').click();
    await page.locator('.certificates-table tbody tr').first().waitFor();
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
