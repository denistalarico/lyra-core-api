import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import type { LeadFlowJsonObject } from '../types/leadflow-settings.types';

const ROOT_KEYS = new Set([
  'schemaVersion',
  'identity',
  'offers',
  'service',
  'qualification',
  'policies',
  'faq',
  'links',
  'legacyTone',
]);
const FORBIDDEN_KEY =
  /(secret|token|password|api.?key|credential|system.?prompt|developer.?instruction)/i;
const URL_KEY = /(url|website|link|links)$/i;

@Injectable()
export class CompanyContextService {
  normalize(value: LeadFlowJsonObject): LeadFlowJsonObject {
    for (const key of Object.keys(value)) {
      if (!ROOT_KEYS.has(key))
        throw new BadRequestException(`Unknown company context field: ${key}.`);
    }
    this.assertRootShape(value);
    const normalized = this.walk(value, '', 0) as LeadFlowJsonObject;
    normalized.schemaVersion = 1;
    const bytes = Buffer.byteLength(this.stableStringify(normalized), 'utf8');
    if (bytes > 64 * 1024)
      throw new BadRequestException('Company context exceeds 64 KiB.');
    return normalized;
  }

  private assertRootShape(value: LeadFlowJsonObject) {
    if (value.schemaVersion !== undefined && value.schemaVersion !== 1) {
      throw new BadRequestException(
        'Unsupported company context schema version.',
      );
    }
    for (const key of ['identity', 'service', 'qualification']) {
      const section = value[key];
      if (
        section !== undefined &&
        (!section || typeof section !== 'object' || Array.isArray(section))
      ) {
        throw new BadRequestException(
          `Company context section ${key} must be an object.`,
        );
      }
    }
    for (const key of ['offers', 'faq', 'links']) {
      if (value[key] !== undefined && !Array.isArray(value[key])) {
        throw new BadRequestException(
          `Company context section ${key} must be a list.`,
        );
      }
    }
    if (
      value.legacyTone !== undefined &&
      typeof value.legacyTone !== 'string'
    ) {
      throw new BadRequestException('Company context legacyTone must be text.');
    }
  }

  fromLegacy(value: LeadFlowJsonObject): LeadFlowJsonObject {
    return this.normalize({
      schemaVersion: 1,
      identity: {
        publicName: value.businessName ?? '',
        legalName: value.legalName ?? '',
        summary: value.businessSummary ?? '',
        valueProposition: value.valueProposition ?? '',
        differentiators: value.differentiators ?? '',
        targetAudience: value.targetAudience ?? '',
        languages: value.languages ?? '',
        timezone: value.timezone ?? '',
        regionsServed: value.regionsServed ?? '',
      },
      offers: this.fromLegacyList(value.mainOffers),
      service: {
        businessHours: value.businessHours ?? '',
        handoffRules: value.handoffRules ?? '',
        serviceLevel: value.serviceLevel ?? '',
        emergencyRules: value.emergencyRules ?? '',
        unsupportedRequests: value.unsupportedRequests ?? '',
      },
      qualification: {
        conversionGoal: value.conversionGoal ?? '',
        preferredCta: value.preferredCta ?? '',
        essentialQuestions: value.essentialQuestions ?? '',
        qualifiedCriteria: value.qualifiedCriteria ?? '',
        disqualificationCriteria: value.disqualificationCriteria ?? '',
        priorityServices: value.priorityServices ?? '',
        urgencySignals: value.urgencySignals ?? '',
      },
      policies: value.policies ?? '',
      faq: this.fromLegacyList(value.faq),
      links: this.fromLegacyList(value.links),
      legacyTone: value.tone ?? '',
    });
  }

  normalizePersisted(value: LeadFlowJsonObject): LeadFlowJsonObject {
    const compatible = { ...value };
    for (const key of ['offers', 'faq', 'links']) {
      if (typeof compatible[key] === 'string') {
        compatible[key] = this.splitLines(compatible[key]);
      }
    }
    return this.normalize(compatible);
  }

  hash(value: LeadFlowJsonObject) {
    return createHash('sha256')
      .update(this.stableStringify(value))
      .digest('hex');
  }

  preview(value: LeadFlowJsonObject) {
    const normalized = this.normalize(value);
    return this.buildPreview(normalized);
  }

  previewPersisted(value: LeadFlowJsonObject) {
    return this.buildPreview(this.normalizePersisted(value));
  }

  private buildPreview(normalized: LeadFlowJsonObject) {
    const serialized = this.stableStringify(normalized);
    return {
      schemaVersion: 1,
      hash: this.hash(normalized),
      bytes: Buffer.byteLength(serialized, 'utf8'),
      estimatedTokens: Math.ceil(serialized.length / 4),
      sections: Object.keys(normalized).filter(
        (key) => key !== 'schemaVersion',
      ),
      offerCount: Array.isArray(normalized.offers)
        ? normalized.offers.length
        : 0,
      faqCount: Array.isArray(normalized.faq) ? normalized.faq.length : 0,
      linkCount: Array.isArray(normalized.links) ? normalized.links.length : 0,
    };
  }

  private fromLegacyList(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') return this.splitLines(value);
    if (typeof value === 'number') return [String(value)];
    return [];
  }

  private splitLines(value: string): string[] {
    return value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private walk(value: unknown, key: string, depth: number): unknown {
    if (depth > 8)
      throw new BadRequestException('Company context nesting is too deep.');
    if (FORBIDDEN_KEY.test(key))
      throw new BadRequestException(
        `Reserved or secret-like field is not allowed: ${key}.`,
      );
    if (typeof value === 'string') {
      if (value.length > 4_000)
        throw new BadRequestException(
          `Company context field ${key} exceeds 4000 characters.`,
        );
      const trimmed = value.trim();
      if (URL_KEY.test(key) && trimmed && !/^https?:\/\//i.test(trimmed)) {
        throw new BadRequestException(
          `Only http/https URLs are allowed in ${key}.`,
        );
      }
      return trimmed;
    }
    if (
      value === null ||
      typeof value === 'boolean' ||
      typeof value === 'number'
    )
      return value;
    if (Array.isArray(value)) {
      if (value.length > 100)
        throw new BadRequestException(
          `Company context list ${key} exceeds 100 items.`,
        );
      return value.map((item) => this.walk(item, key, depth + 1));
    }
    if (!value || typeof value !== 'object')
      throw new BadRequestException(`Invalid company context field: ${key}.`);
    const output: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (childKey.length > 80)
        throw new BadRequestException(
          'Company context field name is too long.',
        );
      output[childKey] = this.walk(child, childKey, depth + 1);
    }
    return output;
  }

  private stableStringify(value: unknown): string {
    if (Array.isArray(value))
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${this.stableStringify((value as Record<string, unknown>)[key])}`,
        )
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }
}
