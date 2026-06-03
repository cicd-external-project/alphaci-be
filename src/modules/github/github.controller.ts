import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { CreateRepoDto } from './dto/create-repo.dto.js';
import { LinkInstallationDto } from './dto/link-installation.dto';
import { GithubService } from './github.service';

@Controller('github')
@UseGuards(SessionAuthGuard)
export class GithubController {
  constructor(private readonly githubService: GithubService) {}

  // ─── GitHub App endpoints ───────────────────────────────────────────────

  /** GET /github/app/install-url — returns the GitHub App installation URL */
  @Get('app/install-url')
  getAppInstallUrl() {
    return { installUrl: this.githubService.getAppInstallUrl() };
  }

  /** POST /github/installations — link a GitHub App installation to the current user */
  @Post('installations')
  async linkInstallation(
    @Req() req: Request,
    @Body() body: LinkInstallationDto,
  ) {
    const userId = req.session.user?.id ?? req.session.userId;
    if (!userId) {
      return { reposLinked: 0, repositorySelection: 'selected' };
    }

    return this.githubService.linkInstallation(userId, body.installationId);
  }

  /** GET /github/installations/repos — list repos linked via GitHub App */
  @Get('installations/repos')
  async listLinkedRepos(@Req() req: Request) {
    const userId = req.session.user?.id ?? req.session.userId;
    if (!userId) {
      return { repos: [] };
    }

    const repos = await this.githubService.listLinkedRepos(userId);
    return { repos };
  }

  /** GET /github/installations/accounts — list GitHub App installation accounts */
  @Get('installations/accounts')
  async listInstallationAccounts(@Req() req: Request) {
    const userId = req.session.user?.id ?? req.session.userId;
    if (!userId) {
      return { accounts: [] };
    }

    const installations = await this.githubService.listInstallationAccounts(userId);
    const accounts = installations.map((inst) => ({
      installationId: inst.installationId,
      accountLogin: inst.accountLogin,
      accountId: inst.accountId,
      repositorySelection: inst.repositorySelection,
    }));
    return { accounts };
  }

  // ─── OAuth repos (existing) ─────────────────────────────────────────────

  @Get('repos')
  async repos(@Req() req: Request) {
    const accessToken = req.session.githubAccessToken;
    if (!accessToken) {
      return { repos: [] };
    }

    const repos = await this.githubService.listRepos(accessToken);
    return { repos };
  }

  /** POST /github/repos — create a new GitHub repository with branch structure */
  @Post('repos')
  async createRepo(@Req() req: Request, @Body() body: CreateRepoDto) {
    const accessToken = req.session.githubAccessToken;
    if (!accessToken) {
      return { error: 'GitHub access token not found. Re-authenticate via GitHub OAuth.' };
    }

    const { repoUrl, cloneUrl, ownerLogin, repoName } = await this.githubService.createRepo(accessToken, body);

    const branchesCreated: string[] = ['main'];
    for (const branch of ['uat', 'test'] as const) {
      await this.githubService.createBranch(accessToken, ownerLogin, repoName, branch, 'main');
      branchesCreated.push(branch);
    }

    for (const branch of ['test', 'uat', 'main'] as const) {
      await this.githubService.applyBranchProtection(accessToken, ownerLogin, repoName, branch);
    }

    return {
      repoUrl,
      cloneUrl,
      defaultBranch: 'main',
      branchesCreated,
    };
  }
}
