import { access, readdir, readFile } from 'node:fs/promises';
import { join, isAbsolute, resolve } from 'node:path';

import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/app.config';
import type { ListCatalogQueryDto } from './dto/list-catalog-query.dto';

// ─── Project Options types ────────────────────────────────────────────────────

export interface RepoShapeOption {
  id: string;
  label: string;
  enabled: boolean;
  description?: string;
}

export interface ProjectOptionSet {
  lint?: boolean;
  unit?: boolean;
  build?: boolean;
  coverage?: boolean;
  security?: boolean;
  docker?: boolean;
  e2e?: boolean;
}

export interface ProjectTypeOption {
  id: string;
  label: string;
  runtime?: string;
  language: string;
  framework: string;
  starterPath?: string;
  repoShapes: string[];
  reservedRepoShapes?: string[];
  defaultRecipe: string;
  allowedRecipes: string[];
  defaultOptions: ProjectOptionSet;
}

export interface WorkflowRecipeOption {
  id: string;
  label: string;
  description?: string;
  supportedProjectTypes: string[];
  templateByProjectType: Record<string, string>;
  mandatoryJobs?: string[];
  supportedOptions: ProjectOptionSet;
  optionJobs: Partial<Record<'lint' | 'unit' | 'build' | 'coverage' | 'security' | 'docker' | 'e2e', string>>;
}

export interface ProjectOptionsResult {
  repoShapes: RepoShapeOption[];
  projectTypes: ProjectTypeOption[];
  recipes: WorkflowRecipeOption[];
}

// ─── Static fallback catalog ─────────────────────────────────────────────────

const STATIC_PROJECT_OPTIONS: ProjectOptionsResult = {
  repoShapes: [
    { id: 'mono', label: 'Monorepo', enabled: true, description: 'Single repo, multiple apps/packages' },
    { id: 'multi', label: 'Multi-repo', enabled: true, description: 'Separate repo per service' },
    { id: 'standalone', label: 'Standalone', enabled: true, description: 'Single app, single repo' },
  ],
  projectTypes: [
    {
      id: 'nextjs',
      label: 'Next.js',
      runtime: 'node',
      language: 'TypeScript',
      framework: 'Next.js',
      repoShapes: ['standalone', 'mono'],
      defaultRecipe: 'standard',
      allowedRecipes: ['standard', 'minimal'],
      defaultOptions: { lint: true, unit: true, build: true, coverage: true },
    },
    {
      id: 'react',
      label: 'React',
      runtime: 'node',
      language: 'TypeScript',
      framework: 'React',
      repoShapes: ['standalone', 'mono'],
      defaultRecipe: 'standard',
      allowedRecipes: ['standard', 'minimal'],
      defaultOptions: { lint: true, unit: true, build: true, coverage: true },
    },
    {
      id: 'nestjs',
      label: 'NestJS',
      runtime: 'node',
      language: 'TypeScript',
      framework: 'NestJS',
      repoShapes: ['standalone', 'multi'],
      defaultRecipe: 'standard',
      allowedRecipes: ['standard', 'minimal'],
      defaultOptions: { lint: true, unit: true, build: true, coverage: true },
    },
    {
      id: 'nodejs',
      label: 'Node.js',
      runtime: 'node',
      language: 'TypeScript',
      framework: 'Express/Fastify',
      repoShapes: ['standalone', 'multi'],
      defaultRecipe: 'standard',
      allowedRecipes: ['standard', 'minimal'],
      defaultOptions: { lint: true, unit: true, build: true },
    },
    {
      id: 'react-native',
      label: 'React Native',
      runtime: 'node',
      language: 'TypeScript',
      framework: 'React Native',
      repoShapes: ['standalone'],
      defaultRecipe: 'mobile',
      allowedRecipes: ['mobile', 'minimal'],
      defaultOptions: { lint: true, unit: true, build: true },
    },
    {
      id: 'expo',
      label: 'Expo',
      runtime: 'node',
      language: 'TypeScript',
      framework: 'Expo',
      repoShapes: ['standalone'],
      defaultRecipe: 'mobile',
      allowedRecipes: ['mobile', 'minimal'],
      defaultOptions: { lint: true, unit: true, build: true },
    },
  ],
  recipes: [
    {
      id: 'standard',
      label: 'Standard',
      description: 'Full CI pipeline: lint, test, build, coverage, security scan',
      supportedProjectTypes: ['nextjs', 'react', 'nestjs', 'nodejs'],
      templateByProjectType: {
        nextjs: 'nextjs-standard',
        react: 'react-standard',
        nestjs: 'nestjs-standard',
        nodejs: 'nodejs-standard',
      },
      mandatoryJobs: ['lint', 'build'],
      supportedOptions: { lint: true, unit: true, build: true, coverage: true, security: true, docker: true, e2e: true },
      optionJobs: {
        lint: 'lint',
        unit: 'test',
        coverage: 'coverage',
        security: 'security-scan',
        docker: 'docker-build',
        e2e: 'e2e',
      },
    },
    {
      id: 'minimal',
      label: 'Minimal',
      description: 'Lightweight CI: lint and build only',
      supportedProjectTypes: ['nextjs', 'react', 'nestjs', 'nodejs', 'react-native', 'expo'],
      templateByProjectType: {
        nextjs: 'nextjs-minimal',
        react: 'react-minimal',
        nestjs: 'nestjs-minimal',
        nodejs: 'nodejs-minimal',
        'react-native': 'react-native-minimal',
        expo: 'expo-minimal',
      },
      mandatoryJobs: ['lint', 'build'],
      supportedOptions: { lint: true, unit: true, build: true },
      optionJobs: { lint: 'lint', unit: 'test' },
    },
    {
      id: 'mobile',
      label: 'Mobile',
      description: 'Mobile-optimised CI: lint, test, and app build',
      supportedProjectTypes: ['react-native', 'expo'],
      templateByProjectType: {
        'react-native': 'react-native-standard',
        expo: 'expo-standard',
      },
      mandatoryJobs: ['lint', 'build'],
      supportedOptions: { lint: true, unit: true, build: true, coverage: true },
      optionJobs: { lint: 'lint', unit: 'test', coverage: 'coverage' },
    },
  ],
};

// ─── Template types ───────────────────────────────────────────────────────────

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  iconName: string;
  categories: string[];
  filePatterns: string[];
  stack: 'nextjs' | 'react' | 'react-native' | 'expo' | 'nestjs' | 'nodejs';
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
  private readonly logger = new Logger(CatalogService.name);
  private readonly config: AppConfig;
  private cache: { loadedAt: number; templates: WorkflowTemplate[] } | null =
    null;
  private readonly cacheTtlMs = 20_000;

  constructor(private readonly configService: ConfigService) {
    this.config = this.configService.getOrThrow<AppConfig>('app');
  }

  /** Returns the static project-options catalog (repo shapes, project types, recipes). */
  getProjectOptions(): ProjectOptionsResult {
    return STATIC_PROJECT_OPTIONS;
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
      .sort(
        (left, right) =>
          right.count - left.count || left.name.localeCompare(right.name),
      );
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
        const hasCategory = template.categories.some(
          (category) => category.toLowerCase() === normalizedCategory,
        );
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
        template.categories.join(' '),
      ]
        .join(' ')
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

    // Resolve the repo path relative to this source file when a relative path
    // is configured. Using __dirname (dist/modules/catalog) keeps the anchor
    // stable regardless of the process working directory — critical in Docker
    // where cwd is /app, not the project root. In production, set an absolute
    // TEMPLATE_REPO_PATH in your environment or Dockerfile to be explicit.
    const configuredPath = this.config.templates.repoPath;
    const anchoredRepoPath = isAbsolute(configuredPath)
      ? configuredPath
      : resolve(__dirname, configuredPath);

    const templatesRoot = join(
      anchoredRepoPath,
      this.config.templates.workflowDir,
    );
    const rootExists = await this.pathExists(templatesRoot);
    if (!rootExists) {
      throw new ServiceUnavailableException(
        `Template source folder is not available: ${templatesRoot}`,
      );
    }

    const entries = await readdir(templatesRoot, { withFileTypes: true });
    const propertyFiles = entries.filter(
      (entry) => entry.isFile() && entry.name.endsWith('.properties.json'),
    );

    const loaded = await Promise.all(
      propertyFiles.map(async (entry) => {
        const id = entry.name.replace('.properties.json', '');
        const propertiesPath = join(templatesRoot, entry.name);
        const workflowPath = join(templatesRoot, `${id}.yml`);

        if (!(await this.pathExists(workflowPath))) {
          return null;
        }

        try {
          const raw = await readFile(propertiesPath, 'utf8');
          const parsed = JSON.parse(raw) as WorkflowPropertiesFile;

          const categories = Array.isArray(parsed.categories)
            ? parsed.categories.filter(
                (value): value is string => typeof value === 'string',
              )
            : [];

          const filePatterns = Array.isArray(parsed.filePatterns)
            ? parsed.filePatterns.filter(
                (value): value is string => typeof value === 'string',
              )
            : [];

          return {
            id,
            name: parsed.name ?? id,
            description: parsed.description ?? '',
            iconName: parsed.iconName ?? 'octicon package',
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
  ): 'nextjs' | 'react' | 'react-native' | 'expo' | 'nestjs' | 'nodejs' {
    const normalizedId = templateId.toLowerCase();
    const normalizedCategories = categories.map((category) =>
      category.toLowerCase(),
    );

    if (
      normalizedId.includes('react-native') ||
      normalizedCategories.includes('react native')
    ) {
      return 'react-native';
    }

    if (
      normalizedId.includes('nextjs') ||
      normalizedCategories.includes('next.js')
    ) {
      return 'nextjs';
    }

    if (normalizedId.includes('nestjs')) {
      return 'nestjs';
    }

    if (
      normalizedId.includes('nodejs') ||
      normalizedCategories.includes('node.js')
    ) {
      return 'nodejs';
    }

    if (normalizedId.includes('expo')) {
      return 'expo';
    }

    return 'react';
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
