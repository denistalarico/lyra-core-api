import { randomUUID } from 'node:crypto';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { ClientAreaBridgeRegistry } from '../../common/client-area-bridge/client-area-bridge.registry';
import { MediaAssetEntity } from '../../common/media-assets/media-asset.entity';
import { getAgencyTypeOrmConfig } from '../../config/typeorm.config';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { resolveMemberAccess } from '../client-area/client-area-permissions.catalog';
import type { ClientAreaContext } from '../client-area/client-area.types';
import { SocialCampaignAlertEntity } from '../social-campaigns/entities/social-campaign-alert.entity';
import { CreativeAssetVersionEntity } from '../social-creative-studio/entities/creative-asset-version.entity';
import { CreativeAssetEntity } from '../social-creative-studio/entities/creative-asset.entity';
import { SocialAdAccountConnectionEntity } from '../social-integrations/entities/social-ad-account-connection.entity';
import { SocialContentIdeaEntity } from '../social-planner/entities/social-content-idea.entity';
import { SocialContentItemEntity } from '../social-planner/entities/social-content-item.entity';
import { SocialContentReferenceEntity } from '../social-planner/entities/social-content-reference.entity';
import { SocialContentRevisionEntity } from '../social-planner/entities/social-content-revision.entity';
import { SocialPlanEntity } from '../social-planner/entities/social-plan.entity';
import { SocialCampaignInstanceEntity } from '../social-planner/entities/social-campaign-instance.entity';
import { SocialCampaignTemplateEntity } from '../social-planner/entities/social-campaign-template.entity';
import { SocialEditorialPillarEntity } from '../social-planner/entities/social-editorial-pillar.entity';
import { SocialCopyGenerationRunEntity } from '../social-planner/entities/social-copy-generation-run.entity';
import { SocialCopyGenerationProposalEntity } from '../social-planner/entities/social-copy-generation-proposal.entity';
import { SocialContentDestinationEntity } from '../social-planner/entities/social-content-destination.entity';
import { SocialPublicationEntity } from '../social-organic/publication/entities/social-publication.entity';
import { SocialOrganicAssetEntity } from '../social-organic/entities/social-organic-asset.entity';
import { SocialOrganicConnectionEntity } from '../social-organic/entities/social-organic-connection.entity';
import { CreativeFolderEntity } from '../social-creative-studio/entities/creative-folder.entity';
import {
  CreativeGenerationEntity,
  CreativeGenerationOutputEntity,
} from '../social-creative-studio/entities/creative-generation.entity';
import { CreativeVideoGenerationEntity } from '../social-creative-studio/entities/creative-video-generation.entity';
import { SocialAdGovernedActionEntity } from '../social-campaigns/entities/social-ad-governed-action.entity';
import {
  SOCIAL_CLIENT_AREA_SCOPE_SQL,
  SocialClientAreaScopeService,
} from './social-client-area-scope.service';

describePostgresIntegration()(
  'CA10 Social scope adapter against PostgreSQL (lyra_agency_test only)',
  () => {
    let admin: DataSource, db: DataSource;
    const schema = `ca10_${randomUUID().replaceAll('-', '')}`;
    const tenant = randomUUID(),
      workspace = randomUUID(),
      client = randomUUID(),
      company = randomUUID(),
      sibling = randomUUID(),
      user = randomUUID(),
      other = randomUUID();
    const ids = {
      plan: randomUUID(),
      siblingPlan: randomUUID(),
      content: randomUUID(),
      foreignAuthor: randomUUID(),
      siblingContent: randomUUID(),
      deletedContent: randomUUID(),
      revision: randomUUID(),
      idea: randomUUID(),
      asset: randomUUID(),
      version: randomUUID(),
      siblingVersion: randomUUID(),
      siblingAsset: randomUUID(),
      media: randomUUID(),
      reference: randomUUID(),
      connection: randomUUID(),
      alert: randomUUID(),
      siblingAlert: randomUUID(),
      siblingConnection: randomUUID(),
    };

    /** Fills every NOT NULL column without default, then applies `values`. */
    async function insert(table: string, values: Record<string, unknown>) {
      const columns = await db.query<
        { column_name: string; data_type: string; udt_name: string }[]
      >(
        `SELECT column_name, data_type, udt_name FROM information_schema.columns
          WHERE table_schema=$1 AND table_name=$2 AND is_nullable='NO' AND column_default IS NULL`,
        [schema, table],
      );
      const row: Record<string, unknown> = {};
      for (const column of columns) {
        if (column.column_name in values) continue;
        if (column.data_type === 'USER-DEFINED') {
          const [label] = await db.query<{ enumlabel: string }[]>(
            `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
              JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname=$1 AND n.nspname=$2
              ORDER BY e.enumsortorder LIMIT 1`,
            [column.udt_name, schema],
          );
          row[column.column_name] = label.enumlabel;
        } else
          row[column.column_name] =
            column.data_type === 'uuid'
              ? randomUUID()
              : /int|numeric|double|real/.test(column.data_type)
                ? 1
                : column.data_type === 'boolean'
                  ? false
                  : /timestamp|date/.test(column.data_type)
                    ? new Date()
                    : column.data_type === 'jsonb' ||
                        column.data_type === 'json'
                      ? {}
                      : column.data_type === 'ARRAY'
                        ? []
                        : 'x';
      }
      Object.assign(row, values);
      const keys = Object.keys(row);
      await db.query(
        `INSERT INTO ${table}(${keys.map((key) => `"${key}"`).join(',')}) VALUES(${keys.map((_, index) => `$${index + 1}`).join(',')})`,
        keys.map((key) => row[key]),
      );
    }
    const scope = (agencyClientId = client, companyContextId = company) => ({
      tenant_id: tenant,
      workspace_id: workspace,
      agency_client_id: agencyClientId,
      company_context_id: companyContextId,
    });
    const base = (agencyClientId = client) => ({
      tenant_id: tenant,
      workspace_id: workspace,
      agency_client_id: agencyClientId,
    });

    beforeAll(async () => {
      if (process.env.AGENCY_DB_NAME !== 'lyra_agency_test')
        throw new Error('CA10 requires lyra_agency_test');
      const config = getAgencyTypeOrmConfig();
      admin = await new DataSource({
        ...config,
        name: 'ca10-admin',
        synchronize: false,
        migrationsRun: false,
      } as DataSourceOptions).initialize();
      await admin.query(`CREATE SCHEMA "${schema}"`);
      db = await new DataSource({
        ...config,
        name: 'ca10',
        schema,
        entities: [
          SocialPlanEntity,
          SocialContentItemEntity,
          SocialContentRevisionEntity,
          SocialContentIdeaEntity,
          SocialContentReferenceEntity,
          CreativeAssetEntity,
          CreativeAssetVersionEntity,
          MediaAssetEntity,
          SocialAdAccountConnectionEntity,
          SocialCampaignAlertEntity,
          SocialCampaignInstanceEntity,
          SocialCampaignTemplateEntity,
          SocialEditorialPillarEntity,
          SocialCopyGenerationRunEntity,
          SocialCopyGenerationProposalEntity,
          SocialContentDestinationEntity,
          SocialPublicationEntity,
          SocialOrganicAssetEntity,
          SocialOrganicConnectionEntity,
          CreativeFolderEntity,
          CreativeGenerationEntity,
          CreativeGenerationOutputEntity,
          CreativeVideoGenerationEntity,
          SocialAdGovernedActionEntity,
        ],
        synchronize: false,
        migrationsRun: false,
        extra: { options: `-c search_path=${schema},public` },
      } as DataSourceOptions).initialize();
      // Entity schema only in this disposable schema; nothing touches public.
      await db.synchronize();
      await insert('social_plans', {
        id: ids.plan,
        ...scope(),
        created_by_id: other,
        deleted_at: null,
      });
      await insert('social_plans', {
        id: ids.siblingPlan,
        ...scope(client, sibling),
        created_by_id: user,
        deleted_at: null,
      });
      for (const [id, plan, creator, deleted] of [
        [ids.content, ids.plan, user, null],
        [ids.foreignAuthor, ids.plan, other, null],
        [ids.siblingContent, ids.siblingPlan, user, null],
        [ids.deletedContent, ids.plan, user, new Date()],
      ] as const)
        await insert('social_content_items', {
          id,
          ...base(),
          plan_id: plan,
          created_by_id: creator,
          deleted_at: deleted,
        });
      await insert('social_content_revisions', {
        source: 'human',
        hashtags: '[]',
        id: ids.revision,
        ...base(),
        content_item_id: ids.content,
        created_by_id: user,
      });
      await insert('social_content_ideas', {
        status: 'open',
        converted_content_item_id: null,
        id: ids.idea,
        ...scope(),
        created_by_id: other,
      });
      await insert('media_assets', {
        id: ids.media,
        ...scope(),
        created_by_id: user,
        deleted_at: null,
      });
      await insert('social_content_references', {
        id: ids.reference,
        ...scope(),
        content_item_id: ids.content,
        media_asset_id: ids.media,
        created_by_id: user,
      });
      await insert('social_creative_assets', {
        asset_type: 'image',
        status: 'ready',
        id: ids.asset,
        ...scope(),
        created_by_id: user,
      });
      await insert('social_creative_assets', {
        asset_type: 'image',
        status: 'ready',
        id: ids.siblingAsset,
        ...scope(client, sibling),
        created_by_id: user,
      });
      await insert('social_creative_asset_versions', {
        source: 'upload',
        id: ids.version,
        creative_asset_id: ids.asset,
        created_by_id: user,
      });
      await insert('social_creative_asset_versions', {
        source: 'upload',
        id: ids.siblingVersion,
        creative_asset_id: ids.siblingAsset,
        created_by_id: user,
      });
      await insert('social_ad_account_connections', {
        id: ids.connection,
        ...scope(),
        credential_removed_at: null,
      });
      await insert('social_ad_account_connections', {
        id: ids.siblingConnection,
        ...scope(client, sibling),
        credential_removed_at: null,
      });
      await insert('social_campaign_alerts', {
        id: ids.alert,
        ...base(),
        connection_id: ids.connection,
      });
      await insert('social_campaign_alerts', {
        deduplication_key: 'sibling',
        id: ids.siblingAlert,
        ...base(),
        connection_id: ids.siblingConnection,
      });
    });
    afterAll(async () => {
      await db?.destroy();
      await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin?.destroy();
    });

    // The tables come from the current entities (synchronize). The shared
    // public schema of lyra_agency_test lags the migrations (it has no
    // social_content_references) and is not migrated by this spec.
    it('runs every scope template against the schema of the current entities', async () => {
      for (const [ref, sql] of Object.entries(SOCIAL_CLIENT_AREA_SCOPE_SQL))
        await expect(
          db
            .query(sql, [tenant, workspace, [randomUUID()]])
            .then((rows: unknown[]) => [ref, rows]),
        ).resolves.toEqual([ref, []]);
    });

    const context = (level: 'viewer' | 'operator' | 'manager') =>
      ({
        surface: 'client_area',
        tenantId: tenant,
        workspaceId: workspace,
        agencyClientId: client,
        companyContextId: company,
        userId: user,
        memberAccess: resolveMemberAccess(
          'client_member',
          {
            social_planner: true,
            social_creative_studio: true,
            social_campaigns: true,
          },
          {
            social_planner: level,
            social_creative_studio: level,
            social_campaigns: level,
          },
        ),
      }) as ClientAreaContext;
    const adapter = () =>
      new SocialClientAreaScopeService(db, new ClientAreaBridgeRegistry());
    const resolve = (
      module: 'social_planner' | 'social_creative_studio' | 'social_campaigns',
      level: 'viewer' | 'operator' | 'manager',
      method: string,
      routePath: string,
      parts: {
        params?: Record<string, string>;
        query?: Record<string, string>;
        body?: Record<string, unknown>;
      } = {},
    ) =>
      adapter().resolve(module, context(level), 'k', {
        method,
        routePath: `/api${routePath}`,
        params: parts.params ?? {},
        query: parts.query ?? {},
        body: parts.body ?? null,
      });

    it('takes a content row company from its plan, so a sibling company never matches', async () => {
      const get = (contentId: string) =>
        resolve(
          'social_planner',
          'viewer',
          'GET',
          '/social/planner/content/:contentId',
          { params: { contentId } },
        );
      await expect(get(ids.content)).resolves.toMatchObject({
        companyContextId: company,
        createdById: user,
      });
      await expect(get(ids.foreignAuthor)).resolves.toMatchObject({
        createdById: other,
      });
      await expect(get(ids.siblingContent)).resolves.toBeNull();
      await expect(get(ids.deletedContent)).resolves.toBeNull();
      await expect(
        resolve(
          'social_planner',
          'viewer',
          'GET',
          '/social/planner/plans/:planId',
          { params: { planId: ids.siblingPlan } },
        ),
      ).resolves.toBeNull();
    });

    it('proves nested and body ids against the real rows', async () => {
      await expect(
        resolve(
          'social_planner',
          'operator',
          'POST',
          '/social/planner/content/:contentId/revisions/:revisionId/restore',
          { params: { contentId: ids.content, revisionId: ids.revision } },
        ),
      ).resolves.toMatchObject({ createdById: user });
      await expect(
        resolve(
          'social_planner',
          'operator',
          'POST',
          '/social/planner/content/:contentId/revisions/:revisionId/restore',
          {
            params: { contentId: ids.foreignAuthor, revisionId: ids.revision },
          },
        ),
      ).resolves.toBeNull();
      await expect(
        resolve(
          'social_planner',
          'operator',
          'PUT',
          '/social/planner/content/:contentId/references/order',
          {
            params: { contentId: ids.content },
            body: { referenceIds: [ids.reference] },
          },
        ),
      ).resolves.toMatchObject({ createdById: user });
      await expect(
        resolve(
          'social_planner',
          'operator',
          'POST',
          '/social/planner/content/:contentId/references',
          {
            params: { contentId: ids.content },
            body: { mediaAssetId: ids.media },
          },
        ),
      ).resolves.toMatchObject({ companyContextId: company });
      await expect(
        resolve(
          'social_planner',
          'operator',
          'POST',
          '/social/planner/ideas/:ideaId/convert',
          { params: { ideaId: ids.idea }, body: { planId: ids.plan } },
        ),
      ).resolves.toBeNull();
      await expect(
        resolve(
          'social_planner',
          'manager',
          'POST',
          '/social/planner/ideas/:ideaId/convert',
          { params: { ideaId: ids.idea }, body: { planId: ids.siblingPlan } },
        ),
      ).resolves.toBeNull();
    });

    it('scopes Studio versions through their asset and campaign alerts through their connection', async () => {
      const content = (versionId: string) =>
        resolve(
          'social_creative_studio',
          'viewer',
          'GET',
          '/social/creative-studio/assets/:id/content',
          { params: { id: ids.asset }, query: { versionId } },
        );
      await expect(content(ids.version)).resolves.toMatchObject({
        companyContextId: company,
      });
      await expect(content(ids.siblingVersion)).resolves.toBeNull();
      const acknowledge = (alertId: string) =>
        resolve(
          'social_campaigns',
          'manager',
          'PATCH',
          '/social/campaigns/meta/alerts/:alertId/acknowledge',
          { params: { alertId } },
        );
      await expect(acknowledge(ids.alert)).resolves.toMatchObject({
        companyContextId: company,
      });
      await expect(acknowledge(ids.siblingAlert)).resolves.toBeNull();
      await expect(
        resolve(
          'social_campaigns',
          'viewer',
          'GET',
          '/social/campaigns/meta/monitor',
          { query: { connectionId: ids.siblingConnection } },
        ),
      ).resolves.toBeNull();
    });
  },
);
