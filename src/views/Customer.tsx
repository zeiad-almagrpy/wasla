import { useRef, useState, type ReactNode } from 'react';
import { Banknote, Bike, MapPin, Search, Store as StoreIcon, Truck, Wallet } from 'lucide-react';
import * as api from '../lib/api';
import { useQuery } from '../lib/hooks';
import { cart, cartCount, useCart } from '../lib/cart';
import { errMsg, locHref, money } from '../lib/utils';
import { Empty, ProductCard, Skeleton, Thumb } from '../components/ui';
import { OrdersPanel } from './Orders';
import { News, Requests } from './Requests';
import type { DeliveryMode, PaymentMethod, Product, ViewProps } from '../lib/types';

function Choice({ sel, onClick, icon, title, sub, disabled }: { sel: boolean; onClick: () => void; icon: ReactNode; title: string; sub?: string; disabled?: boolean }) {
  return (
    <button type="button" className={`choice ${sel ? 'sel' : ''}`} disabled={disabled} onClick={onClick} aria-pressed={sel}>
      <span className="choice-ico">{icon}</span><span><b>{title}</b>{sub && <small>{sub}</small>}</span>
    </button>
  );
}

export default function Customer({ profile, notify, tab, setTab }: ViewProps) {
  const stores = useQuery(api.listActiveStores, [], 60000, ['stores']);
  const products = useQuery(api.listAvailableProducts, [], 60000, ['products']);
  const regions = useQuery(api.listRegions, []);
  const zones = useQuery(api.listZones, [], 0);
  const maxFeeQuery = useQuery(() => api.getSetting('max_delivery_fee'), []);
  const maxFee = Math.min(500, Math.max(0, Number(maxFeeQuery.data || 500)));
  const cs = useCart();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [area, setArea] = useState('all');
  const [mode, setMode] = useState<DeliveryMode>('courier');
  const [zoneId, setZoneId] = useState('');
  const [areaText, setAreaText] = useState('');
  const [address, setAddress] = useState('');
  const [fee, setFee] = useState('');
  const [payment, setPayment] = useState<PaymentMethod>('cash');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useRef<string>(crypto.randomUUID());
  const [loc, setLoc] = useState<{ lat: number; lng: number; acc: number } | null>(null);
  const [locBusy, setLocBusy] = useState(false);
  const shareLocation = () => {
    if (!navigator.geolocation) return notify('جهازك لا يدعم تحديد الموقع', true);
    setLocBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setLoc({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }); setLocBusy(false); },
      (e) => { setLocBusy(false); notify(e.code === 1 ? 'لم تسمح بتحديد الموقع. فعّل الإذن من إعدادات المتصفح ثم حاول مرة أخرى' : 'تعذر تحديد موقعك. تأكد من تشغيل الـ GPS', true); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  };

  const q = query.trim().toLowerCase();
  const shopList = stores.data || [];
  const prodList = products.data || [];
  const storeById = new Map(shopList.map((s) => [s.id, s]));
  const visibleShops = shopList.filter((s) => (area === 'all' || s.region_id === area) && (!q || `${s.name} ${s.category}`.toLowerCase().includes(q)));
  const visibleIds = new Set(visibleShops.map((s) => s.id));
  const visibleProducts = prodList.filter((p) => visibleIds.has(p.store_id) && (!selected || p.store_id === selected) && (!q || `${p.name} ${p.category || ''}`.toLowerCase().includes(q)));

  const byId = new Map(prodList.map((p) => [p.id, p]));
  const cartItems = Object.entries(cs.items).flatMap(([id, qty]) => { const p = byId.get(id); return p ? [{ p, qty }] : []; });
  const missing = Object.keys(cs.items).filter((id) => !byId.has(id));
  const store = cs.storeId ? storeById.get(cs.storeId) : undefined;
  const count = cartCount(cs);
  const subtotal = money(cartItems.reduce((n, i) => n + i.p.price * i.qty, 0));

  const payOptions: PaymentMethod[] = store ? [...(store.accepts_cash ? (['cash'] as const) : []), ...(store.vodafone_cash_number ? (['vodafone_cash'] as const) : [])] : ['cash'];
  const effPay = payOptions.includes(payment) ? payment : payOptions[0];
  const effMode: DeliveryMode = mode === 'store' && !store?.own_delivery ? 'courier' : mode;
  const zoneList = zones.data || [];
  const zone = zoneList.find((z) => z.id === zoneId);
  const negotiable = effMode === 'courier' && !zone;
  const deliveryFee = effMode === 'pickup' ? 0 : effMode === 'store' ? money(store?.own_delivery_fee || 0) : zone ? zone.fee : money(Number(fee || 0));

  const add = (p: Product) => {
    if (!store && cs.storeId) return;
    if (!cart.add(p.store_id, p.id)) return notify('السلة تسمح بالشراء من محل واحد. أفرغ السلة أولًا أو أكمل الطلب.', true);
    notify('تمت الإضافة للسلة');
  };

  const place = async () => {
    if (!cs.storeId || !store) return;
    if (!store.is_open) return notify('المحل مغلق حاليًا', true);
    if (missing.length) return notify('في منتج بالسلة لم يعد متاحًا. احذفه أولًا.', true);
    if (effMode !== 'pickup' && address.trim().length < 3) return notify('اكتب عنوان التوصيل بالتفصيل', true);
    if (negotiable) {
      if (areaText.trim().length < 2) return notify('اكتب اسم المنطقة أو القرية', true);
      const f = Number(fee);
      if (!fee.trim() || !Number.isFinite(f) || f < 0 || f > maxFee) return notify(`اكتب أجرة صحيحة (من 0 إلى ${maxFee} جنيه)`, true);
    }
    setBusy(true);
    try {
      await api.createOrder({
        storeId: cs.storeId, items: cartItems.map((i) => ({ product_id: i.p.id, qty: i.qty })), mode: effMode, address: address.trim(),
        area: areaText.trim(), zoneId: effMode === 'courier' && zone ? zone.id : null, fee: negotiable ? money(Number(fee)) : 0,
        payment: effPay, note: note.trim(), expectedSubtotal: subtotal, key: key.current,
        lat: effMode !== 'pickup' ? loc?.lat ?? null : null, lng: effMode !== 'pickup' ? loc?.lng ?? null : null,
      });
      cart.clear(); setAddress(''); setLoc(null); setFee(''); setNote(''); setAreaText(''); key.current = crypto.randomUUID(); setTab('orders');
      notify(effPay === 'vodafone_cash' ? 'تم إرسال الطلب. حوّل المبلغ من صفحة طلباتي لتأكيده.' : 'تم إرسال طلبك للمحل. تابع حالته من هنا.');
    } catch (e) {
      notify(errMsg(e), true);
      if (String(e instanceof Error ? e.message : e).includes('price changed')) await products.reload();
    } finally { setBusy(false); }
  };

  if (tab === 'orders') return <OrdersPanel role="customer" userId={profile.id} notify={notify} />;
  if (tab === 'requests') return <Requests role="customer" userId={profile.id} notify={notify} canPost />;
  if (tab === 'news') return <News />;

  if (tab === 'cart') {
    if (!count) return <div className="panel"><Empty title="السلة فارغة" text="اختار محل وضيف اللي محتاجه." /><div className="action-row center"><button className="primary" onClick={() => setTab('home')}>تصفح المحلات</button></div></div>;
    return (
      <div className="checkout">
        <div className="panel">
          <h3>سلتك من «{store?.name || 'محل'}»</h3>
          {store && !store.is_open && <div className="notice-box warn">هذا المحل مغلق حاليًا. سيمكنك الإرسال عند فتحه.</div>}
          {cartItems.map(({ p, qty }) => (
            <div className="cart-item" key={p.id}>
              <Thumb path={p.image_path} alt={p.name} />
              <div className="cart-info">
                <b>{p.name}</b><small>{p.price} ج.م للوحدة · {money(p.price * qty)} ج.م</small>
                <div className="qty">
                  <button aria-label="أنقص" onClick={() => cart.set(p.id, qty - 1)}>−</button><b>{qty}</b>
                  <button aria-label="زِد" onClick={() => cart.set(p.id, qty + 1)}>+</button>
                  <button className="text-danger" onClick={() => cart.remove(p.id)}>حذف</button>
                </div>
              </div>
            </div>
          ))}
          {missing.map((id) => <div className="notice-box warn" key={id}>منتج في السلة لم يعد متاحًا. <button className="text-danger" onClick={() => cart.remove(id)}>إزالته</button></div>)}
          <button className="text-danger" onClick={() => cart.clear()}>إفراغ السلة</button>
        </div>

        <div className="panel stack-form">
          <h3>1) طريقة الاستلام</h3>
          <div className="choices">
            <Choice sel={effMode === 'courier'} onClick={() => setMode('courier')} icon={<Bike size={20} />} title="مندوب وصلة" sub="توصيل لحد باب بيتك" />
            {store?.own_delivery && <Choice sel={effMode === 'store'} onClick={() => setMode('store')} icon={<Truck size={20} />} title="توصيل من المحل" sub={`أجرة ثابتة ${money(store.own_delivery_fee || 0)} ج.م`} />}
            <Choice sel={effMode === 'pickup'} onClick={() => setMode('pickup')} icon={<StoreIcon size={20} />} title="استلام من المحل" sub="بدون أجرة توصيل" />
          </div>
          {effMode === 'courier' && (
            <>
              <label className="field-label">منطقتك</label>
              <select value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                <option value="">منطقة أخرى (أقترح الأجرة)</option>
                {zoneList.map((z) => <option key={z.id} value={z.id}>{z.name} · {money(z.fee)} ج.م</option>)}
              </select>
              {negotiable && (
                <>
                  <input value={areaText} maxLength={60} onChange={(e) => setAreaText(e.target.value)} placeholder="اسم المنطقة أو القرية" />
                  <input type="number" inputMode="numeric" min={0} max={maxFee} value={fee} onChange={(e) => setFee(e.target.value)} placeholder={`أجرة التوصيل المقترحة (حتى ${maxFee})`} />
                  <p className="muted tiny">المندوب ممكن يقبل أجرتك أو يقترح غيرها، وبتوافق انت قبل أي حاجة.</p>
                </>
              )}
            </>
          )}
          {effMode !== 'pickup' && (
            <>
              <label className="field-label">العنوان بالتفصيل</label>
              <textarea value={address} maxLength={300} onChange={(e) => setAddress(e.target.value)} placeholder="الشارع، رقم المنزل، علامة مميزة" />
              <p className="muted tiny">العنوان بيظهر للمحل وللمندوب اللي هيوصل طلبك فقط.</p>
              <div className={`share-loc ${loc ? 'on' : ''}`}>
                <p>{loc ? `تم تحديد موقعك${loc.acc > 150 ? ` (الدقة ضعيفة: حوالي ${loc.acc} متر، اكتب العنوان بالتفصيل كمان)` : ` (دقة حوالي ${loc.acc} متر)`}. بيوصل للمحل وللمندوب فقط.` : 'شارك موقعك على الخريطة عشان المندوب يوصلك أسرع (اختياري).'}</p>
                {loc ? (
                  <><a className="chip" href={locHref(loc.lat, loc.lng)} target="_blank" rel="noreferrer">عرض</a><button type="button" className="chip" onClick={() => setLoc(null)}>إلغاء</button></>
                ) : <button type="button" className="secondary small" disabled={locBusy} onClick={shareLocation}><MapPin size={15} /> {locBusy ? 'جارٍ التحديد…' : 'شارك موقعي'}</button>}
              </div>
            </>
          )}
        </div>

        <div className="panel stack-form">
          <h3>2) طريقة الدفع</h3>
          <div className="choices">
            {payOptions.includes('cash') && <Choice sel={effPay === 'cash'} onClick={() => setPayment('cash')} icon={<Banknote size={20} />} title="كاش عند الاستلام" sub="تدفع لما يوصلك الطلب" />}
            {payOptions.includes('vodafone_cash') && <Choice sel={effPay === 'vodafone_cash'} onClick={() => setPayment('vodafone_cash')} icon={<Wallet size={20} />} title="فودافون كاش" sub="حوّل ثمن المنتجات للمحل" />}
          </div>
          {effPay === 'vodafone_cash' && <p className="muted tiny">هتحوّل {subtotal} جنيه على رقم المحل بعد إرسال الطلب، وأجرة التوصيل بتدفعها كاش.</p>}
          <label className="field-label">ملاحظات للمحل (اختياري)</label>
          <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="مثال: بدون سكر" />
        </div>

        <div className="panel summary-card">
          <div className="sum-row"><span>المنتجات</span><b>{subtotal} ج.م</b></div>
          <div className="sum-row"><span>التوصيل</span><b>{effMode === 'pickup' ? 'بدون' : negotiable ? `${money(Number(fee || 0))} ج.م (مقترحة)` : `${deliveryFee} ج.م`}</b></div>
          <div className="summary-total"><span>الإجمالي</span><b>{money(subtotal + deliveryFee)} ج.م</b></div>
          <button className="primary full big" disabled={busy || !store?.is_open || missing.length > 0} onClick={() => void place()}>{busy ? 'جارٍ الإرسال…' : 'تأكيد وإرسال الطلب'}</button>
          <p className="muted tiny">الأسعار النهائية يحسبها الخادم من أسعار المحل الحالية، ولو تغيّر سعر هننبهك قبل الإرسال.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="searchbox" style={{ marginBottom: 16, width: '100%' }}><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث عن محل أو منتج" /></div>
      <section className="hero">
        <div><span className="hero-tag">محلات منطقتك</span><h2>احتياجاتك من المحلات<br />في مكان واحد</h2><p>اختار المحل، ضيف طلبك، وادفع كاش أو فودافون كاش.</p></div>
        <div className="hero-icon"><MapPin size={48} /></div>
      </section>
      <div className="form-row area-filter">
        <select value={area} onChange={(e) => setArea(e.target.value)} aria-label="المنطقة">
          <option value="all">كل المناطق</option>
          {(regions.data || []).map((r) => <option key={r.id} value={r.id}>{r.city}</option>)}
        </select>
      </div>
      <h2 className="section-title">المحلات المتاحة</h2>
      {stores.error && !stores.data ? <div className="notice-box">{stores.error}</div> : !stores.data ? <Skeleton rows={3} /> : visibleShops.length ? (
        <div className="shop-grid">
          {visibleShops.map((s) => (
            <button className={`shop-card ${selected === s.id ? 'sel' : ''} ${s.is_open ? '' : 'closed'}`} key={s.id} onClick={() => setSelected(selected === s.id ? null : s.id)}>
              <div className="shop-icon"><StoreIcon /></div>
              <div>
                <b>{s.name}</b><p>{s.category}</p>
                <div className="chips">
                  <span className={`tag ${s.is_open ? 'ok' : 'off'}`}>{s.is_open ? 'مفتوح' : 'مغلق'}</span>
                  {s.own_delivery && <span className="tag">توصيل من المحل</span>}
                  {s.vodafone_cash_number && <span className="tag">فودافون كاش</span>}
                </div>
              </div>
              <span className="arrow">←</span>
            </button>
          ))}
        </div>
      ) : <Empty title="لا توجد محلات متاحة حاليًا" text="ارجع لاحقًا أو اختر منطقة أخرى." />}
      <h2 className="section-title">{selected ? 'منتجات المحل' : 'المنتجات المتاحة'}</h2>
      {visibleProducts.length ? <div className="product-grid">{visibleProducts.map((p) => <ProductCard key={p.id} p={p} disabled={storeById.get(p.store_id)?.is_open === false} onAdd={() => add(p)} />)}</div> : <Empty title="لا توجد منتجات بعد" text="هتظهر المنتجات هنا لما المحلات تضيف منتجاتها." />}
      {count > 0 && (
        <section className="cartbar" key={count}>
          <div><b>سلة المشتريات</b><p>{count} قطعة · {subtotal} ج.م</p></div>
          <button className="primary" onClick={() => setTab('cart')}>مراجعة السلة</button>
        </section>
      )}
    </>
  );
}
