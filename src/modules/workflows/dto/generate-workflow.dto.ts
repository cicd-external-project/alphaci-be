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

export type DeploymentProvider = 'vercel' | 'render';

export interface DeploymentWorkflowTarget {
  slot: 'backend' | 'frontend' | 'standalone';
  provider: 'vercel';
  deploymentStrategy: 'vercel_ci_pushed';
  rootDirectory?: string;
  secretNames: {
    token: string;
    orgId: string;
    projectId: string;
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
  @IsIn(['vercel', 'render'])
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
