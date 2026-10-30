import { OrdersPanel } from './Orders';
import type { ViewProps } from '../lib/types';

export default function Courier({ profile, notify, tab }: ViewProps) {
  if (tab === 'history') {
    return <OrdersPanel role="courier" userId={profile.id} notify={notify} filter={(o) => o.courier_id === profile.id && ['delivered', 'cancelled'].includes(o.status)} />;
  }
  return (
    <>
      <div className="notice-box">تظهر المهمة بعد قبول المحل للطلب. راجع العنوان والأجرة، ويمكنك قبولها أو اقتراح أجرة مختلفة. تأكيد الاستلام متاح بعد موافقة المشتري وجاهزية الطلب. القائمة تتحدّث تلقائيًا.</div>
      <OrdersPanel role="courier" userId={profile.id} notify={notify} filter={(o) => !['delivered', 'cancelled'].includes(o.status)} />
    </>
  );
}
