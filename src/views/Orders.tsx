import { useEffect, useState, type ReactNode } from 'react';
import { Banknote, Bike, CheckCircle2, MapPin, Store as StoreIcon, Truck, X } from 'lucide-react';
import * as api from '../lib/api';
import { useQuery } from '../lib/hooks';
import { MODE_AR, PAYSTATUS_AR, PAY_AR, STATUS_AR, amountToTransfer, dirHref, dueOnDelivery, errMsg, fmtDate, localPhone, locHref, mapsHref, money, statusTone } from '../lib/utils';
import { ContactButtons, CopyButton, Empty, Skeleton, Status } from '../components/ui';
import type { Notify, Order, Role } from '../lib/types';

type Ctx = { o: Order; userId: string; notify: Notify; busy: boolean; run: (fn: () => Promise<unknown>, okMsg: string) => Promise<void> };
const egp = (n: number) => `${money(n)} ج.م`;
const FINAL = ['delivered', 'cancelled'];

export function OrdersPanel({ role, userId, notify, filter, storeId, onData }: {
  role: Role; userId: string; notify: Notify; filter?: (o: Order) => boolean; storeId?: string; onData?: (orders: Order[]) => void;
}) {
  const q = useQuery(() => api.listOrders(storeId), [storeId], 30000, ['orders']);
  const maxFeeQuery = useQuery(() => api.getSetting('max_delivery_fee'), []);
  const maxFee = Math.min(500, Math.max(0, Number(maxFeeQuery.data || 500)));
  useEffect(() => { if (q.data && onData) onData(q.data); }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (q.error && !q.data) return <div className="notice-box">{q.error}</div>;
  if (!q.data) return <Skeleton rows={3} />;
  const list = filter ? q.data.filter(filter) : q.data;
  if (!list.length) return <Empty title="لا توجد طلبات" text="هتظهر الطلبات هنا أول ما تتوفر، والصفحة بتتحدث لوحدها." />;
  return <div className="order-list">{list.map((o) => <OrderCard key={o.id} o={o} role={role} userId={userId} notify={notify} onChanged={q.reload} maxFee={maxFee} />)}</div>;
}

function OrderCard({ o, role, userId, notify, onChanged, maxFee }: { o: Order; role: Role; userId: string; notify: Notify; onChanged: () => Promise<void>; maxFee: number }) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    try { await fn(); if (okMsg) notify(okMsg); await onChanged(); }
    catch (e) { notify(errMsg(e), true); }
    finally { setBusy(false); }
  };
  const ctx: Ctx = { o, userId, notify, busy, run };
  const mine = o.courier_id === userId;
  const available = role === 'courier' && !o.courier_id;
  const needsCodes = o.delivery_mode === 'courier';

  return (
    <article className={`order-card mode-${o.delivery_mode}`}>
      <div className="order-head">
        <div><b>طلب #{o.order_no}</b><small>{fmtDate(o.created_at)}{o.stores && role !== 'merchant' ? ` · ${o.stores.name}` : ''}</small></div>
        <Status label={STATUS_AR[o.status]} tone={statusTone(o.status)} />
      </div>
      <div className="chips">
        <span className="tag">{MODE_AR[o.delivery_mode]}</span>
        <span className="tag">{PAY_AR[o.payment_method]}</span>
        {o.payment_method === 'vodafone_cash' && <span className={`tag ${o.payment_status === 'confirmed' ? 'ok' : 'warn'}`}>{PAYSTATUS_AR[o.payment_status]}</span>}
      </div>

      <ul className="items">{o.order_items.map((i) => <li key={i.id}><span>{i.quantity}× {i.product_name_snapshot}</span><b>{egp(i.line_total)}</b></li>)}</ul>
      {o.note && <p className="note-line">📝 {o.note}</p>}
      <div className="totals">
        <span>المنتجات {egp(o.subtotal)}</span>
        {o.delivery_required && <span>التوصيل {egp(o.delivery_fee)}</span>}
        <strong>الإجمالي {egp(o.total)}</strong>
      </div>
      {!FINAL.includes(o.status) && (role === 'customer' || role === 'courier') && dueOnDelivery(o) > 0 && (
        <div className="due"><Banknote size={16} /> {role === 'courier' ? 'المطلوب تحصيله من المشتري' : 'تدفع كاش عند الاستلام'}: <b>{egp(dueOnDelivery(o))}</b></div>
      )}

      {role === 'customer' && <CustomerPart {...ctx} />}
      {role === 'merchant' && <MerchantPart {...ctx} />}
      {role === 'courier' && <CourierPart {...ctx} available={available} mine={mine} maxFee={maxFee} />}
      {role === 'admin' && <AdminPart {...ctx} />}
      {needsCodes && role === 'admin' && <p className="muted tiny">طلب عبر مندوب وصلة (له أكواد استلام وتسليم).</p>}
    </article>
  );
}

/* ------------------------------ customer ------------------------------ */
function stepKeys(o: Order) {
  return o.delivery_mode === 'pickup' ? ['new', 'accepted', 'ready', 'delivered'] : ['new', 'accepted', 'ready', 'with_courier', 'delivered'];
}
const STEP_LABEL: Record<string, string> = { new: 'تم الإرسال', accepted: 'المحل جهّز', ready: 'جاهز', with_courier: 'في الطريق', delivered: 'تم' };

function CustomerPart({ o, run, busy }: Ctx) {
  const [ref, setRef] = useState('');
  const idx = stepKeys(o).indexOf(o.status === 'preparing' ? 'accepted' : o.status);
  const canCancel = (o.status === 'new' || (o.status === 'accepted' && !o.courier_id && o.accepted_at && Date.now() - new Date(o.accepted_at).getTime() < 180000))
    && !['proof_submitted', 'confirmed'].includes(o.payment_status);
  const vf = o.stores?.vodafone_cash_number;
  const payOpen = o.payment_method === 'vodafone_cash' && ['awaiting', 'proof_submitted'].includes(o.payment_status) && o.status !== 'cancelled';
  return (
    <>
      {o.status !== 'cancelled' && (
        <ol className="steps">{stepKeys(o).map((k, i) => <li key={k} className={i < idx ? 'done' : i === idx ? 'now' : ''}><i />{STEP_LABEL[k]}</li>)}</ol>
      )}
      {o.prep_minutes && o.accepted_at && ['accepted', 'preparing'].includes(o.status) && <p className="info-line">⏱ وقت التجهيز المتوقع: حوالي {o.prep_minutes} دقيقة</p>}

      {payOpen && (
        <div className="pay-box">
          <h4><Banknote size={17} /> الدفع بفودافون كاش</h4>
          {vf ? (
            <>
              <p>حوّل <b>{egp(amountToTransfer(o))}</b> (قيمة المنتجات) على رقم المحل:</p>
              <div className="number-row"><b dir="ltr">{localPhone(vf)}</b><CopyButton text={localPhone(vf)} /></div>
              <p className="muted tiny">أجرة التوصيل بتدفعها كاش للمندوب. بعد التحويل اكتب رقم العملية أو آخر 4 أرقام من رقم المحفظة اللي حوّلت منها.</p>
            </>
          ) : <p className="muted">رقم المحل غير متاح حاليًا. تواصل مع المحل.</p>}
          {o.payment_status === 'awaiting' ? (
            <form className="inline-form" onSubmit={(e) => { e.preventDefault(); void run(() => api.customerSubmitPayment(o.id, ref.trim()), 'تم إرسال بيانات التحويل للمحل'); }}>
              <input value={ref} minLength={3} maxLength={40} required placeholder="رقم العملية / آخر 4 أرقام" onChange={(e) => setRef(e.target.value)} />
              <button className="primary small" disabled={busy}>تم التحويل</button>
            </form>
          ) : <p className="info-line">✔ أرسلت البيانات ({o.payment_ref}). بانتظار تأكيد المحل.</p>}
        </div>
      )}

      {o.fee_status === 'countered' && !FINAL.includes(o.status) && (
        <div className="offer-box">
          <h4><Bike size={17} /> المندوب اقترح أجرة مختلفة</h4>
          <p>الأجرة المقترحة: <b>{egp(o.courier_proposed_fee ?? 0)}</b> بدل {egp(o.proposed_delivery_fee)}. {o.courier_reply && <>الرد: «{o.courier_reply}»</>}</p>
          <div className="action-row">
            <button className="primary small" disabled={busy} onClick={() => void run(() => api.customerRespondFee(o.id, true), 'تمت الموافقة على الأجرة')}>موافق</button>
            <button className="secondary small" disabled={busy} onClick={() => void run(() => api.customerRespondFee(o.id, false), 'تم رفض الأجرة، سيظهر الطلب لمندوب آخر')}>أرفض</button>
          </div>
        </div>
      )}

      {o.order_delivery_codes?.code && !FINAL.includes(o.status) && o.fee_status === 'accepted' && o.courier_id && (
        <div className="code-box"><small>كود التسليم</small><b dir="ltr">{o.order_delivery_codes.code}</b><p>اعطه للمندوب <u>عند استلامك للطلب فقط</u>. لا تقوله قبل كده.</p></div>
      )}
      {o.order_courier_contacts && !FINAL.includes(o.status) && (
        <div className="info-box"><Truck size={16} /> المندوب: <b>{o.order_courier_contacts.courier_name}</b> <ContactButtons phone={o.order_courier_contacts.courier_phone} /></div>
      )}
      {o.status === 'with_courier' && o.courier_lat != null && o.courier_lng != null && (
        <iframe className="tracking-map" title="موقع المندوب" loading="lazy"
          src={`https://www.openstreetmap.org/export/embed.html?bbox=${o.courier_lng - 0.01}%2C${o.courier_lat - 0.01}%2C${o.courier_lng + 0.01}%2C${o.courier_lat + 0.01}&layer=mapnik&marker=${o.courier_lat}%2C${o.courier_lng}`} />
      )}
      {canCancel && <div className="action-row"><button className="danger small" disabled={busy} onClick={() => { if (window.confirm('إلغاء الطلب؟')) void run(() => api.customerCancel(o.id), 'تم إلغاء الطلب'); }}><X size={15} /> إلغاء الطلب</button></div>}
      {o.status === 'delivered' && <p className="info-line ok"><CheckCircle2 size={15} /> تم تسليم الطلب. شكرًا لاستخدامك وصلة!</p>}
    </>
  );
}

/* ------------------------------ merchant ------------------------------ */
const PREP = [10, 20, 30, 45];
function MerchantPart({ o, run, busy }: Ctx) {
  const [prep, setPrep] = useState(20);
  const addr = o.order_addresses?.address;
  const payWait = !['cod', 'confirmed'].includes(o.payment_status);
  const set = (status: string, msg: string, p?: number) => void run(() => api.merchantSetStatus(o.id, status, p), msg);
  const reviewable = o.payment_method === 'vodafone_cash' && ['awaiting', 'proof_submitted'].includes(o.payment_status) && o.status !== 'cancelled';
  const live = ['new', 'accepted', 'preparing', 'ready'].includes(o.status);
  return (
    <>
      {o.order_contacts && (
        <div className="info-box"><b>{o.order_contacts.customer_name}</b> <span dir="ltr">{localPhone(o.order_contacts.customer_phone)}</span> <ContactButtons phone={o.order_contacts.customer_phone} /></div>
      )}
      {addr && <p className="info-line"><MapPin size={15} /> {addr}{o.order_addresses?.lat != null && o.order_addresses?.lng != null && <a className="chip" href={locHref(o.order_addresses.lat, o.order_addresses.lng)} target="_blank" rel="noreferrer">📍 موقع المشتري</a>}</p>}

      {reviewable && (
        <div className="pay-box">
          <h4><Banknote size={17} /> دفع فودافون كاش: {egp(amountToTransfer(o))}</h4>
          {o.payment_status === 'proof_submitted'
            ? <p>المشتري كتب: <b dir="ltr">{o.payment_ref}</b>. راجع محفظتك وأكّد.</p>
            : <p className="muted">لسه المشتري ما أرسلش بيانات التحويل. لو وصلتك الفلوس تقدر تؤكد بنفسك.</p>}
          <div className="action-row">
            <button className="primary small" disabled={busy} onClick={() => void run(() => api.merchantReviewPayment(o.id, true), 'تم تأكيد الدفع')}>وصلتني الفلوس</button>
            {o.payment_status === 'proof_submitted' && <button className="secondary small" disabled={busy} onClick={() => void run(() => api.merchantReviewPayment(o.id, false), 'تم إبلاغ المشتري أن التحويل لم يصل')}>لم تصل</button>}
          </div>
        </div>
      )}

      {o.status === 'new' && (
        <div className="accept-box">
          <p className="field-label">كم دقيقة تحتاج لتجهيز الطلب؟</p>
          <div className="chips pick">{PREP.map((m) => <button type="button" key={m} className={`chip ${prep === m ? 'sel' : ''}`} onClick={() => setPrep(m)}>{m} د</button>)}</div>
          <div className="action-row">
            <button className="primary" disabled={busy} onClick={() => set('accepted', 'تم قبول الطلب', prep)}>قبول الطلب</button>
            <button className="secondary" disabled={busy} title="الطلب جاهز دلوقتي ومش محتاج وقت تجهيز" onClick={() => set('ready', 'الطلب جاهز')}><CheckCircle2 size={16} /> جاهز فورًا</button>
            <button className="danger" disabled={busy} onClick={() => { if (window.confirm('رفض الطلب؟')) set('cancelled', 'تم رفض الطلب'); }}>رفض</button>
          </div>
        </div>
      )}
      {o.status === 'accepted' && <div className="action-row"><button className="secondary" disabled={busy} onClick={() => set('preparing', 'بدأ التجهيز')}>بدأت التجهيز</button><button className="primary" disabled={busy} onClick={() => set('ready', 'الطلب جاهز')}>الطلب جاهز</button></div>}
      {o.status === 'preparing' && <div className="action-row"><button className="primary" disabled={busy} onClick={() => set('ready', 'الطلب جاهز')}>الطلب جاهز</button></div>}

      {o.delivery_mode === 'courier' && live && o.order_pickup_codes?.code && (
        <div className="code-box"><small>كود تسليم الطلب للمندوب</small><b dir="ltr">{o.order_pickup_codes.code}</b>
          <p>{o.order_courier_contacts ? <>المندوب: <b>{o.order_courier_contacts.courier_name}</b> <ContactButtons phone={o.order_courier_contacts.courier_phone} /></> : 'لسه ما حدش قبل التوصيل.'} · اعطِ الكود للمندوب <u>وقت الاستلام فقط</u>.</p></div>
      )}
      {o.status === 'ready' && payWait && o.delivery_mode !== 'courier' && <p className="info-line warn">لازم تؤكد الدفع أولًا قبل التسليم.</p>}
      {o.status === 'ready' && o.delivery_mode === 'pickup' && <div className="action-row"><button className="primary" disabled={busy || payWait} onClick={() => set('delivered', 'تم تسليم الطلب')}><CheckCircle2 size={16} /> تم تسليم الطلب للمشتري</button></div>}
      {o.status === 'ready' && o.delivery_mode === 'store' && <div className="action-row"><button className="primary" disabled={busy || payWait} onClick={() => set('with_courier', 'خرج الطلب للتوصيل')}><Truck size={16} /> خرج للتوصيل</button></div>}
      {o.status === 'with_courier' && o.delivery_mode === 'store' && <div className="action-row"><button className="primary" disabled={busy} onClick={() => set('delivered', 'تم التوصيل')}><CheckCircle2 size={16} /> تم التوصيل</button></div>}
      {['accepted', 'preparing', 'ready'].includes(o.status) && <div className="action-row"><button className="danger small" disabled={busy} onClick={() => { if (window.confirm('إلغاء الطلب؟')) set('cancelled', 'تم إلغاء الطلب'); }}>إلغاء الطلب</button></div>}
    </>
  );
}

/* ------------------------------ courier ------------------------------ */
function CourierPart({ o, run, busy, notify, available, mine, maxFee }: Ctx & { available: boolean; mine: boolean; maxFee: number }) {
  const [counter, setCounter] = useState(String(o.courier_proposed_fee ?? o.proposed_delivery_fee));
  const [reply, setReply] = useState(o.courier_reply || '');
  const [code, setCode] = useState('');
  const eta = o.prep_minutes && o.accepted_at ? Math.max(0, Math.round((new Date(o.accepted_at).getTime() + o.prep_minutes * 60000 - Date.now()) / 60000)) : null;
  const codeResult = async (fn: () => Promise<string>, okMsg: string) => {
    try {
      const r = await fn();
      if (r === 'ok') { notify(okMsg); setCode(''); await run(async () => undefined, ''); }
      else if (r === 'wrong_code') notify('الكود غير صحيح. راجع الكود وحاول مرة أخرى', true);
      else notify('تم قفل الكود بعد عدة محاولات خاطئة. تواصل مع الإدارة', true);
    } catch (e) { notify(errMsg(e), true); }
  };

  if (available) {
    const feeNum = Number(counter);
    return (
      <>
        <div className="info-box"><StoreIcon size={16} /> من: <b>{o.stores?.name}</b> · {o.stores?.address || 'عنوان المحل غير مسجل'}</div>
        <p className="info-line"><MapPin size={15} /> إلى: <b>{o.area_hint}</b> <small className="muted">(العنوان الكامل بعد قبول المهمة)</small></p>
        {eta !== null && <p className="info-line">⏱ جاهز بعد حوالي {eta} دقيقة</p>}
        <div className="offer-box">
          <h4><Bike size={17} /> أجرتك: {egp(o.proposed_delivery_fee)} {o.fee_fixed && <span className="tag ok">أجرة ثابتة</span>}</h4>
          {o.fee_fixed ? (
            <div className="action-row">
              <button className="primary" disabled={busy} onClick={() => void run(() => api.courierClaim(o.id), 'تم قبول المهمة. العنوان ظهر لك')}>أقبل المهمة</button>
              <button className="secondary" disabled={busy} onClick={() => void run(() => api.courierDecline(o.id), 'تم تجاهل المهمة')}>تجاهل</button>
            </div>
          ) : (
            <>
              <div className="action-row">
                <button className="primary" disabled={busy} onClick={() => void run(() => api.courierOffer(o.id, o.proposed_delivery_fee, ''), 'تم قبول الأجرة')}>أقبل بـ {egp(o.proposed_delivery_fee)}</button>
                <button className="secondary" disabled={busy} onClick={() => void run(() => api.courierDecline(o.id), 'تم تجاهل المهمة')}>تجاهل</button>
              </div>
              <p className="field-label">أو اقترح أجرة (حتى {maxFee} ج.م)</p>
              <div className="inline-form"><input type="number" inputMode="numeric" min={0} max={maxFee} value={counter} onChange={(e) => setCounter(e.target.value)} /><button className="secondary small" disabled={busy || !(feeNum >= 0 && feeNum <= maxFee)} onClick={() => void run(() => api.courierOffer(o.id, feeNum, reply), 'تم إرسال اقتراحك للمشتري')}>اقترح</button></div>
              <input value={reply} maxLength={300} placeholder="سبب الاقتراح (اختياري)" onChange={(e) => setReply(e.target.value)} />
            </>
          )}
        </div>
      </>
    );
  }
  if (!mine) return null;
  const addr = o.order_addresses?.address;
  return (
    <>
      {o.fee_status === 'countered' && (
        <div className="offer-box"><p>بانتظار موافقة المشتري على أجرة <b>{egp(o.courier_proposed_fee ?? 0)}</b>…</p>
          <div className="action-row"><button className="secondary small" disabled={busy} onClick={() => void run(() => api.courierDecline(o.id), 'تم سحب العرض')}>سحب العرض</button></div></div>
      )}
      {o.fee_status === 'accepted' && !FINAL.includes(o.status) && (
        <>
          <div className="info-box"><StoreIcon size={16} /> الاستلام من: <b>{o.stores?.name}</b> · {o.stores?.address || ''}{o.stores?.address && <a className="chip" href={mapsHref(o.stores.address)} target="_blank" rel="noreferrer">خريطة</a>}</div>
          {addr && <div className="info-box"><MapPin size={16} /> التسليم إلى: <b>{addr}</b>{o.order_addresses?.lat != null && o.order_addresses?.lng != null ? <a className="chip sel" href={dirHref(o.order_addresses.lat, o.order_addresses.lng)} target="_blank" rel="noreferrer">📍 اتجاهات لموقع المشتري</a> : <a className="chip" href={mapsHref(addr)} target="_blank" rel="noreferrer">بحث بالعنوان</a>}</div>}
          {o.order_contacts && <div className="info-box"><b>{o.order_contacts.customer_name}</b> <span dir="ltr">{localPhone(o.order_contacts.customer_phone)}</span> <ContactButtons phone={o.order_contacts.customer_phone} /></div>}
          {['accepted', 'preparing'].includes(o.status) && (
            <>
              <p className="info-line">⏳ الطلب لسه بيتجهز{eta !== null ? ` (حوالي ${eta} دقيقة)` : ''}. استنى إشعار «جاهز».</p>
              <div className="action-row"><button className="danger small" disabled={busy} onClick={() => { if (window.confirm('الاعتذار عن المهمة؟')) void run(() => api.courierDecline(o.id), 'تم الاعتذار عن المهمة'); }}>اعتذر عن المهمة</button></div>
            </>
          )}
          {o.status === 'ready' && (
            !['cod', 'confirmed'].includes(o.payment_status)
              ? <p className="info-line warn">المحل لسه ما أكدش الدفع. انتظر قبل الاستلام.</p>
              : (
                <form className="code-entry" onSubmit={(e) => { e.preventDefault(); void codeResult(() => api.courierPickup(o.id, code), 'تم تأكيد الاستلام. اتجه للمشتري'); }}>
                  <label className="field-label">اطلب من صاحب المحل «كود التسليم للمندوب» واكتبه</label>
                  <div className="inline-form"><input value={code} inputMode="numeric" maxLength={4} pattern="[0-9]{4}" required placeholder="0000" dir="ltr" onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /><button className="primary" disabled={busy || code.length !== 4}>تأكيد الاستلام</button></div>
                  <div className="action-row"><button type="button" className="danger small" disabled={busy} onClick={() => { if (window.confirm('الاعتذار عن المهمة؟')) void run(() => api.courierDecline(o.id), 'تم الاعتذار عن المهمة'); }}>اعتذر عن المهمة</button></div>
                </form>
              )
          )}
          {o.status === 'with_courier' && (
            <form className="code-entry" onSubmit={(e) => { e.preventDefault(); void codeResult(() => api.courierDeliver(o.id, code), 'تم تسليم الطلب. أحسنت!'); }}>
              <label className="field-label">اطلب من المشتري «كود التسليم» واكتبه بعد ما يستلم</label>
              <div className="inline-form"><input value={code} inputMode="numeric" maxLength={4} pattern="[0-9]{4}" required placeholder="0000" dir="ltr" onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /><button className="primary" disabled={busy || code.length !== 4}>تأكيد التسليم</button></div>
              <p className="muted tiny">موقعك بيتشارك مع المشتري طول ما التطبيق مفتوح.</p>
            </form>
          )}
        </>
      )}
      {o.status === 'delivered' && <p className="info-line ok"><CheckCircle2 size={15} /> تم التسليم · أجرتك {egp(o.delivery_fee)}</p>}
    </>
  );
}

/* ------------------------------ admin ------------------------------ */
function AdminPart({ o, run, busy }: Ctx): ReactNode {
  const act = (action: 'cancel' | 'release_courier' | 'force_deliver', label: string) => {
    const note = window.prompt(`${label}\nاكتب سبب الإجراء (يُسجّل في سجل التدقيق):`);
    if (note === null) return;
    void run(() => api.adminOrderAction(o.id, action, note), 'تم تنفيذ الإجراء');
  };
  return (
    <>
      <div className="info-box small-text">
        {o.order_contacts ? <>المشتري: <b>{o.order_contacts.customer_name}</b> {localPhone(o.order_contacts.customer_phone)} <ContactButtons phone={o.order_contacts.customer_phone} /></> : null}
        {o.order_courier_contacts ? <><br />المندوب: <b>{o.order_courier_contacts.courier_name}</b> {localPhone(o.order_courier_contacts.courier_phone)} <ContactButtons phone={o.order_courier_contacts.courier_phone} /></> : null}
      </div>
      {!FINAL.includes(o.status) && (
        <div className="action-row">
          {o.courier_id && <button className="secondary small" disabled={busy} onClick={() => act('release_courier', 'تحرير المندوب وإعادة الطلب للمهام المتاحة')}>تحرير المندوب</button>}
          {o.status === 'with_courier' && <button className="secondary small" disabled={busy} onClick={() => act('force_deliver', 'إنهاء الطلب كمُسلَّم')}>إنهاء كمُسلَّم</button>}
          <button className="danger small" disabled={busy} onClick={() => act('cancel', 'إلغاء الطلب')}>إلغاء الطلب</button>
        </div>
      )}
    </>
  );
}
