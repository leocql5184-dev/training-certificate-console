import { useEffect, useRef, useState } from 'react';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Award, BookOpen, Check, ChevronLeft, ChevronRight, Download, Eye, ListFilter, LoaderCircle, RefreshCw, SearchX, ShieldCheck, ShieldX, Users } from 'lucide-react';
import { formatTime, number, queryString, useDebounced, useResource } from './api';
import { Avatar, Empty, ErrorState, Loading, SearchBox, Select, Status } from './components';
import type { Actor, Audit, Certificate, Course, Enrollment, Learner, Page } from './types';

type Shared = { actor: Actor; revision: number; onDetail: (id: string) => void };

export function CertificatesView({ actor, revision, courses, onDetail, onIssue, initialCourse = '' }: Shared & { courses: Course[]; onIssue: () => void; initialCourse?: string }) {
  const [search, setSearch] = useState('');
  const query = useDebounced(search);
  const [course, setCourse] = useState(initialCourse);
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('issued_date');
  const [direction, setDirection] = useState('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [exportNotice, setExportNotice] = useState('');
  const exportController = useRef<AbortController | null>(null);
  useEffect(() => () => exportController.current?.abort(), []);
  const filters = { q: query, course_id: course, status, sort, direction };
  const resource = useResource<Page<Certificate>>(`/certificates?${queryString({ ...filters, page, page_size: pageSize })}`, actor.id, revision);
  const total = resource.data?.total || 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => { if (!resource.loading && !resource.error && page > pageCount) setPage(pageCount); }, [page, pageCount, resource.loading, resource.error]);
  function reset() { setSearch(''); setCourse(''); setStatus(''); setPage(1); }
  async function download() {
    if (exporting || resource.loading || resource.error || search !== query) return;
    const controller = new AbortController(); exportController.current = controller;
    setExporting(true); setExportError(''); setExportNotice('');
    try {
      const response = await fetch(`/api/certificates/export.csv?${queryString(filters)}`, { headers: { 'X-Actor-Id': actor.id }, signal: controller.signal });
      if (!response.ok) throw new Error(`导出失败（${response.status}），请重试。`);
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = `${actor.tenant_name}-certificates.csv`;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      setExportNotice('CSV 已生成，包含当前筛选条件下的全部证书。');
    } catch (err) { if (!controller.signal.aborted) setExportError(err instanceof Error ? err.message : '导出失败，请重试。'); }
    finally { if (!controller.signal.aborted) setExporting(false); }
  }
  return <>
    <div className="page-heading"><div><h1>证书管理</h1><p>管理学习成果，让每一份认证清晰可查。</p></div><div className="heading-actions"><button className="button secondary" onClick={download} disabled={exporting || resource.loading || !!resource.error || search !== query}>{exporting ? <LoaderCircle size={17} className="spin" /> : <Download size={17} />}{exporting ? '正在导出…' : '导出 CSV'}</button><button className="button primary" onClick={onIssue} disabled={!courses.length}><Award size={18} />批量签发</button></div></div>
    {exportError && <ErrorState message={exportError} retry={download} />}{exportNotice && <div className="inline-success" role="status"><Check size={17} />{exportNotice}</div>}
    <section className="data-panel" aria-label="证书列表">
      <div className="panel-tabs"><div className="tabs" aria-label="按证书状态筛选">{[['', '全部证书'], ['active', '有效证书'], ['revoked', '已撤销']].map(([value, label]) => <button key={value} className={status === value ? 'tab active' : 'tab'} onClick={() => { setStatus(value); setPage(1); }} aria-pressed={status === value}>{label}</button>)}</div><span className="table-total">共 {resource.loading ? '…' : number(total)} 张</span></div>
      <div className="table-toolbar"><SearchBox value={search} onChange={value => { setSearch(value); setPage(1); }} /><div className="filter-group"><Select label="按课程筛选" value={course} onChange={value => { setCourse(value); setPage(1); }}><option value="">所有课程</option>{courses.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</Select><Select label="证书排序字段" value={sort} onChange={value => { setSort(value); setPage(1); }}><option value="issued_date">签发日期</option><option value="learner_name">学员姓名</option><option value="course_title">课程名称</option><option value="serial_number">证书编号</option></Select><button className="icon-button bordered" title={direction === 'desc' ? '当前降序，点击升序' : '当前升序，点击降序'} aria-label={direction === 'desc' ? '切换为升序排列' : '切换为降序排列'} onClick={() => { setDirection(value => value === 'desc' ? 'asc' : 'desc'); setPage(1); }}>{direction === 'desc' ? <ArrowDownWideNarrow size={18} /> : <ArrowUpNarrowWide size={18} />}</button><button className="icon-button bordered" title="刷新列表" aria-label="刷新证书列表" onClick={resource.retry} disabled={resource.loading}><RefreshCw size={17} className={resource.loading ? 'spin' : ''} /></button></div></div>
      {resource.loading ? <Loading /> : resource.error ? <ErrorState message={resource.error} retry={resource.retry} /> : !resource.data?.items.length ? <Empty title={search || course || status ? '没有找到匹配的证书' : '还没有签发证书'} description={search || course || status ? '调整搜索词或筛选条件，再试一次。' : '选择一门课程，为完成学习的学员签发第一张证书。'} action={search || course || status ? <button className="button secondary" onClick={reset}><SearchX size={16} />清除筛选</button> : <button className="button primary" onClick={onIssue} disabled={!courses.length}>批量签发</button>} /> : <div className="table-scroll"><table className="certificates-table"><thead><tr><th>学员</th><th>课程</th><th>证书编号</th><th>签发日期 <span className="th-note">本地时间</span></th><th>状态</th><th><span className="sr-only">操作</span></th></tr></thead><tbody>{resource.data.items.map(item => <tr key={item.id}><td><div className="person-cell"><Avatar name={item.learner_name} /><button className="text-button person-name" onClick={() => onDetail(item.id)}>{item.learner_name}</button></div></td><td>{item.course_title}</td><td className="serial-cell">{item.serial_number}</td><td><div className="date-cell"><span>{item.issued_date}</span><small>{item.issued_local?.slice(11)}</small></div></td><td><Status value={item.status} /></td><td><button className="table-action" onClick={() => onDetail(item.id)} aria-label={`查看 ${item.learner_name} 的 ${item.course_title} 证书`}><Eye size={16} /><span>详情</span></button></td></tr>)}</tbody></table></div>}
      <div className="table-footer"><div className="pagination-summary">{total > 0 ? `显示第 ${number((page - 1) * pageSize + 1)}–${number(Math.min(page * pageSize, total))} 条，共 ${number(total)} 条` : '共 0 条记录'}</div><div className="pagination"><Select label="每页显示条数" value={String(pageSize)} onChange={value => { setPageSize(Number(value)); setPage(1); }}><option value="10">10 条 / 页</option><option value="20">20 条 / 页</option><option value="50">50 条 / 页</option></Select><button className="icon-button bordered" aria-label="上一页" disabled={page <= 1 || resource.loading} onClick={() => setPage(value => value - 1)}><ChevronLeft size={18} /></button><span className="page-indicator">{page} / {pageCount}</span><button className="icon-button bordered" aria-label="下一页" disabled={page >= pageCount || resource.loading} onClick={() => setPage(value => value + 1)}><ChevronRight size={18} /></button></div></div>
    </section><p className="page-footnote">日期以 {actor.timezone} 时区显示。导出包含全部匹配结果，不受当前分页限制。</p>
  </>;
}

export function CoursesView({ actor, revision, courses, coursesLoading, coursesError, coursesRetry, onDetail, onIssue, onCertificates }: Shared & { courses: Course[]; coursesLoading: boolean; coursesError: string; coursesRetry: () => void; onIssue: (id: string) => void; onCertificates: (id: string) => void }) {
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const query = useDebounced(search);
  const currentId = selected || courses[0]?.id || '';
  const course = courses.find(item => item.id === currentId);
  const resource = useResource<Enrollment[]>(`/enrollments?${queryString({ course_id: currentId, q: query })}`, actor.id, revision);
  const rows = resource.data?.filter(item => !status || item.status === status) || [];
  return <>
    <div className="page-heading"><div><h1>课程与选课</h1><p>从学习进度到结业认证，掌握每一位学员的状态。</p></div><span className="subtle-count"><BookOpen size={17} />{number(courses.length)} 门课程</span></div>
    {coursesLoading ? <Loading /> : coursesError ? <ErrorState message={coursesError} retry={coursesRetry} /> : <div className="course-layout"><aside className="course-list" aria-label="课程选择"><div className="course-list-heading">全部课程</div>{courses.map(item => <button key={item.id} className={`course-item ${currentId === item.id ? 'selected' : ''}`} onClick={() => { setSelected(item.id); setSearch(''); setStatus(''); }} aria-pressed={currentId === item.id}><span className="course-item-top"><BookOpen size={18} /><strong>{item.title}</strong></span><span className="course-item-count">{item.enrolled_count} 位学员<span>{item.eligible_count > 0 ? `${item.eligible_count} 人可签发` : '暂无待签发'}</span></span></button>)}</aside><section className="data-panel course-detail" aria-label="课程学习记录">
      {course ? <><div className="course-detail-header"><div><h2>{course.title}</h2><p>{course.description}</p></div><button className="button primary small" onClick={() => onIssue(course.id)}><Award size={17} />批量签发</button></div><div className="course-stats"><span><Users size={16} />选课 <strong>{number(course.enrolled_count)}</strong> 人</span><span><Check size={16} />完成 <strong>{number(course.completed_count)}</strong> 人</span><button className="text-button" onClick={() => onCertificates(course.id)}>查看 {number(course.certificate_count)} 张证书</button></div><div className="table-toolbar"><SearchBox value={search} onChange={setSearch} placeholder="搜索课程学员姓名" /><Select label="学习状态筛选" value={status} onChange={setStatus}><option value="">全部学习状态</option><option value="completed">已完成</option><option value="in_progress">学习中</option><option value="not_started">未开始</option></Select></div>
        {resource.loading ? <Loading /> : resource.error ? <ErrorState message={resource.error} retry={resource.retry} /> : !rows.length ? <Empty title="没有匹配的学习记录" description="这门课程暂无符合筛选条件的学员。" /> : <div className="table-scroll"><table><thead><tr><th>学员</th><th>学习进度</th><th>学习状态</th><th>证书</th></tr></thead><tbody>{rows.map(item => <tr key={item.id}><td><div className="person-cell"><Avatar name={item.learner_name} small /><div className="person-info"><strong>{item.learner_name}</strong><span>{item.learner_email}</span></div></div></td><td><div className="progress-cell"><progress value={item.progress} max="100" aria-label={`${item.learner_name} 的学习进度`} /><span>{item.progress}%</span></div></td><td><Status value={item.status} /></td><td>{item.certificate_id ? <button className="text-button" onClick={() => onDetail(item.certificate_id!)}><Status value={item.certificate_status || 'active'} /></button> : item.status === 'completed' ? <span className="eligible-tag">待签发</span> : <span className="muted-text">未签发</span>}</td></tr>)}</tbody></table></div>}
        <div className="table-footer"><span className="muted-text">共 {number(rows.length)} 条学习记录</span><span className="muted-text">完成课程后即可签发证书</span></div></> : <Empty title="暂无课程" description="当前租户还没有课程记录。" />}
    </section></div>}
  </>;
}

export function LearnersView({ actor, revision, onDetail }: Shared) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('');
  const query = useDebounced(search);
  const learners = useResource<Learner[]>(`/learners?${queryString({ q: query })}`, actor.id, revision);
  const enrollments = useResource<Enrollment[]>('/enrollments', actor.id, revision);
  const current = learners.data?.find(item => item.id === selected);
  const selectedRows = enrollments.data?.filter(item => item.learner_id === selected) || [];
  return <>
    <div className="page-heading"><div><h1>学员目录</h1><p>查看本租户学员，以及他们的选课、学习和证书情况。</p></div><span className="subtle-count"><Users size={17} />{learners.loading ? '…' : number(learners.data?.length)} 位学员</span></div>
    <section className="data-panel"><div className="table-toolbar"><SearchBox value={search} onChange={value => { setSearch(value); setSelected(''); }} placeholder="搜索学员姓名" /><span className="toolbar-note">仅显示 {actor.tenant_name} 的学员</span></div>{learners.loading ? <Loading /> : learners.error ? <ErrorState message={learners.error} retry={learners.retry} /> : !learners.data?.length ? <Empty title="没有找到学员" description="换一个姓名搜索，或清空搜索条件。" /> : <div className="table-scroll"><table><thead><tr><th>学员</th><th>联系邮箱</th><th>已选课程</th><th>已完成</th><th>证书</th><th><span className="sr-only">操作</span></th></tr></thead><tbody>{learners.data.map(item => <tr key={item.id} className={selected === item.id ? 'selected-row' : ''}><td><div className="person-cell"><Avatar name={item.name} /><strong>{item.name}</strong></div></td><td>{item.email}</td><td>{number(item.enrolled_count)} 门</td><td>{number(item.completed_count)} 门</td><td>{number(item.certificate_count)} 张</td><td><button className="table-action" onClick={() => setSelected(value => value === item.id ? '' : item.id)} aria-expanded={selected === item.id}><ListFilter size={16} />{selected === item.id ? '收起记录' : '学习记录'}</button></td></tr>)}</tbody></table></div>}</section>
    {current && <section className="data-panel learner-records"><div className="course-detail-header"><div><h2>{current.name} 的学习记录</h2><p>{current.email}</p></div><button className="button secondary small" onClick={() => setSelected('')}>收起</button></div>{enrollments.loading ? <Loading /> : enrollments.error ? <ErrorState message={enrollments.error} retry={enrollments.retry} /> : selectedRows.length ? <div className="table-scroll"><table><thead><tr><th>课程</th><th>学习进度</th><th>状态</th><th>完成时间</th><th>证书</th></tr></thead><tbody>{selectedRows.map(item => <tr key={item.id}><td><strong>{item.course_title}</strong></td><td>{item.progress}%</td><td><Status value={item.status} /></td><td>{formatTime(item.completed_at, actor.timezone)}</td><td>{item.certificate_id ? <button className="table-action" onClick={() => onDetail(item.certificate_id!)}><Eye size={16} />查看证书</button> : <span className="muted-text">未签发</span>}</td></tr>)}</tbody></table></div> : <Empty title="尚未选课" description="该学员还没有学习记录。" />}</section>}
  </>;
}

export function AuditsView({ actor, revision, onDetail }: Shared) {
  const resource = useResource<Audit[]>('/audits', actor.id, revision);
  return <>
    <div className="page-heading"><div><h1>审计日志</h1><p>每一次签发与撤销都有记录，操作人与时间清晰可追溯。</p></div><button className="button secondary" onClick={resource.retry} disabled={resource.loading}><RefreshCw size={17} className={resource.loading ? 'spin' : ''} />刷新记录</button></div>
    <section className="data-panel"><div className="panel-title"><h2>最近的证书操作</h2><span>最多显示最近 100 条</span></div>{resource.loading ? <Loading /> : resource.error ? <ErrorState message={resource.error} retry={resource.retry} /> : !resource.data?.length ? <Empty title="暂无操作记录" description="签发或撤销证书后，操作记录会出现在这里。" /> : <div className="table-scroll"><table><thead><tr><th>操作</th><th>学员与课程</th><th>操作人</th><th>操作时间</th><th>证书</th></tr></thead><tbody>{resource.data.map(item => <tr key={item.id}><td><span className={`audit-action ${item.action.includes('revok') ? 'audit-revoked' : ''}`}>{item.action.includes('revok') ? <ShieldX size={18} /> : <ShieldCheck size={18} />}{item.action.includes('revok') ? '撤销证书' : '签发证书'}</span></td><td><div className="person-info"><strong>{item.learner_name || '—'}</strong><span>{item.course_title || '—'}</span></div></td><td>{item.actor_name}</td><td className="nowrap">{item.created_local || formatTime(item.created_at, actor.timezone)}</td><td>{item.certificate_id ? <button className="text-button serial-cell" onClick={() => onDetail(item.certificate_id!)}>{item.serial_number || '查看详情'}</button> : '—'}</td></tr>)}</tbody></table></div>}</section>
  </>;
}
