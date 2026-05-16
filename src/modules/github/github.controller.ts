import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";

import { SessionAuthGuard } from "../../common/guards/session-auth.guard";
import { GithubService } from "./github.service";

@Controller("github")
@UseGuards(SessionAuthGuard)
export class GithubController {
  constructor(private readonly githubService: GithubService) {}

  @Get("repos")
  async repos(@Req() req: Request) {
    const accessToken = req.session.githubAccessToken;
    if (!accessToken) {
      return { repos: [] };
    }

    const repos = await this.githubService.listRepos(accessToken);
    return { repos };
  }
}
