import { useEffect, useRef, useState } from 'react';
import { BellRing, CircleCheck, MessageCircle, Volume2, VolumeX } from 'lucide-react';
import * as api from '../lib/api';
import { useQuery } from '../lib/hooks';
import { alarmEnabled, audioReady, keepAwake, setAlarmEnabled, startAlarm, stopAlarm, unlockAudio } from '../lib/alert';
import { errMsg, fmtDate, localPhone, toIntlPhone } from '../lib/utils';
import { Empty, Skeleton, Stat, Status, Switch, Thumb } from '../components/ui';
import { ImagePicker } from '../components/ImagePicker';
import type { Compressed } from '../lib/image';
import { OrdersPanel } from './Orders';
import { Requests } from './Requests';
import type { Product, Store, ViewProps } from '../lib/types';

const storeLabel = (s?: Store | null) => (!s ? 'غير مسجل' : s.status === 'active' ? 'معتمد' : s.status === 'paused' ? 'موقوف' : s.status === 'rejected' ? 'مرفوض' : 'قيد المراجعة');
const trialDays = (s: Store, length: number) => (s.trial_started_at ? Math.max(0, length - Math.floor((Date.now() - new Date(s.trial_started_at).getTime()) / 86400000)) : length);

export default function Merchant({ profile, notify, tab, setTab, onProfileChange }: ViewProps & { onProfileChange: () => void }) {
  const store = useQuery(() => api.getMyStore(profile.id), [profile.id], 60000, [`stores|owner_id=eq.${profile.id}`]);
  const regions = useQuery(api.listRegions, []);
  const s = store.data;
  const orders = useQuery(() => api.listOrders(s?.id), [s?.id], 60000, ['orders']);
  const trial = useQuery(() => api.getSetting('merchant_trial_days'), []);
  const subscriptionPrice = useQuery(() => api.getSetting('subscription_monthly_price'), []);
  const paymentMethod = useQuery(() => api.getSetting('subscription_payment_method'), []);
  const subscriptionPhone = useQuery(() => api.getSetting('subscription_whatsapp'), []);
  const trialLength = Math.min(90, Math.max(1, Number(trial.data || 30)));
  const newCount = (orders.data || []).filter((o) => o.status === 'new').length;
  const pendingPay = (orders.data || []).filter((o) => o.payment_status === 'proof_submitted' && o.status !== 'cancelled').length;

  // sound alarm: rings while there are new orders waiting, until the merchant answers them (or mutes it)
  const [alarmOn, setAlarmOn] = useState(alarmEnabled());
  const [ready, setReady] = useState(audioReady());
  const [muted, setMuted] = useState(false);
  const prevNew = useRef(0);
  useEffect(() => { if (newCount > prevNew.current) setMuted(false); prevNew.current = newCount; }, [newCount]);
  useEffect(() => {
    if (alarmOn && ready && newCount > 0 && !muted) startAlarm(); else stopAlarm();
    return () => stopAlarm();
  }, [alarmOn, ready, newCount, muted]);
  useEffect(() => {
    if (!alarmOn) { void keepAwake(false); return; }
    void keepAwake(true);
    const again = () => { if (!document.hidden) { void keepAwake(true); setReady(audioReady()); } };
    const tap = () => { unlockAudio(); setReady(audioReady()); };
    document.addEventListener('visibilitychange', again);
    window.addEventListener('pointerdown', tap, { once: true });
    return () => { document.removeEventListener('visibilitychange', again); window.removeEventListener('pointerdown', tap); void keepAwake(false); };
  }, [alarmOn]);
  const toggleAlarm = (on: boolean) => {
    if (on) { unlockAudio(); setReady(audioReady()); }
    setAlarmEnabled(on); setAlarmOn(on);
    notify(on ? 'تم تفعيل التنبيه الصوتي. اترك الشاشة مفتوحة.' : 'تم إيقاف التنبيه الصوتي');
  };

  if (store.loading && !s) return <Skeleton rows={3} />;
  if (!s && tab !== 'dashboard') return <Empty title="سجّل محلك أولًا" text="بعد إنشاء المحل وإرساله للمراجعة هتقدر تستخدم الصفحة دي." />;

  if (tab === 'orders') return <OrdersPanel role="merchant" userId={profile.id} notify={notify} storeId={s?.id} />;
  if (tab === 'requests') return s?.status === 'active' ? <Requests role="merchant" userId={profile.id} notify={notify} canPost={false} /> : <Empty title="فعّل محلك أولًا" text="تقدر ترد على طلبات المشترين بعد اعتماد المحل." />;
  if (tab === 'products' && s) return <Products store={s} userId={profile.id} notify={notify} />;
  if (tab === 'storeSettings' && s) return <StoreSettings store={s} regions={regions.data || []} notify={notify} onSaved={store.reload} />;
  if (tab === 'subscription') {
    return (
      <div className="panel subscription">
        <span className="trial-icon"><CircleCheck /></span><h2>{s?.subscription_status === 'active' ? 'اشتراك المحل نشط' : s?.subscription_status === 'expired' ? 'الاشتراك منتهٍ' : 'الفترة المجانية'}</h2>
        <p>{s?.subscription_status === 'trial' ? 'تبدأ الفترة التجريبية من تاريخ اعتماد المحل.' : 'تواصل مع إدارة وصلة لإدارة حالة الاشتراك.'}</p>
        <div className="price">{s?.subscription_status === 'active' ? (s.monthly_price || Number(subscriptionPrice.data) || 0) : s?.subscription_status === 'expired' ? (Number(subscriptionPrice.data) || 0) : 0} <small>{s?.subscription_status === 'trial' ? 'جنيه خلال الفترة المجانية' : 'جنيه شهريًا'}</small></div>
        {s?.subscription_status === 'trial' && <p>المتبقي: <b>{s.status === 'active' ? `${trialDays(s, trialLength)} يوم` : 'تبدأ بعد اعتماد المحل'}</b></p>}
        {s?.subscription_status === 'active' && s.paid_until && <p>مدفوع حتى: <b>{fmtDate(s.paid_until).split('،')[0]}</b></p>}
        {s?.subscription_status !== 'trial' && paymentMethod.data && <div className="notice-box"><b>طريقة الدفع:</b><br />{paymentMethod.data}</div>}
        {toIntlPhone(subscriptionPhone.data || '') ? <a className="primary wa-link" target="_blank" rel="noreferrer" href={`https://wa.me/${toIntlPhone(subscriptionPhone.data || '')}?text=${encodeURIComponent(`مرحبًا، بخصوص اشتراك محل ${s?.name || ''} على منصة وصلة.`)}`}><MessageCircle size={18} /> تواصل بخصوص الاشتراك عبر واتساب</a> : <div className="notice-box">للاستفسار عن الاشتراك، تواصل مع الإدارة من صفحة «تواصل مع الإدارة».</div>}
      </div>
    );
  }
  return (
    <>
      {s && s.status === 'active' && (
        <div className={`open-card ${s.is_open ? 'open' : 'closed'}`}>
          <div><b>{s.is_open ? 'المحل مفتوح ويستقبل الطلبات' : 'المحل مغلق الآن'}</b><p>{s.is_open ? 'اقفله لو مش هتقدر ترد على الطلبات.' : 'المشترين مش هيقدروا يطلبوا منك لحد ما تفتح.'}</p></div>
          <Switch checked={s.is_open} label="فتح وإغلاق المحل" onChange={async (v) => { try { await api.updateMyStore(s.id, { is_open: v }); notify(v ? 'تم فتح المحل' : 'تم إغلاق المحل'); await store.reload(); } catch (e) { notify(errMsg(e), true); } }} />
        </div>
      )}
      {newCount > 0 && <button className="new-orders-banner" onClick={() => setTab('orders')}><BellRing size={22} /> عندك {newCount} {newCount === 1 ? 'طلب جديد' : 'طلبات جديدة'} بانتظار الرد</button>}
      {pendingPay > 0 && <button className="new-orders-banner pay" onClick={() => setTab('orders')}>{pendingPay} تحويل فودافون كاش بانتظار تأكيدك</button>}
      <div className="stats">
        <Stat label="طلبات جديدة" value={newCount} tone="hot" /><Stat label="إجمالي الطلبات" value={(orders.data || []).length} />
        <Stat label="أيام التجربة المتبقية" value={s?.status === 'active' ? trialDays(s, trialLength) : '—'} /><Stat label="حالة المحل" value={storeLabel(s)} />
      </div>
      {s && (
        <div className="panel device-alert">
          <div><b>التنبيه الصوتي للطلبات</b><p className="muted">للمحل اللي شاشته مفتوحة طول اليوم: رنين متكرر لحد ما ترد على الطلب، والشاشة بتفضل صاحية.</p>{alarmOn && !ready && <p className="warn-text">اضغط في أي مكان بالصفحة لتشغيل الصوت.</p>}</div>
          <div className="alarm-controls">
            {alarmOn && newCount > 0 && ready && <button className="secondary small" onClick={() => setMuted(!muted)}>{muted ? <><Volume2 size={15} /> تشغيل</> : <><VolumeX size={15} /> كتم</>}</button>}
            <Switch checked={alarmOn} label="التنبيه الصوتي" onChange={toggleAlarm} />
          </div>
        </div>
      )}
      {!s ? <Register profileId={profile.id} regions={regions.data || []} notify={notify} onDone={() => { void store.reload(); onProfileChange(); }} /> : (
        <div className="panel">
          <h3>{s.name}</h3>
          <p>حالة المحل: <Status label={storeLabel(s)} tone={s.status === 'active' ? 'green' : s.status === 'pending' ? 'orange' : 'red'} /></p>
          <p className="muted">{s.status === 'active' ? 'أضف المنتجات واستقبل الطلبات. الصفحة بتتحدث لحظيًا.' : s.status === 'pending' ? 'هيظهر المحل للمشترين بعد اعتماده من الإدارة.' : 'تواصل مع الإدارة لمعرفة السبب.'}</p>
          <div className="action-row"><button className="primary" onClick={() => setTab('products')}>إدارة المنتجات</button><button className="secondary" onClick={() => setTab('storeSettings')}>إعدادات المحل والدفع</button></div>
        </div>
      )}
    </>
  );
}

function Register({ regions, notify, onDone }: { profileId: string; regions: { id: string; city: string }[]; notify: ViewProps['notify']; onDone: () => void }) {
  const [v, setV] = useState({ name: '', category: 'بقالة', description: '', address: '', regionId: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e: { preventDefault(): void }) => {
    e.preventDefault(); setBusy(true);
    try { await api.registerStore({ ...v, regionId: v.regionId || null }); notify('تم إرسال بيانات المحل للمراجعة'); onDone(); }
    catch (x) { notify(errMsg(x), true); }
    finally { setBusy(false); }
  };
  return (
    <div className="panel">
      <h3>سجّل محلك على وصلة</h3><p className="muted">هيظهر المحل للمشترين بعد مراجعته واعتماده من الإدارة.</p>
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

function StoreSettings({ store, regions, notify, onSaved }: { store: Store; regions: { id: string; city: string }[]; notify: ViewProps['notify']; onSaved: () => Promise<void> }) {
  const [f, setF] = useState({
    name: store.name, category: store.category, description: store.description || '', address: store.address || '', regionId: store.region_id || '',
    cash: store.accepts_cash, vf: localPhone(store.vodafone_cash_number), own: store.own_delivery, ownFee: String(store.own_delivery_fee ?? ''),
  });
  const [busy, setBusy] = useState(false);
  const save = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    const vfIntl = f.vf.trim() ? toIntlPhone(f.vf) : '';
    if (f.vf.trim() && !vfIntl) return notify('رقم فودافون كاش غير صحيح (مثال 01012345678)', true);
    if (!f.cash && !vfIntl) return notify('فعّل طريقة دفع واحدة على الأقل', true);
    const fee = f.own ? Number(f.ownFee) : null;
    if (f.own && !(fee !== null && Number.isFinite(fee) && fee >= 0 && fee <= 500)) return notify('اكتب أجرة توصيل صحيحة (من 0 إلى 500)', true);
    setBusy(true);
    try {
      await api.updateMyStore(store.id, {
        name: f.name.trim(), category: f.category.trim(), description: f.description.trim() || null, address: f.address.trim() || null,
        region_id: f.regionId || null, accepts_cash: f.cash, vodafone_cash_number: vfIntl || null, own_delivery: f.own, own_delivery_fee: fee,
      });
      notify('تم حفظ إعدادات المحل'); await onSaved();
    } catch (x) { notify(errMsg(x), true); } finally { setBusy(false); }
  };
  return (
    <form className="stack-form" onSubmit={save}>
      <div className="panel stack-form">
        <h3>بيانات المحل</h3>
        <input value={f.name} maxLength={80} required onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="اسم المحل" />
        <input value={f.category} maxLength={40} required onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="التصنيف" />
        <select value={f.regionId} onChange={(e) => setF({ ...f, regionId: e.target.value })}><option value="">اختر المنطقة</option>{regions.map((r) => <option key={r.id} value={r.id}>{r.city}</option>)}</select>
        <input value={f.address} maxLength={200} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="عنوان المحل (يظهر للمندوب)" />
        <textarea value={f.description} maxLength={500} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="وصف المحل" />
      </div>
      <div className="panel stack-form">
        <h3>طرق الدفع</h3>
        <div className="toggle-row"><span><b>كاش عند الاستلام</b><small>المشتري يدفع لما يستلم</small></span><Switch checked={f.cash} label="كاش" onChange={(v) => setF({ ...f, cash: v })} /></div>
        <label className="field-label">رقم فودافون كاش الخاص بالمحل (اتركه فاضي لو مش بتستقبل)</label>
        <input value={f.vf} inputMode="tel" dir="ltr" onChange={(e) => setF({ ...f, vf: e.target.value })} placeholder="01012345678" />
        <p className="muted tiny">المشتري بيحوّل ثمن المنتجات على الرقم ده ويكتب رقم العملية، وانت بتأكد إن الفلوس وصلت من محفظتك قبل تسليم الطلب. وصلة مش بتلمس الفلوس.</p>
      </div>
      <div className="panel stack-form">
        <h3>التوصيل بمندوب المحل</h3>
        <div className="toggle-row"><span><b>عندي دليفري خاص بالمحل</b><small>المشتري يقدر يختار توصيل من المحل، وانت بتحدد أجرة كل طلب</small></span><Switch checked={f.own} label="توصيل المحل" onChange={(v) => setF({ ...f, own: v })} /></div>
        {f.own && <input type="number" inputMode="numeric" min={0} max={500} value={f.ownFee} onChange={(e) => setF({ ...f, ownFee: e.target.value })} placeholder="الأجرة المعتادة بالجنيه (تقديرية)" />}
        {f.own && <p className="muted tiny">الأجرة دي بتظهر للمشتري كتقدير. في كل طلب انت بتكتب الأجرة الفعلية: لو كتبت نفس الأجرة المعتادة بتتأكد تلقائيًا، ولو غيّرتها المشتري لازم يوافق قبل ما الطلب يخرج. والتسليم بيتأكد بكود المشتري.</p>}
      </div>
      <button className="primary big" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}</button>
    </form>
  );
}

function Products({ store, userId, notify }: { store: Store; userId: string; notify: ViewProps['notify'] }) {
  const q = useQuery(() => api.listMyProducts(store.id), [store.id]);
  const [f, setF] = useState({ name: '', price: '', category: 'عام', description: '' });
  const [img, setImg] = useState<Compressed | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>, okMsg?: string) => { try { await fn(); if (okMsg) notify(okMsg); await q.reload(); } catch (e) { notify(errMsg(e), true); } };

  const submit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    const price = Math.round(Number(f.price) * 100) / 100;
    if (!f.name.trim() || !(price > 0) || price > 100000) return notify('اكتب اسمًا وسعرًا صحيحًا', true);
    setBusy(true);
    try {
      const path = img ? await api.uploadCompressed(userId, img) : null;
      await api.addProduct({ store_id: store.id, name: f.name.trim(), price, category: f.category.trim() || null, description: f.description.trim() || null, image_path: path, is_available: true });
      setF({ name: '', price: '', category: 'عام', description: '' }); setImg(null); notify('تمت إضافة المنتج'); await q.reload();
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
          <ImagePicker value={img} onChange={setImg} notify={notify} />
          <button className="primary" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'إضافة المنتج'}</button>
        </form>
      </div>
      <div className="panel">
        <h3>منتجات المحل</h3>
        {!q.data ? <Skeleton rows={3} /> : q.data.length ? q.data.map((p) => editing === p.id
          ? <EditProduct key={p.id} p={p} userId={userId} notify={notify} onDone={async () => { setEditing(null); await q.reload(); }} />
          : (
            <div className="list-row product-row" key={p.id}>
              <Thumb path={p.image_path} alt={p.name} className="" />
              <div><b>{p.name}</b><small>{p.category} · {p.price} ج.م {p.is_available ? '' : '· مخفي'}</small></div>
              <div className="row-actions">
                <button className="secondary small" onClick={() => setEditing(p.id)}>تعديل</button>
                <button className="secondary small" onClick={() => void act(() => api.updateProduct(p.id, { is_available: !p.is_available }))}>{p.is_available ? 'إخفاء' : 'إظهار'}</button>
                <button className="secondary small" onClick={() => { if (confirm('حذف المنتج؟')) void act(async () => { await api.deleteProduct(p.id); await api.deleteImages(p.image_path); }); }}>حذف</button>
              </div>
            </div>
          )) : <Empty title="لم تضف منتجات بعد" text="أضف أول منتج وصورته من هنا." />}
      </div>
    </>
  );
}

function EditProduct({ p, userId, notify, onDone }: { p: Product; userId: string; notify: ViewProps['notify']; onDone: () => Promise<void> }) {
  const [f, setF] = useState({ name: p.name, price: String(p.price), category: p.category || '', description: p.description || '' });
  const [img, setImg] = useState<Compressed | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    const price = Math.round(Number(f.price) * 100) / 100;
    if (!f.name.trim() || !(price > 0) || price > 100000) return notify('اكتب اسمًا وسعرًا صحيحًا', true);
    setBusy(true);
    try {
      const patch: Partial<Product> = { name: f.name.trim(), price, category: f.category.trim() || null, description: f.description.trim() || null };
      if (img) patch.image_path = await api.uploadCompressed(userId, img);
      try { await api.updateProduct(p.id, patch); }
      catch (e) { if (patch.image_path) await api.deleteImages(patch.image_path); throw e; }   // do not leave the new photo orphaned
      if (img) await api.deleteImages(p.image_path);                                       // replaced: free the old one
      notify('تم حفظ التعديل'); await onDone();
    } catch (x) { notify(errMsg(x), true); } finally { setBusy(false); }
  };
  return (
    <form className="stack-form edit-box" onSubmit={save}>
      <input value={f.name} maxLength={100} required onChange={(e) => setF({ ...f, name: e.target.value })} />
      <input type="number" inputMode="decimal" min="0.01" step="0.01" value={f.price} required onChange={(e) => setF({ ...f, price: e.target.value })} />
      <input value={f.category} maxLength={40} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="التصنيف" />
      <textarea value={f.description} maxLength={500} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="الوصف" />
      <ImagePicker value={img} onChange={setImg} notify={notify} existingPath={p.image_path} />
      <div className="action-row"><button className="primary" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button><button type="button" className="secondary" onClick={() => void onDone()}>إلغاء</button></div>
    </form>
  );
}
