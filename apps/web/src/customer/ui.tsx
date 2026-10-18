import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { X } from 'lucide-react';

/* Cut-corner HUD panel from the mockups: thin cyan edge, gold when highlighted. */
export function Hud({ children, className = '', tone = 'cyan', as: Tag = 'section', ...rest }: { children: React.ReactNode; className?: string; tone?: 'cyan' | 'gold' | 'red' | 'violet' | 'green'; as?: any } & React.HTMLAttributes<HTMLElement>) {
  return <Tag className={`hud hud-${tone} ${className}`} {...rest}><div className="hud-in">{children}</div></Tag>;
}
export function HudHead({ title, en, action }: { title: string; en?: string; action?: React.ReactNode }) {
  return <div className="hud-head"><h2>{title}</h2>{en && <span className="en">{en}</span>}{action}</div>;
}

type BannerArt = 'cockpit' | 'bridge' | 'moon';
const ART: Record<BannerArt, string> = { cockpit: '/bebop/banner-cockpit.webp', bridge: '/bebop/banner-bridge.webp', moon: '/bebop/banner-moon.webp' };
export function Banner({ art, eyebrow, title, sub, side, children }: { art: BannerArt; eyebrow?: string; title: React.ReactNode; sub?: string; side?: React.ReactNode; children?: React.ReactNode }) {
  return <header className={`banner banner-${art}`}>
    <img className="banner-art" src={ART[art]} alt="" />
    <span className="banner-hazard" aria-hidden />
    <div className="banner-text">
      {eyebrow && <span className="en eyebrow">{eyebrow}</span>}
      <h1>{title}</h1>
      {sub && <p>{sub}</p>}
    </div>
    {side && <div className="banner-side en" aria-hidden>{side}</div>}
    {children}
  </header>;
}

export function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'idle' | 'info'; children: React.ReactNode }) {
  return <span className={`pill pill-${tone}`}><i aria-hidden />{children}</span>;
}

export function Empty({ title, text, action }: { title: string; text?: string; action?: React.ReactNode }) {
  return <div className="cx-empty"><img src="/bebop/vial.webp" alt="" /><b>{title}</b>{text && <p>{text}</p>}{action}</div>;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  return <div className="cx-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <div className={`cx-modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="cx-modal-head"><h2>{title}</h2><button className="cx-icon" onClick={onClose} aria-label="إغلاق"><X size={18} /></button></div>
      {children}
    </div>
  </div>;
}

/* QR is drawn locally from a link the customer already revealed; nothing leaves the browser. */
export function QrImage({ text }: { text: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => { void QRCode.toDataURL(text, { margin: 1, width: 280, color: { dark: '#04070d', light: '#ffffff' } }).then(setSrc).catch(() => setSrc('')); }, [text]);
  return src ? <img className="qr" src={src} width={280} height={280} alt="رمز QR للرابط" /> : <div className="qr qr-loading" />;
}

export function Ring({ value, max, children }: { value: number; max: number; children: React.ReactNode }) {
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0, r = 62, c = 2 * Math.PI * r;
  return <div className="ring-meter">
    <svg viewBox="0 0 150 150" aria-hidden><circle cx="75" cy="75" r={r} className="track" /><circle cx="75" cy="75" r={r} className="bar" strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 75 75)" /></svg>
    <div className="ring-text">{children}</div>
  </div>;
}

export function Bar({ pct }: { pct: number | null }) {
  return <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}><span style={{ width: `${pct ?? 0}%` }} /></div>;
}

export function useToast() {
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null);
  useEffect(() => { if (!msg) return; const t = window.setTimeout(() => setMsg(null), 3200); return () => window.clearTimeout(t); }, [msg]);
  const node = msg ? <div className={`cx-toast ${msg.tone}`} role="status">{msg.text}</div> : null;
  return { node, ok: (text: string) => setMsg({ text, tone: 'ok' }), bad: (text: string) => setMsg({ text, tone: 'bad' }) };
}

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return ok; }
}
