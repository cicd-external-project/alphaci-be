import type { EnvEnvironment, EnvVarInput } from '../env-provisioning.types';

export interface ProvisionEnvVarsDto {
  deploymentTargetId: string;
  environment: EnvEnvironment;
  vars: EnvVarInput[];
}
