import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import {
  META_SIGNATURE_HEADER,
  MetaOrganicWebhookSignatureError,
  MetaOrganicWebhookSignatureService,
} from './meta-organic-webhook-signature.service';
import {
  META_ORGANIC_WEBHOOK_PROVIDER,
  buildMetaOrganicWebhookEventKey,
  readMetaOrganicWebhookVerifyToken,
  readMetaWebhookExternalAssetId,
  readMetaWebhookObjectType,
  verifyTokenMatches,
} from './meta-organic-webhook.support';
import { SocialOrganicWebhookService } from './social-organic-webhook.service';

/**
 * The Meta Organic webhook endpoint.
 *
 * Canonical URL: `https://api.lyrasuite.com/api/social/organic/webhooks/meta`
 * (`api` is the global prefix set in `main.ts`). This path is registered in the
 * Meta App dashboard, so it is a published contract — changing it silently
 * breaks an already-configured subscription.
 *
 * **Deliberately its own controller, not a route on `SocialOrganicController`.**
 * Every route there is guarded by `JwtAuthGuard` + `PermissionsGuard` and
 * derives its scope from `RequestContext`. These two routes have neither: they
 * are public, unauthenticated, and authorized *only* by the app secret (POST)
 * or the verify token (GET). Keeping them in a separate file makes that
 * difference impossible to miss and impossible to inherit by accident.
 *
 * It is also not the Inbox's `meta-webhook.controller.ts` and not the Meta Ads
 * OAuth callback: a different Meta app signs these payloads (AF-10).
 */
@Controller('social/organic/webhooks')
export class MetaOrganicWebhookController {
  private readonly logger = new Logger(MetaOrganicWebhookController.name);

  constructor(
    private readonly signatures: MetaOrganicWebhookSignatureService,
    private readonly webhooks: SocialOrganicWebhookService,
  ) {}

  /**
   * Meta's subscription handshake. Returns the challenge verbatim and nothing
   * else — no confirmation of what was wrong, no echo of the presented token.
   */
  @Get('meta')
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') presentedToken: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
  ): string {
    const expectedToken = readMetaOrganicWebhookVerifyToken();
    if (!expectedToken) {
      this.logger.error(
        'Meta organic webhook verification is not configured: ' +
          'SOCIAL_META_ORGANIC_WEBHOOK_VERIFY_TOKEN is unset.',
      );
      throw new ServiceUnavailableException(
        'Meta organic webhook verification is not configured.',
      );
    }

    if (mode !== 'subscribe' || !challenge) {
      throw new BadRequestException(
        'Invalid Meta organic webhook verification request.',
      );
    }

    if (!verifyTokenMatches(presentedToken, expectedToken)) {
      // 403 is what Meta's own documentation expects for a token mismatch, and
      // it is distinct from the 400 above so an operator can tell a malformed
      // request from a wrong token without the response saying which token.
      this.logger.warn(
        'Meta organic webhook verification rejected: verify_token_mismatch',
      );
      throw new ForbiddenException(
        'Invalid Meta organic webhook verification request.',
      );
    }

    return challenge;
  }

  /**
   * Receive one delivery.
   *
   * The whole handler is: verify HMAC over the raw bytes → derive a dedupe key
   * → one INSERT → 200. Semantic work belongs to
   * `SocialOrganicWebhookWorker`, which runs after this response is already on
   * the wire. W1.2 adds the normalizers it will call.
   */
  @Post('meta')
  @HttpCode(200)
  async receive(
    @Headers(META_SIGNATURE_HEADER) signatureHeader: string | undefined,
    @Req() request: RawBodyRequest<Request>,
  ): Promise<{ ok: true; duplicate: boolean }> {
    const rawBody = request.rawBody;

    try {
      this.signatures.verify({ signatureHeader, rawBody });
    } catch (error) {
      throw this.toSignatureHttpError(error);
    }

    // Only reached with a verified signature, so these bytes are Meta's.
    const payload = this.parsePayload(rawBody);
    const objectType = readMetaWebhookObjectType(payload);
    const externalAssetId = readMetaWebhookExternalAssetId(payload);
    const eventKey = buildMetaOrganicWebhookEventKey({
      objectType,
      externalAssetId,
      // Verification above proves rawBody exists.
      rawBody: rawBody as Buffer,
    });

    const result = await this.webhooks.ingest({
      provider: META_ORGANIC_WEBHOOK_PROVIDER,
      eventKey,
      objectType,
      externalAssetId,
      rawPayload: payload,
    });

    // Ids and safe classifications only — never the payload, and never the
    // signature (blueprint §21).
    this.logger.log(
      `Organic webhook received: ${JSON.stringify({
        eventId: result.eventId,
        provider: META_ORGANIC_WEBHOOK_PROVIDER,
        objectType,
        scopeResolution: result.scopeResolution,
        duplicate: result.duplicate,
      })}`,
    );

    // 200 for every signed delivery, including an unrecognized one: an error
    // here would make Meta retry a payload that will never become valid, and
    // eventually unsubscribe the app.
    return { ok: true, duplicate: result.duplicate };
  }

  /**
   * Safe codes in, safe HTTP out. The internal reason is logged; the response
   * body carries one constant message for every rejection, so a caller cannot
   * learn whether the secret, the header shape or the body was the problem.
   */
  private toSignatureHttpError(error: unknown): Error {
    if (!(error instanceof MetaOrganicWebhookSignatureError)) {
      return error instanceof Error ? error : new Error('unknown_error');
    }

    this.logger.warn(
      `Organic webhook signature rejected: ${JSON.stringify({
        provider: META_ORGANIC_WEBHOOK_PROVIDER,
        reason: error.code,
      })}`,
    );

    if (
      error.code === 'signature_secret_not_configured' ||
      error.code === 'raw_body_unavailable'
    ) {
      // Server-side misconfiguration, not a rejected caller.
      return new ServiceUnavailableException(
        'Meta organic webhook signature validation is not configured.',
      );
    }

    return new UnauthorizedException('Invalid Meta organic webhook signature.');
  }

  /**
   * Parsed from the verified bytes rather than taken from `@Body()`, so the
   * stored payload and the signed payload are provably the same document.
   *
   * A non-object body is stored as `{}` rather than rejected: it was correctly
   * signed, so it is a real delivery, and dropping it would lose the audit
   * trail for whatever Meta actually sent.
   */
  private parsePayload(rawBody: Buffer | undefined): Record<string, unknown> {
    if (!rawBody?.length) return {};

    try {
      const parsed: unknown = JSON.parse(rawBody.toString('utf8'));
      return parsed !== null &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
}
