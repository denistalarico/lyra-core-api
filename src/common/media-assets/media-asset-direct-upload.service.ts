// src/common/media-assets/media-asset-direct-upload.service.ts
//
// Browser → R2 multipart upload for heavy videos (2026-11-18). See
// `media-asset-direct-upload.rules.ts` for the why. Provided by the importing
// product module next to `MediaAssetUploadService`, for the same reason that
// one is (it needs the metadata reader bound there).

import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { FilesService } from '../files/files.service';
import {
  assertDirectUploadPartNumbers,
  assertDirectUploadRequest,
  assertDirectUploadSize,
  type DirectUploadClaims,
  directUploadPartCount,
  MEDIA_ASSET_DIRECT_UPLOAD_PART_BYTES,
  MEDIA_ASSET_DIRECT_UPLOAD_PART_URL_TTL_SECONDS,
  MEDIA_ASSET_DIRECT_UPLOAD_TOKEN_TTL_SECONDS,
  normalizeDirectUploadParts,
  signDirectUploadToken,
  verifyDirectUploadToken,
} from './media-asset-direct-upload.rules';
import type { MediaAssetScope } from './media-asset-resolver.service';
import {
  assertCreativeDocumentSize,
  buildMediaAssetObjectKey,
  creativeDocumentMimeFromName,
  sanitizeCreativeDocumentFilename,
  sanitizeMediaAssetFilename,
} from './media-asset-upload.rules';
import { MediaAssetUploadService } from './media-asset-upload.service';

export type DirectUploadStart = {
  token: string;
  partSize: number;
  partCount: number;
  expiresAt: string;
};

@Injectable()
export class MediaAssetDirectUploadService {
  constructor(
    private readonly files: FilesService,
    private readonly uploads: MediaAssetUploadService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 503 `direct_upload_unavailable` when R2 is not configured: the web app
   * then falls back to the regular upload (within its own limit).
   */
  async start(
    scope: MediaAssetScope,
    actorUserId: string | null,
    input: {
      filename: string;
      mimeType: string;
      byteSize: number;
      source: string;
    },
  ): Promise<DirectUploadStart> {
    if (!this.files.hasR2()) {
      throw new ServiceUnavailableException({
        code: 'direct_upload_unavailable',
        message: 'Envio direto indisponível.',
      });
    }
    const documentMime =
      input.source === 'creative_studio'
        ? creativeDocumentMimeFromName(input.filename)
        : undefined;
    if (documentMime) {
      assertDirectUploadSize(input.byteSize);
      assertCreativeDocumentSize(input.byteSize);
    }
    const mimeType = documentMime ?? assertDirectUploadRequest(input);
    const { assetId, objectKey } = buildMediaAssetObjectKey({
      tenantId: scope.tenantId,
      agencyClientId: scope.agencyClientId,
      contentType: mimeType,
    });
    const path = this.files.r2Path(objectKey);
    const uploadId = await this.files.createPrivateMultipartUpload({
      path,
      contentType: documentMime ? 'application/octet-stream' : mimeType,
    });
    const exp =
      Math.floor(Date.now() / 1000) +
      MEDIA_ASSET_DIRECT_UPLOAD_TOKEN_TTL_SECONDS;
    const claims: DirectUploadClaims = {
      v: 1,
      path,
      uploadId,
      assetId,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      companyContextId: scope.companyContextId,
      actorUserId,
      source: input.source,
      mimeType,
      byteSize: input.byteSize,
      filename: documentMime
        ? sanitizeCreativeDocumentFilename(input.filename, documentMime)
        : sanitizeMediaAssetFilename(input.filename),
      exp,
    };
    return {
      token: signDirectUploadToken(claims, this.secret()),
      partSize: MEDIA_ASSET_DIRECT_UPLOAD_PART_BYTES,
      partCount: directUploadPartCount(input.byteSize),
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  async signParts(
    scope: MediaAssetScope,
    actorUserId: string | null,
    token: string,
    partNumbers: number[],
  ) {
    const claims = this.claimsFor(scope, actorUserId, token);
    assertDirectUploadPartNumbers(
      partNumbers,
      directUploadPartCount(claims.byteSize),
    );
    const parts = await Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await this.files.presignUploadPart({
          path: claims.path,
          uploadId: claims.uploadId,
          partNumber,
          ttlSeconds: MEDIA_ASSET_DIRECT_UPLOAD_PART_URL_TTL_SECONDS,
        }),
      })),
    );
    return { parts };
  }

  /**
   * Joins the parts and registers the asset. `expectedSource` stops a token
   * issued by one surface (Planner) from being completed through another
   * (Creative Studio), whose completion creates more than a media row.
   */
  async complete(
    scope: MediaAssetScope,
    actorUserId: string | null,
    token: string,
    parts: ReadonlyArray<{ partNumber: number; etag: string }>,
    expectedSource?: string,
  ) {
    const claims = this.claimsFor(scope, actorUserId, token);
    if (expectedSource && claims.source !== expectedSource) {
      throw new BadRequestException(
        'Envio expirado ou inválido. Envie o arquivo novamente.',
      );
    }
    const ordered = normalizeDirectUploadParts(
      parts,
      directUploadPartCount(claims.byteSize),
    );
    try {
      await this.files.completePrivateMultipartUpload({
        path: claims.path,
        uploadId: claims.uploadId,
        parts: ordered,
      });
    } catch (error) {
      // A retried completion finds the upload gone; the row decides below.
      if (!isMissingUpload(error)) {
        await this.abortQuietly(claims);
        throw new BadRequestException(
          'O envio ficou incompleto. Envie o arquivo novamente.',
        );
      }
    }
    return this.uploads.registerStoredObject(scope, actorUserId, {
      storagePath: claims.path,
      assetId: claims.assetId,
      declaredBytes: claims.byteSize,
      declaredMimeType: claims.mimeType,
      originalFilename: claims.filename,
      source: claims.source,
    });
  }

  async abort(
    scope: MediaAssetScope,
    actorUserId: string | null,
    token: string,
  ): Promise<void> {
    await this.abortQuietly(this.claimsFor(scope, actorUserId, token));
  }

  private async abortQuietly(claims: DirectUploadClaims) {
    try {
      await this.files.abortPrivateMultipartUpload({
        path: claims.path,
        uploadId: claims.uploadId,
      });
    } catch {
      // R2 discards incomplete multipart uploads on its own.
    }
  }

  /** The token is only valid in the scope and for the person that started it. */
  private claimsFor(
    scope: MediaAssetScope,
    actorUserId: string | null,
    token: string,
  ): DirectUploadClaims {
    const claims = verifyDirectUploadToken(
      token,
      this.secret(),
      Math.floor(Date.now() / 1000),
    );
    if (
      claims.tenantId !== scope.tenantId ||
      claims.workspaceId !== scope.workspaceId ||
      claims.agencyClientId !== scope.agencyClientId ||
      claims.companyContextId !== scope.companyContextId ||
      claims.actorUserId !== actorUserId
    ) {
      throw new BadRequestException(
        'Envio expirado ou inválido. Envie o arquivo novamente.',
      );
    }
    return claims;
  }

  /**
   * Derived from the R2 secret (server-only, already required for R2), so no
   * new env var exists and rotating the R2 key also invalidates open tokens.
   */
  private secret(): Buffer {
    const r2Secret = this.config.get<string>('files.r2.secretAccessKey');
    if (!r2Secret) {
      throw new ServiceUnavailableException({
        code: 'direct_upload_unavailable',
        message: 'Envio direto indisponível.',
      });
    }
    return createHash('sha256')
      .update(`lyra-media-direct-upload:v1:${r2Secret}`)
      .digest();
  }
}

function isMissingUpload(error: unknown): boolean {
  const candidate = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  } | null;
  return (
    candidate?.name === 'NoSuchUpload' ||
    candidate?.$metadata?.httpStatusCode === 404
  );
}
