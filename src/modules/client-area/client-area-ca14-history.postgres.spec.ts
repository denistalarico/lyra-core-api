import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { getAgencyTypeOrmConfig } from '../../config/typeorm.config';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { CompanyLogoRegistry } from '../../common/client-area-bridge/company-logo.registry';
import { AgencyClient } from '../clients/entities/agency-client.entity';
import { AgencyClientCompanyContext } from '../clients/entities/agency-client-company-context.entity';
import { AuditChangeEventEntity } from './entities/audit-change-event.entity';
import { AuditChangeService } from './services/audit-change.service';
import {
  auditCsvCell,
  exportAuditChangesCsv,
} from './services/audit-change-csv';
import { ClientAreaAccessController } from './controllers/client-area-access.controller';
import type { ClientAreaContext } from './client-area.types';

jest.mock('otplib', () => ({ verify: jest.fn() }));
describePostgresIntegration()(
  'CA14 audit history (lyra_agency_test only)',
  () => {
    let admin: DataSource, db: DataSource, audit: AuditChangeService;
    const schema = `ca14_history_${randomUUID().replaceAll('-', '')}`;
    const scope = {
      tenantId: randomUUID(),
      workspaceId: randomUUID(),
      agencyClientId: randomUUID(),
      companyContextId: randomUUID(),
    };
    const sibling = randomUUID();
    beforeAll(async () => {
      if (process.env.AGENCY_DB_NAME !== 'lyra_agency_test')
        throw new Error('CA14 history requires lyra_agency_test');
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
        entities: [
          AgencyClient,
          AgencyClientCompanyContext,
          AuditChangeEventEntity,
        ],
        migrations: [],
        migrationsRun: false,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      } as DataSourceOptions).initialize();
      await db.synchronize();
      await db.getRepository(AgencyClient).save({
        id: scope.agencyClientId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        displayName: 'Client',
      });
      for (const id of [scope.companyContextId, sibling])
        await db.getRepository(AgencyClientCompanyContext).save({
          id,
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          agencyClientId: scope.agencyClientId,
          companyContactId: randomUUID(),
        });
      audit = new AuditChangeService(
        db.getRepository(AuditChangeEventEntity),
        new ConfigService(),
      );
      for (const fields of [
        {},
        { internal: true },
        { companyContextId: sibling },
        { workspaceId: randomUUID() },
        { tenantId: randomUUID() },
      ])
        await audit.record({
          ...scope,
          actorSurface: 'client_area',
          actorUserId: randomUUID(),
          moduleKey: 'settings',
          entityType: 'business_profile',
          action: 'update',
          changedFields: ['businessModeKey'],
          diff: { businessModeKey: { before: 'a', after: 'b' } },
          ip: 'private-ip',
          userAgent: 'private-agent',
          requestId: 'private-request',
          ...fields,
        });
    });
    afterAll(async () => {
      if (db?.isInitialized) await db.destroy();
      if (admin?.isInitialized) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.destroy();
      }
    });
    it('Owner history excludes internal/foreign events in SQL, including total and pagination', async () => {
      const result = await audit.list(
        scope,
        { companyContextId: scope.companyContextId, page: 1, limit: 1 },
        true,
      );
      expect(result.total).toBe(1);
      expect(result.events).toHaveLength(1);
      expect(JSON.stringify(result)).not.toMatch(
        /private-ip|private-agent|private-request/,
      );
      expect(
        (
          await audit.list(
            scope,
            { companyContextId: scope.companyContextId, page: 2, limit: 1 },
            true,
          )
        ).events,
      ).toEqual([]);
      expect((await audit.list(scope, {})).total).toBe(3);
      await expect(
        audit.list(scope, { companyContextId: randomUUID() }, true),
      ).rejects.toThrow('Company is not available');
    });
    it('the Owner facade rejects Members and foreign company filters', async () => {
      const controller = new ClientAreaAccessController(
        {} as never,
        {} as never,
        audit,
        new CompanyLogoRegistry(),
      );
      const context = {
        ...scope,
        userId: randomUUID(),
        role: 'client_member',
      } as ClientAreaContext;
      expect(() => controller.changes(context, {})).toThrow('Only the Owner');
      context.role = 'client_owner';
      expect(() =>
        controller.changes(context, { companyContextId: sibling }),
      ).toThrow('Company not found');
      expect((await controller.changes(context, {})).total).toBe(1);
    });
    it('CSV uses the same scope/internal filter and quotes formula-like values', async () => {
      const csv = await exportAuditChangesCsv(
        audit,
        scope,
        { companyContextId: scope.companyContextId },
        true,
      );
      expect(csv.split('\r\n')).toHaveLength(2);
      expect(csv).not.toMatch(/private-ip|private-agent|private-request/);
      expect(auditCsvCell(' \t=1+1')).toBe('"\' \t=1+1"');
      expect(auditCsvCell('a,"b"')).toBe('"a,""b"""');
    });
  },
);
