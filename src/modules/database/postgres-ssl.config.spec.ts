import { postgresSslConfig } from './postgres-ssl.config.js';

describe('postgresSslConfig', () => {
  it.each([
    'postgres://user:pass@localhost:5432/db',
    'postgres://user:pass@127.0.0.1:5432/db',
    'postgres://user:pass@[::1]:5432/db',
  ])('does not enable TLS for local database URL %s', (databaseUrl) => {
    expect(postgresSslConfig(databaseUrl)).toBe(false);
  });

  it('enables verified TLS for remote database URLs by default', () => {
    expect(
      postgresSslConfig('postgres://user:pass@db.example.com:5432/app'),
    ).toBe(true);
  });

  it('uses a configured CA certificate for remote database URLs', () => {
    expect(
      postgresSslConfig(
        'postgres://user:pass@db.example.com:5432/app',
        '-----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE-----',
      ),
    ).toEqual({
      ca: '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----',
    });
  });

  it('fails closed to verified TLS when the database URL is malformed', () => {
    expect(postgresSslConfig('not-a-valid-url')).toBe(true);
  });
});
