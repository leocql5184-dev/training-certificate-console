import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, ChevronDown, CircleCheck, Inbox, LoaderCircle, Search, X } from 'lucide-react';

export function Status({ value }: { value: string }) {
  const names: Record<string, string> = { active: 'Active', revoked: 'Revoked', completed: 'Completed', incomplete: 'Incomplete', certified: 'Certified', issued: 'Issued', skipped: 'Skipped', failed: 'Failed' };
  return <span className={`status status-${value}`}><span className="status-dot" />{names[value] || value}</span>;
}

export function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  const initials = name.split(' ').map(word => word[0]).slice(0, 2).join('');
  const color = name.charCodeAt(0) % 4;
  return <span aria-hidden="true" className={`avatar avatar-${color}${small ? ' avatar-small' : ''}`}>{initials}</span>;
}

export function SearchBox({ value, onChange, placeholder = 'Search by learner name or serial number' }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="search-box"><Search size={18} aria-hidden="true" /><span className="sr-only">{placeholder}</span><input type="search" placeholder={placeholder} value={value} onChange={event => onChange(event.target.value)} /></label>;
}

export function Select({ children, value, onChange, label, disabled = false, className = '' }: { children: ReactNode; value: string; onChange: (value: string) => void; label: string; disabled?: boolean; className?: string }) {
  return <span className={`select-wrap ${className}`}><select aria-label={label} value={value} onChange={event => onChange(event.target.value)} disabled={disabled}>{children}</select><ChevronDown aria-hidden="true" size={16} /></span>;
}

export function Empty({ title = 'No matches', description = 'Try a different search or clear the filters.', action }: { title?: string; description?: string; action?: ReactNode }) {
  return <div className="empty-state"><Inbox size={34} strokeWidth={1.4} aria-hidden="true" /><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="loading-state" role="status"><LoaderCircle className="spin" size={22} aria-hidden="true" /><span>{label}</span></div>;
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="error-state" role="alert"><AlertCircle size={21} aria-hidden="true" /><div><strong>Request failed</strong><p>{message}</p></div>{retry && <button className="button secondary small" onClick={retry}>Reload</button>}</div>;
}

export function Notice({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => { const timer = window.setTimeout(onClose, 6000); return () => window.clearTimeout(timer); }, [message, onClose]);
  return <div className="notice" role="status"><CircleCheck size={20} /><span>{message}</span><button className="icon-button" aria-label="Dismiss notification" onClick={onClose}><X size={16} /></button></div>;
}

export function Drawer({ title, description, children, onClose, busy = false, wide = false }: { title: string; description?: string; children: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  return <dialog ref={ref} className={`drawer ${wide ? 'drawer-wide' : ''}`} aria-labelledby="drawer-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => { if (event.target === event.currentTarget && !busy) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right) onClose(); } }}>
    <div className="drawer-header"><div><h2 id="drawer-title">{title}</h2>{description && <p>{description}</p>}</div><button className="icon-button" aria-label="Close panel" onClick={onClose} disabled={busy}><X size={21} /></button></div>
    <div className="drawer-body">{children}</div>
  </dialog>;
}
