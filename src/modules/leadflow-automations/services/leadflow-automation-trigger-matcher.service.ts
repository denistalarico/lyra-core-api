import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { LEADFLOW_AUTOMATION_TRIGGER_EVENT_MAPPINGS } from '../../leadflow-events/catalog/leadflow-event.catalog';
import {
  LeadFlowAutomationEntity,
  LeadFlowAutomationVersionEntity,
} from '../entities';
import { LeadFlowAutomationStatus } from '../enums/leadflow-automation-status.enum';
import { LeadFlowAutomationVersionStatus } from '../enums/leadflow-automation-version-status.enum';
import type { LeadFlowAutomationRuntimeContract } from '../types/leadflow-automation.types';

const AGENCY_CONNECTION = 'agency';

export interface LeadFlowAutomationTriggerMatch {
  /** Current row: operator status and current published pointer are authoritative. */
  source: LeadFlowAutomationEntity;
  /** Immutable configuration reconstructed from the published snapshot. */
  automation: LeadFlowAutomationEntity;
  version: LeadFlowAutomationVersionEntity;
}

/**
 * Resolves which automations a delivered event concerns.
 *
 * The mapping event → trigger lives in the event catalog and is the same table
 * the ingress uses to decide whether a delivery is relevant at all. Reading it
 * here rather than duplicating the knowledge means a trigger cannot become
 * matchable without also being declared in the published contract.
 */
@Injectable()
export class LeadFlowAutomationTriggerMatcherService {
  constructor(
    @InjectRepository(LeadFlowAutomationEntity, AGENCY_CONNECTION)
    private readonly automationsRepository: Repository<LeadFlowAutomationEntity>,
    @InjectRepository(LeadFlowAutomationVersionEntity, AGENCY_CONNECTION)
    private readonly versionsRepository: Repository<LeadFlowAutomationVersionEntity>,
  ) {}

  /** Trigger keys published as `mapped` for this event name. */
  triggersForEvent(eventName: string): string[] {
    return LEADFLOW_AUTOMATION_TRIGGER_EVENT_MAPPINGS.filter(
      (mapping) =>
        mapping.status === 'mapped' && mapping.eventName === eventName,
    ).map((mapping) => mapping.trigger);
  }

  /**
   * Automations in the event's own tenant/workspace whose configured trigger
   * matches, and which the operator has not left as a draft.
   *
   * Scope comes from the delivery, never from the payload: an event carries the
   * tenant and workspace it was produced in, so a crafted payload cannot reach
   * another workspace's automations.
   */
  async findMatching(
    tenantId: string,
    workspaceId: string,
    eventName: string,
  ): Promise<LeadFlowAutomationTriggerMatch[]> {
    const triggers = this.triggersForEvent(eventName);
    if (triggers.length === 0) {
      return [];
    }

    const candidates = await this.automationsRepository.find({
      where: {
        tenantId,
        workspaceId,
        publishedVersionId: Not(IsNull()),
        status: In([
          LeadFlowAutomationStatus.Active,
          LeadFlowAutomationStatus.Paused,
        ]),
      },
      order: { createdAt: 'ASC' },
    });

    const versionIds = candidates
      .map((automation) => automation.publishedVersionId)
      .filter((id): id is string => typeof id === 'string');
    if (versionIds.length === 0) return [];

    const versions = await this.versionsRepository.find({
      where: {
        id: In(versionIds),
        tenantId,
        status: LeadFlowAutomationVersionStatus.Published,
      },
    });
    const versionsById = new Map(
      versions.map((version) => [version.id, version]),
    );

    const matches: LeadFlowAutomationTriggerMatch[] = [];
    for (const source of candidates) {
      const version = source.publishedVersionId
        ? versionsById.get(source.publishedVersionId)
        : undefined;
      if (!version || version.automationId !== source.id) continue;

      const snapshot = this.readSnapshot(version);
      if (
        !snapshot ||
        snapshot.tenantId !== tenantId ||
        snapshot.workspaceId !== workspaceId ||
        snapshot.automationId !== source.id ||
        !triggers.includes(snapshot.trigger?.type as string)
      ) {
        continue;
      }

      matches.push({
        source,
        version,
        automation: this.fromSnapshot(source, snapshot),
      });
    }
    return matches;
  }

  private readSnapshot(
    version: LeadFlowAutomationVersionEntity,
  ): LeadFlowAutomationRuntimeContract | null {
    const value = version.snapshot;
    if (!isRecord(value)) return null;
    const snapshot = value as Partial<LeadFlowAutomationRuntimeContract>;
    return typeof snapshot.tenantId === 'string' &&
      typeof snapshot.workspaceId === 'string' &&
      typeof snapshot.automationId === 'string' &&
      typeof snapshot.recipeKey === 'string' &&
      typeof snapshot.name === 'string' &&
      typeof snapshot.category === 'string' &&
      isRecord(snapshot.businessMode) &&
      typeof snapshot.businessMode.key === 'string' &&
      isRecord(snapshot.trigger) &&
      typeof snapshot.trigger.type === 'string' &&
      isRecord(snapshot.conditions) &&
      isRecord(snapshot.actions) &&
      isRecord(snapshot.message) &&
      isRecord(snapshot.crmPolicy) &&
      isRecord(snapshot.schedulePolicy) &&
      isRecord(snapshot.developerConfig) &&
      isRecord(snapshot.readiness)
      ? (snapshot as LeadFlowAutomationRuntimeContract)
      : null;
  }

  private fromSnapshot(
    source: LeadFlowAutomationEntity,
    snapshot: LeadFlowAutomationRuntimeContract,
  ): LeadFlowAutomationEntity {
    return Object.assign(new LeadFlowAutomationEntity(), source, {
      recipeKey: snapshot.recipeKey,
      name: snapshot.name,
      category: snapshot.category,
      businessModeKey: snapshot.businessMode.key,
      triggerConfig: { ...snapshot.trigger },
      conditionConfig: { ...snapshot.conditions },
      actionConfig: { ...snapshot.actions },
      messageConfig: { ...snapshot.message },
      crmPolicy: { ...snapshot.crmPolicy },
      schedulePolicy: { ...snapshot.schedulePolicy },
      developerConfig: { ...snapshot.developerConfig },
      readiness: { ...snapshot.readiness },
      // Pause/activation is operator intent after publication, so the current
      // row wins. Configuration always comes from the immutable snapshot.
      status: source.status,
      publishedVersionId: source.publishedVersionId,
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
