import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';

import type { DatabaseService } from '../database/database.service';
import { UsageQuotaService } from './usage-quota.service';

const makeDatabaseService = (query: jest.Mock, isEnabled = true) =>
  ({
    query,
    isEnabled: () => isEnabled,
  }) as unknown as DatabaseService;

describe('UsageQuotaService', () => {
  const configService = {
    getOrThrow: jest.fn(),
  };
  let query: jest.Mock;
  let service: UsageQuotaService;

  beforeEach(() => {
    query = jest.fn();
    configService.getOrThrow.mockReturnValue({
      usageQuotas: { enabled: true },
    });
    service = new UsageQuotaService(
      makeDatabaseService(query),
      configService as never,
    );
  });

  it('returns local usage counters and free plan limits', async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [
        {
          projects: '2',
          managed_render_services: '1',
          managed_vercel_projects: '0',
          deployment_targets: '2',
          env_keys: '4',
          workflow_prs: '1',
        },
      ],
    });

    await expect(service.getUsage('user-1')).resolves.toMatchObject({
      enabled: true,
      plan: 'free',
      items: expect.arrayContaining([
        expect.objectContaining({ code: 'projects', current: 2, limit: 3 }),
        expect.objectContaining({
          code: 'managed_render_services',
          current: 1,
          limit: 1,
          upgradeRequired: true,
        }),
      ]),
    });
  });

  it('treats pro_monthly subscriptions as pro quota plan', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ plan_code: 'pro_monthly' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            projects: '4',
            managed_render_services: '2',
            managed_vercel_projects: '2',
            deployment_targets: '6',
            env_keys: '26',
            workflow_prs: '6',
          },
        ],
      });

    await expect(service.getUsage('user-1')).resolves.toMatchObject({
      plan: 'pro',
      items: expect.arrayContaining([
        expect.objectContaining({ code: 'projects', current: 4, limit: 50 }),
      ]),
    });
  });

  it('blocks actions that would exceed enabled quotas', async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [
        {
          projects: '3',
          managed_render_services: '0',
          managed_vercel_projects: '0',
          deployment_targets: '0',
          env_keys: '0',
          workflow_prs: '0',
        },
      ],
    });

    await expect(
      service.assertWithinLimit('user-1', 'projects'),
    ).rejects.toThrow(BadRequestException);
  });

  it('does not block actions when quotas are disabled', async () => {
    configService.getOrThrow.mockReturnValueOnce({
      usageQuotas: { enabled: false },
    });

    await expect(
      service.assertWithinLimit('user-1', 'projects'),
    ).resolves.toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });

  describe('assertManagedFleetCapacity', () => {
    const withFleetCap = (provider: 'render' | 'vercel', max: number) => {
      configService.getOrThrow.mockReturnValue({
        envProvisioning: {
          flowciManaged:
            provider === 'render'
              ? { renderManagedFleetMax: max }
              : { vercelManagedFleetMax: max },
        },
      });
    };

    it('rejects new managed targets once the platform fleet cap is reached', async () => {
      withFleetCap('render', 2);
      query.mockResolvedValueOnce({ rows: [{ count: '2' }] });

      await expect(
        service.assertManagedFleetCapacity('render'),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('allows a managed target while under the fleet cap', async () => {
      withFleetCap('vercel', 5);
      query.mockResolvedValueOnce({ rows: [{ count: '1' }] });

      await expect(
        service.assertManagedFleetCapacity('vercel'),
      ).resolves.toBeUndefined();
    });

    it('treats a cap of 0 as unlimited and never queries', async () => {
      withFleetCap('render', 0);

      await expect(
        service.assertManagedFleetCapacity('render'),
      ).resolves.toBeUndefined();
      expect(query).not.toHaveBeenCalled();
    });

    it('is a no-op when the database is not configured', async () => {
      service = new UsageQuotaService(
        makeDatabaseService(query, false),
        configService as never,
      );

      await expect(
        service.assertManagedFleetCapacity('render'),
      ).resolves.toBeUndefined();
      expect(query).not.toHaveBeenCalled();
    });
  });
});
