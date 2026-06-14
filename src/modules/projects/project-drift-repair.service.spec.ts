import { BadRequestException } from '@nestjs/common';

import { ProjectDriftRepairService } from './project-drift-repair.service';

describe('ProjectDriftRepairService', () => {
  const projectsRepository = {
    findByIdAndUser: jest.fn(),
  };
  const findingsRepository = {
    findByIdForProject: jest.fn(),
    markStatus: jest.fn(),
  };
  const ciService = {
    issueProjectToken: jest.fn(),
  };
  const deploymentTargetsRepository = {
    deleteDeploymentTargetForUser: jest.fn(),
  };
  const projectsService = {
    previewWorkflowSettings: jest.fn(),
    createWorkflowUpdatePullRequest: jest.fn(),
  };
  const configService = {
    getOrThrow: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    projectsRepository.findByIdAndUser.mockResolvedValue({
      id: 'project-1',
      repo_full_name: 'tone/orders-api',
    });
    findingsRepository.findByIdForProject.mockResolvedValue({
      id: 'finding-1',
      projectId: 'project-1',
      targetId: null,
      source: 'local_snapshot',
      severity: 'error',
      code: 'ci_token_missing',
      message: 'No token',
      details: {},
      status: 'active',
      detectedAt: '2026-06-13T00:00:00.000Z',
      resolvedAt: null,
    });
    ciService.issueProjectToken.mockResolvedValue({
      token: 'fci_secret_raw_token',
      tokenPrefix: 'fci_prefix',
    });
    deploymentTargetsRepository.deleteDeploymentTargetForUser.mockResolvedValue(
      true,
    );
    projectsService.previewWorkflowSettings.mockResolvedValue({
      workflowFiles: [{ path: '.github/workflows/00-flowci-access.yml' }],
      validationWarnings: [],
    });
    projectsService.createWorkflowUpdatePullRequest.mockResolvedValue({
      pullRequestNumber: 42,
      pullRequestUrl: 'https://github.com/tone/orders-api/pull/42',
    });
    configService.getOrThrow.mockReturnValue({
      driftRepair: { enabled: true },
      workflowUpdatePr: { enabled: true },
    });
  });

  function createService() {
    return new ProjectDriftRepairService(
      projectsRepository as never,
      findingsRepository as never,
      ciService as never,
      deploymentTargetsRepository as never,
      projectsService as never,
      configService as never,
    );
  }

  it('rotates a CI token without returning the raw token value', async () => {
    const response = await createService().repair(
      'project-1',
      'finding-1',
      'user-1',
      'rotate_ci_token',
      null,
    );

    expect(ciService.issueProjectToken).toHaveBeenCalledWith('project-1');
    expect(findingsRepository.markStatus).toHaveBeenCalledWith(
      'finding-1',
      'resolved',
    );
    expect(JSON.stringify(response)).toContain('fci_prefix');
    expect(JSON.stringify(response)).not.toContain('fci_secret_raw_token');
  });

  it('detaches a target from FlowCI without deleting provider resources', async () => {
    findingsRepository.findByIdForProject.mockResolvedValueOnce({
      id: 'finding-2',
      projectId: 'project-1',
      targetId: 'target-1',
      source: 'local_snapshot',
      severity: 'error',
      code: 'deployment_target_metadata_missing',
      message: 'Bad target',
      details: {},
      status: 'active',
      detectedAt: '2026-06-13T00:00:00.000Z',
      resolvedAt: null,
    });

    await expect(
      createService().repair(
        'project-1',
        'finding-2',
        'user-1',
        'detach_target',
        null,
      ),
    ).resolves.toMatchObject({
      status: 'completed',
      result: { targetId: 'target-1' },
    });
    expect(
      deploymentTargetsRepository.deleteDeploymentTargetForUser,
    ).toHaveBeenCalledWith('project-1', 'target-1', 'user-1');
  });

  it('returns disabled state for live provider repairs', async () => {
    findingsRepository.findByIdForProject.mockResolvedValueOnce({
      id: 'finding-3',
      projectId: 'project-1',
      targetId: 'target-1',
      source: 'local_snapshot',
      severity: 'error',
      code: 'provider_target_missing_live',
      message: 'Provider target missing',
      details: {},
      status: 'active',
      detectedAt: '2026-06-13T00:00:00.000Z',
      resolvedAt: null,
    });

    await expect(
      createService().repair(
        'project-1',
        'finding-3',
        'user-1',
        'detach_target',
        null,
      ),
    ).resolves.toMatchObject({
      enabled: false,
      status: 'disabled',
      message: 'Live provider activation required',
    });
    expect(
      deploymentTargetsRepository.deleteDeploymentTargetForUser,
    ).not.toHaveBeenCalled();
  });

  it('rejects repair for inactive findings', async () => {
    findingsRepository.findByIdForProject.mockResolvedValueOnce({
      id: 'finding-4',
      projectId: 'project-1',
      targetId: null,
      source: 'local_snapshot',
      severity: 'warning',
      code: 'workflow_files_missing',
      message: 'No workflow',
      details: {},
      status: 'resolved',
      detectedAt: '2026-06-13T00:00:00.000Z',
      resolvedAt: '2026-06-13T00:10:00.000Z',
    });

    await expect(
      createService().repair(
        'project-1',
        'finding-4',
        'user-1',
        'regenerate_workflow_preview',
        null,
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
