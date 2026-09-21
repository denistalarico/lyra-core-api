import { Injectable } from '@nestjs/common';
import { SocialAdCredentialResolver } from '../../social-integrations';
import { MetaAdsGraphService } from '../../social-integrations/services/meta-ads-graph.service';
import type { SocialAdManualActionType } from '../entities';
import type { SocialCampaignsScope } from './social-boost-template.service';

export type MetaAdWritableState = {
  status: string | null;
  dailyBudgetMinor: string | null;
  lifetimeBudgetMinor: string | null;
  endsAt: string | null;
};

export class MetaAdManualActionError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

type ExecuteInput = SocialCampaignsScope & {
  connectionId: string;
  entityLevel: 'campaign' | 'adset' | 'ad';
  entityExternalId: string;
  actionType: SocialAdManualActionType;
  expected: MetaAdWritableState;
  change: Record<string, unknown>;
};

/** The only C5 component allowed to turn a confirmed intent into a Meta write. */
@Injectable()
export class MetaAdsManualActionAdapter {
  constructor(
    private readonly credentials: SocialAdCredentialResolver,
    private readonly graph: MetaAdsGraphService,
  ) {}

  async execute(input: ExecuteInput) {
    const credential = await this.credentials.resolve({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      agencyClientId: input.agencyClientId,
      companyContextId: input.companyContextId ?? null,
      connectionId: input.connectionId,
    });
    const current = await this.readState(
      credential.accessToken,
      input.entityExternalId,
      input.entityLevel,
    );

    if (!this.matchesExpected(current, input.expected, input.actionType)) {
      throw new MetaAdManualActionError('provider_state_changed');
    }

    const mutation = this.toMutation(input);
    const result = await this.graph.mutateNode({
      accessToken: credential.accessToken,
      path: input.entityExternalId,
      method: mutation.method,
      params: mutation.params,
      failureMessage: 'Meta Ads manual action failed.',
    });

    if (input.actionType === 'delete') {
      return {
        before: current,
        after: null,
        providerAccepted: result.success === true,
        verified: result.success === true,
      };
    }

    try {
      const after = await this.readState(
        credential.accessToken,
        input.entityExternalId,
        input.entityLevel,
      );
      return {
        before: current,
        after,
        providerAccepted: true,
        verified: this.matchesChange(after, input),
      };
    } catch {
      // A successful mutation followed by a failed verification is not safe to
      // retry blindly. The audit record says accepted/unverified; sync settles it.
      return {
        before: current,
        after: null,
        providerAccepted: true,
        verified: false,
      };
    }
  }

  private async readState(
    accessToken: string,
    entityExternalId: string,
    level: ExecuteInput['entityLevel'],
  ): Promise<MetaAdWritableState> {
    const row = await this.graph.readNode({
      accessToken,
      path: entityExternalId,
      fields: 'id,status,daily_budget,lifetime_budget,stop_time,end_time',
      failureMessage: 'Meta Ads state verification failed.',
    });

    return {
      status: this.text(row.status)?.toUpperCase() ?? null,
      dailyBudgetMinor: this.integerText(row.daily_budget),
      lifetimeBudgetMinor: this.integerText(row.lifetime_budget),
      endsAt: this.timestamp(
        level === 'campaign' ? row.stop_time : row.end_time,
      ),
    };
  }

  private toMutation(input: ExecuteInput): {
    method: 'POST' | 'DELETE';
    params?: Record<string, string>;
  } {
    if (input.actionType === 'delete') return { method: 'DELETE' };
    if (input.actionType === 'set_status') {
      return {
        method: 'POST',
        params: { status: String(input.change.status) },
      };
    }
    if (input.actionType === 'set_budget') {
      const field =
        input.change.budgetKind === 'daily'
          ? 'daily_budget'
          : 'lifetime_budget';
      return {
        method: 'POST',
        params: { [field]: String(input.change.budgetAmountMinor) },
      };
    }
    return {
      method: 'POST',
      params: {
        [input.entityLevel === 'campaign' ? 'stop_time' : 'end_time']: String(
          input.change.endsAt,
        ),
      },
    };
  }

  private matchesExpected(
    current: MetaAdWritableState,
    expected: MetaAdWritableState,
    actionType: SocialAdManualActionType,
  ) {
    if (actionType === 'set_status') return current.status === expected.status;
    if (actionType === 'set_budget') {
      return (
        current.dailyBudgetMinor === expected.dailyBudgetMinor &&
        current.lifetimeBudgetMinor === expected.lifetimeBudgetMinor
      );
    }
    if (actionType === 'set_end_time')
      return current.endsAt === expected.endsAt;
    return (
      current.status === expected.status &&
      current.dailyBudgetMinor === expected.dailyBudgetMinor &&
      current.lifetimeBudgetMinor === expected.lifetimeBudgetMinor &&
      current.endsAt === expected.endsAt
    );
  }

  private matchesChange(state: MetaAdWritableState, input: ExecuteInput) {
    if (input.actionType === 'set_status') {
      return state.status === String(input.change.status).toUpperCase();
    }
    if (input.actionType === 'set_budget') {
      const value = String(input.change.budgetAmountMinor);
      return input.change.budgetKind === 'daily'
        ? state.dailyBudgetMinor === value
        : state.lifetimeBudgetMinor === value;
    }
    return state.endsAt === this.timestamp(input.change.endsAt);
  }

  private text(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private integerText(value: unknown) {
    if (
      typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 0
    ) {
      return String(value);
    }
    const text = this.text(value);
    return text && /^\d+$/.test(text) ? text : null;
  }

  private timestamp(value: unknown) {
    const text = this.text(value);
    if (!text) return null;
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
}
