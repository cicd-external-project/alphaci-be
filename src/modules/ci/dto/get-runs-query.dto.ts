import { IsString } from 'class-validator';

export class GetRunsQueryDto {
  @IsString()
  repoFullName!: string;
}
