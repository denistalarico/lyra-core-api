import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { getAgencyTypeOrmConfig } from '../../../config/typeorm.config';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import { CompanyLogoRegistry } from '../../../common/client-area-bridge/company-logo.registry';
import { ClientAreaSettingsRegistry } from '../../../common/client-area-bridge/client-area-settings.registry';
import type { FilesService } from '../../../common/files/files.service';
import { BrandKitAssetEntity, BrandKitEntity } from '../entities';
import { BrandKitService } from './brand-kit.service';
import { CompanyLogoResolver } from './company-logo.resolver';

describePostgresIntegration()(
  'CA14 canonical company logo (lyra_agency_test only)',
  () => {
    let admin: DataSource,
      db: DataSource,
      kit: BrandKitService,
      logos: CompanyLogoRegistry;
    const schema = `ca14_logo_${randomUUID().replaceAll('-', '')}`;
    const scope = {
      tenantId: randomUUID(),
      workspaceId: randomUUID(),
      agencyClientId: randomUUID(),
      companyContextId: randomUUID(),
    };
    const sibling = randomUUID(),
      contact = randomUUID();
    const files = {
      uploadPrivateBuffer: jest.fn().mockResolvedValue({}),
      getPrivateAsset: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve({ body: Readable.from(['image bytes']) }),
        ),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    const changes = jest.fn().mockResolvedValue(undefined);
    beforeAll(async () => {
      if (process.env.AGENCY_DB_NAME !== 'lyra_agency_test')
        throw new Error('CA14 logo requires lyra_agency_test');
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
        entities: [BrandKitEntity, BrandKitAssetEntity],
        migrations: [],
        migrationsRun: false,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      } as DataSourceOptions).initialize();
      await db.synchronize();
      await db.query(
        'CREATE TABLE agency_clients(id uuid, tenant_id uuid, workspace_id uuid, archived_at timestamptz, status text)',
      );
      await db.query(
        'CREATE TABLE contacts(id uuid, tenant_id uuid, workspace_id uuid, type text, status text)',
      );
      await db.query(
        'CREATE TABLE agency_client_company_contexts(id uuid, tenant_id uuid, workspace_id uuid, agency_client_id uuid, company_contact_id uuid, status text, archived_at timestamptz, is_primary boolean, created_at timestamptz DEFAULT now())',
      );
      await db.query(
        'CREATE TABLE agency_contact_profiles(tenant_id uuid, workspace_id uuid, contact_id uuid, avatar_url text)',
      );
      await db.query(
        "INSERT INTO agency_clients VALUES ($1,$2,$3,NULL,'active')",
        [scope.agencyClientId, scope.tenantId, scope.workspaceId],
      );
      await db.query(
        "INSERT INTO contacts VALUES ($1,$2,$3,'organization','active')",
        [contact, scope.tenantId, scope.workspaceId],
      );
      for (const id of [scope.companyContextId, sibling])
        await db.query(
          "INSERT INTO agency_client_company_contexts(id,tenant_id,workspace_id,agency_client_id,company_contact_id,status,is_primary) VALUES ($1,$2,$3,$4,$5,'active',$6)",
          [
            id,
            scope.tenantId,
            scope.workspaceId,
            scope.agencyClientId,
            contact,
            id === scope.companyContextId,
          ],
        );
      await db.query(
        'INSERT INTO agency_contact_profiles VALUES ($1,$2,$3,$4)',
        [scope.tenantId, scope.workspaceId, contact, '/avatar/contact.png'],
      );
      const audit = new ClientAreaSettingsRegistry();
      audit.registerAuditWriter(changes);
      kit = new BrandKitService(
        db,
        db.getRepository(BrandKitEntity),
        db.getRepository(BrandKitAssetEntity),
        files as unknown as FilesService,
        audit,
      );
      logos = new CompanyLogoRegistry();
      new CompanyLogoResolver(db, logos, kit).onModuleInit();
    });
    afterAll(async () => {
      if (db?.isInitialized) await db.destroy();
      if (admin?.isInitialized) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.destroy();
      }
    });

    it('uses the contact avatar until a Client Area upload changes the canonical Brand Kit', async () => {
      expect(await logos.resolve(scope)).toBe('/avatar/contact.png');
      const ctx = {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        userId: randomUUID(),
        role: 'client_area_actor',
        managedContext: {
          operatingMode: 'client' as const,
          productKey: 'social' as const,
          clientId: scope.agencyClientId,
          companyContextId: scope.companyContextId,
          managedTenantId: null,
        },
      };
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlS8AAAAASUVORK5CYII=',
        'base64',
      );
      const uploaded = await kit.uploadAsset(ctx, {
        kind: 'logo',
        file: {
          buffer: png,
          originalname: 'logo.png',
          mimetype: 'image/png',
          size: png.length,
        },
      });
      expect(await logos.resolve(scope)).toContain(`?v=${uploaded.id}`);
      expect(await logos.resolve({ ...scope, surface: 'client_area' })).toBe(
        `/client-area/companies/${scope.companyContextId}/logo?v=${uploaded.id}`,
      );
      expect(
        await logos.resolve({ ...scope, companyContextId: undefined }),
      ).toContain(uploaded.id);
      expect((await logos.read(scope)).mimeType).toBe('image/png');
      expect(changes).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'brand_kit_asset',
          actorSurface: 'client_area',
          entityId: uploaded.id,
        }),
      );
      await kit.updateBrandKit(ctx, { guidelines: 'Keep spacing.' });
      expect(changes).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'brand_kit',
          diff: { guidelines: { before: null, after: 'Keep spacing.' } },
        }),
      );
    });

    it('company, client, workspace and tenant filters exclude foreign logos', async () => {
      expect(await logos.resolve({ ...scope, companyContextId: sibling })).toBe(
        '/avatar/contact.png',
      );
      for (const foreign of [
        { ...scope, tenantId: randomUUID() },
        { ...scope, workspaceId: randomUUID() },
        { ...scope, agencyClientId: randomUUID() },
        { ...scope, companyContextId: randomUUID() },
      ]) {
        expect(await logos.resolve(foreign)).toBeNull();
        await expect(logos.read(foreign)).rejects.toThrow('Logo not found');
      }
    });

    it('a new logo is immediately resolved everywhere; tombstones and archives disappear', async () => {
      const old = await db
        .getRepository(BrandKitAssetEntity)
        .findOneByOrFail({ kind: 'logo' });
      const next = await db.getRepository(BrandKitAssetEntity).save({
        ...old,
        id: randomUUID(),
        createdAt: new Date(Date.now() + 1000),
      });
      expect(
        await logos.resolveMany([scope, { ...scope, surface: 'client_area' }]),
      ).toEqual([
        expect.stringContaining(next.id),
        expect.stringContaining(next.id),
      ]);
      await db.getRepository(BrandKitAssetEntity).softDelete(next.id);
      expect(await logos.resolve(scope)).toContain(old.id);
      await db.query(
        "UPDATE agency_client_company_contexts SET status='archived' WHERE id=$1",
        [scope.companyContextId],
      );
      expect(await logos.resolve(scope)).toBeNull();
    });
  },
);
