import { useState } from 'react';
import { ImagePlus, Megaphone } from 'lucide-react';
import * as api from '../lib/api';
import { useQuery } from '../lib/hooks';
import { errMsg, fmtDate, toIntlPhone } from '../lib/utils';
import { Empty, Stat, Status } from '../components/ui';
import { OrdersPanel } from './Orders';
import { Requests } from './Requests';
import type { Store, ViewProps } from '../lib/types';

const storeLabel = (s: Store) => ({ active: 'معتمد', paused: 'موقوف', pending: 'قيد المراجعة', rejected: 'مرفوض' }[s.status]);

export default function Admin({ profile, notify, tab }: ViewProps) {
  const stores = useQuery(api.adminListStores, [], 30000);
  const users = useQuery(api.adminListUsers, [], 30000);
  const orders = useQuery(api.listOrders, [], 30000);
  const regions = useQuery(api.listRegions, []);
  const news = useQuery(api.listAnnouncements, []);
  const support = useQuery(() => api.getSetting('support_whatsapp'), []);
  const [rg, setRg] = useState({ city: '', governorate: '' });
  const [sp, setSp] = useState<string | null>(null);
  const [ad, setAd] = useState({ title: '', body: '' });
  const [file, setFile] = useState<File | null>(null);

  const act = async (fn: () => Promise<unknown>, reload: () => Promise<void>, okMsg?: string) => {
    try { await fn(); if (okMsg) notify(okMsg); await reload(); } catch (e) { notify(errMsg(e), true); }
  };

  if (tab === 'shops') {
    return (
      <div className="panel"><h3>إدارة المحلات</h3>
        {!stores.data ? <Empty title="جارٍ التحميل…" /> : stores.data.length ? stores.data.map((s) => (
          <div className="list-row" key={s.id}>
            <div><b>{s.name}</b><small>{s.category} · {s.profiles?.full_name} · {s.profiles?.phone} · {fmtDate(s.created_at)}</small></div>
            <Status label={storeLabel(s)} tone={s.status === 'active' ? 'green' : s.status === 'pending' ? 'orange' : 'red'} />
            {(s.status === 'pending' || s.status === 'rejected') && <button className="primary small" onClick={() => act(() => api.adminSetStoreStatus(s.id, 'active'), stores.reload, 'تم اعتماد المحل')}>اعتماد وبدء التجربة</button>}
            {s.status === 'pending' && <button className="secondary small" onClick={() => act(() => api.adminSetStoreStatus(s.id, 'rejected'), stores.reload)}>رفض</button>}
            {(s.status === 'active' || s.status === 'paused') && <button className="secondary small" onClick={() => act(() => api.adminSetStoreStatus(s.id, s.status === 'paused' ? 'active' : 'paused'), stores.reload)}>{s.status === 'paused' ? 'تفعيل' : 'إيقاف'}</button>}
          </div>
        )) : <Empty title="لا توجد محلات مسجلة" text="ستظهر هنا طلبات تسجيل المحلات." />}
      </div>
    );
  }
  if (tab === 'orders') return <OrdersPanel role="admin" userId={profile.id} notify={notify} />;
  if (tab === 'users') {
    return (
      <div className="panel"><h3>المستخدمون</h3>
        <p className="muted">طلبات اعتماد المندوبين تظهر أولًا. المندوب لا يرى أي مهام قبل اعتمادك.</p>
        {!users.data ? <Empty title="جارٍ التحميل…" /> : [...users.data].sort((a, b) => Number(b.requested_role === 'courier' && b.role === 'customer') - Number(a.requested_role === 'courier' && a.role === 'customer')).map((u) => (
          <div className="list-row" key={u.id}>
            <div><b>{u.full_name || '—'}</b><small>{u.phone} · {u.role}{u.requested_role !== u.role && u.role === 'customer' ? ` (طلب: ${u.requested_role})` : ''}{u.is_blocked ? ' · محظور' : ''}</small></div>
            {u.requested_role === 'courier' && u.role === 'customer' && <button className="primary small" onClick={() => act(() => api.adminSetRole(u.id, 'courier'), users.reload, 'تم اعتماد المندوب')}>اعتماد كمندوب</button>}
            {u.id !== profile.id && <button className="secondary small" onClick={() => { if (confirm(u.is_blocked ? 'إلغاء الحظر؟' : 'حظر هذا المستخدم؟ سيتم إيقاف محله إن وجد.')) act(() => api.adminSetBlocked(u.id, !u.is_blocked), users.reload); }}>{u.is_blocked ? 'إلغاء الحظر' : 'حظر'}</button>}
          </div>
        ))}
      </div>
    );
  }
  if (tab === 'newsAdmin') {
    return (
      <>
        <div className="panel"><h3>إنشاء منشور للمشترين</h3>
          <form className="stack-form" onSubmit={async (e) => {
            e.preventDefault(); if (!ad.title.trim() || !ad.body.trim()) return;
            try { const path = file ? await api.uploadImage(profile.id, file) : null; await api.saveAnnouncement(profile.id, ad.title.trim(), ad.body.trim(), path); setAd({ title: '', body: '' }); setFile(null); notify('تم نشر الإعلان'); await news.reload(); }
            catch (x) { notify(errMsg(x), true); }
          }}>
            <input value={ad.title} maxLength={120} onChange={(e) => setAd({ ...ad, title: e.target.value })} placeholder="عنوان المنشور" required />
            <textarea value={ad.body} maxLength={3000} onChange={(e) => setAd({ ...ad, body: e.target.value })} placeholder="محتوى المنشور" required />
            <label className="upload-button"><ImagePlus size={18} /> {file ? file.name : 'إضافة صورة اختيارية'}<input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
            <button className="primary"><Megaphone size={16} /> نشر للمشترين</button>
          </form>
        </div>
        <div className="panel"><h3>المنشورات الحالية</h3>
          {(news.data || []).length ? (news.data || []).map((a) => (
            <div className="list-row" key={a.id}>
              <div><b>{a.title}</b><small>{fmtDate(a.created_at)}</small></div>
              <Status label={a.status === 'published' ? 'منشور' : 'مخفي'} tone={a.status === 'published' ? 'green' : 'orange'} />
              <button className="secondary" onClick={() => act(() => api.setAnnouncementStatus(a.id, a.status === 'published' ? 'archived' : 'published'), news.reload)}>{a.status === 'published' ? 'إخفاء' : 'نشر'}</button>
              <button className="secondary" onClick={() => { if (confirm('حذف المنشور؟')) act(() => api.deleteAnnouncement(a.id), news.reload); }}>حذف</button>
            </div>
          )) : <Empty title="لا توجد منشورات" />}
        </div>
        <Requests role="admin" userId={profile.id} notify={notify} canPost={false} />
      </>
    );
  }
  if (tab === 'regions') {
    return (
      <>
        <div className="panel"><h3>إضافة منطقة جديدة</h3>
          <form className="form-row" onSubmit={(e) => { e.preventDefault(); if (!rg.city.trim()) return; act(() => api.addRegion(rg.city.trim(), rg.governorate.trim()), regions.reload, 'تمت إضافة المنطقة').then(() => setRg({ city: '', governorate: '' })); }}>
            <input value={rg.city} maxLength={60} onChange={(e) => setRg({ ...rg, city: e.target.value })} placeholder="المدينة أو المركز" required />
            <input value={rg.governorate} onChange={(e) => setRg({ ...rg, governorate: e.target.value })} placeholder="المحافظة" />
            <button className="primary">إضافة المنطقة</button>
          </form>
        </div>
        <div className="panel"><h3>المناطق المتاحة</h3>
          {(regions.data || []).map((r) => <div className="list-row" key={r.id}><div><b>{r.city}</b><small>{r.governorate}</small></div><button className="secondary" onClick={() => { if (confirm('حذف المنطقة؟')) act(() => api.deleteRegion(r.id), regions.reload); }}>حذف</button></div>)}
        </div>
      </>
    );
  }
  if (tab === 'settings') {
    const val = sp ?? support.data ?? '';
    return (
      <div className="panel"><h3>إعدادات التواصل</h3>
        <label className="field-label">رقم واتساب الدعم</label>
        <form className="form-row" onSubmit={(e) => { e.preventDefault(); const wa = toIntlPhone(val); if (val.trim() && !wa) return notify('رقم غير صحيح. مثال: 01012345678', true); act(() => api.setSetting('support_whatsapp', wa), support.reload, 'تم حفظ رقم الدعم'); }}>
          <input value={val} onChange={(e) => setSp(e.target.value)} placeholder="01xxxxxxxxx" /><button className="primary">حفظ الإعدادات</button>
        </form>
      </div>
    );
  }

  const o = orders.data || [];
  return (
    <>
      <div className="stats">
        <Stat label="المحلات" value={(stores.data || []).length} /><Stat label="الطلبات" value={o.length} />
        <Stat label="محلات قيد المراجعة" value={(stores.data || []).filter((s) => s.status === 'pending').length} />
        <Stat label="مناديب بانتظار الاعتماد" value={(users.data || []).filter((u) => u.requested_role === 'courier' && u.role === 'customer').length} />
      </div>
      <div className="panel"><h3>أحدث الطلبات</h3><OrdersPanel role="admin" userId={profile.id} notify={notify} filter={(x) => o.slice(0, 5).some((y) => y.id === x.id)} /></div>
    </>
  );
}
