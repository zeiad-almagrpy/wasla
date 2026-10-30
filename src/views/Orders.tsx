import { useState } from 'react';
import { Bike } from 'lucide-react';
import * as api from '../lib/api';
import { useQuery } from '../lib/hooks';
import { MAX_FEE, STATUS_AR, errMsg, fmtDate, money, statusTone, waLink } from '../lib/utils';
import { Empty, Status } from '../components/ui';
import type { Notify, Order, OrderStatus, Role } from '../lib/types';

const FLOW: OrderStatus[] = ['accepted', 'preparing', 'ready'];

export function OrdersPanel({ role, userId, notify, filter }: { role: Role; userId: string; notify: Notify; filter?: (o: Order) => boolean }) {
  const q = useQuery(api.listOrders, [], 15000);
  if (q.error && !q.data) return <div className="notice-box">{q.error}</div>;
  if (!q.data) return <Empty title="جارٍ التحميل…" />;
  const list = filter ? q.data.filter(filter) : q.data;
  if (!list.length) return <Empty title="لا توجد طلبات" text="ستظهر الطلبات هنا عند توفرها." />;
  return <div className="order-list">{list.map((o) => <OrderCard key={o.id} o={o} role={role} userId={userId} notify={notify} onChanged={q.reload} />)}</div>;
}

function OrderCard({ o, role, userId, notify, onChanged }: { o: Order; role: Role; userId: string; notify: Notify; onChanged: () => Promise<void> }) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState<OrderStatus>(o.status);
  const [counter, setCounter] = useState(String(o.courier_proposed_fee ?? o.proposed_delivery_fee));
  const [reply, setReply] = useState(o.courier_reply || '');

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    try { await fn(); notify(okMsg); await onChanged(); }
    catch (e) { notify(errMsg(e), true); }
    finally { setBusy(false); }
  };

  const short = o.id.slice(-6);
  const mine = o.courier_id === userId;
  const inFlow = FLOW.includes(o.status);
  const options = FLOW.slice(Math.max(0, FLOW.indexOf(o.status)));
  const sel = options.includes(next) ? next : o.status;
  const openForCourier = role === 'courier' && o.delivery_required && !o.courier_id && inFlow;
  const courierBlock = role === 'courier' && (openForCourier || (mine && inFlow));
  const phone = o.order_contacts?.customer_phone;
  const shopWa = o.stores?.whatsapp;
  const feeNow = o.fee_status === 'countered' || o.fee_status === 'accepted' ? o.courier_proposed_fee : o.proposed_delivery_fee;

  const sendOffer = () => {
    const fee = money(Number(counter));
    if (!counter.trim() || !Number.isFinite(fee) || fee < 0 || fee > MAX_FEE) return notify(`اكتب أجرة صحيحة (من 0 إلى ${MAX_FEE} جنيه)`, true);
    run(() => api.courierOffer(o.id, fee, reply), fee === o.proposed_delivery_fee ? 'أرسلت موافقتك على الأجرة للمشتري' : 'أرسلت أجرة مقترحة للمشتري');
  };

  return (
    <div className="order-card">
      <div className="order-head">
        <div>
          <b>طلب #{short}</b>
          <small>{fmtDate(o.created_at)}{o.order_contacts ? ` · ${o.order_contacts.customer_name}` : ''}</small>
          <small>المحل: {o.stores?.name || 'غير معروف'}</small>
        </div>
        <Status label={STATUS_AR[o.status]} tone={statusTone(o.status)} />
      </div>
      <p>{o.order_items.map((i) => `${i.product_name_snapshot} × ${i.quantity}`).join('، ')}</p>
      <div className="order-foot">
        <strong>قيمة المنتجات: {o.subtotal} ج.م</strong>
        <button className="secondary small" onClick={() => setExpanded(!expanded)}>{expanded ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}</button>
      </div>
      {expanded && (
        <div className="order-details">
          <p><b>{o.delivery_required ? 'العنوان:' : 'الاستلام:'}</b> {o.address_snapshot}</p>
          {o.order_contacts && <p><b>هاتف المشتري:</b> <a href={waLink(o.order_contacts.customer_phone, `مرحبًا ${o.order_contacts.customer_name}، بخصوص طلبك رقم ${short} على وصلة.`)} target="_blank" rel="noopener noreferrer">{o.order_contacts.customer_phone}</a></p>}
          {o.delivery_required && <p><b>أجرة التوصيل:</b> {feeNow} ج.م {o.fee_status === 'accepted' ? '(متفق عليها)' : o.fee_status === 'countered' ? '(بانتظار موافقة المشتري)' : '(مقترحة)'}</p>}
          <p><b>الإجمالي:</b> {o.total} ج.م · الدفع نقدًا عند الاستلام</p>
        </div>
      )}

      {role === 'merchant' && o.status === 'new' && (
        <div className="action-row">
          <button className="primary" disabled={busy} onClick={() => run(() => api.merchantSetStatus(o.id, 'accepted'), 'تم قبول الطلب. حدّث الحالة عند التجهيز.')}>قبول الطلب</button>
          <button className="secondary" disabled={busy} onClick={() => run(() => api.merchantSetStatus(o.id, 'cancelled'), 'تم رفض الطلب')}>رفض الطلب</button>
        </div>
      )}
      {role === 'merchant' && inFlow && (
        <div className="action-row">
          <select value={sel} onChange={(e) => setNext(e.target.value as OrderStatus)}>{options.map((s) => <option key={s} value={s}>{STATUS_AR[s]}</option>)}</select>
          <button className="primary" disabled={busy || sel === o.status} onClick={() => run(() => api.merchantSetStatus(o.id, sel), 'تم تحديث حالة الطلب')}>تحديث الحالة</button>
          <button className="secondary" disabled={busy} onClick={() => { if (confirm('إلغاء الطلب؟')) run(() => api.merchantSetStatus(o.id, 'cancelled'), 'تم إلغاء الطلب'); }}>إلغاء</button>
        </div>
      )}
      {role === 'merchant' && !o.delivery_required && o.status === 'ready' && (
        <div className="action-row"><button className="primary" disabled={busy} onClick={() => run(() => api.merchantSetStatus(o.id, 'delivered'), 'تم تسجيل تسليم الطلب للمشتري')}>تم تسليم الطلب للمشتري</button></div>
      )}

      {courierBlock && (
        <div className="courier-offer">
          <h4><Bike size={17} /> مراجعة مهمة التوصيل</h4>
          <p>العنوان: <b>{o.address_snapshot}</b></p>
          {o.stores?.address && <p>عنوان المحل: <b>{o.stores.address}</b></p>}
          <p>أجرة المشتري المقترحة: <b>{o.proposed_delivery_fee} ج.م</b></p>
          {o.fee_status === 'pending' && (
            <>
              <button className="primary full" disabled={busy} onClick={() => run(() => api.courierOffer(o.id, o.proposed_delivery_fee, 'أوافق على أجرة التوصيل المقترحة.'), 'وافقت على الأجرة. ينتظر الطلب موافقة المشتري.')}>أقبل الطلب بالأجرة المقترحة ({o.proposed_delivery_fee} ج.م)</button>
              <label className="field-label">أو اقترح أجرة مختلفة (جنيه)</label>
              <input type="number" inputMode="decimal" min="0" max={MAX_FEE} value={counter} onChange={(e) => setCounter(e.target.value)} />
              <label className="field-label">رد للمشتري (اختياري)</label>
              <textarea value={reply} maxLength={300} onChange={(e) => setReply(e.target.value)} placeholder="مثلاً: أقدر أوصل مقابل 25 جنيه" />
              <div className="action-row">
                <button className="primary" disabled={busy} onClick={sendOffer}>إرسال الرد والأجرة</button>
                <button className="secondary" disabled={busy} onClick={() => run(() => api.courierDecline(o.id), 'تم إخفاء المهمة عنك')}>غير مناسب</button>
              </div>
            </>
          )}
          {o.fee_status === 'countered' && mine && (
            <div className="notice-box">
              أرسلت أجرة {o.courier_proposed_fee} ج.م وبانتظار موافقة المشتري.
              <div className="action-row"><button className="secondary" disabled={busy} onClick={() => run(() => api.courierDecline(o.id), 'تم سحب عرضك')}>سحب العرض</button></div>
            </div>
          )}
          {o.fee_status === 'accepted' && mine && (o.status === 'ready'
            ? <div className="action-row"><button className="primary" disabled={busy} onClick={() => run(() => api.courierPickup(o.id), 'تم تأكيد استلام الطلب من المحل')}>تأكيد استلام الطلب من المحل</button></div>
            : <div className="notice-box">تم الاتفاق على الأجرة. سيظهر زر الاستلام عندما يصبح الطلب «جاهز للاستلام».</div>)}
        </div>
      )}
      {role === 'courier' && mine && o.status === 'with_courier' && (
        <div className="action-row"><button className="primary" disabled={busy} onClick={() => run(() => api.courierDeliver(o.id), 'تم تسجيل التسليم')}>تأكيد التسليم للمشتري</button></div>
      )}

      {role === 'customer' && o.fee_status === 'countered' && o.status !== 'cancelled' && (
        <div className="notice-box">
          <b>رد المندوب على أجرة التوصيل:</b> {o.courier_reply || 'اقترح المندوب أجرة'}
          <p>الأجرة المقترحة من المندوب: <b>{o.courier_proposed_fee} ج.م</b></p>
          <div className="action-row">
            <button className="primary" disabled={busy} onClick={() => run(() => api.customerRespondFee(o.id, true), 'وافقت على الأجرة. ينتظر تأكيد المندوب للاستلام.')}>موافقة على الأجرة</button>
            <button className="secondary" disabled={busy} onClick={() => run(() => api.customerRespondFee(o.id, false), 'تم رفض الأجرة. يمكن لمندوب آخر تقديم عرض.')}>رفض الأجرة</button>
          </div>
        </div>
      )}
      {role === 'customer' && o.status === 'new' && (
        <div className="action-row">
          {shopWa && <a className="primary wa-link" target="_blank" rel="noopener noreferrer" href={waLink(shopWa, `طلب جديد من وصلة رقم ${short}\nالمنتجات: ${o.order_items.map((i) => `${i.product_name_snapshot} × ${i.quantity}`).join('، ')}\nالإجمالي: ${o.total} جنيه\n${o.delivery_required ? `العنوان: ${o.address_snapshot}` : 'استلام من المحل'}\nيرجى مراجعة الطلب وقبوله من لوحة وصلة.`)}>تنبيه المحل عبر واتساب</a>}
          <button className="secondary" disabled={busy} onClick={() => { if (confirm('إلغاء الطلب؟')) run(() => api.customerCancel(o.id), 'تم إلغاء الطلب'); }}>إلغاء الطلب</button>
        </div>
      )}
      {role === 'customer' && <div className="order-foot"><span>أجرة التوصيل: {o.delivery_required ? feeNow : 0} ج.م</span><strong>الإجمالي: {o.total} ج.م</strong></div>}
    </div>
  );
}
