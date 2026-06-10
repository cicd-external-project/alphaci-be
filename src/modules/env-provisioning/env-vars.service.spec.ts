import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { EnvTokenEncryptionService } from './encryption.service';
import { DeploymentTargetsRepository } from './deployment-targets.repository';
import { EnvVarsRepository } from './env-vars.repository';
import { EnvVarsService } from './env-vars.service';
import { ProviderClientRegistry } from './provider-clients/provider-client.registry';
import { ProviderConnectionsRepository } from './provider-connections.repository';

describe('EnvVarsService', () => {
  it('stores metadata only after provider env provisioning', async () => {
    const envVarsRepository = {
      listEnvMetadata: jest.fn(),
      upsertEnvMetadataBatch: jest.fn(),
    };
    const deploymentTargetsRepository = {
      findDeploymentTargetForUser: jest.fn().mockResolvedValue({
        id: 'target-1',
        projectId: 'project-1',
        ownershipMode: 'flowci_managed',
        provider: 'render',
        providerConnectionId: null,
        providerProjectId: 'srv-1',
      }),
    };
    const providerClient = {
      upsertEnvironmentVariables: jest.fn().mockResolvedValue({
        provisioned: [{ key: 'DATABASE_URL', status: 'provisioned' }],
        failed: [],
      }),
    };
    const module = await Test.createTestingModule({
      providers: [
        EnvVarsService,
        { provide: EnvVarsRepository, useValue: envVarsRepository },
        {
          provide: DeploymentTargetsRepository,
          useValue: deploymentTargetsRepository,
        },
        {
          provide: ProviderConnectionsRepository,
          useValue: { findActiveProviderConnection: jest.fn() },
        },
        {
          provide: ProviderClientRegistry,
          useValue: { getClient: jest.fn().mockReturnValue(providerClient) },
        },
        {
          provide: EnvTokenEncryptionService,
          useValue: { decrypt: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockReturnValue({
              envProvisioning: {
                flowciManaged: {
                  renderToken: 'rnd',
                  vercelToken: '',
                },
              },
            }),
          },
        },
      ],
    }).compile();

    const service = module.get(EnvVarsService);
    await service.provisionEnvVars('project-1', 'user-1', {
      deploymentTargetId: 'target-1',
      environment: 'test',
      vars: [{ key: 'DATABASE_URL', value: 'postgres://secret' }],
    });

    expect(envVarsRepository.upsertEnvMetadataBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            key: 'DATABASE_URL',
            status: 'provisioned',
          }),
        ],
      }),
    );
    expect(
      JSON.stringify(envVarsRepository.upsertEnvMetadataBatch.mock.calls),
    ).not.toContain('postgres://secret');
  });
});
