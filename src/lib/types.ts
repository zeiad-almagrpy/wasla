export type Role = 'customer' | 'merchant' | 'courier' | 'admin';
export type Notify = (text: string, bad?: boolean) => void;
export type ViewProps = { profile: Profile; notify: Notify; tab: string; setTab: (t: string) => void };

export type Profile = {
  id: string; full_name: string; phone: string | null; role: Role;
  requested_role: 'customer' | 'merchant' | 'courier'; is_blocked: boolean; created_at?: string;
};
export type Region = { id: string; city: string; governorate: string; is_active: boolean };
export type StoreStatus = 'pending' | 'active' | 'paused' | 'rejected';
export type Store = {
  id: string; owner_id: string; name: string; description: string | null; category: string; address: string | null;
  region_id: string | null; status: StoreStatus; trial_started_at: string | null; created_at: string;
  profiles?: { full_name: string; phone: string | null } | null;
};
export type Product = {
  id: string; store_id: string; name: string; description: string | null; category: string | null;
  price: number; is_available: boolean; image_path: string | null;
};
export type OrderStatus = 'new' | 'accepted' | 'preparing' | 'ready' | 'with_courier' | 'delivered' | 'cancelled';
export type OrderItem = {
  id: string; product_name_snapshot: string; unit_price_snapshot: number; quantity: number; line_total: number;
  image_path_snapshot: string | null;
};
export type Order = {
  id: string; customer_id: string; store_id: string; address_snapshot: string; status: OrderStatus; subtotal: number;
  proposed_delivery_fee: number; courier_proposed_fee: number | null; courier_reply: string | null;
  fee_status: 'pending' | 'countered' | 'accepted' | 'declined'; courier_id: string | null; delivery_required: boolean;
  delivery_fee: number; total: number; created_at: string; order_items: OrderItem[];
  courier_lat?: number | null; courier_lng?: number | null;
  stores: { name: string; address: string | null } | null;
  order_contacts: { customer_name: string; customer_phone: string } | null;
};
export type Comment = { id: string; user_id: string; author_name: string; author_role: string; body: string; created_at: string };
export type Post = {
  id: string; customer_id: string; author_name: string; title: string; description: string | null;
  image_path: string | null; status: 'open' | 'found' | 'closed'; created_at: string; request_comments: Comment[];
};
export type Announcement = { id: string; title: string; body: string; image_path: string | null; status: string; created_at: string };
