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
      if (!response.ok) throw new Error(`Export failed (${response.status}). Please retry.`);
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = `${actor.tenant_name}-certificates.csv`;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      setExportNotice('CSV is ready and includes all matching certificates.');
    } catch (err) { if (!controller.signal.aborted) setExportError(err instanceof Error ? err.message : 'Export failed. Please retry.'); }
    finally { if (!controller.signal.aborted) setExporting(false); }
  }
  return <>
    <div className="page-heading"><div><h1>Certificates</h1><p>Search, issue and review training certificates.</p></div><div className="heading-actions"><button className="button secondary" onClick={download} disabled={exporting || resource.loading || !!resource.error || search !== query}>{exporting ? <LoaderCircle size={17} className="spin" /> : <Download size={17} />}{exporting ? 'Exporting…' : 'Export CSV'}</button><button className="button primary" onClick={onIssue} disabled={!courses.length}><Award size={18} />Bulk issue</button></div></div>
    {exportError && <ErrorState message={exportError} retry={download} />}{exportNotice && <div className="inline-success" role="status"><Check size={17} />{exportNotice}</div>}
    <section className="data-panel" aria-label="Certificate list">
      <div className="panel-tabs"><div className="tabs" aria-label="Filter by certificate status">{[['', 'All certificates'], ['active', 'Active certificates'], ['revoked', 'Revoked']].map(([value, label]) => <button key={value} className={status === value ? 'tab active' : 'tab'} onClick={() => { setStatus(value); setPage(1); }} aria-pressed={status === value}>{label}</button>)}</div><span className="table-total">Total {resource.loading ? '…' : number(total)} certificates</span></div>
      <div className="table-toolbar"><SearchBox value={search} onChange={value => { setSearch(value); setPage(1); }} /><div className="filter-group"><Select label="Filter by course" value={course} onChange={value => { setCourse(value); setPage(1); }}><option value="">All courses</option>{courses.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</Select><Select label="Certificate sort field" value={sort} onChange={value => { setSort(value); setPage(1); }}><option value="issued_date">Issue date</option><option value="learner_name">Learner name</option><option value="course_title">Course title</option><option value="serial_number">Serial number</option></Select><button className="icon-button bordered" title={direction === 'desc' ? 'Descending. Click for ascending.' : 'Ascending. Click for descending.'} aria-label={direction === 'desc' ? 'Sort ascending' : 'Sort descending'} onClick={() => { setDirection(value => value === 'desc' ? 'asc' : 'desc'); setPage(1); }}>{direction === 'desc' ? <ArrowDownWideNarrow size={18} /> : <ArrowUpNarrowWide size={18} />}</button><button className="icon-button bordered" title="Refresh list" aria-label="Refresh certificate list" onClick={resource.retry} disabled={resource.loading}><RefreshCw size={17} className={resource.loading ? 'spin' : ''} /></button></div></div>
      {resource.loading ? <Loading /> : resource.error ? <ErrorState message={resource.error} retry={resource.retry} /> : !resource.data?.items.length ? <Empty title={search || course || status ? 'No matching certificates' : 'No certificates yet'} description={search || course || status ? 'Adjust the search or filters and try again.' : 'Select a course to issue certificates to eligible learners.'} action={search || course || status ? <button className="button secondary" onClick={reset}><SearchX size={16} />Clear filters</button> : <button className="button primary" onClick={onIssue} disabled={!courses.length}>Bulk issue</button>} /> : <div className="table-scroll"><table className="certificates-table"><thead><tr><th>Learner</th><th>Course</th><th>Serial number</th><th>Issue date <span className="th-note">Local time</span></th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{resource.data.items.map(item => <tr key={item.id}><td><div className="person-cell"><Avatar name={item.learner_name} /><button className="text-button person-name" onClick={() => onDetail(item.id)}>{item.learner_name}</button></div></td><td>{item.course_title}</td><td className="serial-cell">{item.serial_number}</td><td><div className="date-cell"><span>{item.issued_date}</span><small>{item.issued_local?.slice(11)}</small></div></td><td><Status value={item.status} /></td><td><button className="table-action" onClick={() => onDetail(item.id)} aria-label={`View ${item.learner_name} / ${item.course_title} certificate`}><Eye size={16} /><span>Details</span></button></td></tr>)}</tbody></table></div>}
      <div className="table-footer"><div className="pagination-summary">{total > 0 ? `Showing ${number((page - 1) * pageSize + 1)}–${number(Math.min(page * pageSize, total))} of ${number(total)} rows` : 'Total 0 records'}</div><div className="pagination"><Select label="Rows per page" value={String(pageSize)} onChange={value => { setPageSize(Number(value)); setPage(1); }}><option value="10">10 rows / page</option><option value="20">20 rows / page</option><option value="50">50 rows / page</option></Select><button className="icon-button bordered" aria-label="Previous" disabled={page <= 1 || resource.loading} onClick={() => setPage(value => value - 1)}><ChevronLeft size={18} /></button><span className="page-indicator">{page} / {pageCount}</span><button className="icon-button bordered" aria-label="Next" disabled={page >= pageCount || resource.loading} onClick={() => setPage(value => value + 1)}><ChevronRight size={18} /></button></div></div>
    </section><p className="page-footnote">Dates use {actor.timezone} time. Exports include all matches across pages.</p>
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
  const rows = resource.data?.filter(item => !status || item.student_status === status) || [];
  return <>
    <div className="page-heading"><div><h1>Courses and enrollments</h1><p>Review progress and certificate eligibility for each course.</p></div><span className="subtle-count"><BookOpen size={17} />{number(courses.length)} courses</span></div>
    {coursesLoading ? <Loading /> : coursesError ? <ErrorState message={coursesError} retry={coursesRetry} /> : <div className="course-layout"><aside className="course-list" aria-label="Course selection"><div className="course-list-heading">All courses</div>{courses.map(item => <button key={item.id} className={`course-item ${currentId === item.id ? 'selected' : ''}`} onClick={() => { setSelected(item.id); setSearch(''); setStatus(''); }} aria-pressed={currentId === item.id}><span className="course-item-top"><BookOpen size={18} /><strong>{item.title}</strong></span><span className="course-item-count">{item.enrolled_count} learners<span>{item.eligible_count > 0 ? `${item.eligible_count} eligible` : 'None eligible'}</span></span></button>)}</aside><section className="data-panel course-detail" aria-label="Course enrollments">
      {course ? <><div className="course-detail-header"><div><h2>{course.title}</h2><p>{course.description}</p></div><button className="button primary small" onClick={() => onIssue(course.id)}><Award size={17} />Bulk issue</button></div><div className="course-stats"><span><Users size={16} />enrolled <strong>{number(course.enrolled_count)}</strong> learners</span><span><Check size={16} />Done <strong>{number(course.completed_count)}</strong> learners</span><button className="text-button" onClick={() => onCertificates(course.id)}>View {number(course.certificate_count)} certificates</button></div><div className="table-toolbar"><SearchBox value={search} onChange={setSearch} placeholder="Search course roster" /><Select label="Filter by learning status" value={status} onChange={setStatus}><option value="">All learning states</option><option value="completed">Completed</option><option value="incomplete">Incomplete</option><option value="certified">Certified</option></Select></div>
        {resource.loading ? <Loading /> : resource.error ? <ErrorState message={resource.error} retry={resource.retry} /> : !rows.length ? <Empty title="No matching enrollments" description="No learners match the current filters." /> : <div className="table-scroll"><table><thead><tr><th>Learner</th><th>Progress</th><th>Learning status</th><th>certificate</th></tr></thead><tbody>{rows.map(item => <tr key={item.id}><td><div className="person-cell"><Avatar name={item.learner_name} small /><div className="person-info"><strong>{item.learner_name}</strong><span>{item.learner_email}</span></div></div></td><td><div className="progress-cell"><progress value={item.progress} max="100" aria-label={`${item.learner_name}  progress`} /><span>{item.progress}%</span></div></td><td><Status value={item.student_status} /></td><td>{item.certificate_id ? <button className="text-button" onClick={() => onDetail(item.certificate_id!)}><Status value={item.certificate_status || 'active'} /></button> : item.status === 'completed' ? <span className="eligible-tag">Eligible for issuance</span> : <span className="muted-text">Not issued</span>}</td></tr>)}</tbody></table></div>}
        <div className="table-footer"><span className="muted-text">Total {number(rows.length)} enrollments</span><span className="muted-text">Complete a course to become eligible</span></div></> : <Empty title="No courses" description="This tenant has no courses yet." />}
    </section></div>}
  </>;
}

export function LearnersView({ actor, revision, onDetail }: Shared) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('');
  const query = useDebounced(search);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const learners = useResource<Page<Learner>>(`/learners?${queryString({ q: query, page, page_size: pageSize })}`, actor.id, revision);
  const current = learners.data?.items.find(item => item.id === selected);
  const total = learners.data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  function changePage(next: number) { setSelected(''); setPage(next); }
  return <>
    <div className="page-heading"><div><h1>Learner directory</h1><p>Browse learners and inspect their course and certificate records.</p></div><span className="subtle-count"><Users size={17} />{learners.loading ? '…' : number(total)} learners</span></div>
    <section className="data-panel"><div className="table-toolbar"><SearchBox value={search} onChange={value => { setSearch(value); changePage(1); }} placeholder="Search learners by name" /><span className="toolbar-note">Showing learners in {actor.tenant_name} only</span></div>{learners.loading ? <Loading /> : learners.error ? <ErrorState message={learners.error} retry={learners.retry} /> : !learners.data?.items.length ? <Empty title="No learners found" description="Try a different name or clear the search." /> : <div className="table-scroll"><table><thead><tr><th>Learner</th><th>Email</th><th>Courses enrolled</th><th>Completed</th><th>certificate</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{learners.data.items.map(item => <tr key={item.id} className={selected === item.id ? 'selected-row' : ''}><td><div className="person-cell"><Avatar name={item.name} /><strong>{item.name}</strong></div></td><td>{item.email}</td><td>{number(item.enrolled_count)} courses</td><td>{number(item.completed_count)} courses</td><td>{number(item.certificate_count)} certificates</td><td><button className="table-action" onClick={() => setSelected(value => value === item.id ? '' : item.id)} aria-expanded={selected === item.id}><ListFilter size={16} />{selected === item.id ? 'Hide records' : 'Learning records'}</button></td></tr>)}</tbody></table></div>}{!learners.loading && !learners.error && pages > 1 && <div className="table-footer"><span>Page {page} of {pages}</span><div className="button-row"><button className="button secondary small" disabled={page <= 1} onClick={() => changePage(page - 1)}>Previous</button><button className="button secondary small" disabled={page >= pages} onClick={() => changePage(page + 1)}>Next</button></div></div>}</section>
    {current && <LearnerRecords key={current.id} current={current} actor={actor} revision={revision} onDetail={onDetail} onClose={() => setSelected('')} />}
  </>;
}

function LearnerRecords({ current, actor, revision, onDetail, onClose }: Shared & { current: Learner; onClose: () => void }) {
  const enrollments = useResource<Enrollment[]>(`/enrollments?${queryString({ learner_id: current.id })}`, actor.id, revision);
  const selectedRows = enrollments.data || [];
  return <section className="data-panel learner-records"><div className="course-detail-header"><div><h2>{current.name}  — learning records</h2><p>{current.email}</p></div><button className="button secondary small" onClick={onClose}>Collapse</button></div>{enrollments.loading ? <Loading /> : enrollments.error ? <ErrorState message={enrollments.error} retry={enrollments.retry} /> : selectedRows.length ? <div className="table-scroll"><table><thead><tr><th>Course</th><th>Progress</th><th>Status</th><th>Completed at</th><th>certificate</th></tr></thead><tbody>{selectedRows.map(item => <tr key={item.id}><td><strong>{item.course_title}</strong></td><td>{item.progress}%</td><td><Status value={item.student_status} /></td><td>{formatTime(item.completed_at, actor.timezone)}</td><td>{item.certificate_id ? <button className="table-action" onClick={() => onDetail(item.certificate_id!)}><Eye size={16} />View certificate</button> : <span className="muted-text">Not issued</span>}</td></tr>)}</tbody></table></div> : <Empty title="No courses enrolled" description="This learner has no enrollment records." />}</section>;
}

export function AuditsView({ actor, revision, onDetail }: Shared) {
  const resource = useResource<Audit[]>('/audits', actor.id, revision);
  return <>
    <div className="page-heading"><div><h1>Audit log</h1><p>Review who issued or revoked each certificate and when.</p></div><button className="button secondary" onClick={resource.retry} disabled={resource.loading}><RefreshCw size={17} className={resource.loading ? 'spin' : ''} />Refresh events</button></div>
    <section className="data-panel"><div className="panel-title"><h2>Recent certificate events</h2><span>Showing the latest 100 rows</span></div>{resource.loading ? <Loading /> : resource.error ? <ErrorState message={resource.error} retry={resource.retry} /> : !resource.data?.length ? <Empty title="No audit events" description="Issue or revoke a certificate to see its audit event here." /> : <div className="table-scroll"><table><thead><tr><th>Actions</th><th>Learner and course</th><th>Administrator</th><th>Event time</th><th>certificate</th></tr></thead><tbody>{resource.data.map(item => <tr key={item.id}><td><span className={`audit-action ${item.action.includes('revok') ? 'audit-revoked' : ''}`}>{item.action.includes('revok') ? <ShieldX size={18} /> : <ShieldCheck size={18} />}{item.action.includes('revok') ? 'Revoke certificate' : 'Issue certificate'}</span></td><td><div className="person-info"><strong>{item.learner_name || '—'}</strong><span>{item.course_title || '—'}</span></div></td><td>{item.actor_name}</td><td className="nowrap">{item.created_local || formatTime(item.created_at, actor.timezone)}</td><td>{item.certificate_id ? <button className="text-button serial-cell" onClick={() => onDetail(item.certificate_id!)}>{item.serial_number || 'View details'}</button> : '—'}</td></tr>)}</tbody></table></div>}</section>
  </>;
}
