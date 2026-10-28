import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import {
  resolve4,
  resolve6,
  resolveCname,
  resolveTxt,
} from 'node:dns/promises';
import { Repository } from 'typeorm';
import {
  clientAreaHostname,
  resolveClientAreaDomainCname,
} from '../client-area.config';
import { ClientAreaSettingsEntity } from '../entities/client-area-settings.entity';
import { ClientAreaManagementService } from './client-area-management.service';

const MAX_VERIFICATION_AGE_MS = 26 * 60 * 60 * 1000;
// Generous: the first handshake is what makes the edge (Caddy on-demand TLS)
// issue the certificate, and an ACME order takes several seconds.
const TLS_PROBE_TIMEOUT_MS = 20_000;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
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
  lookupA(host: string) {
    return resolve4(host);
  }
  lookupAaaa(host: string) {
    return resolve6(host);
  }
  /** Any HTTP answer over a validated certificate means HTTPS is live. */
  async probeTls(host: string) {
    try {
      await fetch(`https://${host}/client-area/public-branding`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TLS_PROBE_TIMEOUT_MS),
      });
      return true;
    } catch {
      return false;
    }
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
  /**
   * The domain points at the platform either by CNAME (subdomains) or by
   * A/AAAA records (apex, which cannot hold a CNAME). Address records must
   * all belong to the target: a stray one sends visitors — and the ACME
   * validation, which prefers IPv6 — somewhere else.
   */
  private async pointsToPlatform(domain: string, target: string) {
    const none = () => [] as string[];
    const [cnames, a, aaaa, targetA, targetAaaa] = await Promise.all([
      this.lookupCname(domain).catch(none),
      this.lookupA(domain).catch(none),
      this.lookupAaaa(domain).catch(none),
      this.lookupA(target).catch(none),
      this.lookupAaaa(target).catch(none),
    ]);
    if (cnames.some((name) => clientAreaHostname(name) === target))
      return 'cname' as const;
    const within = (found: string[], allowed: string[]) =>
      found.every((address) => allowed.includes(address));
    return a.length > 0 && within(a, targetA) && within(aaaa, targetAaaa)
      ? ('a' as const)
      : null;
  }
  private async check(row: ClientAreaSettingsEntity) {
    let verified = false;
    let pointedBy: 'cname' | 'a' | null = null;
    const expectedCname = resolveClientAreaDomainCname(this.config);
    if (expectedCname && row.customDomain && row.domainVerificationToken) {
      try {
        const [txt, pointer] = await Promise.all([
          this.lookupTxt(`_lyra-verify.${row.customDomain}`),
          this.pointsToPlatform(row.customDomain, expectedCname),
        ]);
        pointedBy = pointer;
        verified =
          txt.some((parts) => parts.join('') === row.domainVerificationToken) &&
          pointer !== null;
      } catch {
        verified = false;
      }
    }
    const status = verified ? 'verified' : 'failed';
    // A DNS response for an old challenge must never verify a replacement domain.
    const challenge = {
      id: row.id,
      customDomain: row.customDomain!,
      domainVerificationToken: row.domainVerificationToken!,
    };
    const result = await this.repo.update(challenge, {
      domainVerificationStatus: status,
      domainVerifiedAt: verified ? new Date() : null,
      ...(verified ? {} : { domainTlsActiveAt: null }),
    });
    // Probed only after the row is verified: the edge asks `isTlsAllowed`
    // before issuing, so this handshake is what obtains the certificate.
    let tlsActive = false;
    if (verified && result.affected) {
      tlsActive = await this.probeTls(row.customDomain!);
      await this.repo.update(challenge, {
        domainTlsActiveAt: tlsActive
          ? (row.domainTlsActiveAt ?? new Date())
          : null,
      });
    }
    return {
      status: result.affected ? status : 'pending',
      txtName: `_lyra-verify.${row.customDomain}`,
      cnameTarget: expectedCname,
      pointedBy,
      tlsActive,
    };
  }
  /**
   * Caddy `on_demand_tls.ask`: a certificate is issued only for a domain the
   * Client Area would serve right now. Loopback-only and never through the
   * public proxy (which always adds X-Forwarded-For / X-Real-IP).
   */
  async isTlsAllowed(
    domain: unknown,
    remoteAddress: string | undefined,
    forwarded: boolean,
  ) {
    if (forwarded || !LOOPBACK.has(remoteAddress ?? '')) return false;
    const hostname =
      typeof domain === 'string' ? clientAreaHostname(domain) : null;
    if (!hostname) return false;
    const row = await this.repo.findOne({
      where: {
        customDomain: hostname,
        enabled: true,
        domainMode: 'custom',
        domainVerificationStatus: 'verified',
      },
    });
    return Boolean(row && this.fresh(row));
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
