import { useState } from 'react';
import { Eye, EyeOff, MessageCircle } from 'lucide-react';
import * as api from '../lib/api';
import { SUPPORT_WHATSAPP } from '../lib/auth';
import { errMsg, isEmail, toIntlPhone, waHref } from '../lib/utils';
import { Captcha, TURNSTILE_KEY } from '../components/Captcha';
import { InstallBanner, InstallButton } from '../components/InstallBanner';

type Kind = 'customer' | 'merchant' | 'courier';
const KINDS: [Kind, string, string][] = [
  ['customer', 'مشتري', 'تصفح واطلب من المحلات'],
  ['merchant', 'صاحب محل', 'يراجع فريق وصلة المحل قبل ظهوره'],
  ['courier', 'مندوب توصيل', 'يراجع فريق وصلة حسابك قبل التفعيل'],
];

function PasswordField({ value, onChange, autoComplete, placeholder }: { value: string; onChange: (v: string) => void; autoComplete: string; placeholder: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-field">
      <input type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete={autoComplete} />
      <button type="button" className="pw-toggle" aria-label={show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'} onClick={() => setShow(!show)}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
    </div>
  );
}

/** Sign in / sign up with the mobile number + password. No email, no confirmation message. */
export default function Auth() {
  const [mode, setMode] = useState<'in' | 'up' | 'forgot'>('up');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [kind, setKind] = useState<Kind>('customer');
  const [agree, setAgree] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState('');
  const [captchaRound, setCaptchaRound] = useState(0);

  const submit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    setErr(''); setInfo('');
    if (mode === 'forgot') return;
    if (!isEmail(email.trim())) return setErr('اكتب بريدًا إلكترونيًا صحيحًا');
    if (mode === 'up' && !toIntlPhone(phone)) return setErr('اكتب رقم موبايل صحيحًا مثل 01012345678');
    if (password.length < 8) return setErr('كلمة المرور 8 أحرف على الأقل');
    if (TURNSTILE_KEY && !captcha) return setErr('أكمل التحقق الأمني أولًا');
    if (mode === 'up') {
      if (name.trim().length < 2) return setErr('اكتب اسمك');
      if (!agree) return setErr('وافق على الشروط وسياسة الخصوصية للمتابعة');
    }
    setBusy(true);
    try {
      if (mode === 'up') {
        const result = await api.signUp(name.trim(), email.trim(), phone, password, kind, captcha || undefined);
        if (!result.confirmed) setErr('الحساب اتسجل، لكن تأكيد البريد ما زال مطلوبًا. أوقف Confirm email من إعدادات Supabase ثم احذف الحساب غير المؤكد وسجّل به مرة أخرى.');
      } else await api.signIn(email.trim(), password, captcha || undefined);
    } catch (x) { setErr(errMsg(x)); }
    finally { setBusy(false); setCaptchaRound((n) => n + 1); }
  };

  return (
    <main className="welcome">
      <form className="welcome-card" onSubmit={submit}>
        <img className="logo" src="/logo-full.png" alt="وصلة.. بتجمعنا" />
        <h1>أهلاً بيك في وصلة</h1>
        <InstallButton />
        <p className="muted">منصة بتجمع المشترين والمحلات ومندوبي التوصيل.</p>
        <div className="seg">
          <button type="button" className={mode !== 'up' ? 'primary' : 'secondary'} onClick={() => { setMode('in'); setErr(''); setInfo(''); }}>تسجيل الدخول</button>
          <button type="button" className={mode === 'up' ? 'primary' : 'secondary'} onClick={() => { setMode('up'); setErr(''); setInfo(''); }}>حساب جديد</button>
        </div>

        {mode === 'forgot' ? (
          <div className="forgot-box">
            <h3>نسيت كلمة المرور؟</h3>
            <ol>
              <li>ابعت رسالة واتساب لإدارة وصلة <b>من نفس الرقم</b> اللي سجّلت به.</li>
              <li>هنتأكد منك ونبعتلك كلمة مرور مؤقتة.</li>
              <li>ادخل بيها واختار كلمة مرور جديدة.</li>
            </ol>
            {SUPPORT_WHATSAPP
              ? <a className="primary full wa-link" href={waHref(SUPPORT_WHATSAPP, 'مرحبًا، نسيت كلمة المرور لحسابي على وصلة.')} target="_blank" rel="noreferrer"><MessageCircle size={18} /> تواصل عبر واتساب</a>
              : <p className="muted">تواصل مع إدارة وصلة على واتساب.</p>}
            <button type="button" className="secondary full" style={{ marginTop: 10 }} onClick={() => setMode('in')}>رجوع لتسجيل الدخول</button>
          </div>
        ) : (
          <>
            {mode === 'up' && <><label className="field-label">الاسم</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="اكتب اسمك" maxLength={80} autoComplete="name" /></>}
            <label className="field-label">البريد الإلكتروني</label>
            <input type="email" inputMode="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete={mode === 'up' ? 'email' : 'username'} />
            {mode === 'up' && <><label className="field-label">رقم الموبايل</label><input type="tel" inputMode="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01xxxxxxxxx" autoComplete="tel" /></>}
            <label className="field-label">كلمة المرور</label>
            <PasswordField value={password} onChange={setPassword} placeholder="8 أحرف على الأقل" autoComplete={mode === 'up' ? 'new-password' : 'current-password'} />
            {mode === 'up' && (
              <>
                <label className="field-label">نوع الحساب</label>
                <div className="role-grid">
                  {KINDS.map(([k, t, d]) => (
                    <button type="button" key={k} className={kind === k ? 'selected' : ''} onClick={() => setKind(k)}><b>{t}</b><small>{d}</small></button>
                  ))}
                </div>
                <p className="muted tiny">استخدم بريدًا تقدر تدخل عليه، واكتب رقمك الصحيح للتواصل بخصوص الطلبات.</p>
                <label className="agree"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> أوافق على <a href="/terms.html" target="_blank" rel="noreferrer">شروط الاستخدام</a> و<a href="/privacy.html" target="_blank" rel="noreferrer">سياسة الخصوصية</a></label>
              </>
            )}
            <Captcha onToken={setCaptcha} resetKey={captchaRound} />
            {err && <div className="toast error">{err}</div>}
            {info && <div className="toast">{info}</div>}
            <button className="primary full" disabled={busy} style={{ marginTop: 16 }}>{busy ? 'لحظة…' : mode === 'up' ? 'إنشاء الحساب' : 'دخول'}</button>
            {mode === 'in' && <button type="button" className="secondary full" style={{ marginTop: 10 }} onClick={() => { setMode('forgot'); setErr(''); }}>نسيت كلمة المرور؟</button>}
          </>
        )}
      </form>
      <InstallBanner />
    </main>
  );
}

/** Shown after a password recovery link (old email accounts) or when the admin issued a temporary password. */
export function NewPassword({ onDone, forced = false }: { onDone: () => void; forced?: boolean }) {
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
        {forced && <p className="muted">دخلت بكلمة مرور مؤقتة من الإدارة. اختار كلمة مرور جديدة تعرفها انت بس.</p>}
        <label className="field-label">كلمة المرور الجديدة</label>
        <PasswordField value={pw} onChange={setPw} placeholder="8 أحرف على الأقل" autoComplete="new-password" />
        {err && <div className="toast error">{err}</div>}
        <button className="primary full" disabled={busy} style={{ marginTop: 16 }}>حفظ</button>
      </form>
    </main>
  );
}
