import { Body, Controller, Get, Post, Query, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { Request } from "express";

import { SessionAuthGuard } from "../../common/guards/session-auth.guard";
import { SubscriptionGuard } from "../../common/guards/subscription.guard";
import { GenerateWorkflowDto } from "./dto/generate-workflow.dto";
import { WorkflowsService } from "./workflows.service";

@Controller("workflows")
@UseGuards(SessionAuthGuard, SubscriptionGuard)
export class WorkflowsController {
  constructor(private readonly workflowsService: WorkflowsService) {}

  @Post("generate")
  async generate(@Req() req: Request, @Body() body: GenerateWorkflowDto) {
    const user = req.session?.user;
    if (!user) {
      throw new UnauthorizedException("Authentication required");
    }

    return this.workflowsService.generate(user.id, body);
  }

  @Get("history")
  async history(@Req() req: Request, @Query("limit") limit?: string) {
    const user = req.session?.user;
    if (!user) {
      throw new UnauthorizedException("Authentication required");
    }

    const parsedLimit = Number.parseInt(limit ?? "25", 10);
    const safeLimit = Number.isFinite(parsedLimit) ? parsedLimit : 25;

    return {
      items: await this.workflowsService.getHistory(user.id, safeLimit),
    };
  }
}
