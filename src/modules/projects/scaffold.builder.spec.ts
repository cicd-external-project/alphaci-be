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

  it('renders a real React scaffold for the react stack', () => {
    const files = buildProjectScaffold({
      serviceName: 'orders-web',
      stack: 'react',
      includeDocker: false,
    });
    const paths = files.map((file) => file.path);

    expect(paths).toContain('src/App.tsx');
    expect(paths).toContain('src/App.spec.tsx');

    const pkg = JSON.parse(
      files.find((file) => file.path === 'package.json')!.content,
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.['react']).toBeDefined();
    expect(pkg.dependencies?.['react-dom']).toBeDefined();
    expect(pkg.devDependencies?.['@types/react']).toBeDefined();

    // jest must pick up the .tsx spec or coverage collapses to zero
    const jestConfig = files.find(
      (file) => file.path === 'jest.config.ts',
    )!.content;
    expect(jestConfig).toContain("'**/*.spec.tsx'");

    const app = files.find((file) => file.path === 'src/App.tsx')!.content;
    expect(app).toContain("title = 'orders-web'");
  });

  it('renders a react frontend/ subdirectory for microservices', () => {
    const files = buildProjectScaffold({
      ...baseOptions,
      repoShape: 'microservices',
      frontendStack: 'react',
      frontendServiceName: 'orders-web',
    });
    const paths = files.map((file) => file.path);

    expect(paths).toContain('frontend/src/App.tsx');
    expect(paths).toContain('frontend/src/App.spec.tsx');
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
