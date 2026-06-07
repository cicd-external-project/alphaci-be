// ─── Scaffold builder ─────────────────────────────────────────────────────────
//
// Generates a default project scaffold — an array of { path, content } tuples
// ready to be pushed to a freshly-created GitHub repository. The scaffold gives
// developers a working starting point that is compatible with the FlowCI CI/CD
// workflows (TypeScript, ESLint, Jest with coverage, SonarQube reporting).

export interface ScaffoldFile {
  path: string;
  content: string;
}

export interface BuildScaffoldOptions {
  serviceName: string;
  /** 'nestjs' | 'nodejs' | 'nextjs' | 'react' */
  stack: string;
  includeDocker: boolean;
  nodeVersion?: string;
}

// Convert a human-readable service name to a valid npm package name (kebab-case).
function toPackageName(name: string): string {
  return name
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '') || 'service';
}

// ─── Shared files (all stacks) ────────────────────────────────────────────────

function buildGitignore(): string {
  return [
    'node_modules/',
    'dist/',
    'build/',
    '.env',
    '.env.local',
    '.env.*.local',
    'coverage/',
    '*.log',
    'npm-debug.log*',
    '.DS_Store',
    '.turbo/',
    '.next/',
    'out/',
  ].join('\n');
}

function buildPackageJson(packageName: string, stack: string): string {
  const isNextJs = stack === 'nextjs';
  const isNestJs = stack === 'nestjs';

  let scripts: Record<string, string>;
  if (isNextJs) {
    scripts = {
      build: 'next build',
      start: 'next start',
      dev: 'next dev',
      test: 'jest',
      lint: 'eslint . --ext .ts,.tsx',
    };
  } else if (isNestJs) {
    scripts = {
      build: 'tsc -p tsconfig.json',
      start: 'node dist/main.js',
      dev: 'ts-node src/main.ts',
      test: 'jest',
      lint: 'eslint . --ext .ts',
    };
  } else {
    scripts = {
      build: 'tsc -p tsconfig.json',
      start: 'node dist/index.js',
      dev: 'ts-node src/index.ts',
      test: 'jest',
      lint: 'eslint . --ext .ts',
    };
  }

  const pkg = {
    name: packageName,
    version: '0.1.0',
    scripts,
    dependencies: {} as Record<string, string>,
    devDependencies: {
      typescript: '*',
      eslint: '*',
      jest: '*',
      'ts-jest': '*',
      '@types/jest': '*',
      '@types/node': '*',
      '@typescript-eslint/parser': '*',
      '@typescript-eslint/eslint-plugin': '*',
    } as Record<string, string>,
  };

  if (isNestJs) {
    pkg.dependencies['@nestjs/common'] = '*';
    pkg.dependencies['@nestjs/core'] = '*';
    pkg.dependencies['@nestjs/platform-express'] = '*';
    pkg.devDependencies['@nestjs/testing'] = '*';
  }

  if (isNextJs) {
    pkg.dependencies['next'] = '*';
    pkg.dependencies['react'] = '*';
    pkg.dependencies['react-dom'] = '*';
    pkg.devDependencies['@types/react'] = '*';
    pkg.devDependencies['@types/react-dom'] = '*';
  }

  return JSON.stringify(pkg, null, 2);
}

function buildTsConfig(stack: string): string {
  const isNextJs = stack === 'nextjs';
  const isReact = stack === 'react';
  const isFrontend = isNextJs || isReact;

  const config = {
    compilerOptions: {
      target: 'ES2022',
      module: isFrontend ? 'ESNext' : 'NodeNext',
      moduleResolution: isFrontend ? 'bundler' : 'NodeNext',
      strict: true,
      outDir: 'dist',
      rootDir: 'src',
      ...(isFrontend ? { jsx: 'react-jsx' } : {}),
      lib: isFrontend ? ['ES2022', 'DOM'] : ['ES2022'],
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
    },
    include: ['src'],
    exclude: ['node_modules', 'dist'],
  };

  return JSON.stringify(config, null, 2);
}

function buildJestConfig(): string {
  return [
    "import type { Config } from 'jest';",
    '',
    'const config: Config = {',
    "  preset: 'ts-jest',",
    "  testEnvironment: 'node',",
    "  testMatch: ['**/*.spec.ts', '**/*.test.ts'],",
    '};',
    '',
    'export default config;',
  ].join('\n');
}

function buildSonarProperties(serviceName: string): string {
  return [
    `sonar.projectKey=${serviceName}`,
    `sonar.projectName=${serviceName}`,
    'sonar.sources=src',
    'sonar.tests=src',
    'sonar.test.inclusions=**/*.spec.ts,**/*.test.ts',
    'sonar.typescript.lcov.reportPaths=coverage/lcov.info',
    'sonar.coverage.exclusions=**/*.spec.ts,**/*.test.ts',
  ].join('\n');
}

function buildEntryPoint(serviceName: string): string {
  return [
    `export const SERVICE_NAME = '${serviceName}';`,
  ].join('\n');
}

function buildEntrySpec(serviceName: string): string {
  return [
    "import { SERVICE_NAME } from './index';",
    '',
    `describe('${serviceName}', () => {`,
    "  it('should export SERVICE_NAME', () => {",
    `    expect(SERVICE_NAME).toBe('${serviceName}');`,
    '  });',
    '});',
  ].join('\n');
}

function buildEslintConfig(): string {
  return JSON.stringify(
    {
      root: true,
      parser: '@typescript-eslint/parser',
      plugins: ['@typescript-eslint'],
      extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
      rules: {},
    },
    null,
    2,
  );
}

function buildEnvExample(): string {
  return ['NODE_ENV=development', 'PORT=3000'].join('\n');
}

// ─── NestJS-specific files ────────────────────────────────────────────────────

function buildNestAppModule(): string {
  return [
    "import { Module } from '@nestjs/common';",
    '',
    '@Module({ imports: [], controllers: [], providers: [] })',
    'export class AppModule {}',
  ].join('\n');
}

function buildNestMain(): string {
  return [
    "import { NestFactory } from '@nestjs/core';",
    "import { AppModule } from './app.module.js';",
    '',
    'async function bootstrap(): Promise<void> {',
    '  const app = await NestFactory.create(AppModule);',
    '  await app.listen(process.env.PORT ?? 3000);',
    '}',
    '',
    'void bootstrap();',
  ].join('\n');
}

// ─── Next.js-specific files ───────────────────────────────────────────────────

function buildNextPage(serviceName: string): string {
  return [
    'export default function Home(): React.JSX.Element {',
    `  return <main><h1>${serviceName}</h1></main>;`,
    '}',
  ].join('\n');
}

function buildNextConfig(): string {
  return [
    "import type { NextConfig } from 'next';",
    '',
    'const config: NextConfig = {};',
    'export default config;',
  ].join('\n');
}

// ─── Docker files ─────────────────────────────────────────────────────────────

function buildDockerfile(nodeVersion: string): string {
  return [
    `FROM node:${nodeVersion}-alpine AS builder`,
    'WORKDIR /app',
    'COPY package*.json ./',
    'RUN npm ci',
    'COPY . .',
    'RUN npm run build',
    '',
    `FROM node:${nodeVersion}-alpine AS runner`,
    'WORKDIR /app',
    'ENV NODE_ENV=production',
    'COPY --from=builder /app/dist ./dist',
    'COPY --from=builder /app/package*.json ./',
    'RUN npm ci --omit=dev',
    'EXPOSE 3000',
    'CMD ["node", "dist/main.js"]',
  ].join('\n');
}

function buildDockerignore(): string {
  return ['node_modules', 'dist', '.env', 'coverage'].join('\n');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a default project scaffold for the given stack.
 *
 * Returns an ordered array of { path, content } objects that can be pushed to
 * a GitHub repository one by one using the Contents API.
 *
 * The scaffold is intentionally minimal — it compiles, passes a placeholder
 * test, and lints clean. It is a starting point, not a complete application.
 */
export function buildProjectScaffold(
  options: BuildScaffoldOptions,
): ScaffoldFile[] {
  const { serviceName, stack, includeDocker, nodeVersion = '22' } = options;
  const packageName = toPackageName(serviceName);

  // ── Shared files (all stacks) ─────────────────────────────────────────────

  const sharedFiles: ScaffoldFile[] = [
    { path: '.gitignore',               content: buildGitignore() },
    { path: 'package.json',             content: buildPackageJson(packageName, stack) },
    { path: 'tsconfig.json',            content: buildTsConfig(stack) },
    { path: 'jest.config.ts',           content: buildJestConfig() },
    { path: 'sonar-project.properties', content: buildSonarProperties(serviceName) },
    { path: '.eslintrc.json',           content: buildEslintConfig() },
    { path: '.env.example',             content: buildEnvExample() },
    { path: 'src/index.ts',            content: buildEntryPoint(serviceName) },
    { path: 'src/index.spec.ts',       content: buildEntrySpec(serviceName) },
  ];

  // ── Stack-specific files ──────────────────────────────────────────────────

  let stackFiles: ScaffoldFile[];
  if (stack === 'nestjs') {
    stackFiles = [
      { path: 'src/app.module.ts', content: buildNestAppModule() },
      { path: 'src/main.ts',       content: buildNestMain() },
    ];
  } else if (stack === 'nextjs') {
    stackFiles = [
      { path: 'src/app/page.tsx', content: buildNextPage(serviceName) },
      { path: 'next.config.ts',   content: buildNextConfig() },
    ];
  } else {
    stackFiles = [];
  }

  // ── Docker files ──────────────────────────────────────────────────────────

  const dockerFiles: ScaffoldFile[] = includeDocker
    ? [
        { path: 'Dockerfile',    content: buildDockerfile(nodeVersion) },
        { path: '.dockerignore', content: buildDockerignore() },
      ]
    : [];

  return [...sharedFiles, ...stackFiles, ...dockerFiles];
}

/**
 * Determine whether Docker files should be included in the scaffold based on
 * the project stack. Backend stacks include Docker by default; frontend stacks
 * do not, since they typically deploy to CDN/edge runtimes rather than
 * container registries.
 */
export function defaultIncludeDocker(stack: string): boolean {
  return stack === 'nestjs' || stack === 'nodejs';
}
