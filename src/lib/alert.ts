/** Sound, wake-lock and system notifications. Browsers only allow audio after a tap, so everything here is opt-in from a button. */
const PREF = 'wesla.alarm';
let ctx: AudioContext | null = null;
let timer: number | undefined;
let lock: { release: () => Promise<void> } | null = null;

export const alarmEnabled = () => { try { return localStorage.getItem(PREF) === '1'; } catch { return false; } };
export const setAlarmEnabled = (on: boolean) => { try { localStorage.setItem(PREF, on ? '1' : '0'); } catch { /* ignore */ } };

export function unlockAudio() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return false;
    ctx = ctx || new AC();
    void ctx.resume();
    return true;
  } catch { return false; }
}

export const audioReady = () => ctx?.state === 'running';

export function beep(freqs: number[] = [880, 660, 880]) {
  if (!ctx) return;
  try {
    let t = ctx.currentTime;
    for (const f of freqs) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.24);
      t += 0.26;
    }
  } catch { /* audio is best-effort */ }
}
export function startAlarm() { stopAlarm(); beep(); timer = window.setInterval(() => beep(), 4000); }
export function stopAlarm() { if (timer) { window.clearInterval(timer); timer = undefined; } }

export async function keepAwake(on: boolean) {
  try {
    if (!on) { await lock?.release(); lock = null; return; }
    const nav = navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    if (nav.wakeLock && !lock) lock = await nav.wakeLock.request('screen');
  } catch { lock = null; }
}

export const notifySupported = () => typeof Notification !== 'undefined';
export const notifyPermission = (): NotificationPermission | 'unsupported' => (notifySupported() ? Notification.permission : 'unsupported');
export async function askNotifyPermission() {
  if (!notifySupported()) return 'unsupported' as const;
  try { return await Notification.requestPermission(); } catch { return Notification.permission; }
}
/** Android Chrome forbids `new Notification()`; go through the service worker and fall back safely. */
export async function systemNotify(title: string, body: string, tag?: string) {
  try {
    if (!notifySupported() || Notification.permission !== 'granted') return false;
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) { await reg.showNotification(title, { body, icon: '/logo-192.png', badge: '/logo-192.png', tag, dir: 'rtl', lang: 'ar', data: { url: '/' } }); return true; }
    new Notification(title, { body, icon: '/logo-192.png', tag });
    return true;
  } catch { return false; }
}
