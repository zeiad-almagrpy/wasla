import { useCallback, useEffect, useRef, useState } from 'react';
import { sb } from './supabase';
import { errMsg } from './utils';

/**
 * Loads data, keeps it fresh. `live` = Realtime subscriptions ("table" or "table|column=eq.value");
 * any change reloads (debounced). Polling stays as a slow safety net, and also reloads when the tab becomes visible again.
 */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[] = [], pollMs = 0, live: string[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(async () => {
    try { setData(await fn()); setError(''); }
    catch (e) { setError(errMsg(e)); }
    finally { setLoading(false); }
  }, deps);
  const runRef = useRef(run);
  runRef.current = run;
  const liveKey = live.join(',');
  useEffect(() => {
    run();
    const poll = liveKey ? Math.max(pollMs, 60000) : pollMs;
    const t = poll ? window.setInterval(() => { if (!document.hidden) runRef.current(); }, poll) : undefined;
    const onVisible = () => { if (!document.hidden) runRef.current(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { if (t) window.clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [run, pollMs, liveKey]);
  useEffect(() => {
    if (!liveKey) return;
    let timer: number | undefined;
    const channel = sb.channel(`live-${liveKey}-${Math.random().toString(36).slice(2, 8)}`);
    for (const spec of liveKey.split(',')) {
      const [table, filter] = spec.split('|');
      channel.on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => runRef.current(), 350);
      });
    }
    channel.subscribe();
    return () => { window.clearTimeout(timer); void sb.removeChannel(channel); };
  }, [liveKey]);
  return { data, loading, error, reload: run };
}
