import {
  Body,
  Controller,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';

import { CiService } from './ci.service';
import type { ValidateCiRunDto } from './dto/validate-ci-run.dto';

@Controller('ci')
export class CiController {
  constructor(private readonly ciService: CiService) {}

  @Post('validate')
  async validate(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: ValidateCiRunDto,
  ) {
    const token = this.extractBearerToken(authorization);
    const input = {
      token,
      repoFullName: body.repo,
      stage: body.stage,
      ...(body.workflowRunId !== undefined && {
        workflowRunId: body.workflowRunId,
      }),
      ...(body.headSha !== undefined && { headSha: body.headSha }),
    };

    return this.ciService.validateRun(input);
  }

  private extractBearerToken(authorization: string | undefined): string {
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1]) {
      throw new UnauthorizedException('Bearer CI token is required');
    }

    return match[1].trim();
  }
}
