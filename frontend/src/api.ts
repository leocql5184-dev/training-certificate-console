import { useEffect, useState } from 'react';

export async function request<T>(path: string, actor?: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (actor) headers.set('X-Actor-Id', actor);
  if (options.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api${path}`, { ...options, headers });
  if (!response.ok) {
    let message = `Request failed (${response.status}). Please try again.`;
    try {
      const data = await response.json();
      if (typeof data.detail === 'string') message = data.detail;
    } catch { /* The HTTP status remains useful for non-JSON errors. */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export function useResource<T>(path: string, actor?: string, revision = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    request<T>(path, actor, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Cannot reach the service. Please retry.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, actor, revision, attempt]);
  return { data, error, loading, retry: () => setAttempt(value => value + 1) };
}

export function useDebounced(value: string, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timeout);
  }, [value, delay]);
  return debounced;
}

export function queryString(values: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => { if (value !== '' && value !== undefined) query.set(key, String(value)); });
  return query.toString();
}

export function formatTime(value: string | null | undefined, timezone: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

export const number = (value: number | undefined) => value === undefined ? '—' : value.toLocaleString('en-AU');

export function reasonText(reason: string) {
  const known: Record<string, string> = {
    incomplete: 'Course incomplete', not_completed: 'Course incomplete', already_certified: 'Already certified',
    already_issued: 'Already certified', revoked: 'Previously revoked; ineligible for reissue', issued: 'Certificate issued',
    'Course not completed': 'Course incomplete', 'Already certified': 'Already certified',
  };
  return known[reason] || reason;
}
