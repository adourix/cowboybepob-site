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
  border: string;
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
  footerTagline: string;
  preheader: string;
}) {
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

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#090d12;border-collapse:collapse;">
    <tr>
      <td align="center" style="padding:34px 12px 32px;">
        <table role="presentation" width="680" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:680px;background:#080b0e;border:1px solid ${options.border};border-collapse:separate;border-spacing:0;">

          <!-- HERO -->
          <tr>
            <td width="680" height="390" valign="top" background="${heroUrl}" style="width:680px;height:390px;background-color:#17100f;background-image:url('${heroUrl}');background-repeat:no-repeat;background-position:center top;background-size:680px 390px;">
              <!--[if gte mso 9]>
              <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:680px;height:390px;">
                <v:fill type="frame" src="${heroUrl}" color="#17100f" />
                <v:textbox inset="0,0,0,0">
              <![endif]-->
              <table role="presentation" width="100%" height="390" cellpadding="0" cellspacing="0" border="0" style="width:100%;height:390px;border-collapse:collapse;">
                <tr>
                  <td valign="top" style="padding:27px 34px 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
                      <tr>
                        <td align="left" valign="top" dir="ltr" style="padding:0;">
                          <div style="font-family:Georgia,'Times New Roman',serif;font-size:38px;line-height:40px;font-weight:700;letter-spacing:-1.8px;color:#f5eee3;white-space:nowrap;">
                            Cowboy<span style="color:${options.accent};">Bepob</span>
                          </div>
                          <div style="margin-top:11px;font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:12px;letter-spacing:5px;color:#ded7ce;white-space:nowrap;">
                            STREAM&nbsp;&nbsp;·&nbsp;&nbsp;WATCH&nbsp;&nbsp;·&nbsp;&nbsp;EXPLORE
                          </div>
                        </td>
                        <td align="right" valign="top" style="padding:5px 0 0 18px;width:170px;">
                          <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:17px;letter-spacing:3px;color:#f2eae1;text-transform:uppercase;text-align:left;">
                            ${safeTopRight}
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <!--[if gte mso 9]>
                </v:textbox>
              </v:rect>
              <![endif]-->
            </td>
          </tr>

          <!-- CONTENT CARD -->
          <tr>
            <td align="center" style="padding:0 18px;background:transparent;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-top:-2px;background:#090d10;border:1px solid ${options.border};border-radius:25px;border-collapse:separate;border-spacing:0;">
                <tr>
                  <td align="center" style="padding:38px 40px 30px;">
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:34px;line-height:45px;font-weight:800;color:#f5efe7;text-align:center;">
                      ${escapeHtml(options.title)} <span style="color:${options.accent};">${escapeHtml(options.titleAccent)}</span>
                    </div>

                    <p style="margin:20px 0 7px;font-family:Georgia,'Times New Roman',serif;font-size:20px;line-height:31px;color:#eee5da;text-align:center;">
                      مرحبًا بك في <span style="font-weight:700;color:#f4eee5;">Cowboy<span style="color:${options.accent};">Bepob</span></span>
                    </p>
                    <p style="margin:0 auto 27px;max-width:560px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:30px;color:#ddd5cb;text-align:center;">
                      ${options.intro}
                    </p>

                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 28px;border-collapse:separate;">
                      <tr>
                        <td align="center" bgcolor="${options.accent}" style="background:${options.accent};border-radius:9px;">
                          <a href="${safeButtonUrl}" style="display:inline-block;width:330px;padding:17px 18px;color:#fff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:22px;font-weight:800;text-align:center;">
                            <span style="font-size:21px;vertical-align:-2px;">${options.buttonIcon}</span>
                            <span style="display:inline-block;width:9px;">&nbsp;</span>
                            ${escapeHtml(options.buttonLabel)}
                          </a>
                        </td>
                      </tr>
                    </table>

                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;border-top:1px solid rgba(255,255,255,.10);">
                      <tr>
                        <td style="padding:17px 0 0;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
                            <tr>
                              <td valign="top" style="width:30px;padding-top:3px;">
                                <table role="presentation" width="20" height="20" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border:1px solid ${options.accent};border-radius:50%;">
                                  <tr><td align="center" valign="middle" style="font-family:Arial,sans-serif;font-size:12px;line-height:18px;color:${options.accent};font-weight:bold;">i</td></tr>
                                </table>
                              </td>
                              <td align="right" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:27px;color:#bdb4aa;padding-right:8px;">
                                ${escapeHtml(options.note)}<br>
                                ${escapeHtml(options.note2)}
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="padding:27px 42px 29px;background:#080b0e;border-top:1px solid rgba(255,255,255,.10);">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
                <tr>
                  <td align="left" valign="middle" dir="ltr" style="padding:0;">
                    <div style="font-family:Georgia,'Times New Roman',serif;font-size:25px;line-height:28px;font-weight:700;color:#f1e9df;white-space:nowrap;">
                      Cowboy<span style="color:${options.accent};">Bepob</span>
                    </div>
                    <div style="margin-top:10px;font-family:Arial,Helvetica,sans-serif;font-size:9px;line-height:12px;letter-spacing:4px;color:#827a72;white-space:nowrap;">
                      ${escapeHtml(options.footerTagline)}
                    </div>
                  </td>
                  <td align="right" valign="middle" dir="ltr" style="padding:0;white-space:nowrap;">
                    <span style="display:inline-block;margin-left:25px;color:#8c8b8a;font-family:Arial,sans-serif;font-size:18px;font-weight:bold;">◉</span>
                    <span style="display:inline-block;margin-left:25px;color:#8c8b8a;font-family:Arial,sans-serif;font-size:20px;">𝕏</span>
                    <span style="display:inline-block;color:#8c8b8a;font-family:Arial,sans-serif;font-size:18px;font-weight:bold;">▶</span>
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
    accent: '#e12b25',
    border: '#6d1d1b',
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
    footerTagline: 'GOOD ANIME. BETTER COMPANY.',
    preheader: 'أكمل إنشاء حسابك في CowboyBepob بتأكيد بريدك الإلكتروني.'
  }));
}

export async function sendPasswordResetEmail(to: string, name: string, token: string) {
  const link = `${publicUrl}/reset-password?token=${encodeURIComponent(token)}`;
  return send(to, 'إعادة تعيين كلمة المرور - CowboyBepob', emailLayout({
    name,
    accent: '#1674e8',
    border: '#123c70',
    hero: '/bebop/login-bg.webp',
    topRight: 'WHATEVER HAPPENS,\nHAPPENS ...',
    title: 'إعادة تعيين',
    titleAccent: 'كلمة المرور',
    intro: 'لقد تلقينا طلبًا لإعادة تعيين كلمة المرور الخاصة بحسابك. اضغط على الزر أدناه لإنشاء كلمة مرور جديدة.',
    buttonLabel: 'إعادة تعيين كلمة المرور',
    buttonIcon: '&#128274;',
    buttonUrl: link,
    note: 'إذا لم تطلب تغيير كلمة المرور، يمكنك تجاهل هذه الرسالة بأمان.',
    note2: 'رابط إعادة التعيين صالح لفترة محدودة من الوقت.',
    footerTagline: 'SAME DREAMS. A DIFFERENT SKY.',
    preheader: 'تم طلب إعادة تعيين كلمة المرور لحسابك في CowboyBepob.'
  }));
}
