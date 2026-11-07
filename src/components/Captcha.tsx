import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, o: { sitekey: string; callback: (t: string) => void; 'expired-callback': () => void; 'error-callback': () => void; language: string; theme: string }) => string;
      reset: (id?: string) => void; remove: (id: string) => void;
    };
  }
}
export const TURNSTILE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
let loading: Promise<void> | null = null;
const loadScript = () => (loading ||= new Promise<void>((resolve, reject) => {
  if (window.turnstile) return resolve();
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  s.async = true; s.onload = () => resolve(); s.onerror = () => { loading = null; reject(new Error('captcha')); };
  document.head.appendChild(s);
}));

/** Cloudflare Turnstile. Renders nothing when VITE_TURNSTILE_SITE_KEY is not set. `resetKey` must change after every submit (tokens are single-use). */
export function Captcha({ onToken, resetKey }: { onToken: (t: string) => void; resetKey: number }) {
  const box = useRef<HTMLDivElement>(null);
  const id = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!TURNSTILE_KEY) return;
    let dead = false;
    loadScript().then(() => {
      if (dead || !box.current || !window.turnstile) return;
      id.current = window.turnstile.render(box.current, {
        sitekey: TURNSTILE_KEY, language: 'ar', theme: 'light',
        callback: onToken, 'expired-callback': () => onToken(''), 'error-callback': () => onToken(''),
      });
    }).catch(() => onToken(''));
    return () => { dead = true; if (id.current && window.turnstile) window.turnstile.remove(id.current); id.current = undefined; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (id.current && window.turnstile) { onToken(''); window.turnstile.reset(id.current); } }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!TURNSTILE_KEY) return null;
  return <div className="captcha" ref={box} />;
}
