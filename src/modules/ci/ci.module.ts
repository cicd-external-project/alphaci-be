import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { CiController } from './ci.controller';
import { CiService } from './ci.service';
import { CiTokensRepository } from './ci-tokens.repository';

@Module({
  imports: [DatabaseModule],
  controllers: [CiController],
  providers: [CiService, CiTokensRepository],
  exports: [CiService],
})
export class CiModule {}
