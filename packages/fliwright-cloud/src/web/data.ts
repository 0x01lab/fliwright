import { useEffect, useState } from 'react';
export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  key?: string,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(key ? { 'idempotency-key': key } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? '请求失败');
  return data as T;
}
export function useData<T>(path: string, refresh = 0, enabled = true) {
  const [data, setData] = useState<T>(),
    [error, setError] = useState(''),
    [version, setVersion] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setData(undefined);
    setError('');
    const load = () =>
      api<T>(path)
        .then((value) => {
          if (active) {
            setData(value);
            setError('');
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    void load();
    const timer = refresh ? setInterval(load, refresh) : undefined;
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [path, refresh, version, enabled]);
  return {
    data,
    error,
    update: setData,
    reload: () => setVersion((v) => v + 1),
  };
}
