import {
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CiReportTestResultsDto {
  @IsInt()
  @Min(0)
  passed!: number;

  @IsInt()
  @Min(0)
  failed!: number;

  @IsInt()
  @Min(0)
  total!: number;
}

export class CiReportCoverageDto {
  @IsNumber()
  @Min(0)
  pct!: number;

  @IsNumber()
  @Min(0)
  threshold!: number;
}

export class CiReportLintDto {
  @IsInt()
  @Min(0)
  errors!: number;

  @IsInt()
  @Min(0)
  warnings!: number;
}

export class CiReportSecurityDto {
  @IsInt()
  @Min(0)
  high!: number;

  @IsInt()
  @Min(0)
  critical!: number;
}

export class CiReportResultsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => CiReportTestResultsDto)
  tests?: CiReportTestResultsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CiReportCoverageDto)
  coverage?: CiReportCoverageDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CiReportLintDto)
  lint?: CiReportLintDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CiReportSecurityDto)
  security?: CiReportSecurityDto;
}

export class CiReportBodyDto {
  @IsString()
  repoFullName!: string;

  @IsString()
  branch!: string;

  @IsString()
  commitSha!: string;

  @IsNumber()
  @Min(0)
  runId!: number;

  @IsIn(['access', 'quality', 'package'])
  stage!: 'access' | 'quality' | 'package';

  @IsIn(['success', 'failure', 'cancelled'])
  conclusion!: 'success' | 'failure' | 'cancelled';

  @IsObject()
  @ValidateNested()
  @Type(() => CiReportResultsDto)
  results!: CiReportResultsDto;
}
