import type { EnvProvider } from '../env-provisioning.types';

export interface CreateProviderConnectionDto {
  provider: EnvProvider;
  label: string;
  token: string;
}
