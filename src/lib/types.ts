export type Role = 'customer' | 'merchant' | 'courier' | 'admin';
export type Notify = (text: string, bad?: boolean) => void;
export type ViewProps = { profile: Profile; notify: Notify; tab: string; setTab: (t: string) => void };

export type Profile = {
  id: string; full_name: string; phone: string | null; role: Role;
  requested_role: 'customer' | 'merchant' | 'courier'; is_blocked: boolean; must_change_password?: boolean; created_at?: string;
};
export type Region = { id: string; city: string; governorate: string; is_active: boolean };
export type Zone = { id: string; region_id: string | null; name: string; fee: number; is_active: boolean; sort_order: number };
export type StoreStatus = 'pending' | 'active' | 'paused' | 'rejected';
export type Store = {
  id: string; owner_id: string; name: string; description: string | null; category: string; address: string | null;
  region_id: string | null; status: StoreStatus; trial_started_at: string | null; subscription_status: 'trial' | 'active' | 'expired';
  monthly_price: number | null; created_at: string; paid_until: string | null;
  is_open: boolean; own_delivery: boolean; own_delivery_fee: number | null; accepts_cash: boolean; vodafone_cash_number: string | null;
  profiles?: { full_name: string; phone: string | null } | null;
};
export type Product = {
  id: string; store_id: string; name: string; description: string | null; category: string | null;
  price: number; is_available: boolean; image_path: string | null;
};
export type OrderStatus = 'new' | 'accepted' | 'preparing' | 'ready' | 'with_courier' | 'delivered' | 'cancelled';
export type DeliveryMode = 'pickup' | 'store' | 'courier';
export type PaymentMethod = 'cash' | 'vodafone_cash';
export type PaymentStatus = 'cod' | 'awaiting' | 'proof_submitted' | 'confirmed';
export type OrderItem = {
  id: string; product_name_snapshot: string; unit_price_snapshot: number; quantity: number; line_total: number;
  image_path_snapshot: string | null;
};
export type Order = {
  id: string; order_no: number; customer_id: string; store_id: string; address_snapshot: string; area_hint: string; status: OrderStatus; subtotal: number;
  proposed_delivery_fee: number; courier_proposed_fee: number | null; courier_reply: string | null;
  fee_status: 'pending' | 'countered' | 'accepted' | 'declined'; fee_fixed: boolean; courier_id: string | null; delivery_required: boolean;
  delivery_mode: DeliveryMode; payment_method: PaymentMethod; payment_status: PaymentStatus; payment_ref: string | null; note: string | null;
  prep_minutes: number | null; accepted_at: string | null;
  delivery_fee: number; total: number; created_at: string; order_items: OrderItem[];
  courier_lat?: number | null; courier_lng?: number | null;
  store_courier_name?: string | null; store_courier_phone?: string | null; cancel_reason?: string | null;
  stores: { name: string; address: string | null; vodafone_cash_number: string | null } | null;
  order_contacts: { customer_name: string; customer_phone: string } | null;
  order_courier_contacts?: { courier_name: string; courier_phone: string } | null;
  order_addresses?: { address: string; lat: number | null; lng: number | null } | null;
  order_pickup_codes?: { code: string } | null;
  order_delivery_codes?: { code: string } | null;
};
export type Comment = { id: string; user_id: string; author_name: string; author_role: string; body: string; created_at: string };
export type Post = {
  id: string; customer_id: string; author_name: string; title: string; description: string | null;
  image_path: string | null; status: 'open' | 'found' | 'closed'; created_at: string; request_comments: Comment[];
};
export type Announcement = { id: string; title: string; body: string; image_path: string | null; status: string; created_at: string };
export type AppNotification = { id: string; title: string; body: string; is_read: boolean; created_at: string; order_id: string | null };
export type SupportRequest = {
  id: string; user_id: string; subject: string; message: string; status: string; created_at: string;
  admin_reply: string | null; answered_at: string | null; profiles?: { full_name: string; phone: string | null } | null;
};
