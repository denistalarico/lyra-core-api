import { randomUUID } from 'node:crypto';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { getAgencyTypeOrmConfig } from '../../config/typeorm.config';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { SocialAdAccountConnectionEntity } from '../social-integrations/entities/social-ad-account-connection.entity';
import { SocialAdConnectionService } from '../social-integrations/services/social-ad-connection.service';
import {
  SocialOrganicAssetEntity,
  SocialOrganicConnectionEntity,
} from '../social-organic/entities';
import { SocialOrganicConnectionService } from '../social-organic/connections/social-organic-connection.service';

describePostgresIntegration()(
  'CA14 integration option isolation (lyra_agency_test only)',
  () => {
    let admin: DataSource, db: DataSource;
    const schema = `ca14_oauth_${randomUUID().replaceAll('-', '')}`;
    const scope = {
      tenantId: randomUUID(),
      workspaceId: randomUUID(),
      agencyClientId: randomUUID(),
      companyContextId: randomUUID(),
    };
    const session = randomUUID();
    const ids = {
      own: randomUUID(),
      foreign: randomUUID(),
      agencyPending: randomUUID(),
      connected: randomUUID(),
    };
    beforeAll(async () => {
      if (process.env.AGENCY_DB_NAME !== 'lyra_agency_test')
        throw new Error('CA14 integrations require lyra_agency_test');
      const config = getAgencyTypeOrmConfig();
      admin = await new DataSource({
        ...config,
        entities: [],
        migrations: [],
        migrationsRun: false,
        synchronize: false,
      } as DataSourceOptions).initialize();
      await admin.query(`CREATE SCHEMA "${schema}"`);
      db = await new DataSource({
        ...config,
        schema,
        entities: [
          SocialAdAccountConnectionEntity,
          SocialOrganicConnectionEntity,
          SocialOrganicAssetEntity,
        ],
        migrations: [],
        migrationsRun: false,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      } as DataSourceOptions).initialize();
      await db.synchronize();
      for (const [kind, id] of Object.entries(ids)) {
        const metadata = {
          companyContextId: scope.companyContextId,
          ...(kind === 'own' || kind === 'foreign'
            ? {
                clientAreaBinding: {
                  sessionId: kind === 'own' ? session : randomUUID(),
                },
              }
            : {}),
          selectableAccounts: [{ externalAccountId: kind }],
          selectableAssets: [
            { externalAssetId: kind, assetType: 'facebook_page' },
          ],
        };
        await db.getRepository(SocialAdAccountConnectionEntity).save({
          id,
          ...scope,
          provider: 'meta_ads',
          connectionStatus:
            kind === 'connected' ? 'connected' : 'awaiting_selection',
          externalAccountId: kind === 'connected' ? 'act_1' : null,
          oauthExpiresAt: new Date(Date.now() + 60000),
          metadata,
        });
        await db.getRepository(SocialOrganicConnectionEntity).save({
          id,
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          agencyClientId: scope.agencyClientId,
          provider: 'meta',
          authorizationMethod: 'oauth_business',
          connectionStatus:
            kind === 'connected' ? 'connected' : 'awaiting_selection',
          oauthExpiresAt: new Date(Date.now() + 60000),
          metadata,
        });
      }
    });
    afterAll(async () => {
      if (db?.isInitialized) await db.destroy();
      if (admin?.isInitialized) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.destroy();
      }
    });
    it('Ads hides pending accounts from another session and preserves established company connections', async () => {
      const service = new SocialAdConnectionService(
        db.getRepository(SocialAdAccountConnectionEntity),
      );
      expect(
        (await service.list({ ...scope, clientAreaSessionId: session }))
          .map((row) => row.id)
          .sort(),
      ).toEqual([ids.own, ids.connected].sort());
      expect((await service.list(scope)).length).toBe(4);
      expect(
        await service.list({
          ...scope,
          companyContextId: randomUUID(),
          clientAreaSessionId: session,
        }),
      ).toEqual([]);
    });
    it('Organic applies the same session rule to unbound account/asset choices', async () => {
      const service = new SocialOrganicConnectionService(
        db.getRepository(SocialOrganicConnectionEntity),
        db.getRepository(SocialOrganicAssetEntity),
        db,
        {} as never,
        {} as never,
      );
      expect(
        (await service.list({ ...scope, clientAreaSessionId: session }))
          .map((row) => row.id)
          .sort(),
      ).toEqual([ids.own, ids.connected].sort());
      expect((await service.list(scope)).length).toBe(4);
      expect(
        await service.list({
          ...scope,
          companyContextId: randomUUID(),
          clientAreaSessionId: session,
        }),
      ).toEqual([]);
    });
  },
);
