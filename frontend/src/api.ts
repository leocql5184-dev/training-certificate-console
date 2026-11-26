import { useEffect, useState } from 'react';

export async function request<T>(path: string, actor?: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (actor) headers.set('X-Actor-Id', actor);
  if (options.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api${path}`, { ...options, headers });
  if (!response.ok) {
    let message = `请求失败（${response.status}），请稍后重试。`;
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
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '无法连接服务，请重试。'); })
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

export const number = (value: number | undefined) => value === undefined ? '—' : value.toLocaleString('zh-CN');

export function reasonText(reason: string) {
  const known: Record<string, string> = {
    incomplete: '尚未完成课程', not_completed: '尚未完成课程', already_certified: '已签发过证书',
    already_issued: '已签发过证书', revoked: '证书已撤销，不重复签发', issued: '证书签发成功',
    'Course not completed': '尚未完成课程', 'Already certified': '已签发过证书',
  };
  return known[reason] || reason;
}
