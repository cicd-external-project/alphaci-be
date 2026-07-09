import {
  buildProjectScaffold,
  defaultIncludeDocker,
  normalizeRepoShape,
} from './scaffold.builder';

describe('normalizeRepoShape', () => {
  it('maps catalog IDs to canonical shapes', () => {
    expect(normalizeRepoShape('mono')).toBe('monorepo');
    expect(normalizeRepoShape('multi')).toBe('multi-repo');
  });

  it('passes canonical shapes through unchanged', () => {
    expect(normalizeRepoShape('monorepo')).toBe('monorepo');
    expect(normalizeRepoShape('multi-repo')).toBe('multi-repo');
    expect(normalizeRepoShape('microservices')).toBe('microservices');
    expect(normalizeRepoShape('standalone')).toBe('standalone');
  });

  it("maps the current catalog single-app shape to standalone", () => {
    expect(normalizeRepoShape('single-app')).toBe(
      normalizeRepoShape('standalone'),
    );
  });

  it('falls back to standalone for unknown or missing shapes', () => {
    expect(normalizeRepoShape(undefined)).toBe('standalone');
    expect(normalizeRepoShape(null)).toBe('standalone');
    expect(normalizeRepoShape('something-else')).toBe('standalone');
  });
});

describe('buildProjectScaffold', () => {
  const baseOptions = {
    serviceName: 'orders-api',
    stack: 'nestjs',
    includeDocker: false,
  };

  const packageJson = (files: ReturnType<typeof buildProjectScaffold>) =>
    JSON.parse(files.find((file) => file.path === 'package.json')!.content) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

  it("renders the monorepo workspace scaffold for the catalog ID 'mono'", () => {
    const files = buildProjectScaffold({ ...baseOptions, repoShape: 'mono' });
    const paths = files.map((file) => file.path);

    expect(paths).toContain('packages/core/package.json');
    expect(paths).toContain('packages/core/src/index.ts');

    const rootPackage = JSON.parse(
      files.find((file) => file.path === 'package.json')!.content,
    ) as { workspaces?: string[] };
    expect(rootPackage.workspaces).toEqual(['packages/*']);
  });

  it("renders a flat standalone scaffold for the catalog ID 'multi' (one repo per service)", () => {
    const files = buildProjectScaffold({ ...baseOptions, repoShape: 'multi' });
    const paths = files.map((file) => file.path);

    expect(paths).toContain('src/index.ts');
    expect(paths.some((path) => path.startsWith('packages/'))).toBe(false);
    expect(paths.some((path) => path.startsWith('backend/'))).toBe(false);
  });

  it('renders backend/ and frontend/ subdirectories for microservices', () => {
    const files = buildProjectScaffold({
      ...baseOptions,
      repoShape: 'microservices',
      frontendStack: 'nextjs',
      frontendServiceName: 'orders-web',
    });
    const paths = files.map((file) => file.path);

    expect(paths).toContain('backend/package.json');
    expect(paths).toContain('frontend/package.json');
    expect(paths).toContain('frontend/src/app/page.tsx');
  });

  it('maps the current Next.js catalog ID to the Next.js scaffold', () => {
    const files = buildProjectScaffold({
      ...baseOptions,
      stack: 'nextjs-app',
    });
    const paths = files.map((file) => file.path);
    const pkg = packageJson(files);

    expect(paths).toContain('next.config.ts');
    expect(paths).toContain('src/app/page.tsx');
    expect(pkg.dependencies?.next).toBeDefined();
    expect(pkg.scripts?.build).toBe('next build');
  });

  it('maps the current React SPA catalog ID to the React scaffold', () => {
    const files = buildProjectScaffold({
      ...baseOptions,
      stack: 'react-spa',
    });
    const tsconfig = JSON.parse(
      files.find((file) => file.path === 'tsconfig.json')!.content,
    ) as { compilerOptions?: { jsx?: string; lib?: string[] } };

    expect(tsconfig.compilerOptions?.jsx).toBe('react-jsx');
    expect(tsconfig.compilerOptions?.lib).toContain('DOM');
  });

  it('maps the current NestJS API catalog ID to the NestJS scaffold', () => {
    const files = buildProjectScaffold({
      ...baseOptions,
      stack: 'nestjs-api',
    });
    const paths = files.map((file) => file.path);
    const pkg = packageJson(files);

    expect(paths).toContain('src/app.module.ts');
    expect(paths).toContain('src/main.ts');
    expect(pkg.dependencies?.['@nestjs/core']).toBeDefined();
  });

  it('maps the current Node.js API catalog ID to the Node.js scaffold defaults', () => {
    expect(defaultIncludeDocker('nodejs-api')).toBe(true);

    const files = buildProjectScaffold({
      ...baseOptions,
      stack: 'nodejs-api',
      includeDocker: true,
    });
    const paths = files.map((file) => file.path);
    const pkg = packageJson(files);

    expect(paths).toContain('Dockerfile');
    expect(paths).toContain('src/index.ts');
    expect(paths).not.toContain('src/app.module.ts');
    expect(pkg.scripts?.start).toBe('node dist/index.js');
  });
});

describe('defaultIncludeDocker', () => {
  it('includes Docker for backend stacks only', () => {
    expect(defaultIncludeDocker('nestjs')).toBe(true);
    expect(defaultIncludeDocker('nodejs')).toBe(true);
    expect(defaultIncludeDocker('nextjs')).toBe(false);
    expect(defaultIncludeDocker('react')).toBe(false);
  });
});
