import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePasswordResets1760000009000 implements MigrationInterface {
  name = 'CreatePasswordResets1760000009000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        user_id uuid NOT NULL,
        token_hash text NOT NULL,
        expires_at timestamptz NOT NULL,
        used_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_password_resets_token_hash
      ON password_resets (token_hash);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_password_resets_tenant_user
      ON password_resets (tenant_id, user_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS idx_password_resets_tenant_user;',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS idx_password_resets_token_hash;',
    );
    await queryRunner.query('DROP TABLE IF EXISTS password_resets;');
  }
}
