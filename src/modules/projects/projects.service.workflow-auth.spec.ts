import { ProjectsService } from './projects.service';
import type { CatalogService } from '../catalog/catalog.service';
import type { CiService } from '../ci/ci.service';
import type { GithubService } from '../github/github.service';
import type { ProjectsRepository } from './projects.repository';

const stagedWorkflowFiles = [
  {
    stage: 'access' as const,
    name: 'FlowCI Access Gate',
    path: '.github/workflows/00-flowci-access.yml',
    gated: true,
    yaml: 'name: FlowCI Access Gate\n',
  },
  {
    stage: 'quality' as const,
    name: 'FlowCI Quality',
    path: '.github/workflows/10-flowci-quality.yml',
    gated: true,
    yaml: 'name: FlowCI Quality\n',
  },
  {
    stage: 'package' as const,
    name: 'FlowCI Package',
    path: '.github/workflows/20-flowci-package.yml',
    gated: true,
    yaml: 'name: FlowCI Package\n',
  },
];

const makeCatalogService = () =>
  ({
    getProjectOptions: jest.fn().mockReturnValue({
      recipes: [
        {
          id: 'backend-api-ci',
          templateByProjectType: { 'nestjs-api': 'be-nestjs' },
        },
      ],
    }),
    getTemplateById: jest.fn().mockResolvedValue({
      id: 'be-nestjs',
      name: 'NestJS Backend',
      stack: 'nestjs',
      workflowPath: '/template.yml',
    }),
    getResolvedStarterPath: jest.fn().mockReturnValue(null),
  }) as unknown as CatalogService;

const makeGithubService = () =>
  ({
    createRepo: jest.fn().mockResolvedValue({
      repoUrl: 'https://github.com/owner/repo',
      ownerLogin: 'owner',
      repoName: 'repo',
    }),
    createBranch: jest.fn().mockResolvedValue(undefined),
    applyBranchProtection: jest.fn().mockResolvedValue(undefined),
    setActionsSecret: jest.fn().mockResolvedValue(undefined),
  }) as unknown as GithubService;

const makeProjectsRepository = () =>
  ({
    create: jest.fn().mockResolvedValue({
      id: 'project-1',
    }),
  }) as unknown as ProjectsRepository;

const makeCiService = () =>
  ({
    issueProjectToken: jest.fn().mockResolvedValue({
      token: 'fci_test-token',
      tokenPrefix: 'fci_test-tok',
    }),
  }) as unknown as CiService;

const stagedWorkflowMetadata = stagedWorkflowFiles.map((file) => ({
  stage: file.stage,
  name: file.name,
  path: file.path,
  gated: file.gated,
}));

describe('ProjectsService workflow authorization', () => {
  let service: ProjectsService;
  let githubService: GithubService;
  let projectsRepository: ProjectsRepository;
  let ciService: CiService;

  beforeEach(() => {
    githubService = makeGithubService();
    projectsRepository = makeProjectsRepository();
    ciService = makeCiService();

    service = new ProjectsService(
      makeCatalogService(),
      githubService,
      projectsRepository,
      ciService,
    );

    jest
      .spyOn(
        service as unknown as { buildWorkflowBundle: jest.Mock },
        'buildWorkflowBundle',
      )
      .mockResolvedValue({
        workflowFiles: stagedWorkflowFiles,
        outputFileName: '00-flowci-access.yml',
      });
    jest
      .spyOn(
        service as unknown as { pushStarterFiles: jest.Mock },
        'pushStarterFiles',
      )
      .mockResolvedValue(undefined);
    jest
      .spyOn(
        service as unknown as { pushWorkflowFile: jest.Mock },
        'pushWorkflowFile',
      )
      .mockResolvedValue({
        commitSha: 'commit-1',
        commitUrl: 'https://commit',
      });
  });

  it('pushes every staged workflow file and installs the project CI token as a GitHub Actions secret', async () => {
    const result = await service.createProject(
      'user-1',
      'octocat',
      'gh-token',
      {
        repoName: 'repo',
        visibility: 'private',
        repoShape: 'standalone',
        projectTypeId: 'nestjs-api',
        workflowRecipeId: 'backend-api-ci',
        serviceName: 'api',
      },
    );

    expect(
      (service as unknown as { pushWorkflowFile: jest.Mock }).pushWorkflowFile,
    ).toHaveBeenCalledTimes(3);
    const setActionsSecret = (
      githubService as unknown as { setActionsSecret: jest.Mock }
    ).setActionsSecret;
    const issueProjectToken = (
      ciService as unknown as { issueProjectToken: jest.Mock }
    ).issueProjectToken;
    const createProjectRow = (
      projectsRepository as unknown as { create: jest.Mock }
    ).create;

    expect(setActionsSecret).toHaveBeenCalledWith(
      'gh-token',
      'owner',
      'repo',
      'CI_TOKEN',
      'fci_test-token',
    );
    expect(issueProjectToken).toHaveBeenCalledWith('project-1');
    expect(createProjectRow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowPath: '.github/workflows/00-flowci-access.yml',
        /* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment */
        projectOptions: expect.objectContaining({
          workflowFiles: stagedWorkflowMetadata,
        }),
      }),
    );
    expect(result.workflowFiles).toEqual(stagedWorkflowMetadata);
  });
});
