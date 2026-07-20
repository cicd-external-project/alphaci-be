import { createHash, randomBytes } from 'node:crypto';

import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { CiTokensRepository } from './ci-tokens.repository';

export interface IssueProjectTokenResult {
  token: string;
  tokenPrefix: string;
}

export interface ValidateRunInput {
  token: string;
  repoFullName: string;
  stage: string;
  workflowRunId?: string;
  headSha?: string;
}

export interface ValidateRunResult {
  authorized: true;
  projectId: string;
  repoFullName: string;
  stage: string;
}

@Injectable()
export class CiService {
  constructor(private readonly ciTokensRepository: CiTokensRepository) {}

  async issueProjectToken(projectId: string): Promise<IssueProjectTokenResult> {
    const token = `aci_${randomBytes(32).toString('base64url')}`;
    const tokenPrefix = token.slice(0, 12);

    await this.ciTokensRepository.upsertProjectToken({
      projectId,
      tokenHash: this.hashToken(token),
      tokenPrefix,
    });

    return { token, tokenPrefix };
  }

  async validateRun(input: ValidateRunInput): Promise<ValidateRunResult> {
    const token = input.token.trim();
    const repoFullName = input.repoFullName.trim();
    const stage = input.stage.trim();

    if (!token) {
      throw new UnauthorizedException('CI token is required');
    }
    if (!repoFullName || !stage) {
      throw new ForbiddenException('Repository and stage are required');
    }

    const context = await this.ciTokensRepository.findValidationContext(
      this.hashToken(token),
      repoFullName,
    );

    if (!context || context.token_status !== 'active') {
      throw new ForbiddenException(
        'CI token is not authorized for this repository',
      );
    }
    if (context.project_status !== 'provisioned') {
      throw new ForbiddenException('Project is not provisioned');
    }
    if (context.subscription_status !== 'active') {
      throw new ForbiddenException('Active subscription required');
    }

    return {
      authorized: true,
      projectId: context.project_id,
      repoFullName: context.repo_full_name,
      stage,
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
