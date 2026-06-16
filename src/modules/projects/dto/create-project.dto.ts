import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class DeploymentProvisioningEnvVarDto {
  @IsString()
  @MinLength(2)
  @MaxLength(128)
  key!: string;

  @IsString()
  @MaxLength(16384)
  value!: string;
}

export class DeploymentProvisioningEnvSetDto {
  @IsIn(['test', 'uat', 'production'])
  environment!: 'test' | 'uat' | 'production';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeploymentProvisioningEnvVarDto)
  vars!: DeploymentProvisioningEnvVarDto[];
}

export class DeploymentProvisioningTargetDto {
  @IsOptional()
  @IsIn(['create', 'register_existing'])
  action?: 'create' | 'register_existing';

  @IsIn(['backend', 'frontend', 'standalone'])
  slot!: 'backend' | 'frontend' | 'standalone';

  @IsIn(['render', 'vercel'])
  provider!: 'render' | 'vercel';

  @IsIn(['byo', 'flowci_managed'])
  ownershipMode!: 'byo' | 'flowci_managed';

  @IsOptional()
  @IsString()
  providerConnectionId?: string;

  @IsOptional()
  @IsString()
  projectName?: string;

  @IsOptional()
  @IsString()
  providerProjectId?: string;

  @IsOptional()
  @IsString()
  providerProjectName?: string;

  @IsOptional()
  @IsString()
  branchName?: string;

  @IsOptional()
  @IsString()
  rootDirectory?: string;

  @IsOptional()
  @IsString()
  buildCommand?: string;

  @IsOptional()
  @IsString()
  startCommand?: string;

  @IsOptional()
  @IsIn(['managed_image', 'byo_image', 'native_git', 'existing_service'])
  renderDeployMethod?:
    | 'managed_image'
    | 'byo_image'
    | 'native_git'
    | 'existing_service';

  @IsOptional()
  @IsIn(['web_service', 'private_service', 'background_worker', 'cron_job'])
  renderServiceType?:
    | 'web_service'
    | 'private_service'
    | 'background_worker'
    | 'cron_job';

  @IsOptional()
  @IsIn(['node', 'python', 'ruby', 'go', 'rust', 'elixir', 'docker'])
  renderRuntime?:
    | 'node'
    | 'python'
    | 'ruby'
    | 'go'
    | 'rust'
    | 'elixir'
    | 'docker';

  @IsOptional()
  @IsString()
  renderInstanceType?: string;

  @IsOptional()
  @IsString()
  renderRegion?: string;

  @IsOptional()
  @IsIn(['test', 'uat', 'production'])
  renderEnvironmentName?: 'test' | 'uat' | 'production';

  @IsOptional()
  @IsString()
  dockerContext?: string;

  @IsOptional()
  @IsString()
  dockerfilePath?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeploymentProvisioningEnvSetDto)
  env?: DeploymentProvisioningEnvSetDto[];
}

export class DeploymentProvisioningRequestDto {
  @IsBoolean()
  enabled!: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeploymentProvisioningTargetDto)
  targets!: DeploymentProvisioningTargetDto[];
}

export class MicroserviceSlotDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  projectTypeId!: string;

  @IsOptional()
  @IsString()
  workflowRecipeId?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  serviceName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  servicePath?: string;
}

export class MicroservicesConfigDto {
  @ValidateNested()
  @Type(() => MicroserviceSlotDto)
  backend!: MicroserviceSlotDto;

  @ValidateNested()
  @Type(() => MicroserviceSlotDto)
  frontend!: MicroserviceSlotDto;
}

export class MultiRepoConfigDto {
  @ValidateNested()
  @Type(() => MicroserviceSlotDto)
  backend!: MicroserviceSlotDto;

  @ValidateNested()
  @Type(() => MicroserviceSlotDto)
  frontend!: MicroserviceSlotDto;
}

export class CreateProjectDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  repoName!: string;

  @IsIn(['private', 'public'])
  visibility!: 'private' | 'public';

  // Catalog IDs ('mono', 'multi') and canonical IDs ('monorepo', 'multi-repo')
  // are both accepted; the service normalizes via normalizeRepoShape().
  @IsOptional()
  @IsIn([
    'standalone',
    'mono',
    'monorepo',
    'multi',
    'multi-repo',
    'microservices',
  ])
  repoShape?: string;

  @IsString()
  @MinLength(1)
  projectTypeId!: string;

  @IsOptional()
  @IsString()
  workflowRecipeId?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  serviceName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  servicePath?: string;

  @IsOptional()
  @IsString()
  nodeVersion?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  coverageThreshold?: number;

  @IsOptional()
  @IsObject()
  tests?: Partial<Record<string, boolean>>;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  outputFileName?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MicroservicesConfigDto)
  microservicesConfig?: MicroservicesConfigDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => MultiRepoConfigDto)
  multiRepoConfig?: MultiRepoConfigDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => DeploymentProvisioningRequestDto)
  deploymentProvisioning?: DeploymentProvisioningRequestDto;
}
