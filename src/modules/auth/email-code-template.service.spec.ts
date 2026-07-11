import { EmailCodeTemplateService } from './email-code-template.service.js';

describe('EmailCodeTemplateService', () => {
  it('renders the verification code email reference content', () => {
    const service = new EmailCodeTemplateService();

    const email = service.renderVerificationCodeEmail({
      email: 'tone@example.test',
      code: '071780',
      expiresInMinutes: 10,
    });

    expect(email.subject).toBe('Verify your email address');
    expect(email.html).toContain('Verify your email');
    expect(email.html).toContain('tone@example.test');
    expect(email.html).toContain('071780');
    expect(email.html).toContain('This code expires in 10 minutes.');
    expect(email.text).toContain('Verify your email');
    expect(email.text).toContain('071780');
    expect(email.text).toContain('This code expires in 10 minutes.');
  });

  it('escapes HTML-sensitive email and code values', () => {
    const service = new EmailCodeTemplateService();

    const email = service.renderVerificationCodeEmail({
      email: 'tone+<script>@example.test',
      code: '12<456',
      expiresInMinutes: 10,
    });

    expect(email.html).toContain('tone+&lt;script&gt;@example.test');
    expect(email.html).toContain('12&lt;456');
    expect(email.text).toContain('tone+<script>@example.test');
    expect(email.text).toContain('12<456');
  });
});
