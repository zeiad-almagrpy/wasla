import { useEffect } from 'react';
import * as api from '../lib/api';
import { useQuery } from '../lib/hooks';
import { OrdersPanel } from './Orders';
import type { ViewProps } from '../lib/types';

export default function Courier({ profile, notify, tab }: ViewProps) {
  const active = useQuery(api.listOrders, [], 15000);
  useEffect(() => {
    const task = active.data?.find((o) => o.courier_id === profile.id && o.status === 'with_courier');
    if (!task || !navigator.geolocation) return;
    const publish = () => navigator.geolocation.getCurrentPosition(
      ({ coords }) => { void api.courierUpdateLocation(task.id, coords.latitude, coords.longitude); },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 12000 },
    );
    publish();
    const timer = window.setInterval(publish, 15000);
    return () => window.clearInterval(timer);
  }, [active.data, profile.id]);
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
