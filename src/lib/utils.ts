import type { DeliveryMode, Order, OrderStatus, PaymentMethod } from './types';

export const MAX_FEE = 500;
export const money = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
export const fmtDate = (v: string) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
};
export const fmtTime = (v: string) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleTimeString('ar-EG', { timeStyle: 'short' });
};
/** 01012345678 / ٠١٠١٢٣٤٥٦٧٨ / +20 101 234 5678 -> 201012345678 ('' if invalid) */
export const toIntlPhone = (raw: string) => {
  let d = raw.replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (/^01\d{9}$/.test(d)) d = '2' + d;
  else if (/^1\d{9}$/.test(d)) d = '20' + d;
  return /^\d{10,15}$/.test(d) ? d : '';
};
/** 201012345678 -> 01012345678 for display */
export const localPhone = (intl: string | null | undefined) => (intl && intl.startsWith('20') && intl.length === 12 ? '0' + intl.slice(2) : intl || '');
export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
export const telHref = (p: string) => `tel:+${toIntlPhone(p) || p}`;
export const waHref = (p: string, text = '') => `https://wa.me/${toIntlPhone(p) || p}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
export const locHref = (lat: number, lng: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
export const dirHref = (lat: number, lng: number) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
export const mapsHref = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

export const STATUS_AR: Record<OrderStatus, string> = {
  new: 'جديد', accepted: 'تم القبول', preparing: 'قيد التجهيز', ready: 'جاهز للاستلام',
  with_courier: 'في الطريق', delivered: 'تم التسليم', cancelled: 'ملغي',
};
export const statusTone = (s: OrderStatus) => (s === 'delivered' ? 'green' : s === 'cancelled' ? 'red' : 'orange');
export const MODE_AR: Record<DeliveryMode, string> = { pickup: 'استلام من المحل', store: 'توصيل من المحل', courier: 'مندوب وصلة' };
export const PAY_AR: Record<PaymentMethod, string> = { cash: 'كاش عند الاستلام', vodafone_cash: 'فودافون كاش' };
export const PAYSTATUS_AR = { cod: 'عند الاستلام', awaiting: 'بانتظار التحويل', proof_submitted: 'بانتظار تأكيد المحل', confirmed: 'تم الدفع' } as const;

/** What the buyer still pays in cash when the order arrives. */
export const dueOnDelivery = (o: Pick<Order, 'payment_method' | 'total' | 'delivery_fee' | 'delivery_required'>) =>
  o.payment_method === 'cash' ? o.total : o.delivery_required ? o.delivery_fee : 0;
export const amountToTransfer = (o: Pick<Order, 'subtotal'>) => money(o.subtotal);

const AR: Record<string, string> = {
  'not allowed': 'غير مسموح لك بهذه العملية',
  'store unavailable': 'المحل غير متاح حاليًا',
  'store closed': 'المحل مغلق حاليًا. جرّب لاحقًا',
  'invalid items': 'بيانات الطلب غير صحيحة',
  'too many open orders': 'عندك 3 طلبات شغالة. انتظر حتى يكتمل أحدها',
  'too many orders': 'عدد الطلبات كبير. حاول لاحقًا',
  'address required': 'اكتب عنوان التوصيل',
  'area required': 'اكتب اسم المنطقة أو القرية',
  'invalid zone': 'المنطقة المختارة غير متاحة',
  'invalid mode': 'طريقة الاستلام غير صحيحة',
  'delivery unavailable': 'هذا المحل لا يوفّر توصيلًا خاصًا',
  'payment unavailable': 'طريقة الدفع غير متاحة في هذا المحل',
  'payment pending': 'لازم يتأكد الدفع أولًا',
  'phone required': 'رقم هاتفك غير مسجل. تواصل مع الإدارة',
  'price changed': 'تغيّر سعر منتج في السلة. راجع الأسعار ثم أكّد من جديد',
  'invalid fee': 'أجرة التوصيل غير صحيحة',
  'invalid reference': 'اكتب رقم العملية أو آخر 4 أرقام من رقم المحوِّل (3 إلى 40 حرفًا)',
  'invalid location': 'الموقع المشارك غير صحيح. أعد تحديده أو احذفه',
  'invalid prep time': 'وقت التجهيز غير صحيح',
  'active delivery exists': 'عندك مهمة توصيل شغالة بالفعل',
  'product unavailable': 'منتج في السلة لم يعد متاحًا. حدّث الصفحة وراجع السلة',
  'invalid quantity': 'كمية غير صحيحة',
  'order not found': 'الطلب غير موجود',
  'invalid transition': 'لا يمكن تنفيذ هذا الإجراء على الطلب الآن',
  'order not available': 'الطلب لم يعد متاحًا',
  'store already registered': 'لديك محل مسجل بالفعل',
  'Invalid login credentials': 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
  'User already registered': 'هذا البريد مسجل بالفعل. سجّل الدخول',
  'Database error saving new user': 'رقم الهاتف مسجل بحساب آخر',
  'is invalid': 'البريد الإلكتروني غير مقبول. جرّب بريدًا آخر',
  'rate limit': 'محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة',
  'Password should be': 'كلمة المرور ضعيفة (8 أحرف على الأقل)',
  'captcha': 'فشل التحقق الأمني. أعد المحاولة',
  'Failed to fetch': 'تعذر الاتصال بالإنترنت',
  'duplicate key': 'هذه القيمة مسجلة من قبل',
  'row-level security': 'غير مسموح لك بهذه العملية',
  'stores_pay_chk': 'فعّل طريقة دفع واحدة على الأقل',
  'stores_vf_chk': 'رقم فودافون كاش غير صحيح',
};
export const errMsg = (e: unknown): string => {
  const m = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  const k = Object.keys(AR).find((x) => m.includes(x));
  return k ? AR[k] : m;
};

/** Shrinks a photo to <=1024px JPEG (typically 100-200 KB) before upload. */
export const resizeImage = (file: File, max = 1024): Promise<Blob> =>
  new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return reject(new Error('اختر صورة JPG أو PNG'));
    if (file.size > 10 * 1024 * 1024) return reject(new Error('حجم الصورة كبير جدًا'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      const g = c.getContext('2d');
      if (!g) return reject(new Error('تعذر معالجة الصورة'));
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('تعذر معالجة الصورة'))), 'image/jpeg', 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('تعذر قراءة الصورة')); };
    img.src = url;
  });
