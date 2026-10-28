import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { resolveCname, resolveTxt } from 'node:dns/promises';
import { Repository } from 'typeorm';
import {
  clientAreaHostname,
  resolveClientAreaDomainCname,
} from '../client-area.config';
import { ClientAreaSettingsEntity } from '../entities/client-area-settings.entity';
import { ClientAreaManagementService } from './client-area-management.service';

const MAX_VERIFICATION_AGE_MS = 26 * 60 * 60 * 1000;
export { clientAreaHostname };

@Injectable()
export class ClientAreaPublicBrandingService {
  private readonly logger = new Logger(ClientAreaPublicBrandingService.name);
  constructor(
    @InjectRepository(ClientAreaSettingsEntity, 'agency')
    private readonly repo: Repository<ClientAreaSettingsEntity>,
    private readonly management: ClientAreaManagementService,
    private readonly config: ConfigService,
  ) {}
  lookupTxt(host: string) {
    return resolveTxt(host);
  }
  lookupCname(host: string) {
    return resolveCname(host);
  }
  private fresh(row: ClientAreaSettingsEntity) {
    return (
      row.enabled &&
      row.domainMode === 'custom' &&
      row.domainVerificationStatus === 'verified' &&
      row.domainVerifiedAt &&
      Date.now() - row.domainVerifiedAt.getTime() < MAX_VERIFICATION_AGE_MS
    );
  }
  async resolve(slug: string | undefined, host: string) {
    const hostname = clientAreaHostname(host);
    if (
      slug !== undefined &&
      (typeof slug !== 'string' || !/^[a-z0-9-]{3,48}$/.test(slug))
    )
      throw this.notFound();
    if (slug === undefined && !hostname) throw this.notFound();
    const row = await this.repo.findOne({
      where:
        slug !== undefined
          ? { publicSlug: slug }
          : {
              customDomain: hostname!,
              enabled: true,
              domainMode: 'custom',
              domainVerificationStatus: 'verified',
            },
    });
    if (!row?.enabled || (slug === undefined && !this.fresh(row)))
      throw this.notFound();
    return {
      branding: await this.management.branding(row.tenantId, row.workspaceId),
    };
  }
  private notFound() {
    return new NotFoundException({
      statusCode: 404,
      message: 'Client Area is unavailable.',
    });
  }
  async verify(tenantId: string, workspaceId: string) {
    const row = await this.repo.findOne({ where: { tenantId, workspaceId } });
    if (
      !row?.customDomain ||
      row.domainMode !== 'custom' ||
      !row.domainVerificationToken
    )
      throw this.notFound();
    return this.check(row);
  }
  private async check(row: ClientAreaSettingsEntity) {
    let verified = false;
    const expectedCname = resolveClientAreaDomainCname(this.config);
    if (expectedCname && row.customDomain && row.domainVerificationToken) {
      try {
        const [txt, cnames] = await Promise.all([
          this.lookupTxt(`_lyra-verify.${row.customDomain}`),
          this.lookupCname(row.customDomain),
        ]);
        verified =
          txt.some((parts) => parts.join('') === row.domainVerificationToken) &&
          cnames.some((name) => clientAreaHostname(name) === expectedCname);
      } catch {
        verified = false;
      }
    }
    const status = verified ? 'verified' : 'failed';
    // A DNS response for an old challenge must never verify a replacement domain.
    const result = await this.repo.update(
      {
        id: row.id,
        customDomain: row.customDomain!,
        domainVerificationToken: row.domainVerificationToken!,
      },
      {
        domainVerificationStatus: status,
        domainVerifiedAt: verified ? new Date() : null,
      },
    );
    return {
      status: result.affected ? status : 'pending',
      txtName: `_lyra-verify.${row.customDomain}`,
      cnameTarget: expectedCname,
    };
  }
  @Cron('0 3 * * *')
  async revalidateDomains() {
    const rows = await this.repo.find({
      where: { domainMode: 'custom', domainVerificationStatus: 'verified' },
    });
    for (const row of rows) {
      try {
        await this.check(row);
      } catch {
        this.logger.error(
          `Client Area domain revalidation failed for settings ${row.id}`,
        );
      }
    }
  }
  async isAllowedOrigin(origin: string) {
    try {
      const url = new URL(origin);
      if (url.protocol !== 'https:' || url.origin !== origin || url.port)
        return false;
      const row = await this.repo.findOne({
        where: {
          customDomain: url.hostname,
          enabled: true,
          domainMode: 'custom',
          domainVerificationStatus: 'verified',
        },
      });
      return Boolean(row && this.fresh(row));
    } catch {
      return false;
    }
  }
}
