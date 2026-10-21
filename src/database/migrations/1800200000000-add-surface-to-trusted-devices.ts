import type { MigrationInterface, QueryRunner } from 'typeorm';

/** CA14 — legacy devices remain Agency devices; no credential changes. */
export class AddSurfaceToTrustedDevices1800200000000 implements MigrationInterface {
  name = 'AddSurfaceToTrustedDevices1800200000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE user_trusted_devices ADD COLUMN surface varchar(16) NOT NULL DEFAULT 'agency'`,
    );
    await q.query(
      `ALTER TABLE user_trusted_devices ADD CONSTRAINT ck_trusted_device_surface CHECK (surface IN ('agency','client_area'))`,
    );
    await q.query(
      `CREATE INDEX idx_trusted_device_surface ON user_trusted_devices(tenant_id,user_id,surface,device_fingerprint)`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    // Client rows must never become legacy Agency devices after rollback.
    await q.query(
      `DELETE FROM user_trusted_devices WHERE surface='client_area'`,
    );
    await q.query(`DROP INDEX idx_trusted_device_surface`);
    await q.query(
      `ALTER TABLE user_trusted_devices DROP CONSTRAINT ck_trusted_device_surface`,
    );
    await q.query(`ALTER TABLE user_trusted_devices DROP COLUMN surface`);
  }
}
