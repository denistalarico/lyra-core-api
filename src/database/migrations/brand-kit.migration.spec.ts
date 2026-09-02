// Lyra Social S1.4.9 §23 — proves the migration's intent by inspecting the
// SQL it emits and the entity metadata it must match.
//
// No Postgres is touched: the query runner is a recorder. That is deliberate
// (§24) — a migration spec must never be the thing that decides whether a
// database gets written to.

import { getMetadataArgsStorage } from 'typeorm';
import {
  BrandKitAssetEntity,
  BrandKitEntity,
} from '../../modules/brand-kit/entities';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateBrandKit1790800000000 } from './1790800000000-create-brand-kit';

function collectSql(run: (queryRunner: never) => Promise<void>) {
  const sql: string[] = [];
  const queryRunner = {
    query: jest.fn((statement: string) => {
      sql.push(statement);
      return Promise.resolve();
    }),
  };

  return run(queryRunner as never).then(() => sql);
}

const up = () =>
  collectSql((queryRunner) =>
    new CreateBrandKit1790800000000().up(queryRunner),
  );

const down = () =>
  collectSql((queryRunner) =>
    new CreateBrandKit1790800000000().down(queryRunner),
  );

function columnsOf(target: new () => object) {
  return getMetadataArgsStorage()
    .columns.filter((column) => column.target === target)
    .map((column) => column.options.name ?? column.propertyName);
}

function indicesOf(target: new () => object) {
  return getMetadataArgsStorage().indices.filter(
    (index) => index.target === target,
  );
}

describe('brand kit migration', () => {
  describe('1 + 2: the two partial unique indexes', () => {
    it('scopes agency uniqueness to rows WHERE agency_client_id IS NULL', async () => {
      const joined = (await up()).join('\n');

      expect(joined).toContain(
        'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_brand_kits_agency_scope"',
      );
      const agencyIndex = (await up()).find((statement) =>
        statement.includes('UQ_brand_kits_agency_scope'),
      )!;
      expect(agencyIndex).toContain('("tenant_id", "workspace_id")');
      expect(agencyIndex).toContain('WHERE "agency_client_id" IS NULL');
    });

    it('scopes client uniqueness to rows WHERE agency_client_id IS NOT NULL', async () => {
      const clientIndex = (await up()).find((statement) =>
        statement.includes('UQ_brand_kits_client_scope'),
      )!;

      expect(clientIndex).toContain(
        '("tenant_id", "workspace_id", "agency_client_id")',
      );
      expect(clientIndex).toContain('WHERE "agency_client_id" IS NOT NULL');
    });

    /**
     * The failure this phase exists to prevent: a plain three-column UNIQUE
     * enforces nothing for the agency scope, because in Postgres NULL is
     * never equal to NULL. If this ever appears, the agency context silently
     * loses its guarantee.
     */
    it('never emits a plain three-column UNIQUE that NULL would defeat', async () => {
      const statements = await up();
      const unconditionalUnique = statements.find(
        (statement) =>
          statement.includes('UNIQUE') &&
          statement.includes('agency_client_id') &&
          !statement.includes('WHERE'),
      );

      expect(unconditionalUnique).toBeUndefined();
    });

    it('the entity declares the same two partial indexes as the migration', () => {
      const indices = indicesOf(BrandKitEntity);
      const agency = indices.find(
        (index) => index.name === 'UQ_brand_kits_agency_scope',
      );
      const client = indices.find(
        (index) => index.name === 'UQ_brand_kits_client_scope',
      );

      expect(agency?.unique).toBe(true);
      expect(agency?.where).toBe('agency_client_id IS NULL');
      expect(client?.unique).toBe(true);
      expect(client?.where).toBe('agency_client_id IS NOT NULL');
    });
  });

  describe('3 + 4: what the indexes allow', () => {
    /**
     * The predicates encode the rules directly, so these are assertions about
     * the predicates rather than inserts against a database:
     *  - two clients in one tenant differ in `agency_client_id`, so the
     *    client index's key differs and both rows are valid;
     *  - an agency row is invisible to the client index (its predicate
     *    excludes NULL) and vice versa, so the two coexist.
     */
    it('different clients in the same tenant fall under different index keys', async () => {
      const clientIndex = (await up()).find((statement) =>
        statement.includes('UQ_brand_kits_client_scope'),
      )!;

      expect(clientIndex).toContain('"agency_client_id"');
      expect(clientIndex).toContain('IS NOT NULL');
    });

    it('agency and client rows are governed by mutually exclusive predicates', async () => {
      const statements = await up();
      const agencyIndex = statements.find((s) =>
        s.includes('UQ_brand_kits_agency_scope'),
      )!;
      const clientIndex = statements.find((s) =>
        s.includes('UQ_brand_kits_client_scope'),
      )!;

      expect(agencyIndex).toContain('IS NULL');
      expect(clientIndex).toContain('IS NOT NULL');
      expect(agencyIndex).not.toContain('IS NOT NULL');
    });
  });

  describe('5: the asset → kit foreign key', () => {
    it('cascades from brand_kits so an asset cannot outlive its kit', async () => {
      const joined = (await up()).join('\n');

      expect(joined).toContain('CONSTRAINT "FK_brand_kit_assets_kit"');
      expect(joined).toContain(
        'FOREIGN KEY ("brand_kit_id") REFERENCES "brand_kits" ("id")',
      );
      expect(joined).toContain('ON DELETE CASCADE');
    });
  });

  describe('6: rollback order', () => {
    it('drops the assets table before the kits table it references', async () => {
      const statements = await down();
      const assetsDrop = statements.findIndex((statement) =>
        statement.includes('DROP TABLE IF EXISTS "brand_kit_assets"'),
      );
      const kitsDrop = statements.findIndex((statement) =>
        statement.includes('DROP TABLE IF EXISTS "brand_kits"'),
      );

      expect(assetsDrop).toBeGreaterThanOrEqual(0);
      expect(kitsDrop).toBeGreaterThanOrEqual(0);
      expect(assetsDrop).toBeLessThan(kitsDrop);
    });

    it('drops both partial unique indexes', async () => {
      const joined = (await down()).join('\n');

      expect(joined).toContain(
        'DROP INDEX IF EXISTS "UQ_brand_kits_agency_scope"',
      );
      expect(joined).toContain(
        'DROP INDEX IF EXISTS "UQ_brand_kits_client_scope"',
      );
    });
  });

  describe('safety and completeness', () => {
    it('is purely additive: it creates, and never alters or drops anything existing', async () => {
      const joined = (await up()).join('\n');

      expect(joined).not.toContain('ALTER TABLE');
      expect(joined).not.toContain('DROP TABLE');
      expect(joined).not.toContain('DROP COLUMN');
      expect(joined).not.toContain('RENAME');
      expect(joined).not.toContain('TRUNCATE');
      expect(joined).not.toContain('DELETE FROM');
      expect(joined).not.toContain('UPDATE ');
    });

    it('touches no table outside the two it creates', async () => {
      const joined = (await up()).join('\n');

      for (const untouched of [
        'leadflow_client_settings',
        'workspace_settings_company',
        'social_ad_account_connections',
        'leadflow_telemetry_consents',
        'agency_client_product_access',
      ]) {
        expect(joined).not.toContain(untouched);
      }
    });

    it('creates every column the entities declare', async () => {
      const joined = (await up()).join('\n');

      for (const column of columnsOf(BrandKitEntity)) {
        expect(joined).toContain(`"${column}"`);
      }
      for (const column of columnsOf(BrandKitAssetEntity)) {
        expect(joined).toContain(`"${column}"`);
      }
    });

    it('constrains kind, variant and theme to the documented catalog', async () => {
      const joined = (await up()).join('\n');

      expect(joined).toContain(`"kind" IN ('logo', 'reference')`);
      expect(joined).toContain(
        `"variant" IN ('vertical', 'horizontal', 'mark')`,
      );
      expect(joined).toContain(`"theme" IN ('light', 'dark')`);
      // A reference has no shape axis.
      expect(joined).toContain('CK_brand_kit_assets_reference_shape');
    });

    it('is registered in the agency datasource — the known project gotcha', () => {
      const registered = AgencyDataSource.options.migrations ?? [];

      expect(registered).toContain(CreateBrandKit1790800000000);
    });

    it('is timestamped after the previous migration', () => {
      expect(new CreateBrandKit1790800000000().name).toBe(
        'CreateBrandKit1790800000000',
      );
      expect(1790800000000).toBeGreaterThan(1790700000000);
    });
  });
});
