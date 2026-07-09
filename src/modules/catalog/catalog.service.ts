import { existsSync, readFileSync } from 'node:fs';
import { access, readdir, readFile } from 'node:fs/promises';
import { join, isAbsolute, resolve } from 'node:path';

import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
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
  kind?: 'frontend' | 'backend';
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
  workflowRefByProjectType?: Record<string, string>;
  mandatoryJobs?: string[];
  supportedOptions: ProjectOptionSet;
  optionJobs: Partial<
    Record<
      'lint' | 'unit' | 'build' | 'coverage' | 'security' | 'docker' | 'e2e',
      string
    >
  >;
}

export interface NodeVersionOption {
  value: string;
  label: string;
}

export interface StarterKitOption {
  id: string;
  label: string;
  description: string;
  repo: string;
  projectType: string;
  repoShape: string;
  language: string;
  framework: string;
  defaultWorkingDirectory: string;
  workflowTiming: 'after-template';
  containsWorkflows: boolean;
  defaultRecipesByPlan: Record<'solo' | 'plus' | 'pro', string>;
}

export interface ProjectOptionsResult {
  repoShapes: RepoShapeOption[];
  projectTypes: ProjectTypeOption[];
  recipes: WorkflowRecipeOption[];
  nodeVersions: NodeVersionOption[];
  starterKits: StarterKitOption[];
}

// ─── Static fallback catalog ─────────────────────────────────────────────────

// Order matters: the FE preselects the first enabled shape, so the simplest
// option (standalone) must come first. 'mono' is parked as disabled until the
// monorepo scaffold produces a real multi-package workspace with per-package
// pipelines — today it would mislead users into a generic TS workspace.
const STATIC_PROJECT_OPTIONS: ProjectOptionsResult = {
  repoShapes: [
    {
      id: 'standalone',
      label: 'Single application',
      enabled: true,
      description:
        'One repository with one app. The simplest way to start — best for most projects.',
    },
    {
      id: 'microservices',
      label: 'Backend + frontend (one repo)',
      enabled: true,
      description:
        'One repository with backend/ and frontend/ folders. Each service gets its own CI pipeline.',
    },
    {
      id: 'multi',
      label: 'Backend + frontend (two repos)',
      enabled: true,
      description:
        'Creates two repositories — one for your backend API, one for your frontend app — each with its own CI/CD pipeline.',
    },
    {
      id: 'mono',
      label: 'Monorepo (workspaces)',
      enabled: false,
      description: 'Multiple packages in one repository. Coming soon.',
    },
  ],
  projectTypes: [
    {
      id: 'nextjs',
      label: 'Next.js',
      runtime: 'node',
      language: 'TypeScript',
      framework: 'Next.js',
      starterPath: 'starters/nextjs',
      repoShapes: ['standalone', 'mono', 'multi', 'microservices'],
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
      starterPath: 'starters/react',
      repoShapes: ['standalone', 'mono', 'multi', 'microservices'],
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
      starterPath: 'starters/nestjs',
      repoShapes: ['standalone', 'multi', 'microservices'],
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
      starterPath: 'starters/nodejs',
      repoShapes: ['standalone', 'multi', 'microservices'],
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
      starterPath: 'starters/react-native',
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
      starterPath: 'starters/expo',
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
      description:
        'Full CI pipeline: lint, test, build, coverage, security scan',
      supportedProjectTypes: ['nextjs', 'react', 'nestjs', 'nodejs'],
      templateByProjectType: {
        nextjs: 'nextjs-service-pipeline',
        react: 'react-service-pipeline',
        nestjs: 'nest-service-pipeline',
        nodejs: 'nodejs-service-pipeline',
      },
      mandatoryJobs: ['lint', 'build'],
      supportedOptions: {
        lint: true,
        unit: true,
        build: true,
        coverage: true,
        security: true,
        docker: true,
        e2e: true,
      },
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
      supportedProjectTypes: [
        'nextjs',
        'react',
        'nestjs',
        'nodejs',
        'react-native',
        'expo',
      ],
      templateByProjectType: {
        nextjs: 'nextjs-service-pipeline',
        react: 'react-service-pipeline',
        nestjs: 'nest-service-pipeline',
        nodejs: 'nodejs-service-pipeline',
        'react-native': 'react-native-service-pipeline',
        expo: 'expo-service-pipeline',
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
        'react-native': 'react-native-service-pipeline',
        expo: 'expo-service-pipeline',
      },
      mandatoryJobs: ['lint', 'build'],
      supportedOptions: { lint: true, unit: true, build: true, coverage: true },
      optionJobs: { lint: 'lint', unit: 'test', coverage: 'coverage' },
    },
  ],
  nodeVersions: [
    { value: '20', label: 'Node 20 LTS (Iron)' },
    { value: '22', label: 'Node 22 LTS (Jod)' },
    { value: '24', label: 'Node 24 LTS (Noble)' },
  ],
  starterKits: [],
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

interface EngineStarterKitsFile {
  starterKits?: unknown[];
}

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);
  private readonly config: AppConfig;
  private cache: { loadedAt: number; templates: WorkflowTemplate[] } | null =
    null;
  private projectOptionsCache: ProjectOptionsResult | null = null;
  private readonly cacheTtlMs = 20_000;

  constructor(private readonly configService: ConfigService) {
    this.config = this.configService.getOrThrow<AppConfig>('app');
  }

  getProjectOptions(): ProjectOptionsResult {
    if (this.projectOptionsCache) {
      return this.projectOptionsCache;
    }

    try {
      const options = this.loadEngineProjectOptions();
      this.projectOptionsCache = options;
      return options;
    } catch (error) {
      this.logger.warn(
        `Could not load engine project catalog; using static fallback: ${(error as Error).message}`,
      );
      return STATIC_PROJECT_OPTIONS;
    }
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

  getResolvedStarterPath(projectTypeId: string): string | null {
    const option = STATIC_PROJECT_OPTIONS.projectTypes.find(
      (pt) => pt.id === projectTypeId,
    );
    if (!option?.starterPath) return null;

    return join(this.resolveTemplateRepoPath(), option.starterPath);
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
    const anchoredRepoPath = this.resolveTemplateRepoPath();

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

  private loadEngineProjectOptions(): ProjectOptionsResult {
    const catalogRoot = join(this.resolveTemplateRepoPath(), 'catalog');
    const projectTypesCatalog = this.readCatalogJson<{
      repoShapes?: unknown[];
      projectTypes?: unknown[];
      nodeVersions?: unknown[];
    }>(catalogRoot, 'project-types.json');
    const workflowRecipesCatalog = this.readCatalogJson<{ recipes?: unknown[] }>(
      catalogRoot,
      'workflow-recipes.json',
    );
    const starterKitCatalog = this.readCatalogJson<EngineStarterKitsFile>(
      catalogRoot,
      'starter-kits.json',
    );

    const repoShapes = (projectTypesCatalog.repoShapes ?? []).filter(
      (shape): shape is RepoShapeOption => this.isRepoShapeOption(shape),
    );
    if (repoShapes.length === 0) {
      throw new Error('project-types.json did not contain usable repo shapes');
    }

    const repoShapeIds = new Set(repoShapes.map((shape) => shape.id));
    const recipes = (workflowRecipesCatalog.recipes ?? [])
      .map((recipe) => this.toWorkflowRecipeOption(recipe))
      .filter((recipe): recipe is WorkflowRecipeOption => recipe !== null);
    if (recipes.length === 0) {
      throw new Error('workflow-recipes.json did not contain usable recipes');
    }

    const recipeIds = new Set(recipes.map((recipe) => recipe.id));
    const projectTypes = (projectTypesCatalog.projectTypes ?? [])
      .map((projectType) => this.toProjectTypeOption(projectType))
      .filter((projectType): projectType is ProjectTypeOption => {
        if (!projectType) {
          return false;
        }

        return (
          projectType.repoShapes.some((repoShape) => repoShapeIds.has(repoShape)) &&
          projectType.allowedRecipes.some((recipeId) => recipeIds.has(recipeId)) &&
          recipeIds.has(projectType.defaultRecipe)
        );
      });
    if (projectTypes.length === 0) {
      throw new Error('project-types.json did not contain usable project types');
    }

    const projectTypeIds = new Set(
      projectTypes.map((projectType) => projectType.id),
    );
    const consistentRecipes = recipes.filter((recipe) =>
      recipe.supportedProjectTypes.some((projectTypeId) =>
        projectTypeIds.has(projectTypeId),
      ),
    );

    const starterKits = (starterKitCatalog.starterKits ?? [])
      .filter((kit): kit is StarterKitOption => this.isStarterKitOption(kit))
      .map((kit) =>
        this.normalizeStarterKitOption(
          kit,
          projectTypes,
          repoShapes,
          consistentRecipes,
        ),
      )
      .filter((kit): kit is StarterKitOption => kit !== null);

    const nodeVersions = (projectTypesCatalog.nodeVersions ?? []).filter(
      (value): value is NodeVersionOption => this.isNodeVersionOption(value),
    );

    return {
      repoShapes,
      projectTypes,
      recipes: consistentRecipes,
      nodeVersions:
        nodeVersions.length > 0
          ? nodeVersions
          : STATIC_PROJECT_OPTIONS.nodeVersions,
      starterKits,
    };
  }

  private isRepoShapeOption(value: unknown): value is RepoShapeOption {
    return (
      this.isCatalogRecord(value) &&
      typeof value.id === 'string' &&
      typeof value.label === 'string' &&
      typeof value.enabled === 'boolean' &&
      (value.description === undefined || typeof value.description === 'string')
    );
  }

  private toProjectTypeOption(value: unknown): ProjectTypeOption | null {
    if (!this.isCatalogRecord(value)) {
      return null;
    }

    const repoShapes = this.stringArray(value.repoShapes);
    const reservedRepoShapes = this.stringArray(value.reservedRepoShapes);
    const allowedRecipes = this.stringArray(value.allowedRecipes);

    if (
      typeof value.id !== 'string' ||
      typeof value.label !== 'string' ||
      (value.kind !== undefined &&
        value.kind !== 'frontend' &&
        value.kind !== 'backend') ||
      (value.runtime !== undefined && typeof value.runtime !== 'string') ||
      typeof value.language !== 'string' ||
      typeof value.framework !== 'string' ||
      (value.starterPath !== undefined &&
        typeof value.starterPath !== 'string') ||
      repoShapes.length === 0 ||
      typeof value.defaultRecipe !== 'string' ||
      allowedRecipes.length === 0 ||
      !this.isProjectOptionSet(value.defaultOptions)
    ) {
      return null;
    }

    return {
      id: value.id,
      label: value.label,
      kind:
        value.kind === 'backend'
          ? 'backend'
          : value.kind === 'frontend'
            ? 'frontend'
            : undefined,
      runtime: typeof value.runtime === 'string' ? value.runtime : undefined,
      language: value.language,
      framework: value.framework,
      starterPath:
        typeof value.starterPath === 'string' ? value.starterPath : undefined,
      repoShapes,
      reservedRepoShapes:
        reservedRepoShapes.length > 0 ? reservedRepoShapes : undefined,
      defaultRecipe: value.defaultRecipe,
      allowedRecipes,
      defaultOptions: this.toProjectOptionSet(value.defaultOptions),
    };
  }

  private toWorkflowRecipeOption(value: unknown): WorkflowRecipeOption | null {
    if (!this.isCatalogRecord(value)) {
      return null;
    }

    const supportedProjectTypes = this.stringArray(value.supportedProjectTypes);
    const mandatoryJobs = this.stringArray(value.mandatoryJobs);

    if (
      typeof value.id !== 'string' ||
      typeof value.label !== 'string' ||
      (value.description !== undefined &&
        typeof value.description !== 'string') ||
      supportedProjectTypes.length === 0 ||
      !this.isStringRecord(value.templateByProjectType) ||
      !this.isProjectOptionSet(value.supportedOptions) ||
      !this.isStringRecord(value.optionJobs)
    ) {
      return null;
    }

    return {
      id: value.id,
      label: value.label,
      description:
        typeof value.description === 'string' ? value.description : undefined,
      supportedProjectTypes,
      templateByProjectType: value.templateByProjectType,
      mandatoryJobs: mandatoryJobs.length > 0 ? mandatoryJobs : undefined,
      supportedOptions: this.toProjectOptionSet(value.supportedOptions),
      optionJobs: this.toOptionJobs(value.optionJobs),
    };
  }

  private isNodeVersionOption(value: unknown): value is NodeVersionOption {
    return (
      this.isCatalogRecord(value) &&
      typeof value.value === 'string' &&
      value.value.length > 0 &&
      typeof value.label === 'string' &&
      value.label.length > 0
    );
  }

  private isStarterKitOption(value: unknown): value is StarterKitOption {
    if (!this.isCatalogRecord(value)) {
      return false;
    }

    const recipesByPlan = value.defaultRecipesByPlan;

    return (
      typeof value.id === 'string' &&
      typeof value.label === 'string' &&
      typeof value.description === 'string' &&
      typeof value.repo === 'string' &&
      typeof value.projectType === 'string' &&
      typeof value.repoShape === 'string' &&
      typeof value.language === 'string' &&
      typeof value.framework === 'string' &&
      typeof value.defaultWorkingDirectory === 'string' &&
      value.workflowTiming === 'after-template' &&
      value.containsWorkflows === false &&
      this.isCatalogRecord(recipesByPlan) &&
      typeof recipesByPlan.solo === 'string' &&
      typeof recipesByPlan.plus === 'string' &&
      typeof recipesByPlan.pro === 'string'
    );
  }

  private normalizeStarterKitOption(
    kit: StarterKitOption,
    projectTypes: ProjectTypeOption[],
    repoShapes: RepoShapeOption[],
    recipes: WorkflowRecipeOption[],
  ): StarterKitOption | null {
    const projectType =
      projectTypes.find((option) => option.id === kit.projectType) ??
      projectTypes.find(
        (option) =>
          option.id === this.normalizeStarterKitProjectType(kit.projectType),
      );
    if (!projectType) {
      return null;
    }

    const repoShape = repoShapes.some((option) => option.id === kit.repoShape)
      ? kit.repoShape
      : this.normalizeStarterKitRepoShape(kit.repoShape);
    if (
      !repoShapes.some((option) => option.id === repoShape) ||
      !projectType.repoShapes.includes(repoShape)
    ) {
      return null;
    }

    const validRecipeIds = new Set(
      recipes
        .filter(
          (recipe) =>
            projectType.allowedRecipes.includes(recipe.id) &&
            recipe.supportedProjectTypes.includes(projectType.id),
        )
        .map((recipe) => recipe.id),
    );
    const fallbackRecipe = validRecipeIds.has(projectType.defaultRecipe)
      ? projectType.defaultRecipe
      : Array.from(validRecipeIds)[0];

    if (!fallbackRecipe) {
      return null;
    }

    const normalizeRecipe = (recipeId: string) =>
      validRecipeIds.has(recipeId) ? recipeId : fallbackRecipe;

    return {
      ...kit,
      projectType: projectType.id,
      repoShape,
      defaultRecipesByPlan: {
        solo: normalizeRecipe(kit.defaultRecipesByPlan.solo),
        plus: normalizeRecipe(kit.defaultRecipesByPlan.plus),
        pro: normalizeRecipe(kit.defaultRecipesByPlan.pro),
      },
    };
  }

  private normalizeStarterKitProjectType(projectType: string): string {
    const aliases: Record<string, string> = {
      'react-spa': 'react',
    };

    return aliases[projectType] ?? projectType;
  }

  private normalizeStarterKitRepoShape(repoShape: string): string {
    const aliases: Record<string, string> = {
      'single-app': 'standalone',
    };

    return aliases[repoShape] ?? repoShape;
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private isProjectOptionSet(value: unknown): boolean {
    if (!this.isCatalogRecord(value)) {
      return false;
    }

    return ['lint', 'unit', 'build', 'coverage', 'security', 'docker', 'e2e'].every(
      (key) => value[key] === undefined || typeof value[key] === 'boolean',
    );
  }

  private toProjectOptionSet(value: unknown): ProjectOptionSet {
    const source = this.isCatalogRecord(value) ? value : {};
    const result: ProjectOptionSet = {};
    for (const key of [
      'lint',
      'unit',
      'build',
      'coverage',
      'security',
      'docker',
      'e2e',
    ] as const) {
      if (typeof source[key] === 'boolean') {
        result[key] = source[key];
      }
    }
    return result;
  }

  private isStringRecord(value: unknown): value is Record<string, string> {
    return (
      this.isCatalogRecord(value) &&
      Object.values(value).every((item) => typeof item === 'string')
    );
  }

  private toOptionJobs(
    value: Record<string, string>,
  ): WorkflowRecipeOption['optionJobs'] {
    const result: WorkflowRecipeOption['optionJobs'] = {};
    for (const key of [
      'lint',
      'unit',
      'build',
      'coverage',
      'security',
      'docker',
      'e2e',
    ] as const) {
      if (typeof value[key] === 'string') {
        result[key] = value[key];
      }
    }
    return result;
  }

  private isCatalogRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
  private readCatalogJson<T>(catalogRoot: string, fileName: string): T {
    const raw = readFileSync(join(catalogRoot, fileName), 'utf8');
    return JSON.parse(raw) as T;
  }

  private resolveTemplateRepoPath(): string {
    const configuredPath = this.config.templates.repoPath;
    if (isAbsolute(configuredPath)) {
      return configuredPath;
    }

    const cwdCandidate = resolve(process.cwd(), configuredPath);
    if (existsSync(cwdCandidate)) {
      return cwdCandidate;
    }

    return resolve(__dirname, configuredPath);
  }

  private templateIdForStack(
    stackKey: string,
    serviceWorkflow?: string,
  ): string {
    const workflowKeyMap: Record<string, string> = {
      nextjsService: 'nextjs-service-pipeline',
      nestjsService: 'nest-service-pipeline',
      nodeService: 'nodejs-service-pipeline',
      reactService: 'react-service-pipeline',
      reactNativeService: 'react-native-service-pipeline',
      expoService: 'expo-service-pipeline',
    };

    return serviceWorkflow
      ? (workflowKeyMap[serviceWorkflow] ?? `${stackKey}-service-pipeline`)
      : `${stackKey}-service-pipeline`;
  }

  private workflowRefForStack(
    serviceWorkflow: string | undefined,
    refs: EngineWorkflowRefsFile,
  ): string {
    if (!serviceWorkflow || !refs.repository || !refs.currentStable) {
      return '';
    }

    const workflowPath = refs.workflows?.[serviceWorkflow];
    if (!workflowPath) {
      return '';
    }

    return `${refs.repository}/${workflowPath}@${refs.currentStable}`;
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

    if (
      (normalizedId.includes('nest') &&
        !normalizedId.includes('react-native')) ||
      normalizedCategories.includes('nestjs')
    ) {
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
