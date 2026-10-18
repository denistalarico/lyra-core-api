import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ClientAreaPublicBrandingAndPreferences1799800000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE client_area_settings
      ADD COLUMN public_slug varchar(48),
      ADD COLUMN domain_verification_token varchar(64),
      ADD COLUMN domain_verified_at timestamptz`);
    await q.query(`UPDATE client_area_settings s SET public_slug =
      coalesce(nullif(trim(both '-' from left(regexp_replace(lower(coalesce(nullif(s.display_name,''),
        (SELECT coalesce(nullif(w.trade_name,''),nullif(w.workspace_name,''),w.legal_name) FROM workspace_company_settings w WHERE w.tenant_id=s.tenant_id AND w.workspace_id=s.workspace_id LIMIT 1), 'agency')), '[^a-z0-9]+', '-', 'g'), 15)),''),'agency') || '-' || replace(gen_random_uuid()::text,'-','')`);
    await q.query(`ALTER TABLE client_area_settings ALTER COLUMN public_slug SET NOT NULL,
      ALTER COLUMN public_slug SET DEFAULT ('agency-' || replace(gen_random_uuid()::text,'-','')),
      ADD CONSTRAINT "CHK_ca8_public_slug" CHECK (public_slug ~ '^[a-z0-9-]{3,48}$')`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_ca8_public_slug" ON client_area_settings(public_slug)`,
    );
    await q.query(
      `UPDATE client_area_settings SET domain_verification_token=replace(gen_random_uuid()::text || gen_random_uuid()::text,'-',''), domain_verification_status='pending' WHERE domain_mode='custom' AND custom_domain IS NOT NULL`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_ca8_verified_domain" ON client_area_settings(lower(custom_domain)) WHERE domain_verification_status='verified'`,
    );
    await q.query(`CREATE TABLE client_area_identity_preferences (
      tenant_id uuid NOT NULL, user_id uuid NOT NULL,
      theme varchar(8) NOT NULL DEFAULT 'system' CHECK (theme IN ('light','dark','system')),
      locale varchar(10) NOT NULL DEFAULT 'pt-BR' CHECK (locale IN ('pt-BR','en','es')),
      PRIMARY KEY (tenant_id,user_id))`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS client_area_identity_preferences');
    await q.query('DROP INDEX IF EXISTS "UQ_ca8_verified_domain"');
    await q.query('DROP INDEX IF EXISTS "UQ_ca8_public_slug"');
    await q.query(`ALTER TABLE client_area_settings DROP CONSTRAINT IF EXISTS "CHK_ca8_public_slug",
      DROP COLUMN IF EXISTS public_slug, DROP COLUMN IF EXISTS domain_verification_token,
      DROP COLUMN IF EXISTS domain_verified_at`);
  }
}
