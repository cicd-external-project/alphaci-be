import { Injectable, Logger } from '@nestjs/common';

import { ProjectsRepository } from './projects.repository';

/**
 * Stable, fake-but-consistent repo identity for the seeded demo project.
 * Not a real GitHub repository — purely a placeholder row so new users see a
 * populated dashboard instead of an empty state.
 */
const DEMO_REPO_FULL_NAME = 'flowci-demo/flowci-demo-app';
const DEMO_SERVICE_NAME = 'flowci-demo-backend';
const DEMO_WORKFLOW_PATH =
  '.github/workflows/flowci-demo-backend-nest-service-pipeline.yml';

// 'nest-service-pipeline' is a real entry in the catalog's static + engine
// template list (see CatalogService STATIC_PROJECT_OPTIONS.recipes / stacks.json
// service workflow map). template_id has no FK constraint in the schema
// (TEXT NOT NULL only — see 20260604_provisioned_projects.sql), so any stable
// string is technically safe, but reusing a real template id keeps this row
// consistent with what a real "nestjs" provisioned project would contain.
const DEMO_TEMPLATE_ID = 'nest-service-pipeline';

/**
 * Seeds a single read-only "demo project" row for every user so their
 * dashboard is never empty on first login.
 *
 * This must be safe to call on every login/signup attempt (not just once):
 * `hasExampleProject` is checked first and the insert is skipped if a row
 * already exists. Failures are logged and swallowed — seeding is best-effort
 * and must never block authentication.
 */
@Injectable()
export class ExampleProjectSeederService {
  private readonly logger = new Logger(ExampleProjectSeederService.name);

  constructor(private readonly projectsRepository: ProjectsRepository) {}

  async ensureExampleProjectSeeded(userId: string): Promise<void> {
    try {
      const alreadySeeded =
        await this.projectsRepository.hasExampleProject(userId);
      if (alreadySeeded) {
        return;
      }

      await this.projectsRepository.create({
        userId,
        repoFullName: DEMO_REPO_FULL_NAME,
        templateId: DEMO_TEMPLATE_ID,
        serviceName: DEMO_SERVICE_NAME,
        workflowPath: DEMO_WORKFLOW_PATH,
        status: 'provisioned',
        visibility: 'public',
        isExample: true,
      });
    } catch (error) {
      // Best-effort seeding: never throw upward. A failure here must not
      // block login/signup — log and move on, matching the philosophy of
      // SubscriptionsRepository.ensurePlanCatalog/ensureDefaultFreeSubscription.
      this.logger.warn(
        `Example project seeding failed for user ${userId}: ${(error as Error).message}`,
      );
    }
  }
}
