import { Injectable, Logger } from '@nestjs/common';
import type { Readable } from 'node:stream';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { BrandKitService } from '../../brand-kit/services/brand-kit.service';
import type { BrandKitAssetResponse } from '../../brand-kit/dto/brand-kit.view';

/**
 * The client's logo for the report letterhead — Etapa 9.
 *
 * ## Why the bytes are inlined instead of linked
 *
 * A Brand Kit asset lives in a **private** bucket. It is never exposed as a
 * URL: the frontend reads it through `/brand-kit/assets/:id/content`, which
 * sits behind `JwtAuthGuard` + `PermissionsGuard`.
 *
 * Playwright renders the report with `setContent`, so the page has no cookies,
 * no Authorization header and no session of any kind. An `<img src>` pointing
 * at that endpoint would be fetched anonymously, answered with a 401, and the
 * logo would be **silently missing from the PDF** — a failure that looks like a
 * layout bug and only ever shows up in the finished document. A signed URL is
 * not the answer either: it is a bearer capability, and the Brand Kit
 * deliberately refuses to mint one (see `brand-kit-asset.entity.ts`).
 *
 * So the bytes are read server-side, under the caller's own scope, and inlined
 * as a `data:` URI. The image is already in the document when Chromium opens
 * it, and nothing is fetched over the network at all.
 *
 * ## Authorization
 *
 * `BrandKitService.getAssetContent` is called with the request's own context,
 * so the scope filter *is* the authorization — an asset belonging to another
 * tenant, or to a different client, does not match and surfaces as a 404. This
 * service adds no scope logic of its own, which is exactly why it goes through
 * the service the Brand Kit module exports rather than touching storage.
 */

/**
 * Ceiling on the inlined logo.
 *
 * A `data:` URI is base64 and costs ~33% over the raw bytes, and it is carried
 * in the HTML handed to Chromium. 2 MiB is far above any real logo and low
 * enough that a mistakenly uploaded print-resolution asset degrades to "no
 * logo" instead of to a render that hangs.
 */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/** Formats a browser will render inline without a plugin. */
const RENDERABLE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]);

@Injectable()
export class SocialAnalyticsReportLogoService {
  private readonly logger = new Logger(SocialAnalyticsReportLogoService.name);

  constructor(private readonly brandKit: BrandKitService) {}

  /**
   * The client's logo as a `data:` URI, or null.
   *
   * Null is a first-class outcome, not an error: a client with no Brand Kit,
   * or with one that has no logo yet, gets a letterhead with their name and no
   * mark. Failing the export over a missing logo would deny the operator a
   * report they need over decoration.
   */
  async resolveClientLogo(ctx: RequestContext): Promise<string | null> {
    try {
      const assets = await this.brandKit.listAssets(ctx);
      const logo = this.pickLogo(assets);

      if (!logo) return null;

      const { asset, file } = await this.brandKit.getAssetContent(ctx, logo.id);

      if (!RENDERABLE_MIME.has(asset.mimeType)) {
        this.logger.warn(
          `Brand Kit logo ${logo.id} has mime type ${asset.mimeType}, which will not render in a PDF; skipping.`,
        );
        return null;
      }

      const bytes = await this.readBounded(file.body);

      if (!bytes) return null;

      return `data:${asset.mimeType};base64,${bytes.toString('base64')}`;
    } catch (error) {
      // Same reasoning as the null above, one level out: a Brand Kit that is
      // unreachable must not take the report down with it.
      this.logger.warn(
        `Could not resolve the client logo for the report letterhead: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /**
   * Which asset is "the logo".
   *
   * The Brand Kit stores shape as `variant` × `theme` rather than naming one
   * asset primary, so this picks the one that suits a printed letterhead:
   *
   * - `usage: 'asset'` only — a `reference` is material the operator uploaded
   *   for the generators to look at, not the mark itself.
   * - `theme: 'light'` first, because the report prints on white paper. A
   *   dark-theme logo is drawn for dark surfaces and can be near-invisible
   *   there — and a logo that vanishes on the page is worse than none, since
   *   the gap reads as a broken image.
   * - `horizontal` before `vertical` before `mark`: the letterhead slot is a
   *   wide, short band, which is the shape a horizontal lockup is made for.
   */
  private pickLogo(
    assets: BrandKitAssetResponse[],
  ): BrandKitAssetResponse | null {
    const logos = assets.filter(
      (asset) => asset.kind === 'logo' && asset.usage === 'asset',
    );

    if (logos.length === 0) return null;

    const rank = (asset: BrandKitAssetResponse): number => {
      // A null theme is not "dark": it is an asset uploaded before the axis
      // mattered, so it ranks with light rather than being pushed behind it.
      const themeScore = asset.theme === 'dark' ? 10 : 0;
      const variantScore =
        asset.variant === 'horizontal'
          ? 0
          : asset.variant === 'vertical'
            ? 1
            : 2;

      return themeScore + variantScore;
    };

    return [...logos].sort((a, b) => rank(a) - rank(b))[0] ?? null;
  }

  /**
   * Reads the stream, giving up past the ceiling.
   *
   * Returns null rather than throwing on an oversized asset: the caller's
   * contract is "a logo or no logo", and this is the no-logo case with a
   * reason worth logging. The stream is destroyed so an oversized object does
   * not keep being pulled from storage after the decision is made.
   */
  private async readBounded(stream: Readable): Promise<Buffer | null> {
    const chunks: Buffer[] = [];
    let total = 0;

    for await (const chunk of stream) {
      const part = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk as Uint8Array);

      total += part.length;

      if (total > MAX_LOGO_BYTES) {
        stream.destroy();
        this.logger.warn(
          `Brand Kit logo exceeds ${MAX_LOGO_BYTES} bytes; the report will print without it.`,
        );
        return null;
      }

      chunks.push(part);
    }

    return Buffer.concat(chunks);
  }
}
