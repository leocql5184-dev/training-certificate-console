import { useCallback, useState } from 'react';
import { Award, BookOpen, ChevronRight, CircleHelp, ClipboardList, Globe2, Menu, ShieldCheck, Users, Waves, X } from 'lucide-react';
import { number, useResource } from './api';
import { Avatar, ErrorState, Loading, Notice, Select } from './components';
import { CertificateDrawer, IssueDrawer } from './dialogs';
import { AuditsView, CertificatesView, CoursesView, LearnersView } from './views';
import type { Actor, Course, Overview } from './types';

type View = 'certificates' | 'courses' | 'learners' | 'audits';
const navigation = [
  { id: 'certificates' as const, label: '证书管理', icon: Award },
  { id: 'courses' as const, label: '课程与选课', icon: BookOpen },
  { id: 'learners' as const, label: '学员目录', icon: Users },
  { id: 'audits' as const, label: '审计日志', icon: ClipboardList },
];

function Workspace({ actor, actors, onActor }: { actor: Actor; actors: Actor[]; onActor: (id: string) => void }) {
  const [view, setView] = useState<View>('certificates');
  const [revision, setRevision] = useState(0);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [notice, setNotice] = useState('');
  const [drawer, setDrawer] = useState<{ type: 'detail'; id: string } | { type: 'issue'; course?: string } | null>(null);
  const [initialCourse, setInitialCourse] = useState('');
  const overview = useResource<Overview>('/overview', actor.id, revision);
  const courses = useResource<Course[]>('/courses', actor.id, revision);
  const closeNotice = useCallback(() => setNotice(''), []);
  const onChanged = (message: string) => { setRevision(value => value + 1); setNotice(message); };
  const onDetail = (id: string) => setDrawer({ type: 'detail', id });
  const onIssue = (course?: string) => setDrawer({ type: 'issue', course });
  const isEast = actor.tenant_id.toLowerCase().includes('east');
  function changeView(next: View) { setView(next); setMobileMenu(false); setInitialCourse(''); }
  return <div className="app-shell">
    {mobileMenu && <button className="mobile-scrim" aria-label="关闭导航" onClick={() => setMobileMenu(false)} />}
    <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}>
      <a className="brand" href="#" onClick={event => { event.preventDefault(); changeView('certificates'); }} aria-label="Ocean Academy 首页"><span className="brand-mark"><Waves size={27} strokeWidth={2} /></span><span><strong>Ocean<span className="brand-dot">.</span></strong><small>ACADEMY</small></span></a>
      <button className="mobile-close icon-button" aria-label="关闭导航" onClick={() => setMobileMenu(false)}><X size={20} /></button>
      <div className="workspace-label">学习与认证工作台</div>
      <nav aria-label="主导航">{navigation.map(item => <button key={item.id} className={`nav-item ${view === item.id ? 'nav-active' : ''}`} onClick={() => changeView(item.id)} aria-current={view === item.id ? 'page' : undefined}><item.icon size={20} strokeWidth={1.7} /><span>{item.label}</span>{view === item.id && <span className="nav-active-mark" />}</button>)}</nav>
      <div className="sidebar-bottom"><div className="tenant-label"><span className="tenant-symbol">{isEast ? 'E' : 'W'}</span><div><strong>{actor.tenant_name} 工作空间</strong><span>{isEast ? '东部培训中心' : '西部培训中心'}</span></div><ShieldCheck size={17} /></div><div className="sidebar-caption"><CircleHelp size={15} /><span>本地演示 · 数据均为虚构</span></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu-button" aria-label="展开导航" onClick={() => setMobileMenu(true)}><Menu size={21} /></button><span>管理工作台</span><ChevronRight size={14} /><strong>{navigation.find(item => item.id === view)?.label}</strong></div><div className="actor-controls"><div className="timezone-label"><Globe2 size={15} /><span>{actor.timezone}</span></div><div className="actor-select"><Avatar name={actor.name} small /><Select label="切换管理员与租户" value={actor.id} onChange={onActor}>{actors.map(item => <option key={item.id} value={item.id}>{item.name} · {item.tenant_name}</option>)}</Select></div></div></header>
      <main id="main-content" className="main-content">
        <div className="tenant-context"><span><span className="tenant-context-dot" />{actor.tenant_name} 工作空间</span><span>当前身份：{actor.email}</span></div>
        {overview.error ? <ErrorState message={overview.error} retry={overview.retry} /> : <div className="overview-strip" aria-label="租户学习与认证概览"><div><Users size={18} /><span>学员</span><strong>{number(overview.data?.learners)}</strong></div><div><BookOpen size={18} /><span>课程</span><strong>{number(overview.data?.courses)}</strong></div><div><Award size={18} /><span>有效证书</span><strong>{number(overview.data?.active_certificates)}</strong></div><div className="overview-pending"><span>待签发</span><strong>{number(overview.data?.eligible)}</strong><span className="overview-unit">人次</span></div></div>}
        {courses.error && view !== 'courses' && <ErrorState message={`课程数据加载失败：${courses.error}`} retry={courses.retry} />}
        {view === 'certificates' && <CertificatesView actor={actor} revision={revision} courses={courses.data || []} onDetail={onDetail} onIssue={() => onIssue()} initialCourse={initialCourse} />}
        {view === 'courses' && <CoursesView actor={actor} revision={revision} courses={courses.data || []} coursesLoading={courses.loading} coursesError={courses.error} coursesRetry={courses.retry} onDetail={onDetail} onIssue={onIssue} onCertificates={id => { setInitialCourse(id); setView('certificates'); }} />}
        {view === 'learners' && <LearnersView actor={actor} revision={revision} onDetail={onDetail} />}
        {view === 'audits' && <AuditsView actor={actor} revision={revision} onDetail={onDetail} />}
        <footer className="workspace-footer"><span>Ocean Academy</span><span>学习有迹可循，成果有证可查。</span><span>{actor.tenant_name} · {actor.timezone}</span></footer>
      </main>
    </div>
    {drawer?.type === 'detail' && <CertificateDrawer key={drawer.id} id={drawer.id} actor={actor} onClose={() => setDrawer(null)} onChanged={onChanged} />}
    {drawer?.type === 'issue' && <IssueDrawer actor={actor} courses={courses.data || []} initialCourse={drawer.course} onClose={() => setDrawer(null)} onChanged={onChanged} />}
    {notice && <Notice message={notice} onClose={closeNotice} />}
  </div>;
}

export default function App() {
  const actors = useResource<Actor[]>('/actors');
  const [actorId, setActorId] = useState('alice');
  if (actors.loading) return <div className="boot-screen"><Waves size={38} /><h1>Ocean Academy</h1><Loading label="正在打开学习与认证工作台…" /></div>;
  if (actors.error) return <div className="boot-screen"><Waves size={38} /><h1>Ocean Academy</h1><ErrorState message={actors.error} retry={actors.retry} /></div>;
  const actor = actors.data?.find(item => item.id === actorId) || actors.data?.[0];
  if (!actor) return <div className="boot-screen"><ErrorState message="没有可用的演示管理员，请检查服务启动和种子数据初始化。" retry={actors.retry} /></div>;
  return <><a className="skip-link" href="#main-content">跳至主要内容</a><Workspace key={actor.id} actor={actor} actors={actors.data || []} onActor={setActorId} /></>;
}
