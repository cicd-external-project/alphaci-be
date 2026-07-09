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
});

describe('defaultIncludeDocker', () => {
  it('includes Docker for backend stacks only', () => {
    expect(defaultIncludeDocker('nestjs')).toBe(true);
    expect(defaultIncludeDocker('nodejs')).toBe(true);
    expect(defaultIncludeDocker('nextjs')).toBe(false);
    expect(defaultIncludeDocker('react')).toBe(false);
  });
});
