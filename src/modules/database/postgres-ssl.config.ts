import type { ConnectionOptions } from 'node:tls';

const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function postgresSslConfig(
  databaseUrl: string,
  caCert?: string,
): boolean | ConnectionOptions {
  if (isLocalDatabase(databaseUrl)) {
    return false;
  }

  const normalizedCa = normalizeCaCert(caCert);
  if (normalizedCa) {
    return { ca: normalizedCa };
  }

  return true;
}

function isLocalDatabase(databaseUrl: string): boolean {
  try {
    const hostname = new URL(databaseUrl).hostname.replace(/^\[|\]$/g, '');
    return LOCAL_DATABASE_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

function normalizeCaCert(caCert?: string): string | undefined {
  const trimmed = caCert?.trim();
  return trimmed ? trimmed.replace(/\\n/g, '\n') : undefined;
}
