import { useEffect, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { compressImage, formatBytes, type Compressed } from '../lib/image';
import { errMsg } from '../lib/utils';
import { SmartImg } from './ui';
import type { Notify } from '../lib/types';

/** Pick any photo; it is shrunk on the phone before upload, and the owner sees the result (size before / after). */
export function ImagePicker({ value, onChange, notify, existingPath, label = 'إضافة صورة' }: {
  value: Compressed | null; onChange: (c: Compressed | null) => void; notify: Notify; existingPath?: string | null; label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState('');
  useEffect(() => {
    if (!value) { setPreview(''); return; }
    const url = URL.createObjectURL(value.thumb); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);
  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setBusy(true);
    try { onChange(await compressImage(file)); } catch (x) { notify(errMsg(x), true); } finally { setBusy(false); }
  };
  return (
    <div className="image-picker">
      <label className="upload-button"><ImagePlus size={18} /> {busy ? 'جارٍ تجهيز الصورة…' : value || existingPath ? 'تغيير الصورة' : label}
        <input type="file" accept="image/*" disabled={busy} onChange={pick} /></label>
      {value ? (
        <div className="picked"><img src={preview} alt="معاينة" width={56} height={56} />
          <p>الصورة جاهزة. كانت <b>{formatBytes(value.originalBytes)}</b> وبقت <b>{formatBytes(value.main.size)}</b>.</p>
          <button type="button" className="icon-btn" aria-label="إزالة الصورة" onClick={() => onChange(null)}><Trash2 size={16} /></button></div>
      ) : existingPath ? <div className="picked"><SmartImg path={existingPath} alt="الصورة الحالية" className="cur" /><p className="muted">الصورة الحالية</p></div>
        : <p className="muted tiny">ارفع الصورة بأي حجم، وبنصغّرها لك تلقائيًا.</p>}
    </div>
  );
}
