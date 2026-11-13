import { Component, type ReactNode, useState } from 'react';
import { Check, Copy, MessageCircle, Package, Phone, Plus } from 'lucide-react';
import { imgUrl, thumbUrl } from '../lib/api';
import { telHref, waHref } from '../lib/utils';
import type { Product } from '../lib/types';

export function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'hot' }) {
  return <div className={`stat-card ${tone === 'hot' && Number(value) > 0 ? 'hot' : ''}`}><small>{label}</small><b>{value}</b></div>;
}
export function Empty({ title, text }: { title: string; text?: string }) {
  return <div className="empty"><Package size={30} /><b>{title}</b>{text && <p>{text}</p>}</div>;
}
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return <div className="skeleton-list" aria-busy="true" aria-label="جارٍ التحميل">{Array.from({ length: rows }, (_, i) => <div className="skeleton" key={i} />)}</div>;
}
export function Status({ label, tone }: { label: string; tone: 'green' | 'red' | 'orange' | 'blue' }) {
  return <span className={`status ${tone}`}>{label}</span>;
}
/** Shows the small thumbnail; falls back to the full image for photos uploaded before thumbnails existed. */
export function SmartImg({ path, alt, className }: { path: string; alt: string; className?: string }) {
  return <img className={className} src={thumbUrl(path)} alt={alt} loading="lazy" decoding="async"
    onError={(e) => { const t = e.currentTarget; if (t.dataset.full !== '1') { t.dataset.full = '1'; t.src = imgUrl(path); } }} />;
}
export function Thumb({ path, alt, className }: { path?: string | null; alt: string; className?: string }) {
  return path ? <SmartImg className={className} path={path} alt={alt} /> : <div className="product-visual"><Package /></div>;
}
export function ProductCard({ p, onAdd, disabled }: { p: Product; onAdd: () => void; disabled?: boolean }) {
  return (
    <div className="product-card">
      {p.image_path ? <SmartImg className="product-photo" path={p.image_path} alt={p.name} /> : <div className="product-visual"><Package size={30} /></div>}
      <small>{p.category}</small><b>{p.name}</b>
      {p.description && <p className="product-desc">{p.description}</p>}
      <strong>{p.price} ج.م</strong>
      <button className="primary small" disabled={disabled} onClick={onAdd}><Plus size={16} /> {disabled ? 'المحل مغلق' : 'أضف للسلة'}</button>
    </div>
  );
}

/** Accessible on/off switch. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <i />
    </button>
  );
}

export function CopyButton({ text, label = 'نسخ' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="chip" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); window.setTimeout(() => setDone(false), 1800); } catch { /* clipboard blocked */ } }}>
      {done ? <Check size={14} /> : <Copy size={14} />} {done ? 'تم النسخ' : label}
    </button>
  );
}

export function ContactButtons({ phone, waText }: { phone: string; waText?: string }) {
  if (!phone) return null;
  return (
    <span className="contact-btns">
      <a className="chip call" href={telHref(phone)}><Phone size={14} /> اتصال</a>
      <a className="chip wa" href={waHref(phone, waText)} target="_blank" rel="noreferrer"><MessageCircle size={14} /> واتساب</a>
    </span>
  );
}

/** Catches render errors so one bad screen never blanks the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) { console.error(err); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="welcome"><div className="welcome-card">
        <h1>حصلت مشكلة غير متوقعة</h1>
        <p className="muted">حدّث الصفحة وجرّب تاني. لو المشكلة استمرت تواصل مع الإدارة.</p>
        <button className="primary" onClick={() => window.location.reload()}>تحديث الصفحة</button>
      </div></main>
    );
  }
}
