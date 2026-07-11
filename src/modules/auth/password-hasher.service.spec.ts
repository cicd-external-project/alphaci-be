import { PasswordHasherService } from './password-hasher.service.js';

describe('PasswordHasherService', () => {
  it('hashes and verifies a secret', async () => {
    const service = new PasswordHasherService();
    const hash = await service.hash('correct horse battery staple');

    expect(hash).toMatch(/^scrypt:/);
    await expect(
      service.verify('correct horse battery staple', hash),
    ).resolves.toBe(true);
    await expect(service.verify('wrong password', hash)).resolves.toBe(false);
  });

  it('rejects malformed hashes', async () => {
    const service = new PasswordHasherService();
    await expect(service.verify('secret', 'bad-hash')).resolves.toBe(false);
  });
});
