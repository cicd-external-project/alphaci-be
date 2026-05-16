import { Module } from '@nestjs/common';
import { ApiCenterClientService } from './api-center-client.service';

@Module({
  providers: [ApiCenterClientService],
  exports: [ApiCenterClientService]
})
export class ExternalModule {}