import { useState } from 'react';
import * as api from '../lib/api';
import { errMsg, isEmail, toIntlPhone } from '../lib/utils';

type Kind = 'customer' | 'merchant' | 'courier';
const KINDS: [Kind, string, string][] = [
  ['customer', 'مشتري', 'تصفح واطلب من المحلات'],
  ['merchant', 'صاحب محل', 'يراجع فريق وصلة المحل قبل ظهوره'],
  ['courier', 'مندوب توصيل', 'يراجع فريق وصلة حسابك قبل التفعيل'],
];

export default function Auth() {
  const [mode, setMode] = useState<'in' | 'up' | 'forgot'>('in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [kind, setKind] = useState<Kind>('customer');
  const [agree, setAgree] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    setErr(''); setInfo('');
    const mail = email.trim().toLowerCase();
    if (!isEmail(mail)) return setErr('اكتب بريدًا إلكترونيًا صحيحًا');
    if (mode === 'forgot') {
      setBusy(true);
      try { await api.resetPassword(mail); setInfo('لو البريد مسجل عندنا هيوصلك رابط لتغيير كلمة المرور. راجع الرسائل غير المرغوبة (Spam) أيضًا.'); }
      catch (x) { setErr(errMsg(x)); }
      finally { setBusy(false); }
      return;
    }
    if (password.length < 8) return setErr('كلمة المرور 8 أحرف على الأقل');
    if (mode === 'up') {
      if (name.trim().length < 2) return setErr('اكتب اسمك');
      if (!toIntlPhone(phone)) return setErr('اكتب رقم هاتف صحيحًا مثل 01012345678');
      if (!agree) return setErr('وافق على الشروط وسياسة الخصوصية للمتابعة');
    }
    setBusy(true);
    try {
      if (mode === 'up') await api.signUp(name.trim(), phone, mail, password, kind);
      else await api.signIn(mail, password);
    } catch (x) { setErr(errMsg(x)); }
    finally { setBusy(false); }
  };

  return (
    <main className="welcome">
      <form className="welcome-card" onSubmit={submit}>
        <img className="logo" src="/public-logo.png" alt="وصلة" />
        <p className="eyebrow">أهلاً بيك في وصلة</p>
        <h1>وصلة.. بتجمعنا</h1>
        <p className="muted">منصة بتجمع المشترين والمحلات ومندوبي التوصيل.</p>
        <div className="seg">
          <button type="button" className={mode === 'in' ? 'primary' : 'secondary'} onClick={() => setMode('in')}>تسجيل الدخول</button>
          <button type="button" className={mode === 'up' ? 'primary' : 'secondary'} onClick={() => setMode('up')}>حساب جديد</button>
        </div>
        {mode === 'up' && <><label className="field-label">الاسم</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="اكتب اسمك" maxLength={80} autoComplete="name" /></>}
        <label className="field-label">البريد الإلكتروني</label>
        <input type="email" inputMode="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@gmail.com" autoComplete="email" />
        {mode === 'up' && <><label className="field-label">رقم الهاتف (للتواصل بخصوص الطلبات)</label><input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01xxxxxxxxx" autoComplete="tel" /></>}
        {mode !== 'forgot' && <><label className="field-label">كلمة المرور</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8 أحرف على الأقل" autoComplete={mode === 'up' ? 'new-password' : 'current-password'} /></>}
        {mode === 'up' && (
          <>
            <label className="field-label">نوع الحساب</label>
            <div className="role-grid">
              {KINDS.map(([k, t, d]) => (
                <button type="button" key={k} className={kind === k ? 'selected' : ''} onClick={() => setKind(k)}><b>{t}</b><small>{d}</small></button>
              ))}
            </div>
            <label className="agree"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> أوافق على <a href="/terms.html" target="_blank" rel="noreferrer">شروط الاستخدام</a> و<a href="/privacy.html" target="_blank" rel="noreferrer">سياسة الخصوصية</a></label>
          </>
        )}
        {err && <div className="toast error">{err}</div>}
        {info && <div className="toast">{info}</div>}
        <button className="primary full" disabled={busy} style={{ marginTop: 16 }}>{busy ? 'لحظة…' : mode === 'up' ? 'إنشاء الحساب' : mode === 'forgot' ? 'إرسال رابط الاستعادة' : 'دخول'}</button>
        {mode === 'in' && <button type="button" className="secondary full" style={{ marginTop: 10 }} onClick={() => { setMode('forgot'); setErr(''); }}>نسيت كلمة المرور؟</button>}
        {mode === 'forgot' && <button type="button" className="secondary full" style={{ marginTop: 10 }} onClick={() => { setMode('in'); setErr(''); setInfo(''); }}>رجوع</button>}
      </form>
    </main>
  );
}

export function NewPassword({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (pw.length < 8) return setErr('كلمة المرور 8 أحرف على الأقل');
    setBusy(true);
    try { await api.updatePassword(pw); onDone(); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  return (
    <main className="welcome">
      <form className="welcome-card" onSubmit={submit}>
        <h1>كلمة مرور جديدة</h1>
        <label className="field-label">كلمة المرور الجديدة</label>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="8 أحرف على الأقل" autoComplete="new-password" />
        {err && <div className="toast error">{err}</div>}
        <button className="primary full" disabled={busy} style={{ marginTop: 16 }}>حفظ</button>
      </form>
    </main>
  );
}
