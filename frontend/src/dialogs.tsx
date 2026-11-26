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
      setConfirming(false); detail.retry(); onChanged('证书已撤销，操作记录已保存。');
    } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '撤销失败，请重试。'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <Drawer title="证书详情" description="查看签发信息与完整操作记录" onClose={onClose} busy={busy}>
    {detail.loading ? <Loading /> : detail.error ? <ErrorState message={detail.error} retry={detail.retry} /> : certificate && <>
      <div className={`certificate-sheet ${certificate.status === 'revoked' ? 'certificate-revoked' : ''}`}>
        <div className="certificate-sheet-top"><span>OCEAN ACADEMY</span><Award size={30} strokeWidth={1.5} /></div>
        <p className="certificate-label">课程结业证书</p><h3>{certificate.learner_name}</h3><p>已完成 <strong>{certificate.course_title}</strong></p>
        <div className="certificate-sheet-bottom"><span>{certificate.serial_number}</span><Status value={certificate.status} /></div>
      </div>
      <dl className="detail-list"><div><dt>所属租户</dt><dd>{actor.tenant_name}</dd></div><div><dt>签发时间</dt><dd>{certificate.issued_local}<small>{actor.timezone}</small></dd></div><div><dt>UTC 时间</dt><dd className="data-text">{certificate.issued_at}</dd></div>{certificate.revoked_at && <div><dt>撤销时间</dt><dd>{formatTime(certificate.revoked_at, actor.timezone)}</dd></div>}</dl>
      <div className="section-heading"><h3>操作记录</h3><span>可追溯的签发与撤销</span></div>
      {certificate.audits?.length ? <ol className="timeline">{certificate.audits.map(audit => <li key={audit.id}><span className={`timeline-icon ${audit.action.includes('revok') ? 'muted' : ''}`}>{audit.action.includes('revok') ? <ShieldX size={17} /> : <ShieldCheck size={17} />}</span><div><strong>{audit.action.includes('revok') ? '撤销证书' : '签发证书'}</strong><p>{audit.actor_name} · {audit.created_local || formatTime(audit.created_at, actor.timezone)}</p>{audit.detail && <small>{audit.detail}</small>}</div></li>)}</ol> : <p className="muted-text">暂无操作记录。</p>}
      {error && <ErrorState message={error} />}
      {certificate.status === 'active' ? confirming ? <section className="revoke-confirm" aria-label="撤销确认"><h3>确认撤销这张证书？</h3><p>{certificate.learner_name} 的「{certificate.course_title}」证书将失效。此操作会保留审计记录，且无法恢复或重新签发。</p><div className="button-row"><button className="button secondary" onClick={() => setConfirming(false)} disabled={busy}>暂不撤销</button><button className="button danger" onClick={revoke} disabled={busy}>{busy && <LoaderCircle size={17} className="spin" />}{busy ? '正在撤销…' : '确认撤销'}</button></div></section> : <div className="drawer-actions"><p>仅在证书需要作废时使用撤销操作。</p><button className="button danger-outline" onClick={() => setConfirming(true)}><ShieldX size={17} />撤销证书</button></div> : <div className="info-box"><ShieldX size={18} /><p>这张证书已撤销。原始签发信息和操作记录仍会保留。</p></div>}
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
      setResult(response); onChanged(`签发操作完成：${response.issued} 人成功，${response.skipped} 人跳过，${response.failed} 人失败。`);
    } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '签发请求失败，请使用下方按钮重试。'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <Drawer title="批量签发证书" description={`${actor.tenant_name} · 为已完成课程的学员签发证书`} onClose={onClose} busy={busy} wide>
    <p className="field-label">选择课程</p>
    <Select label="选择签发课程" value={courseId} onChange={selectCourse} disabled={busy || !!result} className="full-width">{courses.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</Select>
    {!courses.length && <Empty title="暂无可选课程" description="当前租户还没有课程，无法签发证书。" />}
    {course && <>
      {result ? <div className="operation-result" role="status"><CheckCheck size={24} /><div><h3>签发操作已完成</h3><p>签发 {number(result.issued)} 人 · 跳过 {number(result.skipped)} 人 · 失败 {number(result.failed)} 人</p></div></div> : <div className="issue-summary"><div><strong>{number(course.eligible_count)}</strong><span>可签发学员</span></div><p>仅为完成课程且未获证的学员签发。未完成、已获证或已撤销的记录将跳过。</p></div>}
      <div className="section-heading"><h3>{result ? '逐人处理结果' : '课程学员'}</h3><span>{result ? `${result.outcomes.length} 条结果` : `${course.enrolled_count} 人已选课`}</span></div>
      {result ? result.outcomes.length ? <div className="table-scroll result-table"><table><thead><tr><th>学员</th><th>结果</th><th>说明</th></tr></thead><tbody>{result.outcomes.map(item => <tr key={item.learner_id}><td><strong>{item.learner_name}</strong></td><td><Status value={item.status} /></td><td>{reasonText(item.reason) || (item.status === 'issued' ? '证书签发成功' : '—')}</td></tr>)}</tbody></table></div> : <Empty title="该课程没有选课记录" description="操作已完成，没有需要处理的学员。" /> : preview.loading ? <Loading /> : preview.error ? <ErrorState message={preview.error} retry={preview.retry} /> : preview.data?.length ? <ul className="issue-learners">{preview.data.map(item => <li key={item.id}><Avatar name={item.learner_name} small /><div className="person-info"><strong>{item.learner_name}</strong><span>{item.certificate_status === 'revoked' ? '证书已撤销' : item.certificate_id ? '已获证书' : item.status === 'completed' ? '符合签发条件' : '尚未完成课程'}</span></div>{!item.certificate_id && item.status === 'completed' ? <span className="eligible-tag"><Check size={15} />可签发</span> : <Status value={item.certificate_status || item.status} />}</li>)}</ul> : <Empty title="暂无选课记录" description="这门课程还没有学员选课。" />}
      {error && <><ErrorState message={error} /><p className="muted-text retry-note">重试会沿用本次操作标识，不会重复签发证书。</p></>}
      <div className="drawer-actions"><p><Clock3 size={16} />签发日期按 {actor.timezone} 记录</p>{result ? <button className="button primary" onClick={onClose}><Check size={17} />完成</button> : <button className="button primary" onClick={issue} disabled={busy || preview.loading || !!preview.error || !course.eligible_count}>{busy ? <LoaderCircle size={17} className="spin" /> : <Award size={17} />}{busy ? '正在签发…' : error ? '重试本次签发' : `签发 ${number(course.eligible_count)} 张证书`}</button>}</div>
    </>}
  </Drawer>;
}
