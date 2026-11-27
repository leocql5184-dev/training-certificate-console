import { useEffect, useRef, useState } from 'react';
import { Award, Check, CheckCheck, Clock3, LoaderCircle, ShieldCheck, ShieldX } from 'lucide-react';
import { formatTime, number, queryString, reasonText, request, useResource } from './api';
import { Avatar, Drawer, Empty, ErrorState, Loading, Select, Status } from './components';
import type { Actor, Certificate, Course, Enrollment, IssueResult } from './types';

export function CertificateDrawer({ id, actor, onClose, onChanged }: { id: string; actor: Actor; onClose: () => void; onChanged: (message: string) => void }) {
  const detail = useResource<Certificate>(`/certificates/${encodeURIComponent(id)}`, actor.id);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mutation = useRef<AbortController | null>(null);
  useEffect(() => () => mutation.current?.abort(), []);
  const certificate = detail.data;
  async function revoke() {
    if (busy) return;
    const controller = new AbortController();
    mutation.current = controller;
    setBusy(true); setError('');
    try {
      await request<Certificate>(`/certificates/${encodeURIComponent(id)}/revoke`, actor.id, { method: 'POST', body: '{}', signal: controller.signal });
      if (controller.signal.aborted) return;
      setConfirming(false); detail.retry(); onChanged('Certificate revoked. The audit event was saved.');
    } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Revocation failed. Please retry.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <Drawer title="Certificate details" description="Issue information and audit history" onClose={onClose} busy={busy}>
    {detail.loading ? <Loading /> : detail.error ? <ErrorState message={detail.error} retry={detail.retry} /> : certificate && <>
      <div className={`certificate-sheet ${certificate.status === 'revoked' ? 'certificate-revoked' : ''}`}>
        <div className="certificate-sheet-top"><span>OCEAN ACADEMY</span><Award size={30} strokeWidth={1.5} /></div>
        <p className="certificate-label">Certificate of completion</p><h3>{certificate.learner_name}</h3><p>Completed <strong>{certificate.course_title}</strong></p>
        <div className="certificate-sheet-bottom"><span>{certificate.serial_number}</span><Status value={certificate.status} /></div>
      </div>
      <dl className="detail-list"><div><dt>Tenant</dt><dd>{actor.tenant_name}</dd></div><div><dt>Issued at</dt><dd>{certificate.issued_local}<small>{actor.timezone}</small></dd></div><div><dt>UTC time</dt><dd className="data-text">{certificate.issued_at}</dd></div>{certificate.revoked_at && <div><dt>Revoked at</dt><dd>{formatTime(certificate.revoked_at, actor.timezone)}</dd></div>}</dl>
      <div className="section-heading"><h3>Audit history</h3><span>Issuance and revocation events</span></div>
      {certificate.audits?.length ? <ol className="timeline">{certificate.audits.map(audit => <li key={audit.id}><span className={`timeline-icon ${audit.action.includes('revok') ? 'muted' : ''}`}>{audit.action.includes('revok') ? <ShieldX size={17} /> : <ShieldCheck size={17} />}</span><div><strong>{audit.action.includes('revok') ? 'Revoke certificate' : 'Issue certificate'}</strong><p>{audit.actor_name} · {audit.created_local || formatTime(audit.created_at, actor.timezone)}</p>{audit.detail && <small>{audit.detail}</small>}</div></li>)}</ol> : <p className="muted-text">No audit events yet.</p>}
      {error && <ErrorState message={error} />}
      {certificate.status === 'active' ? confirming ? <section className="revoke-confirm" aria-label="Confirm revocation"><h3>Revoke this certificate?</h3><p>{certificate.learner_name}  — {certificate.course_title} certificate will be revoked. Its history will remain available. Revocation is final.</p><div className="button-row"><button className="button secondary" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button><button className="button danger" onClick={revoke} disabled={busy}>{busy && <LoaderCircle size={17} className="spin" />}{busy ? 'Revoking…' : 'Confirm revocation'}</button></div></section> : <div className="drawer-actions"><p>Revoke a certificate only when it must be invalidated.</p><button className="button danger-outline" onClick={() => setConfirming(true)}><ShieldX size={17} />Revoke certificate</button></div> : <div className="info-box"><ShieldX size={18} /><p>This certificate has been revoked. The original issue details and audit history remain available.</p></div>}
    </>}
  </Drawer>;
}

export function IssueDrawer({ actor, courses, initialCourse, onClose, onChanged }: { actor: Actor; courses: Course[]; initialCourse?: string; onClose: () => void; onChanged: (message: string) => void }) {
  const [courseId, setCourseId] = useState(initialCourse || courses[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<IssueResult | null>(null);
  const key = useRef<string | null>(null);
  const mutation = useRef<AbortController | null>(null);
  useEffect(() => () => mutation.current?.abort(), []);
  useEffect(() => {
    if (!courseId && courses.length > 0) setCourseId(courses[0].id);
  }, [courses, courseId]);
  const course = courses.find(value => value.id === courseId);
  const preview = useResource<Enrollment[]>(`/enrollments?${queryString({ course_id: courseId })}`, actor.id);
  function selectCourse(value: string) { setCourseId(value); key.current = null; setError(''); setResult(null); }
  async function issue() {
    if (!courseId || busy || result) return;
    key.current ||= crypto.randomUUID();
    const controller = new AbortController(); mutation.current = controller;
    setBusy(true); setError('');
    try {
      const response = await request<IssueResult>(`/courses/${encodeURIComponent(courseId)}/issue`, actor.id, { method: 'POST', headers: { 'Idempotency-Key': key.current }, body: '{}', signal: controller.signal });
      if (controller.signal.aborted) return;
      setResult(response); onChanged(`Issuance complete: ${response.issued} issued, ${response.skipped} skipped, ${response.failed} failed.`);
    } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Issue request failed. Use the retry button below.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <Drawer title="Bulk certificate issuance" description={`${actor.tenant_name} · Issue certificates to eligible learners`} onClose={onClose} busy={busy} wide>
    <p className="field-label">Select course</p>
    <Select label="Select course to issue" value={courseId} onChange={selectCourse} disabled={busy || !!result} className="full-width">{courses.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</Select>
    {!courses.length && <Empty title="No courses available" description="Add demo courses to enable issuance for this tenant." />}
    {course && <>
      {result ? <div className="operation-result" role="status"><CheckCheck size={24} /><div><h3>Issuance complete</h3><p>{number(result.issued)} issued · {number(result.skipped)} skipped · {number(result.failed)} failed</p></div></div> : <div className="issue-summary"><div><strong>{number(course.eligible_count)}</strong><span>Eligible learners</span></div><p>Learners must have completed the course. Existing and revoked certificates are skipped.</p></div>}
      <div className="section-heading"><h3>{result ? 'Individual outcomes' : 'Course roster'}</h3><span>{result ? `${result.outcomes.length} results` : `${course.enrolled_count} enrolled`}</span></div>
      {result ? result.outcomes.length ? <div className="table-scroll result-table"><table><thead><tr><th>Learner</th><th>Outcome</th><th>Reason</th></tr></thead><tbody>{result.outcomes.map(item => <tr key={item.learner_id}><td><strong>{item.learner_name}</strong></td><td><Status value={item.status} /></td><td>{reasonText(item.reason) || (item.status === 'issued' ? 'Certificate issued' : '—')}</td></tr>)}</tbody></table></div> : <Empty title="No enrollments for this course" description="Operation complete. No learners to process." /> : preview.loading ? <Loading /> : preview.error ? <ErrorState message={preview.error} retry={preview.retry} /> : preview.data?.length ? <ul className="issue-learners">{preview.data.map(item => <li key={item.id}><Avatar name={item.learner_name} small /><div className="person-info"><strong>{item.learner_name}</strong><span>{item.certificate_status === 'revoked' ? 'Certificate revoked' : item.certificate_id ? 'Certified' : item.status === 'completed' ? 'Eligible' : 'Course incomplete'}</span></div><Status value={item.student_status} /></li>)}</ul> : <Empty title="No enrollments" description="No learners have enrolled in this course." />}
      {error && <><ErrorState message={error} /><p className="muted-text retry-note">Retry uses the same operation key to prevent duplicate issuance.</p></>}
      <div className="drawer-actions"><p><Clock3 size={16} />Issue dates use {actor.timezone} time</p>{result ? <button className="button primary" onClick={onClose}><Check size={17} />Done</button> : <button className="button primary" onClick={issue} disabled={busy || preview.loading || !!preview.error || !course.eligible_count}>{busy ? <LoaderCircle size={17} className="spin" /> : <Award size={17} />}{busy ? 'Issuing…' : error ? 'Retry issuance' : `Issue ${number(course.eligible_count)} certificates`}</button>}</div>
    </>}
  </Drawer>;
}
