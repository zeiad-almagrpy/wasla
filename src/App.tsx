import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Bell, LogOut, Menu, X } from 'lucide-react';
import { configured, sb } from './lib/supabase';
import * as api from './lib/api';
import { useQuery } from './lib/hooks';
import { Empty } from './components/ui';
import Auth, { NewPassword } from './views/Auth';
import Customer from './views/Customer';
import Merchant from './views/Merchant';
import Courier from './views/Courier';
import Admin from './views/Admin';
import type { Profile } from './lib/types';

type View = 'customer' | 'merchant' | 'courier' | 'courier_pending' | 'admin';
const NAV: Record<View, [string, string][]> = {
  customer: [['home', 'استكشف المحلات'], ['orders', 'طلباتي'], ['requests', 'اطلب اللي مش لاقيه'], ['news', 'أخبار وصلة'], ['cart', 'السلة']],
  merchant: [['dashboard', 'نظرة عامة'], ['products', 'المنتجات'], ['orders', 'الطلبات'], ['requests', 'طلبات المشترين'], ['subscription', 'الاشتراك']],
  courier: [['tasks', 'مهام التوصيل'], ['history', 'سجل التوصيل']],
  courier_pending: [],
  admin: [['dashboard', 'نظرة عامة'], ['shops', 'إدارة المحلات'], ['orders', 'كل الطلبات'], ['users', 'المستخدمون'], ['newsAdmin', 'المنشورات'], ['regions', 'المناطق'], ['settings', 'إعدادات المنصة']],
};
const ROLE_AR: Record<View, string> = { customer: 'مشتري', merchant: 'صاحب محل', courier: 'مندوب توصيل', courier_pending: 'مندوب (قيد المراجعة)', admin: 'إدارة المنصة' };

const viewOf = (p: Profile): View =>
  p.role === 'admin' ? 'admin' : p.role === 'merchant' ? 'merchant' : p.role === 'courier' ? 'courier'
    : p.requested_role === 'merchant' ? 'merchant' : p.requested_role === 'courier' ? 'courier_pending' : 'customer';

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((event, s) => { setSession(s); if (event === 'PASSWORD_RECOVERY') setRecovery(true); });
    return () => data.subscription.unsubscribe();
  }, []);
  if (!configured) return <main className="welcome"><div className="welcome-card"><h1>الإعداد غير مكتمل</h1><p className="muted">أضف VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY في متغيرات البيئة ثم أعد البناء.</p></div></main>;
  if (session === undefined) return <main className="welcome"><Empty title="جارٍ التحميل…" /></main>;
  if (!session) return <Auth />;
  if (recovery) return <NewPassword onDone={() => setRecovery(false)} />;
  return <Shell userId={session.user.id} />;
}

function Shell({ userId }: { userId: string }) {
  const prof = useQuery(() => api.getProfile(userId), [userId], 60000);
  const notifications = useQuery(() => api.listNotifications(userId), [userId], 20000);
  const [tab, setTab] = useState('');
  const [menu, setMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const notify = (text: string, bad = false) => {
    setNotice({ text, bad });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice(null), 4500);
  };

  const profile = prof.data;
  if (!profile) {
    return (
      <main className="welcome"><div className="welcome-card">
        <Empty title={prof.loading ? 'جارٍ تجهيز حسابك…' : 'تعذر تحميل الحساب'} text={prof.error || undefined} />
        <div className="seg"><button className="secondary" onClick={prof.reload}>إعادة المحاولة</button><button className="secondary" onClick={() => api.signOut()}>خروج</button></div>
      </div></main>
    );
  }
  if (profile.is_blocked) {
    return <main className="welcome"><div className="welcome-card"><h1>الحساب موقوف</h1><p className="muted">تواصل مع إدارة وصلة لمعرفة السبب.</p><button className="secondary" onClick={() => api.signOut()}>خروج</button></div></main>;
  }

  const view = viewOf(profile);
  const nav = NAV[view];
  const active = nav.some(([k]) => k === tab) ? tab : nav[0]?.[0] || '';
  const title = nav.find(([k]) => k === active)?.[1] || 'وصلة';
  const common = { profile, notify, tab: active, setTab };

  return (
    <div className="app-shell">
      <header className="topbar">
        {nav.length > 0 && <button className="mobile-menu icon-btn" aria-label="القائمة" onClick={() => setMenu(!menu)}>{menu ? <X /> : <Menu />}</button>}
        <div className="brand"><img src="/public-logo.png" alt="وصلة" /><div><b>وصلة</b><small>وصلة.. بتجمعنا</small></div></div>
        <div className="top-actions"><span className="role-pill">{ROLE_AR[view]}</span><span className="user-name">{profile.full_name}</span>
          <button className="icon-btn notification-button" title="الإشعارات" aria-label="الإشعارات" onClick={async () => { setShowNotifications(!showNotifications); if (!showNotifications) { await api.markNotificationsRead(userId); await notifications.reload(); } }}><Bell size={18} />{(notifications.data || []).some((n) => !n.is_read) && <i />}</button>
          <button className="icon-btn" title="خروج" aria-label="خروج" onClick={() => api.signOut()}><LogOut size={18} /></button></div>
      </header>
      {showNotifications && <section className="notification-panel"><header><b>الإشعارات</b><button className="secondary small" onClick={() => setShowNotifications(false)}>إغلاق</button></header>{(notifications.data || []).length ? (notifications.data || []).map((n) => <article key={n.id}><b>{n.title}</b><p>{n.body}</p><small>{new Date(n.created_at).toLocaleString('ar-EG')}</small></article>) : <p className="muted">لا توجد إشعارات حاليًا.</p>}</section>}
      <div className="layout">
        {nav.length > 0 && (
          <aside className={`sidebar ${menu ? 'open' : ''}`}>
            <div className="side-caption">القائمة الرئيسية</div>
            {nav.map(([k, label]) => <button key={k} className={`nav-item ${active === k ? 'active' : ''}`} onClick={() => { setTab(k); setMenu(false); }}>{label}</button>)}
          </aside>
        )}
        <main className="content">
          <div className="page-heading"><div><p className="eyebrow">{ROLE_AR[view]}</p><h1>{title}</h1></div></div>
          {notice && <div className={`toast ${notice.bad ? 'error' : ''}`} role="status">{notice.text}</div>}
          {view === 'customer' && <Customer {...common} />}
          {view === 'merchant' && <Merchant {...common} onProfileChange={prof.reload} />}
          {view === 'courier' && <Courier {...common} />}
          {view === 'admin' && <Admin {...common} />}
          {view === 'courier_pending' && <div className="panel"><h3>حسابك قيد المراجعة</h3><p className="muted">سيقوم فريق وصلة بمراجعة بياناتك والتواصل معك. ستظهر لك مهام التوصيل بعد اعتماد حسابك. تتحدث هذه الصفحة تلقائيًا.</p></div>}
          <footer>وصلة © 2026 · وصلة.. بتجمعنا · الدفع نقدًا عند الاستلام · <a href="/terms.html">الشروط</a> · <a href="/privacy.html">الخصوصية</a></footer>
        </main>
      </div>
    </div>
  );
}
