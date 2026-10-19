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
  accent: string;
  accentSoft: string;
  hero: string;
  topRight: string;
  title: string;
  titleAccent: string;
  intro: string;
  buttonLabel: string;
  buttonIcon: string;
  buttonUrl: string;
  note: string;
  note2: string;
  preheader: string;
}) {
  const safeName = escapeHtml(options.name);
  const safeButtonUrl = escapeHtml(options.buttonUrl);
  const safeTopRight = escapeHtml(options.topRight).replace(/\n/g, '<br>');
  const heroUrl = `${publicUrl}${options.hero}`;

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">
  <title>CowboyBepob</title>
</head>
<body style="margin:0;padding:0;background:#090d12;color:#f4eee5;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(options.preheader)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0;padding:0;background:#090d12;">
    <tr>
      <td align="center" style="padding:28px 12px 30px;">
        <table role="presentation" width="680" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:680px;margin:0 auto;background:#080b0e;border:1px solid ${options.accentSoft};box-shadow:0 0 0 1px rgba(255,255,255,.015) inset;">

          <tr>
            <td style="padding:0;background:#080b0e;">
              <div style="position:relative;background:#111;">
                <img src="${heroUrl}" width="680" alt="CowboyBepob" style="display:block;width:100%;height:390px;object-fit:cover;border:0;outline:none;text-decoration:none;">
                <div style="position:absolute;left:34px;right:34px;top:25px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td align="left" valign="top" dir="ltr" style="padding:0;">
                        <div style="font-family:Georgia,'Times New Roman',serif;font-size:38px;line-height:1;font-weight:700;letter-spacing:-1.5px;color:#f5eee3;white-space:nowrap;">
                          Cowboy<span style="color:${options.accent};">Bepob</span>
                        </div>
                        <div style="margin-top:12px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1;letter-spacing:6px;color:#d5cec5;white-space:nowrap;">
                          STREAM&nbsp;&nbsp;·&nbsp;&nbsp;WATCH&nbsp;&nbsp;·&nbsp;&nbsp;EXPLORE
                        </div>
                      </td>
                      <td align="right" valign="top" style="padding:4px 0 0 18px;min-width:155px;">
                        <div style="font-size:11px;line-height:1.55;letter-spacing:3px;color:#eee6dc;text-transform:uppercase;text-align:left;">
                          ${safeTopRight}
                        </div>
                      </td>
                    </tr>
                  </table>
                </div>
              </div>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:0 18px;background:transparent;">
              <div style="margin:-72px 0 0;position:relative;z-index:2;background:linear-gradient(180deg,#090d10 0%,#080b0e 100%);border:1px solid ${options.accentSoft};border-radius:25px;padding:38px 42px 30px;box-shadow:0 18px 42px rgba(0,0,0,.42);">
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:34px;line-height:1.35;font-weight:800;color:#f5efe7;margin:0 0 22px;text-align:center;">
                  ${escapeHtml(options.title)} <span style="color:${options.accent};">${escapeHtml(options.titleAccent)}</span>
                </div>

                <p style="margin:0 0 8px;font-family:Georgia,'Times New Roman',serif;font-size:20px;line-height:1.7;color:#eee5da;text-align:center;">
                  مرحبًا بك في <span style="font-weight:700;color:#f4eee5;">Cowboy<span style="color:${options.accent};">Bepob</span></span>
                </p>
                <p style="margin:0 auto 28px;max-width:560px;font-size:17px;line-height:2;color:#ddd5cb;text-align:center;">
                  ${options.intro}
                </p>

                <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 28px;">
                  <tr>
                    <td align="center" style="background:${options.accent};border-radius:9px;box-shadow:0 8px 24px ${options.accent}35;">
                      <a href="${safeButtonUrl}" style="display:inline-block;min-width:330px;padding:17px 24px;color:#fff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:1.2;font-weight:800;text-align:center;">
                        <span style="font-size:21px;vertical-align:-2px;">${options.buttonIcon}</span>
                        <span style="display:inline-block;width:10px;">&nbsp;</span>
                        ${escapeHtml(options.buttonLabel)}
                      </a>
                    </td>
                  </tr>
                </table>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid rgba(255,255,255,.09);">
                  <tr>
                    <td align="right" style="padding:17px 0 0;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td valign="top" style="width:30px;padding-top:2px;">
                            <div style="width:20px;height:20px;border:1px solid ${options.accent};border-radius:50%;color:${options.accent};font-size:12px;line-height:20px;text-align:center;font-weight:bold;">i</div>
                          </td>
                          <td align="right" style="font-size:13px;line-height:2;color:#bdb4aa;padding-right:8px;">
                            ${escapeHtml(options.note)}<br>
                            ${escapeHtml(options.note2)}
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:28px 42px 30px;background:#080b0e;border-top:1px solid rgba(255,255,255,.08);">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" valign="middle" dir="ltr">
                    <div style="font-family:Georgia,'Times New Roman',serif;font-size:25px;line-height:1;font-weight:700;color:#f1e9df;">
                      Cowboy<span style="color:${options.accent};">Bepob</span>
                    </div>
                    <div style="margin-top:12px;font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:1;letter-spacing:4px;color:#827a72;">
                      ${options.accent === '#e22b26' ? 'GOOD ANIME. BETTER COMPANY.' : 'SAME DREAMS. A DIFFERENT SKY.'}
                    </div>
                  </td>
                  <td align="right" valign="middle" dir="ltr" style="white-space:nowrap;">
                    <span style="display:inline-block;margin-left:22px;color:#8c8b8a;font-size:21px;">◉</span>
                    <span style="display:inline-block;margin-left:22px;color:#8c8b8a;font-size:21px;font-family:Arial,sans-serif;">𝕏</span>
                    <span style="display:inline-block;color:#8c8b8a;font-size:20px;">▶</span>
                  </td>
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
    accent: '#e22b26',
    accentSoft: '#5c1717',
    hero: '/bebop/banner-moon.webp',
    topRight: 'SEE YOU\nSPACE COWBOY ...',
    title: 'تأكيد',
    titleAccent: 'البريد الإلكتروني',
    intro: 'تم إنشاء حسابك بنجاح. من فضلك قم بتأكيد بريدك الإلكتروني لإكمال عملية التسجيل والبدء في استخدام المنصة.',
    buttonLabel: 'تأكيد البريد الإلكتروني',
    buttonIcon: '✉',
    buttonUrl: link,
    note: 'إذا لم تقم بإنشاء هذا الحساب، يمكنك تجاهل هذه الرسالة بأمان.',
    note2: 'رابط التأكيد صالح لفترة محدودة من الوقت.',
    preheader: 'أكمل إنشاء حسابك في CowboyBepob بتأكيد بريدك الإلكتروني.'
  }));
}

export async function sendPasswordResetEmail(to: string, name: string, token: string) {
  const link = `${publicUrl}/reset-password?token=${encodeURIComponent(token)}`;
  return send(to, 'إعادة تعيين كلمة المرور - CowboyBepob', emailLayout({
    name,
    accent: '#1674e8',
    accentSoft: '#123a69',
    hero: '/bebop/login-bg.webp',
    topRight: 'WHATEVER HAPPENS,\nHAPPENS ...',
    title: 'إعادة تعيين',
    titleAccent: 'كلمة المرور',
    intro: 'لقد تلقينا طلبًا لإعادة تعيين كلمة المرور الخاصة بحسابك. اضغط على الزر أدناه لإنشاء كلمة مرور جديدة.',
    buttonLabel: 'إعادة تعيين كلمة المرور',
    buttonIcon: '♙',
    buttonUrl: link,
    note: 'إذا لم تطلب تغيير كلمة المرور، يمكنك تجاهل هذه الرسالة بأمان.',
    note2: 'رابط إعادة التعيين صالح لفترة محدودة من الوقت.',
    preheader: 'تم طلب إعادة تعيين كلمة المرور لحسابك في CowboyBepob.'
  }));
}
