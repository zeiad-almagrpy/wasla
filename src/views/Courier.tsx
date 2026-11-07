import { useEffect, useRef, useState } from 'react';
import { Volume2 } from 'lucide-react';
import * as api from '../lib/api';
import { alarmEnabled, audioReady, beep, setAlarmEnabled, unlockAudio } from '../lib/alert';
import { useQuery } from '../lib/hooks';
import { Switch } from '../components/ui';
import { OrdersPanel } from './Orders';
import type { Order, ViewProps } from '../lib/types';

export default function Courier({ profile, notify, tab }: ViewProps) {
  const active = useQuery(() => api.listOrders(), [], 60000, ['orders']);
  const [sound, setSound] = useState(alarmEnabled());
  const taskId = active.data?.find((o: Order) => o.courier_id === profile.id && o.status === 'with_courier')?.id;
  const available = (active.data || []).filter((o) => !o.courier_id && o.delivery_mode === 'courier' && ['accepted', 'preparing', 'ready'].includes(o.status)).length;
  const prev = useRef<number | null>(null);

  // share live position only while carrying an order (keyed on the order id, so polling never restarts it)
  useEffect(() => {
    if (!taskId || !navigator.geolocation) return;
    const publish = () => navigator.geolocation.getCurrentPosition(
      ({ coords }) => { void api.courierUpdateLocation(taskId, coords.latitude, coords.longitude).catch(() => undefined); },
      () => undefined, { enableHighAccuracy: true, maximumAge: 10000, timeout: 12000 });
    publish();
    const timer = window.setInterval(publish, 15000);
    return () => window.clearInterval(timer);
  }, [taskId]);

  // beep when a new task shows up
  useEffect(() => {
    if (prev.current !== null && available > prev.current && sound && audioReady()) beep();
    prev.current = available;
  }, [available, sound]);

  if (tab === 'history') {
    return <OrdersPanel role="courier" userId={profile.id} notify={notify} filter={(o) => o.courier_id === profile.id && ['delivered', 'cancelled'].includes(o.status)} />;
  }
  return (
    <>
      <div className="panel device-alert">
        <div><b><Volume2 size={16} /> تنبيه صوتي للمهام الجديدة</b><p className="muted">بيرن لما مهمة جديدة تظهر وانت فاتح التطبيق. وبتوصلك كمان إشعارات الجهاز لو فعّلتها من الجرس.</p></div>
        <Switch checked={sound} label="تنبيه صوتي" onChange={(v) => { if (v) unlockAudio(); setAlarmEnabled(v); setSound(v); if (v) beep([660, 880]); notify(v ? 'تم تفعيل التنبيه الصوتي' : 'تم إيقاف التنبيه الصوتي'); }} />
      </div>
      <div className="notice-box">بتظهر المهمة بعد ما المحل يقبل الطلب. لو الأجرة ثابتة اقبلها مباشرة، ولو لأ تقدر تقبل الأجرة أو تقترح غيرها. بعد القبول بيظهر العنوان ورقم المشتري. استلم الطلب بكود من المحل، وسلّمه بكود من المشتري.</div>
      <OrdersPanel role="courier" userId={profile.id} notify={notify} filter={(o) => !['delivered', 'cancelled'].includes(o.status)} />
    </>
  );
}
