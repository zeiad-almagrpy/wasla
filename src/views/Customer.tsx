import { useState } from 'react';
import { MapPin, Search, Store as StoreIcon } from 'lucide-react';
import * as api from '../lib/api';
import { useQuery } from '../lib/hooks';
import { errMsg, money } from '../lib/utils';
import { Empty, ProductCard, Thumb } from '../components/ui';
import { OrdersPanel } from './Orders';
import { News, Requests } from './Requests';
import type { Product, ViewProps } from '../lib/types';

export default function Customer({ profile, notify, tab, setTab }: ViewProps) {
  const stores = useQuery(api.listActiveStores, [], 60000);
  const products = useQuery(api.listAvailableProducts, [], 60000);
  const regions = useQuery(api.listRegions, []);
  const maxFeeQuery = useQuery(() => api.getSetting('max_delivery_fee'), []);
  const maxFee = Math.min(500, Math.max(0, Number(maxFeeQuery.data || 500)));
  const [cart, setCart] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [area, setArea] = useState('all');
  const [delivery, setDelivery] = useState(true);
  const [address, setAddress] = useState('');
  const [fee, setFee] = useState('');
  const [busy, setBusy] = useState(false);

  const q = query.trim().toLowerCase();
  const shopList = stores.data || [];
  const prodList = products.data || [];
  const visibleShops = shopList.filter((s) => (area === 'all' || s.region_id === area) && (!q || `${s.name} ${s.category}`.toLowerCase().includes(q)));
  const visibleIds = new Set(visibleShops.map((s) => s.id));
  const visibleProducts = prodList.filter((p) => visibleIds.has(p.store_id) && (!selected || p.store_id === selected) && (!q || `${p.name} ${p.category || ''}`.toLowerCase().includes(q)));
  const cartItems = prodList.filter((p) => (cart[p.id] || 0) > 0).map((p) => ({ p, qty: cart[p.id] }));
  const cartShop = cartItems.length ? cartItems[0].p.store_id : null;
  const count = cartItems.reduce((n, i) => n + i.qty, 0);
  const subtotal = money(cartItems.reduce((n, i) => n + i.p.price * i.qty, 0));
  const feeNum = delivery ? Number(fee || 0) : 0;

  const add = (p: Product) => {
    if (cartShop && cartShop !== p.store_id) return notify('السلة تسمح بالشراء من محل واحد. أفرغ السلة أولًا.', true);
    if ((cart[p.id] || 0) >= 50) return notify('الحد الأقصى 50 قطعة من المنتج الواحد.', true);
    setCart((c) => ({ ...c, [p.id]: (c[p.id] || 0) + 1 }));
    notify('تمت إضافة المنتج إلى السلة');
  };

  const place = async () => {
    if (!cartShop) return;
    const f = money(Number(fee));
    if (delivery && !address.trim()) return notify('اكتب عنوان التوصيل', true);
    if (delivery && (!fee.trim() || !Number.isFinite(f) || f < 0 || f > maxFee)) return notify(`حدد أجرة توصيل صحيحة (من 0 إلى ${maxFee} جنيه)`, true);
    setBusy(true);
    try {
      await api.createOrder(cartShop, cartItems.map((i) => ({ product_id: i.p.id, qty: i.qty })), delivery, address.trim(), delivery ? f : 0);
      setCart({}); setAddress(''); setFee(''); setTab('orders');
      notify('تم إرسال طلبك للمحل. تابع تحديث حالته من صفحة طلباتي.');
    } catch (e) { notify(errMsg(e), true); }
    finally { setBusy(false); }
  };

  if (tab === 'orders') return <OrdersPanel role="customer" userId={profile.id} notify={notify} />;
  if (tab === 'requests') return <Requests role="customer" userId={profile.id} notify={notify} canPost />;
  if (tab === 'news') return <News />;

  if (tab === 'cart') {
    return (
      <div className="panel">
        <h3>راجع مشترياتك قبل التأكيد</h3>
        {!cartItems.length ? <Empty title="السلة فارغة" text="استكشف المحلات وأضف المنتجات التي تريدها." /> : (
          <>
            <div className="order-list">
              {cartItems.map(({ p, qty }) => (
                <div className="cart-item" key={p.id}>
                  <Thumb path={p.image_path} alt={p.name} />
                  <div className="cart-info">
                    <b>{p.name}</b><small>{p.price} جنيه للوحدة · {money(p.price * qty)} جنيه</small>
                    <div className="qty">
                      <button onClick={() => setCart((c) => ({ ...c, [p.id]: Math.max(0, (c[p.id] || 0) - 1) }))}>−</button><b>{qty}</b>
                      <button onClick={() => setCart((c) => ({ ...c, [p.id]: Math.min(50, (c[p.id] || 0) + 1) }))}>+</button>
                      <button className="text-danger" onClick={() => setCart((c) => { const n = { ...c }; delete n[p.id]; return n; })}>حذف</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="summary">
              <div><span>المجموع الفرعي</span><b>{subtotal} جنيه</b></div>
              <div className="seg">
                <button type="button" className={delivery ? 'primary' : 'secondary'} onClick={() => setDelivery(true)}>توصيل للعنوان</button>
                <button type="button" className={!delivery ? 'primary' : 'secondary'} onClick={() => setDelivery(false)}>استلام من المحل</button>
              </div>
              {delivery && (
                <>
                  <label className="field-label">عنوان التوصيل</label>
                  <input value={address} maxLength={300} onChange={(e) => setAddress(e.target.value)} placeholder="الشارع، المنطقة، علامة مميزة" />
                  <p className="muted">حدد ميزانية التوصيل. سيُسند الطلب لمندوب متاح ضمنها، وتظهر لك حالة الطلب هنا.</p>
                  <label className="field-label">أجرة التوصيل المقترحة (جنيه)</label>
                  <input type="number" inputMode="decimal" min="0" max={maxFee} value={fee} onChange={(e) => setFee(e.target.value)} placeholder="مثلاً 20" />
                </>
              )}
              <div className="summary-total"><span>الإجمالي قبل اعتماد أجرة المندوب</span><b>{money(subtotal + feeNum)} جنيه</b></div>
              <p className="muted">الدفع نقدًا عند الاستلام. الأسعار النهائية يحسبها الخادم من أسعار المحل الحالية.</p>
              <button className="primary full" disabled={busy} onClick={place}>{busy ? 'جارٍ الإرسال…' : 'تأكيد الطلب وإرساله للمحل'}</button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="searchbox" style={{ marginBottom: 16, width: '100%' }}><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث عن محل أو منتج" /></div>
      <section className="hero">
        <div><span className="hero-tag">محلات منطقتك</span><h2>احتياجاتك من المحلات<br />في مكان واحد</h2><p>اختار المحل، ضيف طلبك، وراجع تفاصيل التوصيل قبل التأكيد.</p></div>
        <div className="hero-icon"><MapPin size={48} /></div>
      </section>
      <div className="form-row area-filter">
        <select value={area} onChange={(e) => setArea(e.target.value)} aria-label="المنطقة">
          <option value="all">كل المناطق</option>
          {(regions.data || []).map((r) => <option key={r.id} value={r.id}>{r.city}</option>)}
        </select>
      </div>
      <h2 className="section-title">المحلات المتاحة</h2>
      {stores.error && !stores.data ? <div className="notice-box">{stores.error}</div> : visibleShops.length ? (
        <div className="shop-grid">
          {visibleShops.map((s) => (
            <button className="shop-card" key={s.id} onClick={() => setSelected(selected === s.id ? null : s.id)} style={selected === s.id ? { borderColor: '#087f75' } : undefined}>
              <div className="shop-icon"><StoreIcon /></div>
              <div><b>{s.name}</b><p>{s.category}</p><small><MapPin size={13} /> {(regions.data || []).find((r) => r.id === s.region_id)?.city || ''}</small></div>
              <span className="arrow">←</span>
            </button>
          ))}
        </div>
      ) : <Empty title="لا توجد محلات متاحة حاليًا" text="ارجع لاحقًا أو اختر منطقة أخرى." />}
      <h2 className="section-title">{selected ? 'منتجات المحل' : 'المنتجات المتاحة'}</h2>
      {visibleProducts.length ? <div className="product-grid">{visibleProducts.map((p) => <ProductCard key={p.id} p={p} onAdd={() => add(p)} />)}</div> : <Empty title="لا توجد منتجات بعد" text="ستظهر المنتجات هنا عندما تضيف المحلات منتجاتها." />}
      <section className="cartbar">
        <div><b>سلة المشتريات</b><p>{count} قطعة · {subtotal} جنيه</p></div>
        <button className="primary" disabled={!count} onClick={() => setTab('cart')}>مراجعة السلة</button>
      </section>
    </>
  );
}
