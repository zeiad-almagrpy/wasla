import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { BadgeDollarSign, Bell, Bike, ClipboardList, Download, Headset, History, LayoutDashboard, LogOut, type LucideIcon, Megaphone, MapPin, MessageSquarePlus, MoreHorizontal, Navigation, Newspaper, Package, Settings, Settings2, ShoppingCart, Store, Users, X } from 'lucide-react';
import { configured, sb } from './lib/supabase';
import * as api from './lib/api';
import { useQuery } from './lib/hooks';
import { cartCount, useCart } from './lib/cart';
import { alarmEnabled, askNotifyPermission, beep, notifyPermission, setAlarmEnabled, systemNotify, unlockAudio } from './lib/alert';
import { fmtDate } from './lib/utils';
import { promptInstall, useInstall } from './lib/install';
import { InstallBanner, InstallButton } from './components/InstallBanner';
import { Empty, Skeleton } from './components/ui';
import Auth, { NewPassword } from './views/Auth';
import Customer from './views/Customer';
import Merchant from './views/Merchant';
import Courier from './views/Courier';
import Admin from './views/Admin';
import { SupportPanel } from './views/Support';
import type { Profile } from './lib/types';

type View = 'customer' | 'merchant' | 'courier' | 'courier_pending' | 'admin';
const NAV: Record<View, [string, string][]> = {
  customer: [['home', 'المحلات'], ['orders', 'طلباتي'], ['cart', 'السلة'], ['requests', 'اطلب اللي مش لاقيه'], ['news', 'أخبار وصلة'], ['support', 'تواصل مع الإدارة']],
  merchant: [['dashboard', 'الرئيسية'], ['orders', 'الطلبات'], ['products', 'المنتجات'], ['storeSettings', 'إعدادات المحل'], ['requests', 'طلبات المشترين'], ['subscription', 'الاشتراك'], ['support', 'تواصل مع الإدارة']],
  courier: [['tasks', 'مهام التوصيل'], ['history', 'سجل التوصيل'], ['support', 'تواصل مع الإدارة']],
  courier_pending: [],
  admin: [['dashboard', 'نظرة عامة'], ['shops', 'المحلات'], ['orders', 'كل الطلبات'], ['users', 'المستخدمون'], ['subscriptions', 'الاشتراكات'], ['zones', 'مناطق التوصيل'], ['regions', 'المدن'], ['newsAdmin', 'المنشورات'], ['supportAdmin', 'رسائل الدعم'], ['settings', 'إعدادات المنصة']],
};
const PRIMARY: Record<View, number> = { customer: 3, merchant: 3, courier: 3, courier_pending: 0, admin: 3 };
const ICONS: Record<string, LucideIcon> = {
  home: Store, orders: ClipboardList, cart: ShoppingCart, requests: MessageSquarePlus, news: Newspaper, support: Headset,
  dashboard: LayoutDashboard, products: Package, storeSettings: Settings2, subscription: BadgeDollarSign,
  tasks: Bike, history: History, shops: Store, users: Users, subscriptions: BadgeDollarSign, zones: Navigation, regions: MapPin,
  newsAdmin: Megaphone, supportAdmin: Headset, settings: Settings,
};
const ORDERS_TAB: Record<View, string> = { customer: 'orders', merchant: 'orders', courier: 'tasks', admin: 'orders', courier_pending: '' };
const ROLE_AR: Record<View, string> = { customer: 'مشتري', merchant: 'صاحب محل', courier: 'مندوب توصيل', courier_pending: 'مندوب (قيد المراجعة)', admin: 'إدارة المنصة' };

const viewOf = (p: Profile): View =>
  p.role === 'admin' ? 'admin' : p.role === 'merchant' ? 'merchant' : p.role === 'courier' ? 'courier'
    : p.requested_role === 'merchant' ? 'merchant' : p.requested_role === 'courier' ? 'courier_pending' : 'customer';

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    let authEventHandled = false;
    const { data } = sb.auth.onAuthStateChange((event, s) => { authEventHandled = true; setSession(s); if (event === 'PASSWORD_RECOVERY') setRecovery(true); });
    sb.auth.getSession().then(({ data: sessionData }) => { if (!authEventHandled) setSession(sessionData.session); });
    return () => data.subscription.unsubscribe();
  }, []);
  if (!configured) return <main className="welcome"><div className="welcome-card"><h1>الإعداد غير مكتمل</h1><p className="muted">أضف VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY في متغيرات البيئة ثم أعد البناء.</p></div></main>;
  if (session === undefined) return <main className="welcome"><div className="welcome-card"><Skeleton rows={3} /></div></main>;
  if (!session) return <Auth />;
  if (recovery) return <NewPassword onDone={() => setRecovery(false)} />;
  return <Shell userId={session.user.id} />;
}

function Shell({ userId }: { userId: string }) {
  const prof = useQuery(() => api.getProfile(userId), [userId], 60000);
  const notifications = useQuery(() => api.listNotifications(userId), [userId], 60000, [`notifications|user_id=eq.${userId}`]);
  const cart = useCart();
  const [tab, setTab] = useState('');
  const [menu, setMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [perm, setPerm] = useState(notifyPermission());
  const [sound, setSound] = useState(alarmEnabled());
  const { hasPrompt } = useInstall();
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const notify = (text: string, bad = false) => {
    setNotice({ text, bad });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice(null), 4500);
  };

  // new unread notification while the app is open: toast + device notification + short beep (if the user enabled sound)
  const seen = useRef<Set<string> | null>(null);
  const unread = (notifications.data || []).filter((n) => !n.is_read).length;
  useEffect(() => {
    const list = notifications.data;
    if (!list) return;
    if (seen.current) {
      for (const n of list) if (!n.is_read && !seen.current.has(n.id)) {
        notify(`${n.title}: ${n.body}`);
        void systemNotify(n.title, n.body, n.id);
        if (alarmEnabled()) beep();
      }
    }
    seen.current = new Set(list.map((n) => n.id));
  }, [notifications.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { document.title = unread ? `(${unread}) وصلة` : 'وصلة'; return () => { document.title = 'وصلة'; }; }, [unread]);

  const profile = prof.data;
  if (!profile) {
    return (
      <main className="welcome"><div className="welcome-card">
        {prof.loading ? <Skeleton rows={3} /> : <Empty title="تعذر تحميل الحساب" text={prof.error || undefined} />}
        <div className="seg"><button className="secondary" onClick={prof.reload}>إعادة المحاولة</button><button className="secondary" onClick={() => api.signOut()}>خروج</button></div>
      </div></main>
    );
  }
  if (profile.is_blocked) {
    return <main className="welcome"><div className="welcome-card"><h1>الحساب موقوف</h1><p className="muted">تواصل مع إدارة وصلة لمعرفة السبب.</p><button className="secondary" onClick={() => api.signOut()}>خروج</button></div></main>;
  }

  if (profile.must_change_password) return <NewPassword forced onDone={() => void prof.reload()} />;
  const view = viewOf(profile);
  const nav = NAV[view];
  const active = nav.some(([k]) => k === tab) ? tab : nav[0]?.[0] || '';
  const title = nav.find(([k]) => k === active)?.[1] || 'وصلة';
  const common = { profile, notify, tab: active, setTab };
  const go = (k: string) => { setTab(k); setMenu(false); setShowNotifications(false); window.scrollTo({ top: 0 }); };
  const primary = nav.slice(0, PRIMARY[view]);
  const extra = nav.slice(PRIMARY[view]);
  const badge = (k: string) => (k === 'cart' ? cartCount(cart) : 0);

  const toggleBell = async () => {
    const next = !showNotifications;
    setShowNotifications(next); setMenu(false);
    if (next) { await api.markNotificationsRead(userId); await notifications.reload(); }
  };
  const enableAlerts = async () => {
    unlockAudio(); setAlarmEnabled(true); setSound(true); beep([660, 880]);
    setPerm(await askNotifyPermission());
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><img src="/public-logo.png" alt="وصلة" /><div><b>وصلة</b><small>وصلة.. بتجمعنا</small></div></div>
        <div className="top-actions">
          <InstallButton className="topbar-install" /><span className="role-pill">{ROLE_AR[view]}</span><span className="user-name">{profile.full_name}</span>
          <button className="icon-btn notification-button" title="الإشعارات" aria-label="الإشعارات" onClick={() => void toggleBell()}><Bell size={19} />{unread > 0 && <i className="dot-pulse" />}</button>
          <button className="icon-btn" title="خروج" aria-label="خروج" onClick={() => api.signOut()}><LogOut size={19} /></button>
        </div>
      </header>

      {showNotifications && (
        <>
          <div className="backdrop" onClick={() => setShowNotifications(false)} />
          <section className="notification-panel" aria-label="الإشعارات">
            <header><b>الإشعارات</b><button className="icon-btn" aria-label="إغلاق" onClick={() => setShowNotifications(false)}><X size={18} /></button></header>
            {(perm !== 'granted' || !sound) && perm !== 'unsupported' && (
              <div className="alert-setup"><p>فعّل تنبيهات الجهاز والصوت عشان تعرف بالجديد حتى لو بتستخدم تطبيق تاني.</p><button className="primary small" onClick={() => void enableAlerts()}>تفعيل التنبيهات</button></div>
            )}
            {(notifications.data || []).length ? (notifications.data || []).map((n) => (
              <article key={n.id} className={n.order_id ? 'clickable' : ''} onClick={() => n.order_id && go(ORDERS_TAB[view])}>
                <b>{n.title}</b><p>{n.body}</p><small>{fmtDate(n.created_at)}</small>
              </article>
            )) : <p className="muted">لا توجد إشعارات حاليًا.</p>}
          </section>
        </>
      )}

      <div className="layout">
        {nav.length > 0 && (
          <>
            {menu && <div className="backdrop" onClick={() => setMenu(false)} />}
            <aside className={`sidebar ${menu ? 'open' : ''}`}>
              <div className="side-caption">القائمة الرئيسية</div>
              {nav.map(([k, label]) => { const Icon = ICONS[k] || Package; return <button key={k} className={`nav-item ${active === k ? 'active' : ''}`} onClick={() => go(k)}><Icon size={18} />{label}{badge(k) > 0 && <em className="nav-badge">{badge(k)}</em>}</button>; })}
              {hasPrompt && <button className="nav-item install" onClick={() => void promptInstall()}><Download size={18} />ثبّت التطبيق على جهازك</button>}
            </aside>
          </>
        )}
        <main className="content">
          <div className="page-heading"><div><p className="eyebrow">{ROLE_AR[view]}</p><h1>{title}</h1></div></div>
          {notice && <div className={`toast ${notice.bad ? 'error' : ''}`} role="status" key={notice.text}>{notice.text}</div>}
          <div className="page" key={active}>
            {active === 'support' && <SupportPanel userId={profile.id} notify={notify} />}
            {active === 'supportAdmin' && <SupportPanel userId={profile.id} admin notify={notify} />}
            {active !== 'support' && active !== 'supportAdmin' && view === 'customer' && <Customer {...common} />}
            {active !== 'support' && active !== 'supportAdmin' && view === 'merchant' && <Merchant {...common} onProfileChange={prof.reload} />}
            {active !== 'support' && active !== 'supportAdmin' && view === 'courier' && <Courier {...common} />}
            {active !== 'support' && active !== 'supportAdmin' && view === 'admin' && <Admin {...common} />}
            {view === 'courier_pending' && <div className="panel"><h3>حسابك قيد المراجعة</h3><p className="muted">سيقوم فريق وصلة بمراجعة بياناتك والتواصل معك. ستظهر لك مهام التوصيل بعد اعتماد حسابك. تتحدث هذه الصفحة تلقائيًا.</p></div>}
          </div>
          <footer>وصلة © 2026 · وصلة.. بتجمعنا · <a href="/terms.html">الشروط</a> · <a href="/privacy.html">الخصوصية</a></footer>
        </main>
      </div>

      <InstallBanner aboveNav={nav.length > 0} />
      {nav.length > 0 && (
        <nav className="bottom-nav" aria-label="التنقل">
          {primary.map(([k, label]) => { const Icon = ICONS[k] || Package; return <button key={k} className={active === k ? 'active' : ''} onClick={() => go(k)}><span className="ico"><Icon size={22} />{badge(k) > 0 && <em className="nav-badge">{badge(k)}</em>}</span><small>{label}</small></button>; })}
          {extra.length > 0 && <button className={extra.some(([k]) => k === active) || menu ? 'active' : ''} onClick={() => { setMenu(!menu); setShowNotifications(false); }}><span className="ico"><MoreHorizontal size={22} /></span><small>المزيد</small></button>}
        </nav>
      )}
    </div>
  );
}
