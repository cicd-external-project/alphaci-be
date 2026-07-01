import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export type DeploymentProvider = 'vercel' | 'render' | 'gcp';

export interface DeploymentWorkflowTarget {
  slot: 'backend' | 'frontend' | 'standalone';
  provider: DeploymentProvider;
  deploymentStrategy:
    | 'vercel_ci_pushed'
    | 'render_image_pushed'
    | 'render_git_connected'
    | 'render_existing_service'
    | 'gcp_cloud_run';
  rootDirectory?: string;
  dockerContext?: string | null;
  dockerfilePath?: string | null;
  imageName?: string | null;
  gcpProjectId?: string | null;
  gcpRegion?: string | null;
  workloadIdentityProvider?: string | null;
  deployerServiceAccount?: string | null;
  runtimeServiceAccount?: string | null;
  artifactRegistryRepository?: string | null;
  cloudRunServiceName?: string | null;
  allowPreview?: boolean | null;
  renderServiceType?: string | null;
  renderInstanceType?: string | null;
  secretNames?: {
    token?: string;
    orgId?: string;
    projectId?: string;
    apiKey?: string;
    serviceId?: string;
    ownerId?: string;
    registryCredentialId?: string;
  };
}

export class GenerateWorkflowDto {
  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  templateId!: string;

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
  @Matches(/^[0-9]{2}$/)
  nodeVersion?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  coverageThreshold?: number;

  @IsOptional()
  @IsIn(['vercel', 'render', 'gcp'])
  deploymentProvider?: DeploymentProvider;

  deploymentTargets?: DeploymentWorkflowTarget[];

  @IsOptional()
  @IsArray()
  @IsIn(
    [
      'strictProductionApproval',
      'enableUatApproval',
      'disablePlaywright',
      'disableK6',
    ],
    {
      each: true,
    },
  )
  enhancements?: Array<
    | 'strictProductionApproval'
    | 'enableUatApproval'
    | 'disablePlaywright'
    | 'disableK6'
  >;
}
