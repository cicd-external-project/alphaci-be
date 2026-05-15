import { Injectable } from '@nestjs/common';

export interface ServiceInfo {
  service: string;
  version: string;
}

@Injectable()
export class AppService {
  getServiceInfo(): ServiceInfo {
    return { service: 'tribe-backend', version: '1.0.0' };
  }
}
