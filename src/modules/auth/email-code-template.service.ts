import { Injectable } from '@nestjs/common';

export interface VerificationCodeEmailInput {
  email: string;
  code: string;
  expiresInMinutes: number;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

@Injectable()
export class EmailCodeTemplateService {
  renderVerificationCodeEmail(input: VerificationCodeEmailInput): RenderedEmail {
    const subject = 'Verify your email address';
    const email = escapeHtml(input.email);
    const code = escapeHtml(input.code);
    const expiresInMinutes = input.expiresInMinutes;

    return {
      subject,
      html: `<!doctype html>
<html>
  <body style="margin:0;background:#ffffff;color:#020617;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffffff;padding:48px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;border:1px solid #d9dee7;border-radius:14px;padding:40px;background:#ffffff;">
            <tr>
              <td>
                <div style="width:64px;height:64px;border:1px solid #e5e7eb;border-radius:16px;display:inline-block;text-align:center;line-height:64px;font-weight:800;font-size:28px;color:#0f172a;">A</div>
                <h1 style="font-size:28px;line-height:36px;margin:28px 0 16px;font-weight:700;color:#020617;">Verify your email</h1>
                <p style="font-size:16px;line-height:26px;margin:0 0 28px;color:#020617;">
                  We need to verify your email address <a href="mailto:${email}" style="color:#2563eb;text-decoration:none;">${email}</a> before you can access your account. Enter the code below in your open browser window.
                </p>
                <p style="font-size:32px;letter-spacing:4px;line-height:42px;margin:0 0 32px;color:#020617;font-weight:400;">${code}</p>
                <hr style="border:0;border-top:1px solid #d9dee7;margin:0 0 28px;" />
                <p style="font-size:14px;line-height:22px;margin:0 0 16px;color:#334155;">This code expires in ${expiresInMinutes} minutes.</p>
                <p style="font-size:14px;line-height:22px;margin:0;color:#334155;">If you didn't sign up for AlphaCI, you can safely ignore this email. Someone else might have typed your email address by mistake.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
      text: [
        'Verify your email',
        '',
        `We need to verify your email address ${input.email} before you can access your account. Enter the code below in your open browser window.`,
        '',
        input.code,
        '',
        `This code expires in ${expiresInMinutes} minutes.`,
        "If you didn't sign up for AlphaCI, you can safely ignore this email. Someone else might have typed your email address by mistake.",
      ].join('\n'),
    };
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
