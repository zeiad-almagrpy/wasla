import { useState } from 'react';
import * as api from '../lib/api';
import { useQuery } from '../lib/hooks';
import { errMsg, fmtDate, localPhone } from '../lib/utils';
import { ContactButtons, Skeleton, Status } from '../components/ui';
import type { Notify } from '../lib/types';

const STATUS_AR: Record<string, string> = { open: 'مفتوحة', answered: 'تم الرد', closed: 'مغلقة' };

export function SupportPanel({ userId, admin = false, notify }: { userId: string; admin?: boolean; notify: Notify }) {
  const q = useQuery(() => api.listSupportRequests(userId, admin), [userId, admin], 30000, admin ? ['support_requests'] : [`support_requests|user_id=eq.${userId}`]);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: { preventDefault(): void }) => {
    e.preventDefault(); setBusy(true);
    try { await api.createSupportRequest(userId, subject.trim(), message.trim()); setSubject(''); setMessage(''); notify('وصلت رسالتك للإدارة'); await q.reload(); }
    catch (x) { notify(errMsg(x), true); }
    finally { setBusy(false); }
  };
  const reply = async (id: string) => {
    const text = (replies[id] || '').trim();
    if (!text) return notify('اكتب الرد أولًا', true);
    try { await api.adminReplySupport(id, text); setReplies((r) => ({ ...r, [id]: '' })); notify('تم إرسال الرد للمستخدم'); await q.reload(); }
    catch (x) { notify(errMsg(x), true); }
  };
  const close = async (id: string) => { try { await api.updateSupportStatus(id, 'closed'); await q.reload(); } catch (x) { notify(errMsg(x), true); } };

  return (
    <div className="support-layout">
      {!admin && (
        <form className="panel stack-form" onSubmit={submit}>
          <h3>تواصل مع إدارة وصلة</h3>
          <p className="muted">اكتب مشكلتك أو اقتراحك، وهيوصلك الرد هنا وفي الإشعارات.</p>
          <input value={subject} maxLength={120} minLength={3} required placeholder="عنوان الرسالة" onChange={(e) => setSubject(e.target.value)} />
          <textarea value={message} maxLength={3000} minLength={5} required placeholder="اكتب رسالتك" onChange={(e) => setMessage(e.target.value)} />
          <button className="primary" disabled={busy}>{busy ? 'جارٍ الإرسال…' : 'إرسال للإدارة'}</button>
        </form>
      )}
      <section className="panel">
        <h3>{admin ? 'رسائل الدعم الواردة' : 'رسائلي السابقة'}</h3>
        {q.loading && !q.data ? <Skeleton rows={2} /> : (q.data || []).length ? (q.data || []).map((item) => (
          <article className="support-item" key={item.id}>
            <div className="support-head"><b>{item.subject}</b><Status label={STATUS_AR[item.status] || item.status} tone={item.status === 'open' ? 'orange' : item.status === 'answered' ? 'green' : 'blue'} /></div>
            {admin && item.profiles && <p className="muted support-from">من: <b>{item.profiles.full_name || '—'}</b> · {localPhone(item.profiles.phone)} {item.profiles.phone && <ContactButtons phone={item.profiles.phone} />}</p>}
            <p>{item.message}</p>
            <small>{fmtDate(item.created_at)}</small>
            {item.admin_reply && <div className="reply-box"><b>رد الإدارة</b><p>{item.admin_reply}</p></div>}
            {admin && item.status !== 'closed' && (
              <div className="reply-form">
                <textarea value={replies[item.id] || ''} maxLength={3000} placeholder="اكتب ردك للمستخدم" onChange={(e) => setReplies((r) => ({ ...r, [item.id]: e.target.value }))} />
                <div className="action-row"><button className="primary small" onClick={() => void reply(item.id)}>إرسال الرد</button><button className="secondary small" onClick={() => void close(item.id)}>إغلاق بدون رد</button></div>
              </div>
            )}
          </article>
        )) : <p className="muted">لا توجد رسائل بعد.</p>}
      </section>
    </div>
  );
}
