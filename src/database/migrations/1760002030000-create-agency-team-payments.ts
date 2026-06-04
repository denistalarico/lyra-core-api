import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgencyTeamPayments1760002030000 implements MigrationInterface {
  name = 'CreateAgencyTeamPayments1760002030000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE team_payment_batch_status_enum AS ENUM ('draft', 'generated', 'cancelled', 'archived');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE team_payment_status_enum AS ENUM ('draft', 'scheduled', 'confirmed', 'invoice_created', 'payment_pending', 'paid', 'cancelled', 'archived');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE team_payment_calculation_mode_enum AS ENUM ('monthly', 'hourly', 'daily', 'per_project', 'manual');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE team_payment_item_type_enum AS ENUM ('base', 'benefit', 'discount', 'overtime', 'adjustment');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE team_payment_document_type_enum AS ENUM ('statement', 'payslip', 'benefits_declaration', 'advance_voucher', 'attendance_report', 'receipt');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS team_payment_batches (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        competence_start date NOT NULL,
        competence_end date NOT NULL,
        status team_payment_batch_status_enum NOT NULL DEFAULT 'draft',
        generated_at timestamptz NULL,
        generated_by_id uuid NULL,
        notes text NULL,
        metadata jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS team_payments (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        batch_id uuid NULL REFERENCES team_payment_batches(id) ON DELETE SET NULL,
        member_id uuid NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
        contract_id uuid NULL,
        finance_bill_id uuid NULL,
        finance_payment_id uuid NULL,
        competence_start date NOT NULL,
        competence_end date NOT NULL,
        due_date date NULL,
        paid_at timestamptz NULL,
        status team_payment_status_enum NOT NULL DEFAULT 'draft',
        calculation_mode team_payment_calculation_mode_enum NOT NULL DEFAULT 'manual',
        base_amount numeric(14,2) NOT NULL DEFAULT 0,
        worked_hours numeric(10,2) NOT NULL DEFAULT 0,
        overtime_hours numeric(10,2) NOT NULL DEFAULT 0,
        worked_days numeric(10,2) NOT NULL DEFAULT 0,
        gross_amount numeric(14,2) NOT NULL DEFAULT 0,
        benefits_total numeric(14,2) NOT NULL DEFAULT 0,
        discounts_total numeric(14,2) NOT NULL DEFAULT 0,
        net_amount numeric(14,2) NOT NULL DEFAULT 0,
        currency varchar(3) NOT NULL DEFAULT 'BRL',
        notes text NULL,
        metadata jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS team_payment_items (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        payment_id uuid NOT NULL REFERENCES team_payments(id) ON DELETE CASCADE,
        type team_payment_item_type_enum NOT NULL DEFAULT 'adjustment',
        name varchar(180) NOT NULL,
        description text NULL,
        amount numeric(14,2) NOT NULL DEFAULT 0,
        quantity numeric(10,2) NOT NULL DEFAULT 1,
        unit_value numeric(14,2) NOT NULL DEFAULT 0,
        metadata jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS team_payment_documents (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        payment_id uuid NOT NULL REFERENCES team_payments(id) ON DELETE CASCADE,
        type team_payment_document_type_enum NOT NULL DEFAULT 'statement',
        title varchar(180) NOT NULL,
        html_content text NULL,
        pdf_file_key text NULL,
        status varchar(40) NOT NULL DEFAULT 'draft',
        generated_at timestamptz NULL,
        metadata jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_team_payment_batches_tenant_workspace ON team_payment_batches(tenant_id, workspace_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_team_payments_tenant_workspace_member ON team_payments(tenant_id, workspace_id, member_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_team_payments_tenant_workspace_status ON team_payments(tenant_id, workspace_id, status)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_team_payments_competence ON team_payments(tenant_id, workspace_id, competence_start, competence_end)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_team_payment_items_payment ON team_payment_items(tenant_id, workspace_id, payment_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_team_payment_documents_payment ON team_payment_documents(tenant_id, workspace_id, payment_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS team_payment_documents`);
    await queryRunner.query(`DROP TABLE IF EXISTS team_payment_items`);
    await queryRunner.query(`DROP TABLE IF EXISTS team_payments`);
    await queryRunner.query(`DROP TABLE IF EXISTS team_payment_batches`);
    await queryRunner.query(`DROP TYPE IF EXISTS team_payment_document_type_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS team_payment_item_type_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS team_payment_calculation_mode_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS team_payment_status_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS team_payment_batch_status_enum`);
  }
}
