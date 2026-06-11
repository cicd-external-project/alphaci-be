import { DeploymentStrategyResolver } from './deployment-strategy.resolver';

describe('DeploymentStrategyResolver', () => {
  const resolver = new DeploymentStrategyResolver();

  it('uses Vercel Git connection for FlowCI-managed Vercel targets', () => {
    expect(
      resolver.resolve({
        provider: 'vercel',
        ownershipMode: 'flowci_managed',
      }),
    ).toBe('vercel_git_connected');
  });

  it('uses CI-pushed deployments for BYO Vercel targets', () => {
    expect(
      resolver.resolve({
        provider: 'vercel',
        ownershipMode: 'byo',
      }),
    ).toBe('vercel_ci_pushed');
  });

  it('uses native provider behavior for Render targets', () => {
    expect(
      resolver.resolve({
        provider: 'render',
        ownershipMode: 'flowci_managed',
      }),
    ).toBe('provider_native');
    expect(
      resolver.resolve({
        provider: 'render',
        ownershipMode: 'byo',
      }),
    ).toBe('provider_native');
  });
});
