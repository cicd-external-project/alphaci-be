import { Injectable, NotFoundException } from '@nestjs/common';

import { AuditEventsService } from '../../audit/audit-events.service';
import { HierarchyAccessService } from '../hierarchy-access.service';
import { HIERARCHY_EVENT_CODES } from '../hierarchy.types';
import { SystemsRepository, type SystemRecord } from './systems.repository';
import type { CreateSystemDto } from '../dto/create-system.dto';
import type { UpdateSystemDto } from '../dto/update-system.dto';

@Injectable()
export class SystemsService {
  constructor(
    private readonly systemsRepository: SystemsRepository,
    private readonly accessService: HierarchyAccessService,
    private readonly auditEventsService: AuditEventsService,
  ) {}

  async createSystem(
    groupId: string,
    userId: string,
    dto: CreateSystemDto,
  ): Promise<SystemRecord> {
    await this.accessService.assertGroupManagerOrPlatformAdmin(groupId, userId);
    const system = await this.systemsRepository.create({
      groupId,
      name: dto.name,
      description: dto.description ?? null,
      ownerId: userId,
    });

    await this.auditEventsService.recordProjectEvent({
      workspaceId: groupId,
      actorUserId: userId,
      eventCode: HIERARCHY_EVENT_CODES.systemCreated,
      message: `System "${system.name}" created`,
      metadata: { groupId, systemId: system.id },
    });

    return system;
  }

  async listSystems(groupId: string, userId: string): Promise<SystemRecord[]> {
    if (!(await this.accessService.isPlatformAdmin(userId))) {
      await this.accessService.assertGroupMembership(groupId, userId);
    }
    return this.systemsRepository.listByGroup(groupId);
  }

  async getSystem(systemId: string, userId: string): Promise<SystemRecord> {
    await this.accessService.assertSystemMembership(systemId, userId);
    const system = await this.systemsRepository.findById(systemId);
    if (!system) {
      throw new NotFoundException('System not found');
    }
    return system;
  }

  async updateSystem(
    systemId: string,
    userId: string,
    dto: UpdateSystemDto,
  ): Promise<SystemRecord> {
    const { groupId } = await this.accessService.assertSystemManager(
      systemId,
      userId,
    );
    const system = await this.systemsRepository.update(systemId, dto);
    if (!system) {
      throw new NotFoundException('System not found');
    }

    await this.auditEventsService.recordProjectEvent({
      workspaceId: groupId,
      actorUserId: userId,
      eventCode: HIERARCHY_EVENT_CODES.systemUpdated,
      message: `System "${system.name}" updated`,
      metadata: { groupId, systemId },
    });

    return system;
  }

  async archiveSystem(systemId: string, userId: string): Promise<SystemRecord> {
    const { groupId } = await this.accessService.assertSystemManager(
      systemId,
      userId,
    );
    const system = await this.systemsRepository.archive(systemId);
    if (!system) {
      throw new NotFoundException('System not found');
    }

    await this.auditEventsService.recordProjectEvent({
      workspaceId: groupId,
      actorUserId: userId,
      eventCode: HIERARCHY_EVENT_CODES.systemArchived,
      message: `System "${system.name}" archived`,
      metadata: { groupId, systemId },
    });

    return system;
  }
}
