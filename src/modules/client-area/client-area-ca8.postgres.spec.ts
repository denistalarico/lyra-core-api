import { randomUUID } from 'node:crypto';
import { ClientAreaIdentityPreferencesEntity } from './entities/client-area-identity-preferences.entity';
import { ClientAreaPreferencesController } from './controllers/client-area-preferences.controller';
import type { ClientAreaRequest } from './client-area.types';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { getAgencyTypeOrmConfig } from '../../config/typeorm.config';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { ClientAreaPublicBrandingAndPreferences1799800000000 } from '../../database/migrations/1799800000000-client-area-public-branding-and-preferences';

describePostgresIntegration()('CA8 migration (lyra_agency_test only)', () => {
  let admin: DataSource, db: DataSource;
  const schema = `ca8_${randomUUID().replaceAll('-', '')}`;
  const tenant = randomUUID(),
    workspace = randomUUID();
  const migration = new ClientAreaPublicBrandingAndPreferences1799800000000();
  beforeAll(async () => {
    if (process.env.AGENCY_DB_NAME !== 'lyra_agency_test')
      throw new Error('CA8 requires lyra_agency_test');
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
      entities: [ClientAreaIdentityPreferencesEntity],
      schema,
      migrations: [],
      migrationsRun: false,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    } as DataSourceOptions).initialize();
    await db.query(
      `CREATE TABLE workspace_company_settings(tenant_id uuid,workspace_id uuid,trade_name text,workspace_name text,legal_name text)`,
    );
    await db.query(
      `CREATE TABLE client_area_settings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,workspace_id uuid,display_name text,domain_mode text DEFAULT 'default',custom_domain text,domain_verification_status text DEFAULT 'not_configured')`,
    );
    await db.query(
      `INSERT INTO client_area_settings(tenant_id,workspace_id,display_name) VALUES ($1,$2,'Agência Ágil')`,
      [tenant, workspace],
    );
  });
  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });
  it('runs up/down/up; generates unique constrained slugs and isolated preferences', async () => {
    const q = db.createQueryRunner();
    await q.connect();
    try {
      await migration.up(q);
      const [row] = (await q.query(
        'SELECT public_slug FROM client_area_settings',
      )) as Array<{ public_slug: string }>;
      expect(row.public_slug).toMatch(/^[a-z0-9-]{3,48}$/);
      await expect(
        q.query('INSERT INTO client_area_settings(public_slug) VALUES ($1)', [
          row.public_slug,
        ]),
      ).rejects.toThrow();
      await expect(
        q.query(
          "INSERT INTO client_area_settings(public_slug) VALUES ('INVALID')",
        ),
      ).rejects.toThrow();
      const person = randomUUID();
      await q.query(
        "INSERT INTO client_area_identity_preferences(tenant_id,user_id,theme,locale) VALUES ($1,$2,'dark','es'),($3,$2,'light','en')",
        [tenant, person, randomUUID()],
      );
      expect(
        await q.query(
          'SELECT theme FROM client_area_identity_preferences WHERE tenant_id=$1 AND user_id=$2',
          [tenant, person],
        ),
      ).toEqual([{ theme: 'dark' }]);
      const preferences = new ClientAreaPreferencesController(
        db.getRepository(ClientAreaIdentityPreferencesEntity),
      );
      const req = {
        clientAreaIdentity: { tenantId: tenant, userId: person },
      } as ClientAreaRequest;
      await expect(preferences.patch(req, { theme: 'light' })).resolves.toEqual(
        {
          theme: 'light',
          locale: 'es',
        },
      );
      await expect(preferences.patch(req, { locale: 'en' })).resolves.toEqual({
        theme: 'light',
        locale: 'en',
      });
      expect(
        await q.query(
          'SELECT count(*)::int AS n FROM client_area_identity_preferences WHERE user_id=$1',
          [person],
        ),
      ).toEqual([{ n: 2 }]);
      await expect(
        q.query("UPDATE client_area_identity_preferences SET theme='invalid'"),
      ).rejects.toThrow();
      await migration.down(q);
      expect(
        await q.query(
          "SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name='client_area_identity_preferences'",
          [schema],
        ),
      ).toEqual([]);
      await migration.up(q);
      expect(
        await q.query('SELECT count(*)::int AS n FROM client_area_settings'),
      ).toEqual([{ n: 1 }]);
    } finally {
      await q.release();
    }
  });
});
