import type { MigrationInterface, QueryRunner } from 'typeorm';

/** What a standalone piece is about, written by whoever sends it. */
export class AddSocialApprovalPieceDescription1803400000000 implements MigrationInterface {
  name = 'AddSocialApprovalPieceDescription1803400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "social_approval_pieces" ADD COLUMN IF NOT EXISTS "description" text`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "social_approval_pieces" DROP COLUMN IF EXISTS "description"`,
    );
  }
}
