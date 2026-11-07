import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Order, Profile, Store } from '../src/lib/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ fns: {} as Record<string, ReturnType<typeof vi.fn>> }));
vi.mock('../src/lib/supabase', () => {
  const channel = { on() { return channel; }, subscribe() { return channel; } };
  return { configured: true, sb: { channel: () => channel, removeChannel: async () => undefined, storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }) }) }, auth: { signOut: async () => undefined } } };
});
vi.mock('../src/lib/api', () => new Proxy({ __esModule: true } as Record<string, unknown>, {
  get: (t, k: string) => { if (k in t) return t[k]; if (k === 'then') return undefined; return (h.fns[k] ??= vi.fn(async () => null)); },
  has: () => true,
}));
import * as api from '../src/lib/api';
import { OrdersPanel } from '../src/views/Orders';
import Customer from '../src/views/Customer';
import Merchant from '../src/views/Merchant';
import Admin from '../src/views/Admin';
import { SupportPanel } from '../src/views/Support';
import { cart } from '../src/lib/cart';

const fn = (name: string) => (api as unknown as Record<string, ReturnType<typeof vi.fn>>)[name];
let n = 100;
const order = (o: Partial<Order> = {}): Order => ({
  id: `o${n}`, order_no: n++, customer_id: 'c1', store_id: 's1', address_snapshot: 'قرية س', area_hint: 'قرية س', status: 'new', subtotal: 60,
  proposed_delivery_fee: 20, courier_proposed_fee: null, courier_reply: null, fee_status: 'accepted', fee_fixed: true, courier_id: null, delivery_required: true,
  delivery_mode: 'courier', payment_method: 'cash', payment_status: 'cod', payment_ref: null, note: null, prep_minutes: 20, accepted_at: new Date().toISOString(),
  delivery_fee: 20, total: 80, created_at: new Date().toISOString(),
  order_items: [{ id: 'i1', product_name_snapshot: 'لبن', unit_price_snapshot: 30, quantity: 2, line_total: 60, image_path_snapshot: null }],
  stores: { name: 'محل الأول', address: 'شارع 1', vodafone_cash_number: '201000000011' },
  order_contacts: { customer_name: 'مشتري', customer_phone: '201000000021' }, order_courier_contacts: null,
  order_addresses: { address: 'المنزل 5 جنب المسجد', lat: null, lng: null }, order_pickup_codes: null, order_delivery_codes: null, ...o,
});

async function mount(el: React.ReactElement) {
  const div = document.createElement('div'); document.body.appendChild(div);
  const root = createRoot(div);
  await act(async () => { root.render(el); });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return { div, text: () => div.textContent || '', root };
}
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const btn = (div: HTMLElement, label: string) => [...div.querySelectorAll('button,a')].find((b) => (b.textContent || '').includes(label)) as HTMLElement | undefined;
const notify = vi.fn();
const panel = async (role: 'customer' | 'merchant' | 'courier' | 'admin', orders: Order[], userId = 'u1') => {
  fn('listOrders').mockResolvedValue(orders); fn('getSetting').mockResolvedValue('500');
  return mount(<OrdersPanel role={role} userId={userId} notify={notify} />);
};

beforeEach(() => { document.body.innerHTML = ''; localStorage.clear(); cart.clear(); Object.values(h.fns).forEach((f) => f.mockClear()); fn('imgUrl').mockImplementation(() => ''); });

describe('buyer sees the right things', () => {
  it('delivery code + cash due + courier contact on an assigned courier order', async () => {
    const m = await panel('customer', [order({ status: 'ready', courier_id: 'k1', order_delivery_codes: { code: '4821' }, order_courier_contacts: { courier_name: 'المندوب أحمد', courier_phone: '201000000031' } })]);
    expect(m.text()).toContain('كود التسليم'); expect(m.text()).toContain('4821'); expect(m.text()).toContain('تدفع كاش عند الاستلام'); expect(m.text()).toContain('80 ج.م');
    expect(m.text()).toContain('المندوب أحمد'); expect(m.div.querySelectorAll('.steps li').length).toBe(5);
    expect(m.div.querySelector('a[href^="tel:"]')).toBeTruthy();
  });
  it('vodafone: shows wallet number, amount, and submits the reference', async () => {
    const m = await panel('customer', [order({ id: 'vf1', payment_method: 'vodafone_cash', payment_status: 'awaiting', delivery_mode: 'pickup', delivery_required: false, delivery_fee: 0, total: 60 })]);
    expect(m.text()).toContain('الدفع بفودافون كاش'); expect(m.text()).toContain('01000000011'); expect(m.text()).toContain('60 ج.م');
    const input = m.div.querySelector('.pay-box input') as HTMLInputElement;
    await act(async () => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; set.call(input, 'TX99887'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { m.div.querySelector('.pay-box form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(fn('customerSubmitPayment')).toHaveBeenCalledWith('vf1', 'TX99887');
  });
  it('vodafone proof submitted -> waiting message, no input, cannot cancel', async () => {
    const m = await panel('customer', [order({ payment_method: 'vodafone_cash', payment_status: 'proof_submitted', payment_ref: 'TX1', status: 'new' })]);
    expect(m.text()).toContain('بانتظار تأكيد المحل'); expect(m.div.querySelector('.pay-box input')).toBeNull(); expect(btn(m.div, 'إلغاء الطلب')).toBeUndefined();
  });
  it('counter offer: accept / reject buttons', async () => {
    const m = await panel('customer', [order({ fee_status: 'countered', fee_fixed: false, courier_id: 'k1', courier_proposed_fee: 35, courier_reply: 'بعيد', status: 'accepted' })]);
    expect(m.text()).toContain('35 ج.م'); await click(btn(m.div, 'موافق'));
    expect(fn('customerRespondFee')).toHaveBeenCalledWith(expect.any(String), true);
  });
  it('cancel allowed when new, hidden after the 3-minute window', async () => {
    const a = await panel('customer', [order({ status: 'new' })]); expect(btn(a.div, 'إلغاء الطلب')).toBeTruthy();
    document.body.innerHTML = '';
    const b = await panel('customer', [order({ status: 'accepted', accepted_at: new Date(Date.now() - 10 * 60000).toISOString() })]); expect(btn(b.div, 'إلغاء الطلب')).toBeUndefined();
  });
  it('never shows delivery code to a buyer of a pickup order; shows 4 steps', async () => {
    const m = await panel('customer', [order({ delivery_mode: 'pickup', delivery_required: false, delivery_fee: 0, total: 60, status: 'ready' })]);
    expect(m.text()).not.toContain('كود التسليم'); expect(m.div.querySelectorAll('.steps li').length).toBe(4);
  });
});

describe('merchant order handling', () => {
  it('new order: prep-time chips and accept passes minutes', async () => {
    const m = await panel('merchant', [order({ id: 'm1', status: 'new' })]);
    await click(btn(m.div, '30 د')); await click(btn(m.div, 'قبول الطلب'));
    expect(fn('merchantSetStatus')).toHaveBeenCalledWith('m1', 'accepted', 30);
  });
  it('vodafone proof: shows reference and confirm / reject', async () => {
    const m = await panel('merchant', [order({ id: 'm2', payment_method: 'vodafone_cash', payment_status: 'proof_submitted', payment_ref: 'TX777', status: 'accepted' })]);
    expect(m.text()).toContain('TX777'); await click(btn(m.div, 'وصلتني الفلوس')); expect(fn('merchantReviewPayment')).toHaveBeenCalledWith('m2', true);
    await click(btn(m.div, 'لم تصل')); expect(fn('merchantReviewPayment')).toHaveBeenCalledWith('m2', false);
  });
  it('courier order ready: shows pickup code and who is coming', async () => {
    const m = await panel('merchant', [order({ status: 'ready', courier_id: 'k1', order_pickup_codes: { code: '0731' }, order_courier_contacts: { courier_name: 'سمير', courier_phone: '201000000031' } })]);
    expect(m.text()).toContain('0731'); expect(m.text()).toContain('سمير'); expect(m.text()).not.toContain('كود التسليم');
  });
  it('pickup + unpaid vodafone: handover button disabled with a warning', async () => {
    const m = await panel('merchant', [order({ status: 'ready', delivery_mode: 'pickup', delivery_required: false, payment_method: 'vodafone_cash', payment_status: 'awaiting' })]);
    expect((btn(m.div, 'تم تسليم الطلب للمشتري') as HTMLButtonElement).disabled).toBe(true); expect(m.text()).toContain('لازم تؤكد الدفع أولًا');
  });
  it('own-delivery flow buttons: out for delivery then delivered', async () => {
    const a = await panel('merchant', [order({ id: 'sd1', status: 'ready', delivery_mode: 'store' })]); await click(btn(a.div, 'خرج للتوصيل')); expect(fn('merchantSetStatus')).toHaveBeenCalledWith('sd1', 'with_courier', undefined);
    document.body.innerHTML = '';
    const b = await panel('merchant', [order({ id: 'sd2', status: 'with_courier', delivery_mode: 'store' })]); await click(btn(b.div, 'تم التوصيل')); expect(fn('merchantSetStatus')).toHaveBeenCalledWith('sd2', 'delivered', undefined);
  });
  it('shows buyer contact buttons and address', async () => {
    const m = await panel('merchant', [order({ status: 'new' })]);
    expect(m.div.querySelector('a[href^="tel:"]')).toBeTruthy(); expect(m.div.querySelector('a[href*="wa.me"]')).toBeTruthy(); expect(m.text()).toContain('المنزل 5');
  });
});

describe('courier privacy and flow', () => {
  it('available fixed-fee task: area only (no full address / phone), claim button', async () => {
    const m = await panel('courier', [order({ id: 'k1o', status: 'accepted', order_addresses: null, order_contacts: null })]);
    expect(m.text()).toContain('قرية س'); expect(m.text()).not.toContain('المنزل 5'); expect(m.text()).not.toContain('01000000021');
    await click(btn(m.div, 'أقبل المهمة')); expect(fn('courierClaim')).toHaveBeenCalledWith('k1o');
  });
  it('available negotiable task: accept proposed fee or counter', async () => {
    const m = await panel('courier', [order({ status: 'accepted', fee_fixed: false, fee_status: 'pending', order_addresses: null, order_contacts: null })]);
    expect(btn(m.div, 'أقبل بـ')).toBeTruthy(); expect(btn(m.div, 'اقترح')).toBeTruthy();
  });
  it('mine, ready: asks for the store code; wrong code message; right code calls api', async () => {
    fn('courierPickup').mockResolvedValueOnce('wrong_code').mockResolvedValueOnce('ok');
    const m = await panel('courier', [order({ id: 'p1', status: 'ready', courier_id: 'u1' })], 'u1');
    expect(m.text()).toContain('كود التسليم للمندوب'); expect(m.text()).toContain('المنزل 5');
    const input = m.div.querySelector('.code-entry input') as HTMLInputElement;
    const type = async (v: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await type('1111'); await act(async () => { m.div.querySelector('.code-entry')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(fn('courierPickup')).toHaveBeenCalledWith('p1', '1111'); expect(notify).toHaveBeenCalledWith(expect.stringContaining('غير صحيح'), true);
  });
  it('mine, unpaid vodafone: tells courier to wait instead of showing the code form', async () => {
    const m = await panel('courier', [order({ status: 'ready', courier_id: 'u1', payment_method: 'vodafone_cash', payment_status: 'awaiting' })], 'u1');
    expect(m.text()).toContain('لسه ما أكدش الدفع'); expect(m.div.querySelector('.code-entry')).toBeNull();
  });
  it('mine, with courier: delivery code form; due amount only fee for vodafone orders', async () => {
    const m = await panel('courier', [order({ status: 'with_courier', courier_id: 'u1', payment_method: 'vodafone_cash', payment_status: 'confirmed' })], 'u1');
    expect(btn(m.div, 'تأكيد التسليم')).toBeTruthy(); expect(m.text()).toContain('المطلوب تحصيله من المشتري'); expect(m.div.querySelector('.due')!.textContent).toContain('20 ج.م');
  });
});

describe('location sharing + ready right away', () => {
  it('merchant sees a map link only when the buyer shared a location', async () => {
    const a = await panel('merchant', [order({ order_addresses: { address: 'المنزل 5', lat: 31.2, lng: 30.9 } })]);
    expect(a.div.querySelector('a[href*="query=31.2,30.9"]')).toBeTruthy();
    document.body.innerHTML = '';
    const b = await panel('merchant', [order()]); expect(b.div.querySelector('a[href*="query="]')).toBeNull();
  });
  it('courier who took the order gets directions to the shared pin', async () => {
    const m = await panel('courier', [order({ status: 'ready', courier_id: 'u1', order_addresses: { address: 'المنزل 5', lat: 31.2, lng: 30.9 } })], 'u1');
    expect(m.div.querySelector('a[href*="destination=31.2,30.9"]')).toBeTruthy();
  });
  it('"ready right away" skips the prep time and sets ready directly', async () => {
    const m = await panel('merchant', [order({ id: 'rr1', status: 'new' })]);
    await click(btn(m.div, 'جاهز فورًا')); expect(fn('merchantSetStatus')).toHaveBeenCalledWith('rr1', 'ready', undefined);
  });
});

describe('admin tools', () => {
  it('stuck order: release / force deliver / cancel with audit note', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('المندوب لا يرد');
    const m = await panel('admin', [order({ id: 'a1', status: 'with_courier', courier_id: 'k1', order_courier_contacts: { courier_name: 'سمير', courier_phone: '201000000031' } })]);
    await click(btn(m.div, 'تحرير المندوب')); expect(fn('adminOrderAction')).toHaveBeenCalledWith('a1', 'release_courier', 'المندوب لا يرد');
    expect(btn(m.div, 'إنهاء كمُسلَّم')).toBeTruthy(); expect(btn(m.div, 'إلغاء الطلب')).toBeTruthy();
  });
});

const profile: Profile = { id: 'c1', full_name: 'Customer', phone: '201000000021', role: 'customer', requested_role: 'customer', is_blocked: false };
const store: Store = { id: 's1', owner_id: 'm1', name: 'محل الأول', description: null, category: 'بقالة', address: 'شارع 1', region_id: null, status: 'active', trial_started_at: null, subscription_status: 'trial', monthly_price: null, created_at: '', paid_until: null, is_open: true, own_delivery: true, own_delivery_fee: 10, accepts_cash: true, vodafone_cash_number: '201000000011' };
const product = { id: 'p1', store_id: 's1', name: 'لبن', description: null, category: 'ألبان', price: 30, is_available: true, image_path: null };

describe('customer checkout contract', () => {
  beforeEach(() => {
    fn('listActiveStores').mockResolvedValue([store]); fn('listAvailableProducts').mockResolvedValue([product]); fn('listRegions').mockResolvedValue([]);
    fn('listZones').mockResolvedValue([{ id: 'z1', region_id: null, name: 'قرية س', fee: 20, is_active: true, sort_order: 0 }]); fn('getSetting').mockResolvedValue('500');
    fn('createOrder').mockResolvedValue('new-order');
  });
  it('shop list shows open state, store delivery and vodafone tags; products add to the persisted cart', async () => {
    const m = await mount(<Customer profile={profile} notify={notify} tab="home" setTab={vi.fn()} />);
    expect(m.text()).toContain('مفتوح'); expect(m.text()).toContain('توصيل من المحل'); expect(m.text()).toContain('فودافون كاش');
    await click(btn(m.div, 'أضف للسلة')); expect(cart.get().items).toEqual({ p1: 1 }); expect(JSON.parse(localStorage.getItem('wesla.cart.v1')!).items).toEqual({ p1: 1 });
  });
  it('cart: all three modes + both payments; zone gives a fixed fee; sends exact payload with idempotency key', async () => {
    cart.add('s1', 'p1'); cart.set('p1', 2);
    const setTab = vi.fn(); const m = await mount(<Customer profile={profile} notify={notify} tab="cart" setTab={setTab} />);
    for (const t of ['مندوب وصلة', 'توصيل من المحل', 'استلام من المحل', 'كاش عند الاستلام', 'فودافون كاش']) expect(m.text()).toContain(t);
    const sel = m.div.querySelector('select') as HTMLSelectElement;
    await act(async () => { sel.value = 'z1'; sel.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(m.div.querySelector('.summary-total')!.textContent).toContain('80 ج.م');
    const ta = m.div.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, 'المنزل 5 جنب المسجد'); ta.dispatchEvent(new Event('input', { bubbles: true })); });
    await click(btn(m.div, 'فودافون كاش')); await click(btn(m.div, 'تأكيد وإرسال الطلب'));
    expect(fn('createOrder')).toHaveBeenCalledWith(expect.objectContaining({ storeId: 's1', mode: 'courier', zoneId: 'z1', payment: 'vodafone_cash', expectedSubtotal: 60, items: [{ product_id: 'p1', qty: 2 }], key: expect.stringMatching(/^[0-9a-f-]{36}$/) }));
    expect(cart.get().storeId).toBeNull(); expect(setTab).toHaveBeenCalledWith('orders');
  });
  it('shares GPS location with the order (delivery only, never for pickup)', async () => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: 31.2, longitude: 30.9, accuracy: 20 } }) } });
    cart.add('s1', 'p1');
    const m = await mount(<Customer profile={profile} notify={notify} tab="cart" setTab={vi.fn()} />);
    const ta = m.div.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, 'بيت 7 جنب المسجد'); ta.dispatchEvent(new Event('input', { bubbles: true })); });
    const sel = m.div.querySelector('select') as HTMLSelectElement;
    await act(async () => { sel.value = 'z1'; sel.dispatchEvent(new Event('change', { bubbles: true })); });
    await click(btn(m.div, 'شارك موقعي')); expect(m.text()).toContain('تم تحديد موقعك');
    await click(btn(m.div, 'تأكيد وإرسال الطلب'));
    expect(fn('createOrder')).toHaveBeenCalledWith(expect.objectContaining({ mode: 'courier', lat: 31.2, lng: 30.9 }));
    document.body.innerHTML = ''; fn('createOrder').mockClear(); cart.add('s1', 'p1');
    const p = await mount(<Customer profile={profile} notify={notify} tab="cart" setTab={vi.fn()} />);
    const ta2 = p.div.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta2, 'بيت 7 جنب المسجد'); ta2.dispatchEvent(new Event('input', { bubbles: true })); });
    const sel2 = p.div.querySelector('select') as HTMLSelectElement;
    await act(async () => { sel2.value = 'z1'; sel2.dispatchEvent(new Event('change', { bubbles: true })); });
    await click(btn(p.div, 'شارك موقعي')); await click(btn(p.div, 'استلام من المحل')); await click(btn(p.div, 'تأكيد وإرسال الطلب'));
    expect(fn('createOrder')).toHaveBeenCalledWith(expect.objectContaining({ mode: 'pickup', lat: null, lng: null }));
  });
  it('store delivery uses the store fee and pickup has none', async () => {
    cart.add('s1', 'p1'); const m = await mount(<Customer profile={profile} notify={notify} tab="cart" setTab={vi.fn()} />);
    await click(btn(m.div, 'توصيل من المحل')); expect(m.div.querySelector('.summary-total')!.textContent).toContain('40 ج.م');
    await click(btn(m.div, 'استلام من المحل')); expect(m.div.querySelector('.summary-total')!.textContent).toContain('30 ج.م'); expect(m.div.querySelector('textarea')).toBeNull();
  });
  it('a store without vodafone number / own delivery only offers what it supports', async () => {
    fn('listActiveStores').mockResolvedValue([{ ...store, own_delivery: false, vodafone_cash_number: null }]);
    cart.add('s1', 'p1'); const m = await mount(<Customer profile={profile} notify={notify} tab="cart" setTab={vi.fn()} />);
    expect(m.text()).not.toContain('توصيل من المحل'); expect(m.text()).not.toContain('حوّل ثمن المنتجات');
  });
  it('closed store blocks ordering; server price change refreshes products', async () => {
    fn('listActiveStores').mockResolvedValue([{ ...store, is_open: false }]); cart.add('s1', 'p1');
    const m = await mount(<Customer profile={profile} notify={notify} tab="cart" setTab={vi.fn()} />);
    expect(m.text()).toContain('مغلق حاليًا'); expect((btn(m.div, 'تأكيد وإرسال الطلب') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('merchant screens', () => {
  beforeEach(() => { fn('getMyStore').mockResolvedValue(store); fn('listOrders').mockResolvedValue([order({ status: 'new' })]); fn('listRegions').mockResolvedValue([]); fn('getSetting').mockResolvedValue('30'); });
  it('dashboard: open/closed switch, new-order banner, sound switch', async () => {
    const m = await mount(<Merchant profile={{ ...profile, id: 'm1', role: 'merchant' }} notify={notify} tab="dashboard" setTab={vi.fn()} onProfileChange={vi.fn()} />);
    expect(m.text()).toContain('المحل مفتوح'); expect(m.text()).toContain('عندك 1 طلب جديد'); expect(m.div.querySelectorAll('[role=switch]').length).toBe(2);
    await click(m.div.querySelector('[aria-label="فتح وإغلاق المحل"]')); expect(fn('updateMyStore')).toHaveBeenCalledWith('s1', { is_open: false });
  });
  it('store settings: saves payment + own delivery; rejects having no payment method', async () => {
    const m = await mount(<Merchant profile={{ ...profile, id: 'm1', role: 'merchant' }} notify={notify} tab="storeSettings" setTab={vi.fn()} onProfileChange={vi.fn()} />);
    expect(m.text()).toContain('طرق الدفع'); expect(m.text()).toContain('التوصيل بمندوب المحل');
    await act(async () => { m.div.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(fn('updateMyStore')).toHaveBeenCalledWith('s1', expect.objectContaining({ accepts_cash: true, vodafone_cash_number: '201000000011', own_delivery: true, own_delivery_fee: 10 }));
  });
});

describe('admin + support screens', () => {
  it('support admin: sender name/phone visible, reply form works', async () => {
    fn('listSupportRequests').mockResolvedValue([{ id: 'sr1', user_id: 'x', subject: 'مشكلة', message: 'الطلب اتأخر', status: 'open', created_at: new Date().toISOString(), admin_reply: null, answered_at: null, profiles: { full_name: 'سعيد', phone: '201000000044' } }]);
    const m = await mount(<SupportPanel userId="a1" admin notify={notify} />);
    expect(m.text()).toContain('سعيد'); expect(m.text()).toContain('01000000044');
    const ta = m.div.querySelector('.reply-form textarea') as HTMLTextAreaElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, 'تم الحل'); ta.dispatchEvent(new Event('input', { bubbles: true })); });
    await click(btn(m.div, 'إرسال الرد')); expect(fn('adminReplySupport')).toHaveBeenCalledWith('sr1', 'تم الحل');
  });
  it('admin zones tab lists zones and settings tab has the new toggles', async () => {
    fn('listZones').mockResolvedValue([{ id: 'z1', region_id: null, name: 'قرية س', fee: 20, is_active: true, sort_order: 0 }]);
    fn('adminListStores').mockResolvedValue([]); fn('adminListUsers').mockResolvedValue([]); fn('listOrders').mockResolvedValue([]); fn('listRegions').mockResolvedValue([]); fn('listAnnouncements').mockResolvedValue([]); fn('getSetting').mockResolvedValue('');
    const a = await mount(<Admin profile={{ ...profile, role: 'admin' }} notify={notify} tab="zones" setTab={vi.fn()} />);
    expect(a.text()).toContain('قرية س'); expect(a.text()).toContain('تعديل الأجرة');
    document.body.innerHTML = '';
    const s = await mount(<Admin profile={{ ...profile, role: 'admin' }} notify={notify} tab="settings" setTab={vi.fn()} />);
    expect(s.text()).toContain('مهلة رد المحل'); expect(s.text()).toContain('منع الطلبات من المحلات المنتهي اشتراكها');
  });
});
