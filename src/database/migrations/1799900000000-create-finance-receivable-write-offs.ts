import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFinanceReceivableWriteOffs1799900000000 implements MigrationInterface {
  name = 'CreateFinanceReceivableWriteOffs1799900000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS written_off_amount numeric(14,2) NOT NULL DEFAULT 0`,
    );
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_finance_invoices_write_off_scope" ON finance_invoices(tenant_id, workspace_id, id)`,
    );
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_finance_accounts_write_off_scope" ON finance_accounts(tenant_id, workspace_id, id)`,
    );
    await q.query(`CREATE TABLE IF NOT EXISTS finance_receivable_write_offs (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      invoice_id uuid NOT NULL, amount numeric(14,2) NOT NULL CHECK (amount > 0), currency varchar(3) NOT NULL,
      write_off_date date NOT NULL, reason varchar(2000) NOT NULL CHECK (length(trim(reason)) > 0), evidence varchar(2000),
      expense_account_id uuid NOT NULL, idempotency_key uuid NOT NULL,
      journal_entry_id uuid, status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reversed')),
      created_by_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
      reversed_at timestamptz, reversed_by_id uuid, reversal_date date, reversal_reason varchar(2000), reversal_entry_id uuid,
      CONSTRAINT "UQ_finance_write_off_idempotency" UNIQUE(tenant_id, workspace_id, idempotency_key),
      CONSTRAINT "FK_finance_write_off_invoice" FOREIGN KEY(tenant_id, workspace_id, invoice_id)
        REFERENCES finance_invoices(tenant_id, workspace_id, id) ON DELETE RESTRICT,
      CONSTRAINT "FK_finance_write_off_expense_account" FOREIGN KEY(tenant_id, workspace_id, expense_account_id)
        REFERENCES finance_accounts(tenant_id, workspace_id, id) ON DELETE RESTRICT,
      CONSTRAINT "CHK_finance_write_off_reversal" CHECK (
        (status = 'active' AND reversed_at IS NULL AND reversal_date IS NULL AND reversal_entry_id IS NULL)
        OR (status = 'reversed' AND reversed_at IS NOT NULL AND reversal_date IS NOT NULL AND reversal_date >= write_off_date
          AND reversal_reason IS NOT NULL AND length(trim(reversal_reason)) > 0 AND reversal_entry_id IS NOT NULL))
    )`);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_finance_write_off_invoice" ON finance_receivable_write_offs(tenant_id, workspace_id, invoice_id, write_off_date)`,
    );

    // A database guard also protects old API clients and read/modify/save paths
    // that loaded the invoice before a concurrent write-off committed.
    await q.query(`CREATE OR REPLACE FUNCTION finance_guard_invoice_write_off() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE expected numeric(14,2);
    BEGIN
      IF OLD.written_off_amount > 0 OR NEW.written_off_amount > 0 THEN
        SELECT coalesce(sum(amount),0) INTO expected FROM finance_receivable_write_offs
          WHERE tenant_id=NEW.tenant_id AND workspace_id=NEW.workspace_id AND invoice_id=NEW.id AND status='active';
        IF NEW.written_off_amount <> expected OR NEW.total_amount <> OLD.total_amount
          OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
          OR NEW.tenant_id <> OLD.tenant_id OR NEW.workspace_id <> OLD.workspace_id
          OR NEW.issue_date IS DISTINCT FROM OLD.issue_date OR NEW.period_start IS DISTINCT FROM OLD.period_start
          OR NEW.period_end IS DISTINCT FROM OLD.period_end
          OR NEW.status::text IN ('draft','cancelled','void') THEN
          RAISE EXCEPTION 'Estorne as perdas antes de alterar a operação original da fatura.';
        END IF;
        IF NEW.paid_amount < 0 OR NEW.paid_amount + NEW.written_off_amount > NEW.total_amount THEN
          RAISE EXCEPTION 'Recebimentos e perdas excedem o total da fatura.';
        END IF;
        NEW.balance_due := greatest(0, NEW.total_amount - NEW.paid_amount - NEW.written_off_amount);
        IF NEW.paid_amount >= NEW.total_amount AND NEW.written_off_amount = 0 THEN
          NEW.status := 'paid'; NEW.paid_at := coalesce(NEW.paid_at, now());
        ELSIF NEW.paid_amount > 0 THEN NEW.status := 'partially_paid'; NEW.paid_at := NULL;
        ELSE NEW.status := 'issued'; NEW.paid_at := NULL;
        END IF;
      END IF;
      RETURN NEW;
    END $$`);
    await q.query(
      `CREATE TRIGGER finance_invoice_write_off_guard BEFORE UPDATE ON finance_invoices FOR EACH ROW EXECUTE FUNCTION finance_guard_invoice_write_off()`,
    );

    await q.query(`CREATE OR REPLACE FUNCTION finance_guard_write_off_record() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE inv finance_invoices%ROWTYPE; active_amount numeric(14,2);
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'O histórico de perdas não pode ser excluído.'; END IF;
      IF TG_OP = 'UPDATE' AND (
        (OLD.id, OLD.tenant_id, OLD.workspace_id, OLD.invoice_id, OLD.amount, OLD.currency, OLD.write_off_date,
          OLD.reason, OLD.evidence, OLD.expense_account_id, OLD.idempotency_key, OLD.created_by_id, OLD.created_at)
        IS DISTINCT FROM
        (NEW.id, NEW.tenant_id, NEW.workspace_id, NEW.invoice_id, NEW.amount, NEW.currency, NEW.write_off_date,
          NEW.reason, NEW.evidence, NEW.expense_account_id, NEW.idempotency_key, NEW.created_by_id, NEW.created_at)
        OR (OLD.journal_entry_id IS NOT NULL AND OLD.journal_entry_id IS DISTINCT FROM NEW.journal_entry_id)
        OR OLD.status = 'reversed') THEN RAISE EXCEPTION 'O registro de perda é imutável; use um estorno.';
      END IF;
      SELECT * INTO inv FROM finance_invoices WHERE id=NEW.invoice_id AND tenant_id=NEW.tenant_id
        AND workspace_id=NEW.workspace_id FOR UPDATE;
      IF NOT FOUND OR inv.currency <> NEW.currency OR inv.status::text IN ('draft','cancelled','void') THEN
        RAISE EXCEPTION 'A perda exige uma fatura emitida no mesmo escopo e moeda.';
      END IF;
      SELECT coalesce(sum(amount),0) INTO active_amount FROM finance_receivable_write_offs
        WHERE invoice_id=NEW.invoice_id AND tenant_id=NEW.tenant_id AND workspace_id=NEW.workspace_id
        AND status='active' AND id <> NEW.id;
      IF NEW.status='active' THEN active_amount := active_amount + NEW.amount; END IF;
      IF active_amount + inv.paid_amount > inv.total_amount THEN RAISE EXCEPTION 'A perda excede o saldo disponível.'; END IF;
      RETURN NEW;
    END $$`);
    await q.query(
      `CREATE TRIGGER finance_write_off_record_guard BEFORE INSERT OR UPDATE OR DELETE ON finance_receivable_write_offs FOR EACH ROW EXECUTE FUNCTION finance_guard_write_off_record()`,
    );
    await q.query(`CREATE OR REPLACE FUNCTION finance_sync_write_off_balance() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE finance_invoices SET written_off_amount=(SELECT coalesce(sum(amount),0) FROM finance_receivable_write_offs
        WHERE invoice_id=NEW.invoice_id AND tenant_id=NEW.tenant_id AND workspace_id=NEW.workspace_id AND status='active')
        WHERE id=NEW.invoice_id AND tenant_id=NEW.tenant_id AND workspace_id=NEW.workspace_id;
      RETURN NEW;
    END $$`);
    await q.query(
      `CREATE TRIGGER finance_write_off_balance_sync AFTER INSERT OR UPDATE ON finance_receivable_write_offs FOR EACH ROW EXECUTE FUNCTION finance_sync_write_off_balance()`,
    );
    await q.query(`CREATE OR REPLACE FUNCTION finance_guard_write_off_items() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE parent_id uuid; loss numeric(14,2);
    BEGIN
      IF TG_OP='DELETE' THEN parent_id:=OLD.invoice_id; ELSE parent_id:=NEW.invoice_id; END IF;
      SELECT written_off_amount INTO loss FROM finance_invoices WHERE id=parent_id FOR UPDATE;
      IF loss > 0 THEN RAISE EXCEPTION 'Estorne as perdas antes de editar os itens da fatura.'; END IF;
      IF TG_OP='UPDATE' AND OLD.invoice_id <> NEW.invoice_id THEN
        SELECT written_off_amount INTO loss FROM finance_invoices WHERE id=OLD.invoice_id FOR UPDATE;
        IF loss > 0 THEN RAISE EXCEPTION 'Estorne as perdas antes de editar os itens da fatura.'; END IF;
      END IF;
      IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END $$`);
    await q.query(
      `CREATE TRIGGER finance_write_off_items_guard BEFORE INSERT OR UPDATE OR DELETE ON finance_invoice_lines FOR EACH ROW EXECUTE FUNCTION finance_guard_write_off_items()`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    // Never silently remove financial evidence during a rollback.
    const rows = (await q.query(
      `SELECT 1 FROM finance_receivable_write_offs LIMIT 1`,
    )) as unknown[];
    if (rows.length)
      throw new Error(
        'Não é possível remover a migração com histórico de perdas registrado.',
      );
    await q.query(
      `DROP TRIGGER IF EXISTS finance_write_off_items_guard ON finance_invoice_lines`,
    );
    await q.query(
      `DROP TRIGGER IF EXISTS finance_invoice_write_off_guard ON finance_invoices`,
    );
    await q.query(`DROP TABLE finance_receivable_write_offs`);
    await q.query(
      `DROP FUNCTION finance_guard_invoice_write_off(), finance_guard_write_off_record(), finance_sync_write_off_balance(), finance_guard_write_off_items()`,
    );
    await q.query(
      `ALTER TABLE finance_invoices DROP COLUMN written_off_amount`,
    );
    await q.query(
      `DROP INDEX IF EXISTS "IDX_finance_invoices_write_off_scope"`,
    );
    await q.query(
      `DROP INDEX IF EXISTS "IDX_finance_accounts_write_off_scope"`,
    );
  }
}
