import React, { useState } from 'react';
import { api } from '../lib/api';
import { usePortal } from './Portal';

/** Landline picker with inline add — every new config must be tied to one of the customer's landlines. */
export function LandlinePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { landlines, refresh } = usePortal();
  const [adding, setAdding] = useState(false); const [n, setN] = useState(''); const [err, setErr] = useState('');
  const add = async () => { setErr(''); try { const r = await api<any>('/api/v1/customer/landlines', { method: 'POST', body: JSON.stringify({ number: n, label: '' }) }); await refresh(); onChange(r.id); setAdding(false); setN(''); } catch (e: any) { setErr(e.message); } };
  return <div className="landline-pick">
    <label className="cx-field"><span>الرقم الأرضي المرتبط بالخدمة</span>
      <select value={value} onChange={e => e.target.value === '__add' ? setAdding(true) : onChange(e.target.value)}>
        <option value="">اختر رقمًا أرضيًا</option>{landlines.map(l => <option key={l.id} value={l.id}>{l.number}{l.label ? ` — ${l.label}` : ''}</option>)}<option value="__add">+ إضافة رقم جديد</option>
      </select></label>
    {adding && <div className="inline-add"><input dir="ltr" inputMode="tel" placeholder="0225551111" value={n} onChange={e => setN(e.target.value)} aria-label="رقم أرضي جديد" /><button type="button" className="cx-btn small gold" onClick={add}>إضافة</button><button type="button" className="cx-btn small outline" onClick={() => setAdding(false)}>إلغاء</button></div>}
    {err && <div className="cx-alert bad">{err}</div>}
  </div>;
}

export async function placeOrder(items: any[]) {
  const key = crypto.randomUUID();
  return api<any>('/api/v1/customer/orders', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ items }) });
}
