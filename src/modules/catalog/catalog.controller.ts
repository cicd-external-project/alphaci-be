import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";

import { SessionAuthGuard } from "../../common/guards/session-auth.guard";
import { SubscriptionGuard } from "../../common/guards/subscription.guard";
import { ListCatalogQueryDto } from "./dto/list-catalog-query.dto";
import { CatalogService } from "./catalog.service";

@Controller("catalog")
@UseGuards(SessionAuthGuard, SubscriptionGuard)
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get("categories")
  async categories() {
    return {
      categories: await this.catalogService.listCategories(),
    };
  }

  @Get("templates")
  async templates(@Query() query: ListCatalogQueryDto) {
    return {
      templates: await this.catalogService.listTemplates(query),
    };
  }

  @Get("templates/:templateId")
  async templateById(@Param("templateId") templateId: string) {
    const template = await this.catalogService.getTemplateById(templateId);
    if (!template) {
      throw new NotFoundException(`Template '${templateId}' not found`);
    }

    return {
      template,
    };
  }
}
