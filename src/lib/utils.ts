import type { OrderStatus } from './types';

export const MAX_FEE = 500;
export const money = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
export const fmtDate = (v: string) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
};
/** 01012345678 / ٠١٠١٢٣٤٥٦٧٨ / +20 101 234 5678 -> 201012345678 ('' if invalid) */
export const toIntlPhone = (raw: string) => {
  let d = raw.replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (/^01\d{9}$/.test(d)) d = '2' + d;
  else if (/^1\d{9}$/.test(d)) d = '20' + d;
  return /^\d{10,15}$/.test(d) ? d : '';
};
export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export const STATUS_AR: Record<OrderStatus, string> = {
  new: 'جديد', accepted: 'مقبول', preparing: 'قيد التجهيز', ready: 'جاهز للاستلام',
  with_courier: 'مع المندوب', delivered: 'تم التسليم', cancelled: 'ملغي',
};
export const statusTone = (s: OrderStatus) => (s === 'delivered' ? 'green' : s === 'cancelled' ? 'red' : 'orange');

const AR: Record<string, string> = {
  'not allowed': 'غير مسموح لك بهذه العملية',
  'store unavailable': 'المحل غير متاح حاليًا',
  'invalid items': 'بيانات الطلب غير صحيحة',
  'too many orders': 'عدد الطلبات كبير. حاول لاحقًا',
  'address required': 'اكتب عنوان التوصيل',
  'invalid fee': 'أجرة التوصيل غير صحيحة',
  'product unavailable': 'منتج في السلة لم يعد متاحًا. حدّث الصفحة وراجع السلة',
  'invalid quantity': 'كمية غير صحيحة',
  'order not found': 'الطلب غير موجود',
  'invalid transition': 'لا يمكن تغيير حالة الطلب بهذه الطريقة الآن',
  'order not available': 'الطلب لم يعد متاحًا',
  'store already registered': 'لديك محل مسجل بالفعل',
  'Invalid login credentials': 'رقم الهاتف أو كلمة المرور غير صحيحة',
  'User already registered': 'هذا الرقم مسجل بالفعل. سجّل الدخول',
  'Database error saving new user': 'رقم الهاتف مسجل بحساب آخر',
  'is invalid': 'البريد الإلكتروني غير مقبول. جرّب بريدًا آخر',
  'rate limit': 'محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة',
  'Password should be': 'كلمة المرور ضعيفة (8 أحرف على الأقل)',
  'Failed to fetch': 'تعذر الاتصال بالإنترنت',
  'duplicate key': 'هذه القيمة مسجلة من قبل',
  'row-level security': 'غير مسموح لك بهذه العملية',
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
