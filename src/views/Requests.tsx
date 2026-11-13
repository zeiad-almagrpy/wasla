import { useState } from 'react';
import { ImagePlus, Send } from 'lucide-react';
import * as api from '../lib/api';
import { useQuery } from '../lib/hooks';
import { errMsg, fmtDate } from '../lib/utils';
import { Empty, Status } from '../components/ui';
import type { Notify, Post, Role } from '../lib/types';

export function Requests({ role, userId, notify, canPost }: { role: Role; userId: string; notify: Notify; canPost: boolean }) {
  const q = useQuery(api.listPosts, [], 30000);
  const [draft, setDraft] = useState({ title: '', body: '' });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!draft.title.trim()) return;
    setBusy(true);
    try {
      const path = file ? await api.uploadImage(userId, file) : null;
      await api.createPost(draft.title.trim(), draft.body.trim(), path);
      setDraft({ title: '', body: '' }); setFile(null); notify('تم نشر طلبك'); await q.reload();
    } catch (x) { notify(errMsg(x), true); }
    finally { setBusy(false); }
  };

  return (
    <>
      {canPost && (
        <div className="panel">
          <h3>انشر طلبك كمنشور</h3>
          <p className="muted">اكتب ما تبحث عنه، ويمكن للمحلات والناس الرد عليه.</p>
          <form className="stack-form" onSubmit={submit}>
            <input value={draft.title} maxLength={120} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="عنوان الطلب: بدور على..." required />
            <textarea value={draft.body} maxLength={2000} onChange={(e) => setDraft({ ...draft, body: e.target.value })} placeholder="تفاصيل إضافية (اختياري)" />
            <label className="upload-button"><ImagePlus size={18} /> {file ? file.name : 'إضافة صورة اختيارية'}
              <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
            <button className="primary" disabled={busy}><Send size={16} /> {busy ? 'جارٍ النشر…' : 'نشر الطلب'}</button>
          </form>
        </div>
      )}
      {!q.data ? <Empty title="جارٍ التحميل…" /> : !q.data.length ? <Empty title="لا توجد منشورات بعد" text="كن أول من ينشر طلبًا أو ارجع لاحقًا." /> : (
        <div className="request-feed">{q.data.map((p) => <PostCard key={p.id} p={p} role={role} userId={userId} notify={notify} onChanged={q.reload} />)}</div>
      )}
    </>
  );
}

function PostCard({ p, role, userId, notify, onChanged }: { p: Post; role: Role; userId: string; notify: Notify; onChanged: () => Promise<void> }) {
  const [comment, setComment] = useState('');
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); await onChanged(); } catch (e) { notify(errMsg(e), true); } };
  const label = (r: string) => (r === 'merchant' ? 'محل' : r === 'admin' ? 'إدارة' : 'مستخدم');
  const comments = [...p.request_comments].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return (
    <article className="panel request-card">
      <div className="request-meta"><b>{p.author_name}</b><span>{fmtDate(p.created_at)}</span><Status label={p.status === 'open' ? 'مفتوح' : 'مغلق'} tone={p.status === 'open' ? 'orange' : 'green'} /></div>
      <h3>{p.title}</h3>
      {p.description && <p>{p.description}</p>}
      {p.image_path && <img className="request-image" src={api.imgUrl(p.image_path)} alt="صورة الطلب" loading="lazy" />}
      <div className="comment-list">{comments.map((c) => <div className="comment" key={c.id}><b>{c.author_name} <small>· {label(c.author_role)}</small></b><p>{c.body}</p><small>{fmtDate(c.created_at)}</small></div>)}</div>
      {p.status === 'open' && (
        <form className="comment-form" onSubmit={(e) => { e.preventDefault(); const t = comment.trim(); if (t) act(() => api.addComment(p.id, t)); setComment(''); }}>
          <input value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} placeholder={role === 'merchant' ? 'اكتب ردًا أو عرضًا من المحل' : 'اكتب تعليقًا أو اقتراحًا'} required />
          <button className="primary small">رد</button>
        </form>
      )}
      <div className="action-row">
        {p.customer_id === userId && p.status === 'open' && <button className="secondary small" onClick={() => act(() => api.closePost(p.id))}>إغلاق الطلب</button>}
        {role === 'admin' && <button className="secondary small" onClick={() => { if (confirm('حذف المنشور؟')) act(() => api.deletePost(p.id)); }}>حذف (إدارة)</button>}
      </div>
    </article>
  );
}

export function News() {
  const q = useQuery(api.listAnnouncements, [], 120000);
  const list = (q.data || []).filter((a) => a.status === 'published');
  if (!q.data) return <Empty title="جارٍ التحميل…" />;
  if (!list.length) return <Empty title="لا توجد إعلانات حاليًا" text="ستظهر أخبار وصلة هنا عندما تنشر الإدارة إعلانًا." />;
  return (
    <div className="announcement-grid">
      {list.map((a) => (
        <article className="panel" key={a.id}>
          <span className="eyebrow">أخبار وصلة</span><h3>{a.title}</h3>
          {a.image_path && <img className="request-image" src={api.imgUrl(a.image_path)} alt="" loading="lazy" />}
          <p>{a.body}</p><small className="muted">{fmtDate(a.created_at)}</small>
        </article>
      ))}
    </div>
  );
}
