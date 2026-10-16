const RESEND_API = 'https://api.resend.com/emails';

const apiKey = process.env.RESEND_API_KEY || '';
const fromEmail = process.env.MAIL_FROM_EMAIL || '';
const fromName = process.env.MAIL_FROM_NAME || 'CowboyBepob';
const publicUrl = (process.env.PUBLIC_APP_URL || process.env.CORS_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');

function escapeHtml(value: string) {
  return value.replace(/[&<>'\"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '\"': '&quot;' }[c] as string));
}

async function send(to: string, subject: string, html: string) {
  if (!apiKey || !fromEmail) throw new Error('RESEND_NOT_CONFIGURED');
  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `${fromName} <${fromEmail}>`, to: [to], subject, html })
  });
  if (!response.ok) {
    const body = await response.text();
    throw Object.assign(new Error(`Resend ${response.status}: ${body.slice(0, 300)}`), { status: response.status });
  }
  return await response.json() as { id?: string };
}

export async function sendVerificationEmail(to: string, name: string, token: string) {
  const link = `${publicUrl}/verify-email?token=${encodeURIComponent(token)}`;
  return send(to, 'تأكيد البريد الإلكتروني - CowboyBepob', `
    <div dir="rtl" style="font-family:Arial,sans-serif;max-width:620px;margin:auto;line-height:1.8">
      <h2>CowboyBepob</h2>
      <p>مرحبًا ${escapeHtml(name)}،</p>
      <p>تم إنشاء حسابك. اضغط الزر التالي لتأكيد بريدك الإلكتروني:</p>
      <p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px">تأكيد البريد</a></p>
      <p>إذا لم تكن أنت من أنشأ الحساب فتجاهل هذه الرسالة.</p>
      <p style="color:#666;font-size:13px">الرابط صالح لفترة محدودة.</p>
    </div>`);
}

export async function sendPasswordResetEmail(to: string, name: string, token: string) {
  const link = `${publicUrl}/reset-password?token=${encodeURIComponent(token)}`;
  return send(to, 'إعادة تعيين كلمة المرور - CowboyBepob', `
    <div dir="rtl" style="font-family:Arial,sans-serif;max-width:620px;margin:auto;line-height:1.8">
      <h2>CowboyBepob</h2>
      <p>مرحبًا ${escapeHtml(name)}،</p>
      <p>تم طلب إعادة تعيين كلمة المرور.</p>
      <p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px">إعادة تعيين كلمة المرور</a></p>
      <p>إذا لم تطلب ذلك فتجاهل الرسالة.</p>
    </div>`);
}
