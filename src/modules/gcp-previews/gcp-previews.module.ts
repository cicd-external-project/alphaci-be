import { Module } from '@nestjs/common';

import { GcpControlModule } from '../gcp-control/gcp-control.module';
import { PreviewCleanupService } from './preview-cleanup.service';
import { PreviewLimitsService } from './preview-limits.service';
import { PreviewTargetsService } from './preview-targets.service';

@Module({
  imports: [GcpControlModule],
  providers: [
    PreviewCleanupService,
    PreviewLimitsService,
    PreviewTargetsService,
  ],
  exports: [PreviewCleanupService, PreviewLimitsService, PreviewTargetsService],
})
export class GcpPreviewsModule {}
