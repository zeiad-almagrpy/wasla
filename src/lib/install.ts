import { useSyncExternalStore } from 'react';

/** "Add to home screen" logic. Imported from main.tsx so the browser's one-shot `beforeinstallprompt` event is never missed. */
type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
export type InstallMode = 'none' | 'prompt' | 'ios' | 'android' | 'inapp';

const KEY = 'wesla.install.dismissed';
const SNOOZE_MS = 24 * 3600 * 1000;   // "later" hides the message for one day (the top-bar button brings it back any time)
let deferred: BIPEvent | null = null;
let installed = false;
let version = 0;
const subs = new Set<() => void>();
const emit = () => { version++; subs.forEach((f) => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BIPEvent; emit(); });
  window.addEventListener('appinstalled', () => { installed = true; deferred = null; emit(); });
}

export const isStandalone = () =>
  Boolean(window.matchMedia?.('(display-mode: standalone)').matches) || (navigator as unknown as { standalone?: boolean }).standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = () => /android/i.test(navigator.userAgent);
/** Facebook / Instagram / WhatsApp / TikTok in-app browsers and Android WebViews cannot install a PWA. */
export const inAppBrowser = () => /FBAN|FBAV|Instagram|Line\/|Messenger|MicroMessenger|WhatsApp|Snapchat|TikTok|; wv\)/i.test(navigator.userAgent);
const snoozed = () => { try { return Date.now() - Number(localStorage.getItem(KEY) || 0) < SNOOZE_MS; } catch { return false; } };

/** Lets the person bring the message back after dismissing it (the "install" button in the top bar / sign-in card). */
export function reopenInstall() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } emit(); }
export function dismissInstall() { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ } emit(); }
export async function promptInstall() {
  if (!deferred) return false;
  const e = deferred; deferred = null; emit();
  try { await e.prompt(); const c = await e.userChoice; if (c.outcome !== 'accepted') dismissInstall(); return c.outcome === 'accepted'; }
  catch { return false; }
}
export const __resetInstallForTests = () => { deferred = null; installed = false; try { localStorage.removeItem(KEY); } catch { /* ignore */ } emit(); };

const modeNow = (): InstallMode => {
  if (installed || isStandalone() || snoozed()) return 'none';
  if (inAppBrowser()) return 'inapp';
  if (deferred) return 'prompt';
  if (isIOS()) return 'ios';
  if (isAndroid()) return 'android'; // Chrome did not offer the native prompt (Firefox, Samsung, Opera...): show manual steps
  return 'none';
};
export function useInstall() {
  useSyncExternalStore(subscribe, () => version, () => 0);
  const open = !installed && !isStandalone();
  return { mode: modeNow(), hasPrompt: Boolean(deferred) && open, available: open && (Boolean(deferred) || isIOS() || isAndroid() || inAppBrowser()) };
}
