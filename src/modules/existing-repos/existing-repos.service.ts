import { readFile } from 'node:fs/promises';

import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import yaml from 'js-yaml';

import { CatalogService } from '../catalog/catalog.service';
import { GithubService } from '../github/github.service';
import type { DiscoverExistingRepoDto } from './dto/discover-existing-repo.dto';
import type { SetupExistingRepoPrDto } from './dto/setup-existing-repo-pr.dto';

export interface ExistingRepoDiscoveryResponse {
  repoFullName: string;
  baseBranch: string;
  detectedProjectTypeId: string | null;
  recommendedWorkflowRecipeId: string;
  serviceName: string;
  servicePath: string;
}

export interface ExistingRepoSetupPullRequestResponse {
  repoFullName: string;
  branchName: string;
  workflowPath: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
}

@Injectable()
export class ExistingReposService {
  constructor(
    private readonly githubService: GithubService,
    private readonly catalogService: CatalogService,
  ) {}

  async discover(
    userId: string,
    oauthAccessToken: string | null | undefined,
    dto: DiscoverExistingRepoDto,
  ): Promise<ExistingRepoDiscoveryResponse> {
    const [owner, repo] = this.parseRepoFullName(dto.repoFullName);
    const token = await this.resolveProvisioningToken(
      userId,
      oauthAccessToken,
      dto.repoFullName,
    );
    const baseBranch = dto.baseBranch ?? 'main';
    const packageJson = await this.githubService.getFileContent(
      token,
      owner,
      repo,
      'package.json',
      baseBranch,
    );
    const detectedProjectTypeId = this.detectProjectType(packageJson);

    return {
      repoFullName: dto.repoFullName,
      baseBranch,
      detectedProjectTypeId,
      recommendedWorkflowRecipeId: 'standard',
      serviceName: repo,
      servicePath: '.',
    };
  }

  async setupPullRequest(
    userId: string,
    oauthAccessToken: string | null | undefined,
    dto: SetupExistingRepoPrDto,
  ): Promise<ExistingRepoSetupPullRequestResponse> {
    const [owner, repo] = this.parseRepoFullName(dto.repoFullName);
    const token = await this.resolveProvisioningToken(
      userId,
      oauthAccessToken,
      dto.repoFullName,
    );
    const baseBranch = dto.baseBranch ?? 'main';
    const workflowRecipeId = dto.workflowRecipeId ?? 'standard';
    const templateId = this.resolveTemplateId(
      dto.projectTypeId,
      workflowRecipeId,
    );
    const { generatedYaml, outputFileName } = await this.buildWorkflowYaml(
      templateId,
      dto.serviceName,
      dto.servicePath,
      dto.nodeVersion,
      dto.coverageThreshold,
      dto.outputFileName,
    );
    const branchName = `alphaci/${this.sanitizeBranchSlug(dto.serviceName)}-ci`;
    const workflowPath = `.github/workflows/${outputFileName}`;

    await this.githubService.createBranch(
      token,
      owner,
      repo,
      branchName,
      baseBranch,
    );
    await this.githubService.putFileContent(
      token,
      owner,
      repo,
      workflowPath,
      generatedYaml,
      branchName,
      'ci: add ALPHACI workflow',
    );
    const pullRequest = await this.githubService.createPullRequest(
      token,
      owner,
      repo,
      {
        title: 'Add ALPHACI workflow',
        head: branchName,
        base: baseBranch,
        body: [
          'This PR adds an ALPHACI workflow for this existing repository.',
          '',
          `Service: ${dto.serviceName}`,
          `Workflow: ${workflowPath}`,
        ].join('\n'),
      },
    );

    return {
      repoFullName: dto.repoFullName,
      branchName,
      workflowPath,
      pullRequestNumber: pullRequest.number,
      pullRequestUrl: pullRequest.htmlUrl,
    };
  }

  private async resolveProvisioningToken(
    userId: string,
    oauthAccessToken: string | null | undefined,
    repoFullName: string,
  ): Promise<string> {
    const installationToken =
      await this.githubService.getInstallationAccessTokenForUserRepo(
        userId,
        repoFullName,
      );

    if (installationToken) {
      return installationToken;
    }

    if (oauthAccessToken) {
      return oauthAccessToken;
    }

    throw new UnauthorizedException(
      'No usable GitHub token found. Link the GitHub App installation or re-authenticate via GitHub OAuth.',
    );
  }

  private parseRepoFullName(repoFullName: string): [string, string] {
    const parts = repoFullName.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new UnprocessableEntityException(
        `Invalid repoFullName '${repoFullName}'. Expected format: "owner/repo"`,
      );
    }

    return [parts[0], parts[1]];
  }

  private detectProjectType(packageJsonRaw: string | null): string | null {
    if (!packageJsonRaw) {
      return null;
    }

    let parsed: {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    try {
      parsed = JSON.parse(packageJsonRaw) as typeof parsed;
    } catch {
      return null;
    }

    const dependencies = {
      ...(parsed.dependencies ?? {}),
      ...(parsed.devDependencies ?? {}),
    };

    if (dependencies.next) return 'nextjs';
    if (dependencies['@nestjs/core']) return 'nestjs';
    if (dependencies.react) return 'react';
    if (dependencies.express || dependencies.fastify) return 'nodejs';

    return null;
  }

  private resolveTemplateId(
    projectTypeId: string,
    workflowRecipeId: string,
  ): string {
    const { recipes } = this.catalogService.getProjectOptions();
    const recipe = recipes.find((item) => item.id === workflowRecipeId);
    const mapped = recipe?.templateByProjectType[projectTypeId];
    return mapped ?? `${projectTypeId}-${workflowRecipeId}`;
  }

  private async buildWorkflowYaml(
    templateId: string,
    serviceName: string,
    servicePath?: string,
    nodeVersion?: string,
    coverageThreshold?: number,
    customOutputFileName?: string,
  ): Promise<{ generatedYaml: string; outputFileName: string }> {
    const template = await this.catalogService.getTemplateById(templateId);
    if (!template) {
      throw new NotFoundException(`Template '${templateId}' not found`);
    }

    const source = await readFile(template.workflowPath, 'utf8');
    const parsed = yaml.load(source, { schema: yaml.DEFAULT_SCHEMA }) as Record<
      string,
      unknown
    > | null;

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new UnprocessableEntityException(
        'Workflow template could not be parsed',
      );
    }

    parsed.name = `${serviceName} - ${template.name}`;

    const onConfig = this.ensureObject(parsed, 'on');
    const dispatchConfig = this.ensureObject(onConfig, 'workflow_dispatch');
    const inputConfig = this.ensureObject(dispatchConfig, 'inputs');

    this.setInputDefault(inputConfig, 'service_name', serviceName, 'string');
    if (servicePath !== undefined) {
      this.setInputDefault(inputConfig, 'service_path', servicePath, 'string');
    }
    if (nodeVersion !== undefined) {
      this.setInputDefault(inputConfig, 'node_version', nodeVersion, 'string');
    }
    if (coverageThreshold !== undefined) {
      this.setInputDefault(
        inputConfig,
        'coverage_threshold',
        coverageThreshold,
        'number',
      );
    }

    return {
      generatedYaml: yaml.dump(parsed, {
        lineWidth: -1,
        noRefs: true,
        sortKeys: false,
      }),
      outputFileName:
        customOutputFileName ??
        this.deriveOutputFileName(serviceName, templateId),
    };
  }

  private ensureObject(
    parent: Record<string, unknown>,
    key: string,
  ): Record<string, unknown> {
    const existing = parent[key];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      const next: Record<string, unknown> = {};
      parent[key] = next;
      return next;
    }

    return existing as Record<string, unknown>;
  }

  private setInputDefault(
    inputs: Record<string, unknown>,
    key: string,
    value: string | number,
    type: 'string' | 'number',
  ): void {
    const existing = inputs[key];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      inputs[key] = {
        description: `Auto-generated default for ${key}`,
        required: false,
        type,
        default: value,
      };
      return;
    }

    const record = existing as Record<string, unknown>;
    record.default = value;
    if (!record.type) {
      record.type = type;
    }
  }

  private deriveOutputFileName(
    serviceName: string,
    templateId: string,
  ): string {
    return `${this.sanitizeBranchSlug(serviceName) || 'service'}-${templateId}.yml`;
  }

  private sanitizeBranchSlug(value: string): string {
    return value
      .toLowerCase()
      .replaceAll(/[^a-z0-9-]+/g, '-')
      .replaceAll(/^-+|-+$/g, '');
  }
}
