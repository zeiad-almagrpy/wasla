import { useEffect, useState } from 'react';
import { CircleCheck, ImagePlus } from 'lucide-react';
import * as api from '../lib/api';
import { useQuery } from '../lib/hooks';
import { errMsg } from '../lib/utils';
import { Empty, Stat, Status, Thumb } from '../components/ui';
import { OrdersPanel } from './Orders';
import { Requests } from './Requests';
import type { Store, ViewProps } from '../lib/types';

const storeLabel = (s?: Store | null) => (!s ? 'غير مسجل' : s.status === 'active' ? 'معتمد' : s.status === 'paused' ? 'موقوف' : s.status === 'rejected' ? 'مرفوض' : 'قيد المراجعة');
const trialDays = (s: Store, length: number) => (s.trial_started_at ? Math.max(0, length - Math.floor((Date.now() - new Date(s.trial_started_at).getTime()) / 86400000)) : length);

export default function Merchant({ profile, notify, tab, setTab, onProfileChange }: ViewProps & { onProfileChange: () => void }) {
  const store = useQuery(() => api.getMyStore(profile.id), [profile.id], 30000);
  const regions = useQuery(api.listRegions, []);
  const orders = useQuery(api.listOrders, [], 20000);
  const trial = useQuery(() => api.getSetting('merchant_trial_days'), []);
  const trialLength = Math.min(90, Math.max(1, Number(trial.data || 30)));
  const s = store.data;
  const newCount = (orders.data || []).filter((o) => o.status === 'new').length;
  useEffect(() => { document.title = newCount ? `(${newCount}) طلبات جديدة | وصلة` : 'وصلة'; return () => { document.title = 'وصلة'; }; }, [newCount]);

  if (store.loading && !s) return <Empty title="جارٍ التحميل…" />;
  if (!s && tab !== 'dashboard') return <Empty title="سجّل محلك أولًا" text="بعد إنشاء المحل وإرساله للمراجعة ستتمكن من استخدام هذه الصفحة." />;

  if (tab === 'orders') return <OrdersPanel role="merchant" userId={profile.id} notify={notify} storeId={s?.id} />;
  if (tab === 'requests') return s?.status === 'active' ? <Requests role="merchant" userId={profile.id} notify={notify} canPost={false} /> : <Empty title="فعّل محلك أولًا" text="يمكنك الرد على طلبات المشترين بعد اعتماد المحل." />;
  if (tab === 'products' && s) return <Products store={s} userId={profile.id} notify={notify} />;
  if (tab === 'subscription') {
    return (
      <div className="panel subscription">
        <span className="trial-icon"><CircleCheck /></span><h2>{s?.subscription_status === 'active' ? 'اشتراك المحل نشط' : s?.subscription_status === 'expired' ? 'الاشتراك منتهٍ' : 'الفترة المجانية'}</h2>
        <p>{s?.subscription_status === 'trial' ? 'تبدأ الفترة التجريبية من تاريخ اعتماد المحل.' : 'تواصل مع إدارة وصلة لإدارة حالة الاشتراك.'}</p>
        <div className="price">{s?.subscription_status === 'active' ? (s.monthly_price || 0) : 0} <small>{s?.subscription_status === 'active' ? 'جنيه شهريًا' : 'جنيه خلال الفترة المجانية'}</small></div>
        {s?.subscription_status === 'trial' && <p>المتبقي: <b>{s.status === 'active' ? `${trialDays(s, trialLength)} يوم` : 'تبدأ بعد اعتماد المحل'}</b></p>}
        <div className="notice-box">تُدار حالة الاشتراك حاليًا من إدارة وصلة.</div>
      </div>
    );
  }
  return (
    <>
      <div className="stats">
        <Stat label="طلبات جديدة" value={newCount} /><Stat label="إجمالي الطلبات" value={(orders.data || []).length} />
        <Stat label="أيام التجربة المتبقية" value={s?.status === 'active' ? trialDays(s, trialLength) : '—'} /><Stat label="حالة المحل" value={storeLabel(s)} />
      </div>
      {!s ? <Register profileId={profile.id} regions={regions.data || []} notify={notify} onDone={() => { store.reload(); onProfileChange(); }} /> : (
        <div className="panel">
          <h3>{s.name}</h3>
          <p>حالة المحل: <Status label={storeLabel(s)} tone={s.status === 'active' ? 'green' : s.status === 'pending' ? 'orange' : 'red'} /></p>
          <p className="muted">{s.status === 'active' ? 'أضف المنتجات واستقبل الطلبات. الصفحة تتحدّث تلقائيًا كل 20 ثانية.' : s.status === 'pending' ? 'سيظهر المحل للمشترين بعد اعتماده من الإدارة.' : 'تواصل مع الإدارة لمعرفة السبب.'}</p>
          <button className="primary" onClick={() => setTab('products')}>إدارة المنتجات</button>
        </div>
      )}
    </>
  );
}

function Register({ regions, notify, onDone }: { profileId: string; regions: { id: string; city: string }[]; notify: ViewProps['notify']; onDone: () => void }) {
  const [v, setV] = useState({ name: '', category: 'بقالة', description: '', address: '', regionId: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    setBusy(true);
    try { await api.registerStore({ ...v, regionId: v.regionId || null }); notify('تم إرسال بيانات المحل للمراجعة'); onDone(); }
    catch (x) { notify(errMsg(x), true); }
    finally { setBusy(false); }
  };
  return (
    <div className="panel">
      <h3>سجّل محلك على وصلة</h3><p className="muted">سيظهر المحل للمشترين بعد مراجعته واعتماده من الإدارة.</p>
      <form className="stack-form" onSubmit={submit}>
        <input value={v.name} maxLength={80} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="اسم المحل" required />
        <input value={v.category} maxLength={40} onChange={(e) => setV({ ...v, category: e.target.value })} placeholder="التصنيف" required />
        <select value={v.regionId} onChange={(e) => setV({ ...v, regionId: e.target.value })}><option value="">اختر المنطقة</option>{regions.map((r) => <option key={r.id} value={r.id}>{r.city}</option>)}</select>
        <input value={v.address} maxLength={200} onChange={(e) => setV({ ...v, address: e.target.value })} placeholder="عنوان المحل (يظهر للمندوب)" />
        <textarea value={v.description} maxLength={500} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder="وصف المحل (اختياري)" />
        <button className="primary" disabled={busy}>{busy ? 'جارٍ الإرسال…' : 'إرسال للمراجعة'}</button>
      </form>
    </div>
  );
}

function Products({ store, userId, notify }: { store: Store; userId: string; notify: ViewProps['notify'] }) {
  const q = useQuery(() => api.listMyProducts(store.id), [store.id]);
  const [f, setF] = useState({ name: '', price: '', category: 'عام', description: '' });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>, okMsg?: string) => { try { await fn(); if (okMsg) notify(okMsg); await q.reload(); } catch (e) { notify(errMsg(e), true); } };

  const submit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    const price = Math.round(Number(f.price) * 100) / 100;
    if (!f.name.trim() || !(price > 0) || price > 100000) return notify('اكتب اسمًا وسعرًا صحيحًا', true);
    setBusy(true);
    try {
      const path = file ? await api.uploadImage(userId, file) : null;
      await api.addProduct({ store_id: store.id, name: f.name.trim(), price, category: f.category.trim() || null, description: f.description.trim() || null, image_path: path, is_available: true });
      setF({ name: '', price: '', category: 'عام', description: '' }); setFile(null); notify('تمت إضافة المنتج'); await q.reload();
    } catch (x) { notify(errMsg(x), true); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="panel">
        <h3>إضافة منتج جديد</h3>
        <form className="stack-form" onSubmit={submit}>
          <input value={f.name} maxLength={100} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="اسم المنتج" required />
          <input type="number" inputMode="decimal" min="0.01" step="0.01" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} placeholder="السعر بالجنيه" required />
          <input value={f.category} maxLength={40} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="التصنيف" />
          <textarea value={f.description} maxLength={500} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="وصف المنتج (اختياري)" />
          <label className="upload-button"><ImagePlus size={18} /> {file ? file.name : 'إضافة صورة'}<input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
          <button className="primary" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'إضافة المنتج'}</button>
        </form>
      </div>
      <div className="panel">
        <h3>منتجات المحل</h3>
        {!q.data ? <Empty title="جارٍ التحميل…" /> : q.data.length ? q.data.map((p) => (
          <div className="list-row product-row" key={p.id}>
            <Thumb path={p.image_path} alt={p.name} className="" />
            <div><b>{p.name}</b><small>{p.category}</small></div><strong>{p.price} ج.م</strong>
            <button className="secondary" onClick={() => {
              const raw = window.prompt('السعر الجديد بالجنيه', String(p.price)); if (raw === null) return;
              const v = Math.round(Number(raw) * 100) / 100;
              if (!(v > 0) || v > 100000) return notify('سعر غير صالح', true);
              act(() => api.updateProduct(p.id, { price: v }), 'تم تعديل السعر');
            }}>تعديل السعر</button>
            <button className="secondary" onClick={() => act(() => api.updateProduct(p.id, { is_available: !p.is_available }))}>{p.is_available ? 'إخفاء' : 'إظهار'}</button>
            <button className="secondary" onClick={() => { if (confirm('حذف المنتج؟')) act(() => api.deleteProduct(p.id)); }}>حذف</button>
          </div>
        )) : <Empty title="لم تضف منتجات بعد" text="أضف أول منتج وصورته من هنا." />}
      </div>
    </>
  );
}
