import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { EnvTokenEncryptionService } from './encryption.service';
import type { CreateProviderConnectionDto } from './dto/create-provider-connection.dto';
import type { EnvProvider } from './env-provisioning.types';
import { ProviderClientRegistry } from './provider-clients/provider-client.registry';
import { ProviderConnectionsRepository } from './provider-connections.repository';

const PROVIDERS: EnvProvider[] = ['render', 'vercel'];

@Injectable()
export class ProviderConnectionsService {
  constructor(
    private readonly repository: ProviderConnectionsRepository,
    private readonly encryptionService: EnvTokenEncryptionService,
    private readonly clientRegistry: ProviderClientRegistry,
  ) {}

  async createProviderConnection(
    userId: string,
    dto: CreateProviderConnectionDto,
  ) {
    if (!PROVIDERS.includes(dto.provider)) {
      throw new BadRequestException('Unsupported provider');
    }
    if (!dto.label?.trim() || !dto.token?.trim()) {
      throw new BadRequestException('Provider label and token are required');
    }

    const token = dto.token.trim();
    await this.clientRegistry.getClient(dto.provider).validateConnection(token);

    return this.repository.createProviderConnection({
      userId,
      provider: dto.provider,
      label: dto.label.trim(),
      encryptedToken: this.encryptionService.encrypt(token),
      tokenLastFour: token.slice(-4),
    });
  }

  listProviderConnections(userId: string) {
    return this.repository.listProviderConnections(userId);
  }

  async revokeProviderConnection(id: string, userId: string) {
    const revoked = await this.repository.revokeProviderConnection(id, userId);
    if (!revoked) {
      throw new NotFoundException('Provider connection not found');
    }

    return { revoked: true };
  }
}
