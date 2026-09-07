import { BadRequestException } from '@nestjs/common';

export type MetaOrganicGraphErrorKind =
  | 'transient'
  | 'rate_limited'
  | 'credential_invalid'
  | 'permission_denied'
  | 'permanent';

export type MetaOrganicGraphErrorCode =
  | 'meta_network_error'
  | 'meta_request_timeout'
  | 'meta_rate_limited'
  | 'meta_credential_invalid'
  | 'meta_permission_denied'
  | 'meta_service_unavailable'
  | 'meta_request_rejected'
  | 'meta_invalid_response'
  | 'meta_pagination_limit';

/** Fixed-code failure: raw Meta text and request URLs never cross this edge. */
export class MetaOrganicGraphError extends BadRequestException {
  readonly kind: MetaOrganicGraphErrorKind;
  readonly code: MetaOrganicGraphErrorCode;
  readonly httpStatus: number | null;
  readonly metaCode: number | null;
  readonly metaSubcode: number | null;

  constructor(input: {
    kind: MetaOrganicGraphErrorKind;
    code: MetaOrganicGraphErrorCode;
    httpStatus?: number | null;
    metaCode?: number | null;
    metaSubcode?: number | null;
  }) {
    super(input.code);
    this.name = 'MetaOrganicGraphError';
    this.kind = input.kind;
    this.code = input.code;
    this.httpStatus = input.httpStatus ?? null;
    this.metaCode = input.metaCode ?? null;
    this.metaSubcode = input.metaSubcode ?? null;
  }
}
