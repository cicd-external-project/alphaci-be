import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { AppConfig } from "../../config/app.config";
import type { ListCatalogQueryDto } from "./dto/list-catalog-query.dto";

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  iconName: string;
  categories: string[];
  filePatterns: string[];
  stack: "nextjs" | "react" | "react-native" | "expo" | "nestjs" | "nodejs";
  propertiesPath: string;
  workflowPath: string;
}

interface WorkflowPropertiesFile {
  name?: string;
  description?: string;
  iconName?: string;
  categories?: string[];
  filePatterns?: string[];
}

@Injectable()
export class CatalogService {
  private readonly config: AppConfig;
  private cache: { loadedAt: number; templates: WorkflowTemplate[] } | null = null;
  private readonly cacheTtlMs = 20_000;

  constructor(private readonly configService: ConfigService) {
    this.config = this.configService.getOrThrow<AppConfig>("app");
  }

  async listCategories() {
    const templates = await this.getTemplates();
    const counts = new Map<string, number>();

    for (const template of templates) {
      for (const category of template.categories) {
        counts.set(category, (counts.get(category) ?? 0) + 1);
      }
    }

    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
  }

  async listTemplates(query: ListCatalogQueryDto = {}) {
    const templates = await this.getTemplates();
    const normalizedCategory = query.category?.trim().toLowerCase();
    const normalizedSearch = query.q?.trim().toLowerCase();

    return templates.filter((template) => {
      if (query.stack && template.stack !== query.stack) {
        return false;
      }

      if (normalizedCategory) {
        const hasCategory = template.categories.some((category) => category.toLowerCase() === normalizedCategory);
        if (!hasCategory) {
          return false;
        }
      }

      if (!normalizedSearch) {
        return true;
      }

      const haystack = [
        template.name,
        template.description,
        template.stack,
        template.categories.join(" "),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }

  async getTemplateById(templateId: string): Promise<WorkflowTemplate | null> {
    const templates = await this.getTemplates();
    return templates.find((template) => template.id === templateId) ?? null;
  }

  private async getTemplates(): Promise<WorkflowTemplate[]> {
    if (this.cache && Date.now() - this.cache.loadedAt < this.cacheTtlMs) {
      return this.cache.templates;
    }

    const templatesRoot = join(this.config.templates.repoPath, this.config.templates.workflowDir);
    const rootExists = await this.pathExists(templatesRoot);
    if (!rootExists) {
      throw new ServiceUnavailableException(
        `Template source folder is not available: ${templatesRoot}`,
      );
    }

    const entries = await readdir(templatesRoot, { withFileTypes: true });
    const propertyFiles = entries.filter(
      (entry) => entry.isFile() && entry.name.endsWith(".properties.json"),
    );

    const loaded = await Promise.all(
      propertyFiles.map(async (entry) => {
        const id = entry.name.replace(".properties.json", "");
        const propertiesPath = join(templatesRoot, entry.name);
        const workflowPath = join(templatesRoot, `${id}.yml`);

        if (!(await this.pathExists(workflowPath))) {
          return null;
        }

        try {
          const raw = await readFile(propertiesPath, "utf8");
          const parsed = JSON.parse(raw) as WorkflowPropertiesFile;

          const categories = Array.isArray(parsed.categories)
            ? parsed.categories.filter((value): value is string => typeof value === "string")
            : [];

          const filePatterns = Array.isArray(parsed.filePatterns)
            ? parsed.filePatterns.filter((value): value is string => typeof value === "string")
            : [];

          return {
            id,
            name: parsed.name ?? id,
            description: parsed.description ?? "",
            iconName: parsed.iconName ?? "octicon package",
            categories,
            filePatterns,
            stack: this.inferStack(id, categories),
            propertiesPath,
            workflowPath,
          } satisfies WorkflowTemplate;
        } catch {
          return null;
        }
      }),
    );

    const templates = loaded
      .filter((template): template is WorkflowTemplate => template !== null)
      .sort((left, right) => left.name.localeCompare(right.name));

    this.cache = {
      loadedAt: Date.now(),
      templates,
    };

    return templates;
  }

  private inferStack(
    templateId: string,
    categories: string[],
  ): "nextjs" | "react" | "react-native" | "expo" | "nestjs" | "nodejs" {
    const normalizedId = templateId.toLowerCase();
    const normalizedCategories = categories.map((category) => category.toLowerCase());

    if (normalizedId.includes("react-native") || normalizedCategories.includes("react native")) {
      return "react-native";
    }

    if (normalizedId.includes("nextjs") || normalizedCategories.includes("next.js")) {
      return "nextjs";
    }

    if (normalizedId.includes("nestjs")) {
      return "nestjs";
    }

    if (normalizedId.includes("nodejs") || normalizedCategories.includes("node.js")) {
      return "nodejs";
    }

    if (normalizedId.includes("expo")) {
      return "expo";
    }

    return "react";
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }
}
