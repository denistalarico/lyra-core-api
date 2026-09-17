import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Persists the operator's selected conversation channels for Meta Boost. */
export class AddSocialBoostMessageDestinations1793800000000
  implements MigrationInterface
{
  name = 'AddSocialBoostMessageDestinations1793800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_boost_templates"
      ADD COLUMN IF NOT EXISTS "message_destinations" jsonb NOT NULL
      DEFAULT '{"destinations":[],"whatsappPhoneNumber":null}'::jsonb
    `);
    await queryRunner.query(`
      ALTER TABLE "social_boost_templates"
      ADD CONSTRAINT "CK_social_boost_templates_message_destinations_object"
      CHECK (jsonb_typeof("message_destinations") = 'object')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_boost_templates"
      DROP CONSTRAINT IF EXISTS "CK_social_boost_templates_message_destinations_object"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_boost_templates"
      DROP COLUMN IF EXISTS "message_destinations"
    `);
  }
}
