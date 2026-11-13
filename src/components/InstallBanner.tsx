import { useEffect, useState } from 'react';
import { BellRing, Download, MoreVertical, Smartphone, Share, X, Zap } from 'lucide-react';
import { dismissInstall, promptInstall, reopenInstall, useInstall } from '../lib/install';
import { CopyButton } from './ui';

const BENEFITS: [typeof Zap, string][] = [[Zap, 'تفتحها بضغطة واحدة زي أي تطبيق'], [BellRing, 'تنبيهات الطلبات توصلك أسرع'], [Smartphone, 'شاشة كاملة بدون شريط المتصفح']];

/**
 * Asks visitors to put Wesla on their home screen. Phones get a bottom sheet with the benefits and the exact steps;
 * desktops get a small corner card. Android/desktop Chrome: native prompt. iPhone and other Android browsers: steps. In-app browsers: "open in your browser".
 */
export function InstallBanner({ aboveNav = false, delayMs = 400 }: { aboveNav?: boolean; delayMs?: number }) {
  const { mode } = useInstall();
  const [ready, setReady] = useState(delayMs === 0);
  useEffect(() => { if (delayMs === 0) return; const t = window.setTimeout(() => setReady(true), delayMs); return () => window.clearTimeout(t); }, [delayMs]);
  if (mode === 'none' || !ready) return null;
  return (
    <>
      <div className="install-backdrop" onClick={dismissInstall} />
      <section className={`install-banner ${aboveNav ? 'above-nav' : ''}`} role="dialog" aria-modal="true" aria-label="تثبيت التطبيق">
        <button className="icon-btn ib-close" aria-label="لاحقًا" onClick={dismissInstall}><X size={16} /></button>
        <img src="/logo-192.png" alt="" width={52} height={52} />
        <div className="ib-text">
          {mode === 'inapp' ? <><b>افتح الرابط في المتصفح</b><p>أنت داخل متصفح تطبيق آخر (واتساب أو فيسبوك) ومش هتقدر تثبّت منه. افتح الرابط في Chrome أو Safari عشان تضيف وصلة لشاشتك الرئيسية.</p></>
            : <><b>ضيف وصلة لشاشتك الرئيسية</b><p>بتفتح بسرعة وبتوصلك تنبيهات طلباتك.</p></>}
          {mode !== 'inapp' && <ul className="ib-benefits">{BENEFITS.map(([Icon, t]) => <li key={t}><Icon size={16} />{t}</li>)}</ul>}
          {mode === 'ios' && <ol className="ib-steps"><li>اضغط زر المشاركة <Share size={15} className="ib-ico" /> في أسفل المتصفح</li><li>اختر <b>«إضافة إلى الشاشة الرئيسية»</b></li><li>اضغط <b>«إضافة»</b></li></ol>}
          {mode === 'android' && <p className="muted tiny">لو ظهر زر «تثبيت الآن» بعد ثواني، اضغط عليه وهيبقى أسهل.</p>}
          {mode === 'android' && <ol className="ib-steps"><li>اضغط القائمة <MoreVertical size={15} className="ib-ico" /> أعلى المتصفح</li><li>اختر <b>«تثبيت التطبيق»</b> أو <b>«إضافة إلى الشاشة الرئيسية»</b></li><li>أكّد بالضغط على <b>«تثبيت»</b></li></ol>}
        </div>
        <div className="ib-actions">
          {mode === 'prompt' && <button className="primary" onClick={() => void promptInstall()}><Download size={16} /> تثبيت الآن</button>}
          {mode === 'inapp' && <CopyButton text={window.location.href} label="نسخ الرابط" />}
          <button className="secondary small" onClick={dismissInstall}>{mode === 'ios' || mode === 'android' ? 'تمام، فهمت' : 'لاحقًا'}</button>
        </div>
      </section>
    </>
  );
}

/** Small always-available entry point once the message was dismissed (hidden while installed / when install is impossible). */
export function InstallButton({ className = '' }: { className?: string }) {
  const { mode, available } = useInstall();
  if (!available || mode !== 'none') return null;
  return <button type="button" className={`install-chip ${className}`} onClick={reopenInstall}><Download size={15} /> ثبّت التطبيق</button>;
}
