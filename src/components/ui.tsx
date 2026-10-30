import { Package, Plus } from 'lucide-react';
import { imgUrl } from '../lib/api';
import type { Product } from '../lib/types';

export function Stat({ label, value }: { label: string; value: string | number }) {
  return <div className="stat-card"><small>{label}</small><b>{value}</b></div>;
}
export function Empty({ title, text }: { title: string; text?: string }) {
  return <div className="empty"><Package size={30} /><b>{title}</b>{text && <p>{text}</p>}</div>;
}
export function Status({ label, tone }: { label: string; tone: 'green' | 'red' | 'orange' }) {
  return <span className={`status ${tone}`}>{label}</span>;
}
export function Thumb({ path, alt, className }: { path?: string | null; alt: string; className?: string }) {
  return path ? <img className={className} src={imgUrl(path)} alt={alt} loading="lazy" /> : <div className="product-visual"><Package /></div>;
}
export function ProductCard({ p, onAdd }: { p: Product; onAdd: () => void }) {
  return (
    <div className="product-card">
      {p.image_path ? <img className="product-photo" src={imgUrl(p.image_path)} alt={p.name} loading="lazy" /> : <div className="product-visual"><Package size={30} /></div>}
      <small>{p.category}</small><b>{p.name}</b>
      {p.description && <p className="product-desc">{p.description}</p>}
      <strong>{p.price} ج.م</strong>
      <button className="primary small" onClick={onAdd}><Plus size={16} /> أضف للسلة</button>
    </div>
  );
}
