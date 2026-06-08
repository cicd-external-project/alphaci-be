// ─── Scaffold builder ─────────────────────────────────────────────────────────
//
// Generates a default project scaffold — an array of { path, content } tuples
// ready to be pushed to a freshly-created GitHub repository. The scaffold gives
// developers a working starting point that is compatible with the FlowCI CI/CD
// workflows (TypeScript, ESLint, Jest with coverage, SonarQube reporting).
//
// Shape-aware: the scaffold structure varies by repoShape (standalone, monorepo,
// microservices, multi-repo) as well as the technology stack.

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
  /** 'standalone' | 'monorepo' | 'microservices' | 'multi-repo' — defaults to 'standalone' */
  repoShape?: string;
  // Microservices shape only: secondary (frontend) service info
  frontendStack?: string;
  frontendServiceName?: string;
  backendServiceName?: string;
}

// Convert a human-readable service name to a valid npm package name (kebab-case).
function toPackageName(name: string): string {
  return name
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '') || 'service';
}

// ─── Shared file builders (all stacks) ────────────────────────────────────────

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

// ─── Monorepo-specific helpers ────────────────────────────────────────────────

function buildMonorepoRootPackageJson(packageName: string): string {
  return JSON.stringify(
    {
      name: packageName,
      version: '0.1.0',
      private: true,
      workspaces: ['packages/*'],
      scripts: {
        build: 'tsc -b',
        test: 'jest --passWithNoTests',
        lint: 'eslint . --ext .ts',
      },
      devDependencies: {
        typescript: '*',
        eslint: '*',
        jest: '*',
        'ts-jest': '*',
        '@types/jest': '*',
        '@types/node': '*',
        '@typescript-eslint/parser': '*',
        '@typescript-eslint/eslint-plugin': '*',
      },
    },
    null,
    2,
  );
}

function buildMonorepoRootTsConfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        composite: true,
        declaration: true,
        declarationMap: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
      },
      references: [{ path: 'packages/core' }],
      include: [],
    },
    null,
    2,
  );
}

function buildMonorepoRootJestConfig(): string {
  return [
    "import type { Config } from 'jest';",
    '',
    'const config: Config = {',
    "  projects: ['<rootDir>/packages/*/jest.config.ts'],",
    '};',
    '',
    'export default config;',
  ].join('\n');
}

function buildMonorepoSonarProperties(serviceName: string): string {
  return [
    `sonar.projectKey=${serviceName}`,
    `sonar.projectName=${serviceName}`,
    'sonar.sources=packages',
    'sonar.tests=packages',
    'sonar.test.inclusions=**/*.spec.ts,**/*.test.ts',
    'sonar.typescript.lcov.reportPaths=packages/*/coverage/lcov.info',
    'sonar.coverage.exclusions=**/*.spec.ts,**/*.test.ts',
  ].join('\n');
}

function buildPackageTsConfig(): string {
  return JSON.stringify(
    {
      extends: '../../tsconfig.json',
      compilerOptions: {
        outDir: 'dist',
        rootDir: 'src',
      },
      include: ['src'],
      exclude: ['node_modules', 'dist'],
    },
    null,
    2,
  );
}

function buildPackagePackageJson(packageName: string, stack: string): string {
  const pkg = {
    name: packageName,
    version: '0.1.0',
    scripts: {
      build: 'tsc -p tsconfig.json',
      test: 'jest',
      lint: 'eslint . --ext .ts',
    },
    dependencies: {} as Record<string, string>,
    devDependencies: {
      typescript: '*',
      eslint: '*',
      jest: '*',
      'ts-jest': '*',
      '@types/jest': '*',
      '@types/node': '*',
    } as Record<string, string>,
  };

  if (stack === 'nestjs') {
    pkg.dependencies['@nestjs/common'] = '*';
    pkg.dependencies['@nestjs/core'] = '*';
    pkg.dependencies['@nestjs/platform-express'] = '*';
    pkg.devDependencies['@nestjs/testing'] = '*';
  }

  return JSON.stringify(pkg, null, 2);
}

// ─── Microservices-specific helpers ──────────────────────────────────────────

function buildDockerCompose(): string {
  return [
    'version: "3.9"',
    'services:',
    '  backend:',
    '    build: ./backend',
    '    ports:',
    '      - "3001:3000"',
    '    environment:',
    '      - NODE_ENV=development',
    '  frontend:',
    '    build: ./frontend',
    '    ports:',
    '      - "3000:3000"',
    '    environment:',
    '      - NODE_ENV=development',
    '    depends_on:',
    '      - backend',
  ].join('\n');
}

function buildMicroservicesSonarProperties(serviceName: string): string {
  return [
    `sonar.projectKey=${serviceName}`,
    `sonar.projectName=${serviceName}`,
    'sonar.sources=backend/src,frontend/src',
    'sonar.tests=backend/src,frontend/src',
    'sonar.test.inclusions=**/*.spec.ts,**/*.test.ts',
    'sonar.typescript.lcov.reportPaths=backend/coverage/lcov.info,frontend/coverage/lcov.info',
    'sonar.coverage.exclusions=**/*.spec.ts,**/*.test.ts',
  ].join('\n');
}

// Build scaffold files for a single service under a subdirectory prefix.
function buildServiceSubdirFiles(
  dir: string,
  serviceName: string,
  stack: string,
  nodeVersion: string,
): ScaffoldFile[] {
  const packageName = toPackageName(serviceName);

  const files: ScaffoldFile[] = [
    { path: `${dir}/package.json`,       content: buildPackageJson(packageName, stack) },
    { path: `${dir}/tsconfig.json`,      content: buildTsConfig(stack) },
    { path: `${dir}/jest.config.ts`,     content: buildJestConfig() },
    { path: `${dir}/.eslintrc.json`,     content: buildEslintConfig() },
    { path: `${dir}/.env.example`,       content: buildEnvExample() },
    { path: `${dir}/src/index.ts`,       content: buildEntryPoint(serviceName) },
    { path: `${dir}/src/index.spec.ts`,  content: buildEntrySpec(serviceName) },
  ];

  if (stack === 'nestjs') {
    files.push({ path: `${dir}/src/app.module.ts`, content: buildNestAppModule() });
    files.push({ path: `${dir}/src/main.ts`,       content: buildNestMain() });
    files.push({ path: `${dir}/Dockerfile`,        content: buildDockerfile(nodeVersion) });
    files.push({ path: `${dir}/.dockerignore`,     content: buildDockerignore() });
  } else if (stack === 'nodejs') {
    files.push({ path: `${dir}/Dockerfile`,        content: buildDockerfile(nodeVersion) });
    files.push({ path: `${dir}/.dockerignore`,     content: buildDockerignore() });
  } else if (stack === 'nextjs') {
    files.push({ path: `${dir}/src/app/page.tsx`,  content: buildNextPage(serviceName) });
    files.push({ path: `${dir}/next.config.ts`,    content: buildNextConfig() });
  }

  return files;
}

// ─── Shape-specific scaffold builders ─────────────────────────────────────────

function buildStandaloneScaffold(options: BuildScaffoldOptions): ScaffoldFile[] {
  const { serviceName, stack, includeDocker, nodeVersion = '22' } = options;
  const packageName = toPackageName(serviceName);

  const sharedFiles: ScaffoldFile[] = [
    { path: '.gitignore',               content: buildGitignore() },
    { path: 'package.json',             content: buildPackageJson(packageName, stack) },
    { path: 'tsconfig.json',            content: buildTsConfig(stack) },
    { path: 'jest.config.ts',           content: buildJestConfig() },
    { path: 'sonar-project.properties', content: buildSonarProperties(serviceName) },
    { path: '.eslintrc.json',           content: buildEslintConfig() },
    { path: '.env.example',             content: buildEnvExample() },
    { path: 'src/index.ts',             content: buildEntryPoint(serviceName) },
    { path: 'src/index.spec.ts',        content: buildEntrySpec(serviceName) },
  ];

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

  const dockerFiles: ScaffoldFile[] = includeDocker
    ? [
        { path: 'Dockerfile',    content: buildDockerfile(nodeVersion) },
        { path: '.dockerignore', content: buildDockerignore() },
      ]
    : [];

  return [...sharedFiles, ...stackFiles, ...dockerFiles];
}

function buildMonorepoScaffold(options: BuildScaffoldOptions): ScaffoldFile[] {
  const { serviceName, stack, nodeVersion = '22' } = options;
  const rootPackageName = toPackageName(serviceName);
  const corePackageName = `@${rootPackageName}/core`;

  return [
    // Root workspace files
    { path: '.gitignore',               content: buildGitignore() },
    { path: 'package.json',             content: buildMonorepoRootPackageJson(rootPackageName) },
    { path: 'tsconfig.json',            content: buildMonorepoRootTsConfig() },
    { path: 'jest.config.ts',           content: buildMonorepoRootJestConfig() },
    { path: 'sonar-project.properties', content: buildMonorepoSonarProperties(serviceName) },
    { path: '.eslintrc.json',           content: buildEslintConfig() },
    { path: '.env.example',             content: buildEnvExample() },
    // packages/core — rename or duplicate to add more packages
    { path: 'packages/core/package.json',      content: buildPackagePackageJson(corePackageName, stack) },
    { path: 'packages/core/tsconfig.json',     content: buildPackageTsConfig() },
    { path: 'packages/core/jest.config.ts',    content: buildJestConfig() },
    { path: 'packages/core/src/index.ts',      content: buildEntryPoint(serviceName) },
    { path: 'packages/core/src/index.spec.ts', content: buildEntrySpec(serviceName) },
  ];
}

function buildMicroservicesScaffold(options: BuildScaffoldOptions): ScaffoldFile[] {
  const {
    serviceName,
    stack: backendStack,
    nodeVersion = '22',
    frontendStack = 'nextjs',
    frontendServiceName,
    backendServiceName,
  } = options;

  const beName = backendServiceName ?? serviceName;
  const feName = frontendServiceName ?? `${serviceName}-fe`;

  const rootFiles: ScaffoldFile[] = [
    { path: '.gitignore',               content: buildGitignore() },
    { path: 'sonar-project.properties', content: buildMicroservicesSonarProperties(serviceName) },
  ];

  if (defaultIncludeDocker(backendStack)) {
    rootFiles.push({ path: 'docker-compose.yml', content: buildDockerCompose() });
  }

  return [
    ...rootFiles,
    ...buildServiceSubdirFiles('backend', beName, backendStack, nodeVersion),
    ...buildServiceSubdirFiles('frontend', feName, frontendStack, nodeVersion),
  ];
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a default project scaffold for the given shape and stack.
 *
 * Returns an ordered array of { path, content } objects that can be pushed to
 * a GitHub repository one by one using the Contents API.
 *
 * - standalone / multi-repo: flat structure, stack-specific files at root
 * - monorepo: workspace root + packages/core with TypeScript project references
 * - microservices: backend/ and frontend/ subdirectories, optional docker-compose
 */
export function buildProjectScaffold(options: BuildScaffoldOptions): ScaffoldFile[] {
  switch (options.repoShape) {
    case 'monorepo':      return buildMonorepoScaffold(options);
    case 'microservices': return buildMicroservicesScaffold(options);
    default:              return buildStandaloneScaffold(options);
  }
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
