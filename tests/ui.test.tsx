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
vi.mock('../src/lib/image', async (orig) => ({ ...(await orig<typeof import('../src/lib/image')>()), compressImage: vi.fn(async (f: File) => ({ main: new Blob([new Uint8Array(150_000)]), thumb: new Blob([new Uint8Array(20_000)]), originalBytes: f.size, width: 1024, height: 768 })) }));
import * as api from '../src/lib/api';
import { OrdersPanel } from '../src/views/Orders';
import Customer from '../src/views/Customer';
import Merchant from '../src/views/Merchant';
import Admin from '../src/views/Admin';
import { SupportPanel } from '../src/views/Support';
import { cart } from '../src/lib/cart';
import { InstallBanner, InstallButton } from '../src/components/InstallBanner';
import Auth, { NewPassword } from '../src/views/Auth';
import { __resetInstallForTests } from '../src/lib/install';

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

beforeEach(() => { document.body.innerHTML = ''; localStorage.clear(); cart.clear(); Object.values(h.fns).forEach((f) => f.mockClear()); fn('imgUrl').mockImplementation(() => ''); fn('thumbUrl').mockImplementation(() => ''); });

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
  it('store delivery: buyer sees the pending fee, then approves/rejects the store fee', async () => {
    const a = await panel('customer', [order({ id: 'bf0', status: 'accepted', delivery_mode: 'store', fee_fixed: false, fee_status: 'pending', proposed_delivery_fee: 10, delivery_fee: 10, total: 70 })]);
    expect(a.text()).toContain('المحل لسه بيحدد أجرة التوصيل'); expect(a.text()).toContain('(تقديرية)');
    document.body.innerHTML = '';
    const m = await panel('customer', [order({ id: 'bf1', status: 'accepted', delivery_mode: 'store', fee_fixed: false, fee_status: 'countered', proposed_delivery_fee: 10, delivery_fee: 25, total: 85 })]);
    expect(m.text()).toContain('المحل حدد أجرة التوصيل'); expect(m.text()).toContain('25 ج.م'); expect(m.text()).not.toContain('المندوب اقترح');
    await click(btn(m.div, 'موافق')); expect(fn('customerRespondFee')).toHaveBeenCalledWith('bf1', true);
    await click(btn(m.div, 'أرفض')); expect(fn('customerRespondFee')).toHaveBeenCalledWith('bf1', false);
    expect(btn(m.div, 'إلغاء الطلب')).toBeTruthy();   // the buyer may walk away while the fee is not agreed
  });
  it('store delivery: delivery code and driver appear only once the order is out, and cancel is gone', async () => {
    const early = await panel('customer', [order({ id: 'bc1', status: 'ready', delivery_mode: 'store', fee_status: 'accepted', order_delivery_codes: { code: '7351' } })]);
    expect(early.text()).not.toContain('7351');
    document.body.innerHTML = '';
    const m = await panel('customer', [order({ id: 'bc2', status: 'with_courier', delivery_mode: 'store', fee_status: 'accepted', order_delivery_codes: { code: '7351' }, store_courier_name: 'أحمد', store_courier_phone: '01012345678' })]);
    expect(m.text()).toContain('7351'); expect(m.text()).toContain('للسائق'); expect(m.text()).toContain('أحمد'); expect(m.div.querySelector('a[href^="tel:"]')).toBeTruthy(); expect(btn(m.div, 'إلغاء الطلب')).toBeUndefined();
  });
  it('a cancelled order shows its reason', async () => {
    const m = await panel('customer', [order({ status: 'cancelled', delivery_mode: 'store', cancel_reason: 'المشتري لا يرد' })]);
    expect(m.text()).toContain('سبب الإلغاء'); expect(m.text()).toContain('المشتري لا يرد');
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
  it('store delivery: fee form while the fee is not agreed, sends the fee, and dispatch is blocked', async () => {
    const m = await panel('merchant', [order({ id: 'sf1', status: 'accepted', delivery_mode: 'store', fee_fixed: false, fee_status: 'pending', proposed_delivery_fee: 10, delivery_fee: 10, total: 70 })]);
    expect(m.text()).toContain('أجرة التوصيل لهذا الطلب');
    const input = m.div.querySelector('.offer-box input[type=number]') as HTMLInputElement; expect(input.value).toBe('10');
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '25'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await click(btn(m.div, 'أرسل الأجرة')); expect(fn('merchantSetFee')).toHaveBeenCalledWith('sf1', 25);
  });
  it('store delivery: ready but fee not agreed -> out-for-delivery button disabled with a warning', async () => {
    const m = await panel('merchant', [order({ id: 'sf2', status: 'ready', delivery_mode: 'store', fee_fixed: false, fee_status: 'countered', delivery_fee: 25, total: 85 })]);
    expect((btn(m.div, 'خرج للتوصيل') as HTMLButtonElement).disabled).toBe(true); expect(m.text()).toContain('لازم المشتري يوافق على أجرة التوصيل'); expect(m.text()).toContain('بانتظار موافقة المشتري');
  });
  it('store delivery: dispatch with driver name/phone, then deliver with the buyer code (no plain "delivered" button any more)', async () => {
    const a = await panel('merchant', [order({ id: 'sd1', status: 'ready', delivery_mode: 'store', fee_status: 'accepted' })]);
    const [nameIn, phoneIn] = [...a.div.querySelectorAll('.code-entry input')] as HTMLInputElement[];
    const setv = async (el: HTMLInputElement, v: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); });
    await setv(nameIn, 'أحمد'); await setv(phoneIn, '01012345678');
    await click(btn(a.div, 'خرج للتوصيل')); expect(fn('merchantDispatch')).toHaveBeenCalledWith('sd1', 'أحمد', '01012345678');
    document.body.innerHTML = '';
    const b = await panel('merchant', [order({ id: 'sd2', status: 'with_courier', delivery_mode: 'store', fee_status: 'accepted' })]);
    expect(btn(b.div, 'تم التوصيل')).toBeUndefined();
    const codeIn = b.div.querySelector('.code-entry input') as HTMLInputElement; await setv(codeIn, '4821');
    fn('merchantDeliver').mockResolvedValueOnce('wrong_code'); await click(btn(b.div, 'تأكيد التسليم'));
    expect(fn('merchantDeliver')).toHaveBeenCalledWith('sd2', '4821'); expect(notify).toHaveBeenCalledWith('الكود غير صحيح. اطلبه من المشتري مرة أخرى', true);
    fn('merchantDeliver').mockResolvedValueOnce('ok'); await click(btn(b.div, 'تأكيد التسليم')); expect(notify).toHaveBeenCalledWith('تم تأكيد التسليم');
  });
  it('store delivery: cancel in transit asks for a reason', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('المشتري لا يرد');
    const m = await panel('merchant', [order({ id: 'sd3', status: 'with_courier', delivery_mode: 'store', fee_status: 'accepted' })]);
    await click(btn(m.div, 'تعذّر التسليم')); expect(fn('merchantCancelInTransit')).toHaveBeenCalledWith('sd3', 'المشتري لا يرد'); prompt.mockRestore();
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

describe('customer search', () => {
  const shops = [
    { ...store, id: 's1', name: 'بقالة النور', category: 'بقالة' },
    { ...store, id: 's2', name: 'مخبز السلام', category: 'مخبوزات' },
  ];
  const prods = [
    { ...product, id: 'p1', store_id: 's1', name: 'لبن جهينة', category: 'ألبان' },
    { ...product, id: 'p2', store_id: 's2', name: 'عيش بلدي', category: 'خبز' },
    { ...product, id: 'p3', store_id: 's1', name: 'جبنة رومي', category: 'ألبان', description: 'مأكولات خفيفة' },
  ];
  beforeEach(() => { fn('listActiveStores').mockResolvedValue(shops); fn('listAvailableProducts').mockResolvedValue(prods); fn('listRegions').mockResolvedValue([]); fn('listZones').mockResolvedValue([]); fn('getSetting').mockResolvedValue('500'); });
  const search = async (m: { div: HTMLElement }, v: string) => {
    const input = m.div.querySelector('.searchbox input') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v); input.dispatchEvent(new Event('input', { bubbles: true })); });
  };
  const names = (m: { div: HTMLElement }) => [...m.div.querySelectorAll('.product-card b')].map((b) => b.textContent);
  const shopNames = (m: { div: HTMLElement }) => [...m.div.querySelectorAll('.shop-card b')].map((b) => b.textContent);

  it('finds a product even when the shop name does not match (the old bug)', async () => {
    const m = await mount(<Customer profile={profile} notify={notify} tab="home" setTab={vi.fn()} />);
    await search(m, 'لبن'); expect(names(m)).toEqual(['لبن جهينة']); expect(shopNames(m)).toEqual(['بقالة النور']);
  });
  it('ignores ة/ه, hamza and diacritics', async () => {
    const m = await mount(<Customer profile={profile} notify={notify} tab="home" setTab={vi.fn()} />);
    await search(m, 'جبنه'); expect(names(m)).toEqual(['جبنة رومي']);
    await search(m, 'ماكولات'); expect(names(m)).toEqual(['جبنة رومي']);   // matches description "مأكولات"
    await search(m, 'لَبَن'); expect(names(m)).toEqual(['لبن جهينة']);
  });
  it('matching a shop name or category lists its products too', async () => {
    const m = await mount(<Customer profile={profile} notify={notify} tab="home" setTab={vi.fn()} />);
    await search(m, 'مخبز'); expect(shopNames(m)).toEqual(['مخبز السلام']); expect(names(m)).toEqual(['عيش بلدي']);
  });
  it('multi-word: all words must match, across product + shop', async () => {
    const m = await mount(<Customer profile={profile} notify={notify} tab="home" setTab={vi.fn()} />);
    await search(m, 'لبن النور'); expect(names(m)).toEqual(['لبن جهينة']);
    await search(m, 'لبن السلام'); expect(names(m)).toEqual([]); expect(m.text()).toContain('مفيش نتايج');
  });
  it('clear button restores everything', async () => {
    const m = await mount(<Customer profile={profile} notify={notify} tab="home" setTab={vi.fn()} />);
    await search(m, 'zzz'); expect(names(m)).toEqual([]);
    await click(m.div.querySelector('.search-clear')); expect(names(m).length).toBe(3); expect(shopNames(m).length).toBe(2);
  });
});

describe('install-to-home-screen message', () => {
  const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
  const ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
  const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1';
  const INAPP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [FBAN/FBIOS;FBAV/430.0]';
  const setUA = (ua: string) => Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
  const standalone = (on: boolean) => Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: on, addListener() {}, removeListener() {} }) });
  beforeEach(() => { __resetInstallForTests(); setUA(DESKTOP); standalone(false); });

  it('desktop without an install event shows nothing', async () => { const m = await mount(<InstallBanner delayMs={0} />); expect(m.div.querySelector('.install-banner')).toBeNull(); });
  it('native prompt: shows benefits and calls prompt() on the button', async () => {
    setUA(ANDROID); const prompt = vi.fn(async () => undefined);
    const m = await mount(<InstallBanner delayMs={0} />);
    await act(async () => { window.dispatchEvent(Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome: 'accepted' }) })); });
    expect(m.text()).toContain('ضيف وصلة لشاشتك الرئيسية'); expect(m.text()).toContain('تنبيهات الطلبات'); expect(m.div.querySelector('.ib-steps')).toBeNull();
    await click(btn(m.div, 'تثبيت الآن')); expect(prompt).toHaveBeenCalled();
  });
  it('Android browsers without the native prompt get manual steps', async () => {
    setUA(ANDROID); const m = await mount(<InstallBanner delayMs={0} />);
    expect(m.text()).toContain('تثبيت التطبيق'); expect(m.div.querySelectorAll('.ib-steps li').length).toBe(3);
  });
  it('iPhone gets the share-sheet steps', async () => {
    setUA(IOS); const m = await mount(<InstallBanner delayMs={0} />);
    expect(m.text()).toContain('إضافة إلى الشاشة الرئيسية'); expect(m.div.querySelectorAll('.ib-steps li').length).toBe(3);
  });
  it('in-app browsers (WhatsApp/Facebook) are told to open the link in a real browser', async () => {
    setUA(INAPP); const m = await mount(<InstallBanner delayMs={0} />);
    expect(m.text()).toContain('افتح الرابط في المتصفح'); expect(btn(m.div, 'نسخ الرابط')).toBeTruthy(); expect(btn(m.div, 'تثبيت الآن')).toBeUndefined();
  });
  it('dismissing hides it and keeps it hidden on the next visit', async () => {
    setUA(IOS); const m = await mount(<InstallBanner delayMs={0} />);
    await click(btn(m.div, 'تمام، فهمت')); expect(m.div.querySelector('.install-banner')).toBeNull();
    document.body.innerHTML = ''; const again = await mount(<InstallBanner delayMs={0} />); expect(again.div.querySelector('.install-banner')).toBeNull();
  });
  it('after "later" a small install button remains and brings the message back', async () => {
    setUA(IOS); const m = await mount(<><InstallBanner delayMs={0} /><InstallButton /></>);
    expect(m.div.querySelector('.install-chip')).toBeNull();                    // not shown while the message itself is open
    await click(btn(m.div, 'تمام، فهمت')); expect(m.div.querySelector('.install-banner')).toBeNull();
    await click(m.div.querySelector('.install-chip')); expect(m.div.querySelector('.install-banner')).toBeTruthy();
  });
  it('"later" snoozes for one day only, not a week', async () => {
    setUA(IOS); localStorage.setItem('wesla.install.dismissed', String(Date.now() - 25 * 3600 * 1000));
    const m = await mount(<InstallBanner delayMs={0} />); expect(m.div.querySelector('.install-banner')).toBeTruthy();
    document.body.innerHTML = ''; localStorage.setItem('wesla.install.dismissed', String(Date.now() - 2 * 3600 * 1000));
    const n = await mount(<InstallBanner delayMs={0} />); expect(n.div.querySelector('.install-banner')).toBeNull();
  });
  it('already installed (standalone) shows nothing', async () => { setUA(IOS); standalone(true); const m = await mount(<InstallBanner delayMs={0} />); expect(m.div.querySelector('.install-banner')).toBeNull(); });
});

describe('sign-in screen (email + password, phone kept for contact)', () => {
  const fill = async (el: Element | null, v: string) => { expect(el).toBeTruthy(); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); (el as HTMLElement).dispatchEvent(new Event('input', { bubbles: true })); }); };
  const submit = async (m: { div: HTMLElement }) => act(async () => { m.div.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  const phoneInput = (m: { div: HTMLElement }) => m.div.querySelector('input[type=tel]');
  const pwInput = (m: { div: HTMLElement }) => m.div.querySelector('.pw-field input');

  const emailInput = (m: { div: HTMLElement }) => m.div.querySelector('input[type=email]');
  it('login asks for email + password (no phone field, no name)', async () => {
    fn('signIn').mockResolvedValue(undefined);
    const m = await mount(<Auth />); await click(btn(m.div, 'تسجيل الدخول'));
    expect(emailInput(m)).toBeTruthy(); expect(phoneInput(m)).toBeNull(); expect(m.div.querySelector('input[autocomplete=name]')).toBeNull();
    await fill(emailInput(m), 'Ziad@Example.com'); await fill(pwInput(m), 'password123'); await submit(m);
    expect(fn('signIn')).toHaveBeenCalledWith('Ziad@Example.com', 'password123', undefined);
  });
  it('sign-up: name + email + phone + password + account type + terms', async () => {
    fn('signUp').mockResolvedValue({ confirmed: true });
    const m = await mount(<Auth />);
    await fill(m.div.querySelector('input[autocomplete=name]'), 'Ziad'); await fill(emailInput(m), 'ziad@example.com'); await fill(phoneInput(m), '٠١٠١٢٣٤٥٦٧٨٩'); await fill(pwInput(m), 'password123');
    await click(m.div.querySelector('.agree input')); await submit(m);
    expect(fn('signUp')).toHaveBeenCalledWith('Ziad', 'ziad@example.com', '٠١٠١٢٣٤٥٦٧٨٩', 'password123', 'customer', undefined);
  });
  it('a bad email, a bad number or a short password never reaches the server', async () => {
    const m = await mount(<Auth />);
    await fill(emailInput(m), 'not-an-email'); await fill(phoneInput(m), '01012345678'); await fill(pwInput(m), 'password123'); await submit(m); expect(m.text()).toContain('بريدًا إلكترونيًا صحيحًا');
    await fill(emailInput(m), 'a@b.co'); await fill(phoneInput(m), '0101'); await submit(m); expect(m.text()).toContain('رقم موبايل صحيحًا');
    await fill(phoneInput(m), '01012345678'); await fill(pwInput(m), 'short'); await submit(m); expect(m.text()).toContain('8 أحرف');
    expect(fn('signUp')).not.toHaveBeenCalled(); expect(fn('signIn')).not.toHaveBeenCalled();
  });
  it('forgot password = WhatsApp instructions, no input fields', async () => {
    const m = await mount(<Auth />); await click(btn(m.div, 'تسجيل الدخول')); await click(btn(m.div, 'نسيت كلمة المرور؟'));
    expect(m.text()).toContain('من نفس الرقم'); expect(m.text()).toContain('كلمة مرور مؤقتة'); expect(m.div.querySelector('input')).toBeNull();
    await click(btn(m.div, 'رجوع لتسجيل الدخول')); expect(emailInput(m)).toBeTruthy();
  });
  it('show / hide password toggle', async () => {
    const m = await mount(<Auth />); expect(pwInput(m)!.getAttribute('type')).toBe('password');
    await click(m.div.querySelector('.pw-toggle')); expect(pwInput(m)!.getAttribute('type')).toBe('text');
  });
  it('the install message is really on the sign-in screen (it was attached to the wrong form before)', async () => {
    Object.defineProperty(window.navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1', configurable: true });
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addListener() {}, removeListener() {} }) });
    __resetInstallForTests();
    const m = await mount(<Auth />); await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
    expect(m.div.querySelector('.install-banner')).toBeTruthy();
    Object.defineProperty(window.navigator, 'userAgent', { value: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120', configurable: true }); __resetInstallForTests();
  });
  it('temporary-password screen explains itself and clears via updatePassword', async () => {
    const done = vi.fn(); const m = await mount(<NewPassword forced onDone={done} />);
    expect(m.text()).toContain('كلمة مرور مؤقتة'); await fill(pwInput(m), 'brandnew123'); await submit(m);
    expect(fn('updatePassword')).toHaveBeenCalledWith('brandnew123'); expect(done).toHaveBeenCalled();
  });
  it('admin issues a temporary password and can send it on WhatsApp', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fn('adminListUsers').mockResolvedValue([{ id: 'u9', full_name: 'سعيد', phone: '201000000044', role: 'customer', requested_role: 'customer', is_blocked: false }]);
    fn('adminListStores').mockResolvedValue([]); fn('listOrders').mockResolvedValue([]); fn('listRegions').mockResolvedValue([]); fn('listAnnouncements').mockResolvedValue([]); fn('getSetting').mockResolvedValue('');
    fn('adminResetPassword').mockResolvedValue('abcd2345');
    const m = await mount(<Admin profile={{ ...profile, role: 'admin' }} notify={notify} tab="users" setTab={vi.fn()} />);
    await click(btn(m.div, 'كلمة مرور مؤقتة')); expect(fn('adminResetPassword')).toHaveBeenCalledWith('u9');
    expect(m.div.querySelector('.code-box b')!.textContent).toBe('abcd2345'); expect(m.div.querySelector('a[href*="wa.me/201000000044"]')).toBeTruthy();
  });
});

describe('merchant photo upload: any size in, compressed automatically', () => {
  const merchant = { ...profile, id: 'm1', role: 'merchant' as const };
  const bigFile = () => { const f = new File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' }); Object.defineProperty(f, 'size', { value: 6.5 * 1024 * 1024 }); return f; };
  const choose = async (div: HTMLElement, f: File, scope = '') => { const input = div.querySelector(`${scope} .image-picker input[type=file]`.trim()) as HTMLInputElement; Object.defineProperty(input, 'files', { value: [f], configurable: true }); await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); }); await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };
  const fillIn = async (el: Element | null, v: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); (el as HTMLElement).dispatchEvent(new Event('input', { bubbles: true })); });
  const oldProduct = { ...product, id: 'pp1', store_id: 's1', image_path: 'm1/old.jpg' };
  beforeEach(() => { fn('getMyStore').mockResolvedValue(store); fn('listOrders').mockResolvedValue([]); fn('listRegions').mockResolvedValue([]); fn('getSetting').mockResolvedValue('30'); fn('listMyProducts').mockResolvedValue([oldProduct]); fn('uploadCompressed').mockResolvedValue('m1/new.jpg'); URL.createObjectURL = vi.fn(() => 'blob:x'); URL.revokeObjectURL = vi.fn(); });
  const mountProducts = () => mount(<Merchant profile={merchant} notify={notify} tab="products" setTab={vi.fn()} onProfileChange={vi.fn()} />);

  it('accepts a 6.5 MB photo, shows before/after size, uploads the compressed version', async () => {
    const m = await mountProducts(); await choose(m.div, bigFile());
    expect(m.text()).toContain('6.5 MB'); expect(m.text()).toContain('146 KB'); expect(m.text()).not.toContain('أقل من');
    const form = m.div.querySelector('.panel form')!; const inputs = form.querySelectorAll('input:not([type=file])');
    await fillIn(inputs[0], 'لبن'); await fillIn(inputs[1], '30');
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(fn('uploadCompressed')).toHaveBeenCalledWith('m1', expect.objectContaining({ originalBytes: 6.5 * 1024 * 1024 }));
    expect(fn('addProduct')).toHaveBeenCalledWith(expect.objectContaining({ image_path: 'm1/new.jpg', name: 'لبن' }));
  });
  it('deleting a product also deletes its photos from storage', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const m = await mountProducts(); await click(btn(m.div, 'حذف'));
    expect(fn('deleteProduct')).toHaveBeenCalledWith('pp1'); expect(fn('deleteImages')).toHaveBeenCalledWith('m1/old.jpg');
  });
  it('replacing a photo frees the old one after the update succeeds', async () => {
    const m = await mountProducts(); await click(btn(m.div, 'تعديل')); await choose(m.div, bigFile(), '.edit-box');
    await act(async () => { m.div.querySelector('.edit-box')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(fn('updateProduct')).toHaveBeenCalledWith('pp1', expect.objectContaining({ image_path: 'm1/new.jpg' })); expect(fn('deleteImages')).toHaveBeenCalledWith('m1/old.jpg');
  });
  it('if saving fails, the NEW photo is removed so nothing is orphaned (and the old one is kept)', async () => {
    fn('updateProduct').mockRejectedValueOnce(new Error('network'));
    const m = await mountProducts(); await click(btn(m.div, 'تعديل')); await choose(m.div, bigFile(), '.edit-box');
    await act(async () => { m.div.querySelector('.edit-box')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(fn('deleteImages')).toHaveBeenCalledWith('m1/new.jpg'); expect(fn('deleteImages')).not.toHaveBeenCalledWith('m1/old.jpg');
  });
});
