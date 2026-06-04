import {
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

export class CreateProjectDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  repoName!: string;

  @IsIn(['private', 'public'])
  visibility!: 'private' | 'public';

  @IsOptional()
  @IsString()
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
}
