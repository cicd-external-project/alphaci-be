import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { CreateProjectDto } from './dto/create-project.dto';
import { SetupProjectDto } from './dto/setup-project.dto';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  /**
   * POST /api/v1/projects
   * Creates a new GitHub repository, sets up branch structure + protection,
   * generates a workflow YAML from the chosen template, and pushes it.
   * Requires an active subscription.
   */
  @Post()
  @UseGuards(SessionAuthGuard, SubscriptionGuard)
  async createProject(@Req() req: Request, @Body() body: CreateProjectDto) {
    const userId = req.session.user?.id ?? req.session.userId;
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }

    const userLogin = req.session.user?.login;
    if (!userLogin) {
      throw new UnauthorizedException('GitHub login not found in session. Re-authenticate.');
    }

    const accessToken = req.session.githubAccessToken ?? null;
    return this.projectsService.createProject(userId, userLogin, accessToken, body);
  }

  /**
   * POST /api/v1/projects/setup
   * Generates a workflow YAML and pushes it to an existing GitHub repository.
   * Requires an active subscription.
   */
  @Post('setup')
  @UseGuards(SessionAuthGuard, SubscriptionGuard)
  async setupProject(@Req() req: Request, @Body() body: SetupProjectDto) {
    const accessToken = req.session.githubAccessToken;
    if (!accessToken) {
      throw new UnauthorizedException(
        'GitHub access token not found. Re-authenticate via GitHub OAuth.',
      );
    }

    const userId = req.session.user?.id ?? req.session.userId;
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }

    return this.projectsService.setupProject(userId, accessToken, body);
  }

  /**
   * GET /api/v1/projects
   * Returns all provisioned projects for the authenticated user.
   */
  @Get()
  @UseGuards(SessionAuthGuard)
  async listProjects(@Req() req: Request, @Query('limit') limit?: string) {
    const userId = req.session.user?.id ?? req.session.userId;
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }

    const parsedLimit = Number.parseInt(limit ?? '25', 10);
    const safeLimit = Number.isFinite(parsedLimit) ? parsedLimit : 25;

    return this.projectsService.listProjects(userId, safeLimit);
  }
}
