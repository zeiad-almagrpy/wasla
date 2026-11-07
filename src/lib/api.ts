import { sb } from './supabase';
import { cart } from './cart';
import { resizeImage, toIntlPhone } from './utils';
import type { Announcement, AppNotification, DeliveryMode, Order, PaymentMethod, Post, Product, Profile, Region, Store, StoreStatus, SupportRequest, Zone } from './types';

type Res<T> = { data: T | null; error: { message: string } | null };
const ok = <T,>(r: Res<T>): T => { if (r.error) throw new Error(r.error.message); return r.data as T; };
const rpc = async (fn: string, args: Record<string, unknown>) => { ok(await sb.rpc(fn, args)); };
const rpcText = async (fn: string, args: Record<string, unknown>) => String(ok(await sb.rpc(fn, args)));

// ---- auth
export async function signUp(name: string, phone: string, email: string, password: string, requestedRole: string, captchaToken?: string) {
  const r = await sb.auth.signUp({
    email, password,
    options: { emailRedirectTo: window.location.origin, captchaToken, data: { full_name: name, phone: toIntlPhone(phone), requested_role: requestedRole } },
  });
  if (r.error) throw new Error(r.error.message);
  return { confirmed: Boolean(r.data.session) };
}
export async function signIn(email: string, password: string, captchaToken?: string) {
  const r = await sb.auth.signInWithPassword({ email, password, options: { captchaToken } });
  if (r.error) throw new Error(r.error.message);
}
export async function resetPassword(email: string, captchaToken?: string) {
  const r = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin, captchaToken });
  if (r.error) throw new Error(r.error.message);
}
export async function updatePassword(password: string) {
  const r = await sb.auth.updateUser({ password });
  if (r.error) throw new Error(r.error.message);
}
export const signOut = () => { cart.clear(); return sb.auth.signOut(); };
export async function getProfile(id: string) {
  return ok(await sb.from('profiles').select('*').eq('id', id).maybeSingle()) as Profile | null;
}
export const listNotifications = async (userId: string) =>
  ok(await sb.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(40)) as AppNotification[];
export const markNotificationsRead = async (userId: string) => {
  ok(await sb.from('notifications').update({ is_read: true }).eq('user_id', userId).eq('is_read', false));
};
export const listSupportRequests = async (userId: string, admin = false) => {
  let q = sb.from('support_requests').select(admin ? '*, profiles(full_name,phone)' : '*').order('created_at', { ascending: false }).limit(100);
  if (!admin) q = q.eq('user_id', userId);
  return ok(await q) as unknown as SupportRequest[];
};
export const createSupportRequest = async (userId: string, subject: string, message: string) => {
  ok(await sb.from('support_requests').insert({ user_id: userId, subject, message }));
};
export const updateSupportStatus = async (id: string, status: string) => {
  ok(await sb.from('support_requests').update({ status }).eq('id', id));
};
export const adminReplySupport = (id: string, reply: string) => rpc('admin_reply_support', { p_id: id, p_reply: reply });

// ---- storage
export async function uploadImage(userId: string, file: File): Promise<string> {
  const blob = await resizeImage(file);
  const path = `${userId}/${crypto.randomUUID()}.jpg`;
  const r = await sb.storage.from('images').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (r.error) throw new Error(r.error.message);
  return path;
}
export const imgUrl = (path?: string | null) => (path ? (sb.storage.from('images').getPublicUrl(path).data.publicUrl as string) : '');

// ---- catalogue
export const listRegions = async () => ok(await sb.from('regions').select('*').order('city')) as Region[];
export const listZones = async () => ok(await sb.from('delivery_zones').select('*').order('sort_order').order('name')) as Zone[];
export const addZone = async (name: string, fee: number) => { ok(await sb.from('delivery_zones').insert({ name, fee })); };
export const updateZone = async (id: string, patch: Partial<Zone>) => { ok(await sb.from('delivery_zones').update(patch).eq('id', id)); };
export const deleteZone = async (id: string) => { ok(await sb.from('delivery_zones').delete().eq('id', id)); };
export const listActiveStores = async () => ok(await sb.from('stores').select('*').eq('status', 'active').order('name')) as Store[];
export const listAvailableProducts = async () =>
  ok(await sb.from('products').select('*').eq('is_available', true).order('created_at', { ascending: false })) as Product[];
export const getMyStore = async (ownerId: string) =>
  ok(await sb.from('stores').select('*').eq('owner_id', ownerId).maybeSingle()) as Store | null;
export const updateMyStore = async (id: string, patch: Partial<Store>) => { ok(await sb.from('stores').update(patch).eq('id', id)); };
export const listMyProducts = async (storeId: string) =>
  ok(await sb.from('products').select('*').eq('store_id', storeId).order('created_at', { ascending: false })) as Product[];
export const registerStore = (v: { name: string; category: string; description: string; address: string; regionId: string | null }) =>
  rpc('register_store', { p_name: v.name, p_category: v.category, p_description: v.description, p_address: v.address, p_region_id: v.regionId });
export const addProduct = async (p: Partial<Product>) => { ok(await sb.from('products').insert(p)); };
export const updateProduct = async (id: string, p: Partial<Product>) => { ok(await sb.from('products').update(p).eq('id', id)); };
export const deleteProduct = async (id: string) => { ok(await sb.from('products').delete().eq('id', id)); };

// ---- orders (every write is a server-side function)
const ORDER_SELECT = '*, order_items(*), stores(name,address,vodafone_cash_number), order_contacts(customer_name,customer_phone), order_courier_contacts(courier_name,courier_phone), order_addresses(address,lat,lng), order_pickup_codes(code), order_delivery_codes(code)';
export const listOrders = async (storeId?: string) => {
  let q = sb.from('orders').select(ORDER_SELECT);
  if (storeId) q = q.eq('store_id', storeId);
  return ok(await q.order('created_at', { ascending: false }).limit(150)) as unknown as Order[];
};
export type NewOrder = {
  storeId: string; items: { product_id: string; qty: number }[]; mode: DeliveryMode; address: string; area: string;
  zoneId: string | null; fee: number; payment: PaymentMethod; note: string; expectedSubtotal: number; key: string; lat?: number | null; lng?: number | null;
};
export const createOrder = async (o: NewOrder) =>
  ok(await sb.rpc('create_order', {
    p_store_id: o.storeId, p_items: o.items, p_mode: o.mode, p_address: o.mode === 'pickup' ? null : o.address,
    p_area: o.area || null, p_zone_id: o.zoneId, p_proposed_fee: o.fee, p_payment: o.payment,
    p_note: o.note || null, p_expected_subtotal: o.expectedSubtotal, p_key: o.key,
    p_lat: o.mode === 'pickup' ? null : (o.lat ?? null), p_lng: o.mode === 'pickup' ? null : (o.lng ?? null),
  }));
export const merchantSetStatus = (id: string, status: string, prep?: number) => rpc('merchant_set_order_status', { p_order_id: id, p_status: status, p_prep: prep ?? null });
export const customerCancel = (id: string) => rpc('customer_cancel_order', { p_order_id: id });
export const courierOffer = (id: string, fee: number, reply: string) => rpc('courier_offer_fee', { p_order_id: id, p_fee: fee, p_reply: reply });
export const courierClaim = (id: string) => rpc('courier_claim_order', { p_order_id: id });
export const courierDecline = (id: string) => rpc('courier_decline_order', { p_order_id: id });
export const customerRespondFee = (id: string, accept: boolean) => rpc('customer_respond_fee', { p_order_id: id, p_accept: accept });
export const courierPickup = (id: string, code: string) => rpcText('courier_pickup_order', { p_order_id: id, p_code: code });
export const courierDeliver = (id: string, code: string) => rpcText('courier_deliver_order', { p_order_id: id, p_code: code });
export const courierUpdateLocation = (id: string, lat: number, lng: number) =>
  rpc('courier_update_location', { p_order_id: id, p_lat: lat, p_lng: lng });
export const customerSubmitPayment = (id: string, ref: string) => rpc('customer_submit_payment', { p_order_id: id, p_ref: ref });
export const merchantReviewPayment = (id: string, okPay: boolean) => rpc('merchant_review_payment', { p_order_id: id, p_ok: okPay });
export const adminOrderAction = (id: string, action: 'cancel' | 'release_courier' | 'force_deliver', note: string) =>
  rpc('admin_order_action', { p_order_id: id, p_action: action, p_note: note });

// ---- requests board / news
export const listPosts = async () =>
  ok(await sb.from('request_posts').select('*, request_comments(*)').order('created_at', { ascending: false }).limit(60)) as Post[];
export const createPost = async (title: string, description: string, imagePath: string | null) => {
  ok(await sb.from('request_posts').insert({ title, description: description || null, image_path: imagePath }));
};
export const addComment = async (postId: string, body: string) => { ok(await sb.from('request_comments').insert({ post_id: postId, body })); };
export const closePost = async (id: string) => { ok(await sb.from('request_posts').update({ status: 'closed' }).eq('id', id)); };
export const deletePost = async (id: string) => { ok(await sb.from('request_posts').delete().eq('id', id)); };
export const listAnnouncements = async () =>
  ok(await sb.from('announcements').select('*').order('created_at', { ascending: false }).limit(50)) as Announcement[];
export const saveAnnouncement = async (adminId: string, title: string, body: string, imagePath: string | null) => {
  ok(await sb.from('announcements').insert({ admin_id: adminId, title, body, image_path: imagePath, status: 'published' }));
};
export const setAnnouncementStatus = async (id: string, status: string) => { ok(await sb.from('announcements').update({ status }).eq('id', id)); };
export const deleteAnnouncement = async (id: string) => { ok(await sb.from('announcements').delete().eq('id', id)); };

// ---- settings / admin
export const getSetting = async (key: string) => {
  const r = ok(await sb.from('platform_settings').select('value').eq('key', key).maybeSingle()) as { value: string } | null;
  return r?.value || '';
};
export const setSetting = async (key: string, value: string) => { ok(await sb.from('platform_settings').upsert({ key, value })); };
export const adminListStores = async () =>
  ok(await sb.from('stores').select('*, profiles(full_name,phone)').order('created_at', { ascending: false })) as Store[];
export const adminListUsers = async () =>
  ok(await sb.from('profiles').select('*').order('created_at', { ascending: false }).limit(300)) as Profile[];
export const adminSetStoreStatus = (id: string, status: StoreStatus) => rpc('admin_set_store_status', { p_store_id: id, p_status: status });
export const adminSetSubscription = (id: string, status: 'trial' | 'active' | 'expired', price: number) =>
  rpc('admin_set_store_subscription', { p_store_id: id, p_status: status, p_monthly_price: price });
export const adminExtendSubscription = (id: string, months: number, price: number) =>
  rpc('admin_extend_subscription', { p_store_id: id, p_months: months, p_monthly_price: price });
export const adminSetRole = (id: string, role: string) => rpc('admin_set_role', { p_user: id, p_role: role });
export const adminSetBlocked = (id: string, blocked: boolean) => rpc('admin_set_blocked', { p_user: id, p_blocked: blocked });
export const addRegion = async (city: string, governorate: string) => { ok(await sb.from('regions').insert({ city, governorate })); };
export const deleteRegion = async (id: string) => { ok(await sb.from('regions').delete().eq('id', id)); };
