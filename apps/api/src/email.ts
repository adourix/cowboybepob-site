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

function emailLayout(options: {
  name: string;
  eyebrow: string;
  title: string;
  accent: string;
  intro: string;
  buttonLabel: string;
  buttonUrl: string;
  note: string;
  preheader: string;
}) {
  const safeName = escapeHtml(options.name);
  const safeButtonUrl = escapeHtml(options.buttonUrl);

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>CowboyBepob</title>
</head>
<body style="margin:0;padding:0;background:#090909;color:#f5f1e8;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(options.preheader)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#090909;margin:0;padding:0;">
    <tr>
      <td align="center" style="padding:28px 14px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#111111;border:1px solid #292929;">
          <tr>
            <td style="height:5px;background:${options.accent};font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <tr>
            <td style="padding:26px 30px 22px;background:#151515;border-bottom:1px solid #292929;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="right" style="font-family:Arial,Helvetica,sans-serif;">
                    <div style="font-size:22px;line-height:1;font-weight:900;letter-spacing:2px;color:#f5f1e8;text-transform:uppercase;">COWBOY<span style="color:${options.accent};">BEPOB</span></div>
                    <div style="margin-top:7px;font-size:10px;line-height:1;letter-spacing:3px;color:#777;text-transform:uppercase;">SPACE NETWORK // TRANSMISSION</div>
                  </td>
                  <td align="left" valign="middle" style="width:44px;">
                    <div style="width:34px;height:34px;border:1px solid ${options.accent};border-radius:50%;text-align:center;line-height:34px;color:${options.accent};font-size:16px;font-weight:bold;">✦</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:42px 34px 36px;background:#111111;">
              <div style="font-size:10px;line-height:1.4;letter-spacing:3px;color:${options.accent};font-weight:bold;text-transform:uppercase;">${escapeHtml(options.eyebrow)}</div>
              <h1 style="margin:12px 0 18px;font-size:30px;line-height:1.25;color:#ffffff;font-weight:800;">${escapeHtml(options.title)}</h1>
              <div style="height:2px;width:64px;background:${options.accent};margin:0 0 24px;"></div>

              <p style="margin:0 0 12px;font-size:16px;line-height:1.9;color:#f1eee7;">مرحبًا ${safeName}،</p>
              <p style="margin:0 0 28px;font-size:15px;line-height:1.9;color:#aaa;">${options.intro}</p>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;">
                <tr>
                  <td align="center" style="border-radius:2px;background:${options.accent};">
                    <a href="${safeButtonUrl}" style="display:inline-block;padding:15px 26px;color:#0a0a0a;text-decoration:none;font-size:14px;line-height:1;font-weight:800;letter-spacing:.2px;">${escapeHtml(options.buttonLabel)}</a>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#181818;border-right:3px solid ${options.accent};">
                <tr>
                  <td style="padding:14px 16px;">
                    <p style="margin:0;font-size:12px;line-height:1.8;color:#8f8f8f;">${escapeHtml(options.note)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 30px 24px;background:#0d0d0d;border-top:1px solid #292929;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="right" style="font-size:11px;line-height:1.8;color:#666;">
                    CowboyBepob<br>
                    <span style="color:#444;">SEE YOU, SPACE COWBOY.</span>
                  </td>
                  <td align="left" valign="bottom" style="font-size:10px;line-height:1.8;color:#444;letter-spacing:1px;">TRANSMISSION  //  CB-01</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendVerificationEmail(to: string, name: string, token: string) {
  const link = `${publicUrl}/verify-email?token=${encodeURIComponent(token)}`;
  return send(to, 'تأكيد البريد الإلكتروني - CowboyBepob', emailLayout({
    name,
    eyebrow: 'Identity verification',
    title: 'تأكيد البريد الإلكتروني',
    accent: '#f04a32',
    intro: 'تم إنشاء حسابك بنجاح. استخدم الزر التالي لتأكيد بريدك الإلكتروني وتفعيل حسابك.',
    buttonLabel: 'تأكيد البريد الإلكتروني',
    buttonUrl: link,
    note: 'إذا لم تكن أنت من أنشأ الحساب، يمكنك تجاهل هذه الرسالة. الرابط صالح لفترة محدودة.',
    preheader: 'أكمل إنشاء حسابك في CowboyBepob بتأكيد بريدك الإلكتروني.'
  }));
}

export async function sendPasswordResetEmail(to: string, name: string, token: string) {
  const link = `${publicUrl}/reset-password?token=${encodeURIComponent(token)}`;
  return send(to, 'إعادة تعيين كلمة المرور - CowboyBepob', emailLayout({
    name,
    eyebrow: 'Security transmission',
    title: 'إعادة تعيين كلمة المرور',
    accent: '#2d8cff',
    intro: 'تم استلام طلب لإعادة تعيين كلمة المرور الخاصة بحسابك. إذا كان الطلب منك، استخدم الزر التالي للمتابعة.',
    buttonLabel: 'إعادة تعيين كلمة المرور',
    buttonUrl: link,
    note: 'إذا لم تطلب إعادة تعيين كلمة المرور، فتجاهل هذه الرسالة. لا تشارك رابط إعادة التعيين مع أي شخص.',
    preheader: 'تم طلب إعادة تعيين كلمة المرور لحسابك في CowboyBepob.'
  }));
}
