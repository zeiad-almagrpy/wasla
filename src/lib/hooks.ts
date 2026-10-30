import { useCallback, useEffect, useState } from 'react';
import { errMsg } from './utils';

/** Loads data, optionally re-polls while the tab is visible. */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[] = [], pollMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(async () => {
    try { setData(await fn()); setError(''); }
    catch (e) { setError(errMsg(e)); }
    finally { setLoading(false); }
  }, deps);
  useEffect(() => {
    run();
    if (!pollMs) return;
    const t = window.setInterval(() => { if (!document.hidden) run(); }, pollMs);
    return () => window.clearInterval(t);
  }, [run, pollMs]);
  return { data, loading, error, reload: run };
}
