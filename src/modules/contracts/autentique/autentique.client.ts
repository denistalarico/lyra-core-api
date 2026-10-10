// GraphQL client for the Autentique API (https://docs.autentique.com.br/api).
//
// Native `fetch`, no SDK. Every request is bounded by a timeout, never follows
// redirects on the API host, and maps failures to a typed error so callers can
// tell a definite rejection (safe to retry the send) from an uncertain outcome
// (the document may exist on Autentique even though we got no answer).

export const AUTENTIQUE_DEFAULT_API_BASE_URL =
  'https://api.autentique.com.br/v2';

const DEFAULT_TIMEOUT_MS = 30_000;
const CREATE_DOCUMENT_TIMEOUT_MS = 90_000;
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const MAX_DOWNLOAD_REDIRECTS = 3;

// Hosts that may receive the bearer token. The API base URL is owner-editable,
// so it is pinned here to keep the token (and server-side requests) away from
// arbitrary hosts.
const AUTENTIQUE_HOST_SUFFIX = 'autentique.com.br';
// Signed files are served by the Autentique panel and may redirect to their
// storage bucket. The token is only ever sent to Autentique hosts.
const DOWNLOAD_HOST_SUFFIXES = [
  AUTENTIQUE_HOST_SUFFIX,
  'storage.googleapis.com',
];

export type AutentiqueErrorCode =
  | 'invalid_config'
  | 'unauthorized'
  | 'rate_limited'
  | 'graphql'
  | 'http'
  | 'timeout'
  | 'network'
  | 'invalid_response';

export class AutentiqueApiError extends Error {
  constructor(
    message: string,
    readonly code: AutentiqueErrorCode,
    readonly status: number | null = null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'AutentiqueApiError';
  }

  /**
   * True when the request may have reached Autentique and been processed even
   * though we did not get a usable answer (timeout, dropped connection, 5xx).
   * A document send in this state must not be blindly retried.
   */
  get outcomeUncertain() {
    return (
      this.code === 'timeout' ||
      this.code === 'network' ||
      this.code === 'invalid_response' ||
      (this.code === 'http' && (this.status ?? 0) >= 500)
    );
  }
}

export type AutentiqueAccount = {
  id: string | null;
  name: string | null;
  email: string | null;
};

export type AutentiqueSignerInput = {
  name: string;
  email: string;
};

export type AutentiqueEventStamp = {
  created_at?: string | null;
  reason?: string | null;
} | null;

export type AutentiqueSignature = {
  public_id: string;
  name?: string | null;
  email?: string | null;
  action?: { name?: string | null } | null;
  link?: { short_link?: string | null } | null;
  viewed?: AutentiqueEventStamp;
  signed?: AutentiqueEventStamp;
  rejected?: AutentiqueEventStamp;
  email_events?: {
    sent?: string | null;
    refused?: string | null;
    reason?: string | null;
  } | null;
};

export type AutentiqueDocument = {
  id: string;
  name?: string | null;
  created_at?: string | null;
  files?: {
    original?: string | null;
    signed?: string | null;
    pades?: string | null;
  } | null;
  signatures: AutentiqueSignature[];
};

export type AutentiqueClientOptions = {
  apiBaseUrl?: string | null;
  apiToken: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const CREATE_DOCUMENT_MUTATION = (
  sandbox: boolean,
) => `mutation CreateDocumentMutation($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {
  createDocument(sandbox: ${sandbox ? 'true' : 'false'}, document: $document, signers: $signers, file: $file) {
    id
    name
    created_at
    signatures {
      public_id
      name
      email
      action { name }
      link { short_link }
    }
  }
}`;

const GET_DOCUMENT_QUERY = (id: string) => `query {
  document(id: ${JSON.stringify(id)}) {
    id
    name
    created_at
    files { original signed pades }
    signatures {
      public_id
      name
      email
      action { name }
      link { short_link }
      email_events { sent refused reason }
      viewed { created_at }
      signed { created_at }
      rejected { created_at reason }
    }
  }
}`;

const ME_QUERY = 'query { me { id name email } }';

export class AutentiqueClient {
  private readonly endpoint: string;
  private readonly apiToken: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AutentiqueClientOptions) {
    const token = options.apiToken?.trim();
    if (!token) {
      throw new AutentiqueApiError(
        'Token de API do Autentique não configurado.',
        'invalid_config',
      );
    }

    this.endpoint = `${assertAutentiqueApiBaseUrl(
      options.apiBaseUrl ?? AUTENTIQUE_DEFAULT_API_BASE_URL,
    )}/graphql`;
    this.apiToken = token;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async me(): Promise<AutentiqueAccount> {
    const data = await this.postJson<{ me?: AutentiqueAccount | null }>(
      ME_QUERY,
    );
    if (!data.me) {
      throw new AutentiqueApiError(
        'Autentique não retornou a conta do token.',
        'invalid_response',
      );
    }
    return {
      id: data.me.id ?? null,
      name: data.me.name ?? null,
      email: data.me.email ?? null,
    };
  }

  async createDocument(input: {
    name: string;
    pdf: Buffer;
    fileName: string;
    signers: AutentiqueSignerInput[];
    sandbox: boolean;
    message?: string | null;
  }): Promise<AutentiqueDocument> {
    if (input.signers.length === 0) {
      throw new AutentiqueApiError(
        'Nenhum signatário informado.',
        'invalid_config',
      );
    }

    // GraphQL multipart request spec: `operations` carries the query with the
    // file variable set to null, `map` points the `file` part at it.
    const operations = {
      query: CREATE_DOCUMENT_MUTATION(input.sandbox),
      variables: {
        document: {
          name: input.name,
          ...(input.message ? { message: input.message } : {}),
        },
        signers: input.signers.map((signer) => ({
          name: signer.name,
          email: signer.email,
          action: 'SIGN',
        })),
        file: null,
      },
    };

    const form = new FormData();
    form.append('operations', JSON.stringify(operations));
    form.append('map', JSON.stringify({ file: ['variables.file'] }));
    form.append(
      'file',
      new Blob([new Uint8Array(input.pdf)], { type: 'application/pdf' }),
      input.fileName,
    );

    const data = await this.request<{
      createDocument?: AutentiqueDocument | null;
    }>(form, CREATE_DOCUMENT_TIMEOUT_MS);

    const document = data.createDocument;
    if (!document?.id) {
      throw new AutentiqueApiError(
        'Autentique não retornou o documento criado.',
        'invalid_response',
      );
    }

    return { ...document, signatures: document.signatures ?? [] };
  }

  async getDocument(id: string): Promise<AutentiqueDocument | null> {
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) {
      throw new AutentiqueApiError(
        'ID de documento inválido.',
        'invalid_config',
      );
    }

    const data = await this.postJson<{ document?: AutentiqueDocument | null }>(
      GET_DOCUMENT_QUERY(id),
    );

    if (!data.document) return null;
    return { ...data.document, signatures: data.document.signatures ?? [] };
  }

  async downloadFile(url: string): Promise<Buffer> {
    let current = assertDownloadUrl(url);

    for (let hop = 0; hop <= MAX_DOWNLOAD_REDIRECTS; hop += 1) {
      const headers: Record<string, string> = { Accept: 'application/pdf' };
      if (isHostWithin(current.hostname, AUTENTIQUE_HOST_SUFFIX)) {
        headers.Authorization = `Bearer ${this.apiToken}`;
      }

      const response = await this.fetchWithTimeout(
        current.toString(),
        { method: 'GET', headers, redirect: 'manual' },
        this.timeoutMs,
      );

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new AutentiqueApiError(
            'Redirecionamento sem destino.',
            'invalid_response',
            response.status,
          );
        }
        current = assertDownloadUrl(new URL(location, current).toString());
        continue;
      }

      if (!response.ok) {
        throw this.httpError(response);
      }

      const declared = Number(response.headers.get('content-length') ?? '0');
      if (declared > MAX_DOWNLOAD_BYTES) {
        throw new AutentiqueApiError(
          'Arquivo assinado excede o limite.',
          'invalid_response',
        );
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_DOWNLOAD_BYTES) {
        throw new AutentiqueApiError(
          'Arquivo assinado excede o limite.',
          'invalid_response',
        );
      }
      if (buffer.subarray(0, 4).toString('utf8') !== '%PDF') {
        throw new AutentiqueApiError(
          'Arquivo assinado não é um PDF.',
          'invalid_response',
        );
      }
      return buffer;
    }

    throw new AutentiqueApiError(
      'Redirecionamentos demais.',
      'invalid_response',
    );
  }

  private postJson<T>(query: string) {
    return this.request<T>(
      JSON.stringify({ query }),
      this.timeoutMs,
      'application/json',
    );
  }

  private async request<T>(
    body: string | FormData,
    timeoutMs: number,
    contentType?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiToken}`,
      Accept: 'application/json',
    };
    // For FormData the runtime sets the multipart boundary itself.
    if (contentType) headers['Content-Type'] = contentType;

    const response = await this.fetchWithTimeout(
      this.endpoint,
      { method: 'POST', headers, body, redirect: 'error' },
      timeoutMs,
    );

    if (!response.ok) {
      throw this.httpError(response);
    }

    let payload: { data?: T | null; errors?: Array<{ message?: string }> };
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      throw new AutentiqueApiError(
        'Resposta inválida do Autentique.',
        'invalid_response',
        response.status,
      );
    }

    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      const message = payload.errors
        .map((error) => error?.message)
        .filter((value): value is string => Boolean(value))
        .join('; ')
        .slice(0, 500);
      const code: AutentiqueErrorCode =
        /unauthenticated|unauthorized|token/i.test(message)
          ? 'unauthorized'
          : 'graphql';
      throw new AutentiqueApiError(
        message || 'Erro retornado pelo Autentique.',
        code,
        response.status,
      );
    }

    if (!payload.data) {
      throw new AutentiqueApiError(
        'Resposta do Autentique sem dados.',
        'invalid_response',
        response.status,
      );
    }

    return payload.data;
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AutentiqueApiError(
          'Tempo esgotado ao falar com o Autentique.',
          'timeout',
        );
      }
      throw new AutentiqueApiError(
        `Falha de rede ao falar com o Autentique: ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`.slice(0, 300),
        'network',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private httpError(response: Response) {
    if (response.status === 401 || response.status === 403) {
      return new AutentiqueApiError(
        'Token do Autentique recusado.',
        'unauthorized',
        response.status,
      );
    }

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'));
      return new AutentiqueApiError(
        'Limite de requisições do Autentique atingido (60/min). Tente novamente em instantes.',
        'rate_limited',
        429,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60,
      );
    }

    return new AutentiqueApiError(
      `Autentique respondeu HTTP ${response.status}.`,
      'http',
      response.status,
    );
  }
}

export function assertAutentiqueApiBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new AutentiqueApiError(
      'URL da API do Autentique inválida.',
      'invalid_config',
    );
  }

  if (
    url.protocol !== 'https:' ||
    !isHostWithin(url.hostname, AUTENTIQUE_HOST_SUFFIX)
  ) {
    throw new AutentiqueApiError(
      'A URL da API precisa ser HTTPS em autentique.com.br.',
      'invalid_config',
    );
  }

  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

function assertDownloadUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AutentiqueApiError(
      'URL de arquivo inválida.',
      'invalid_response',
    );
  }

  if (
    url.protocol !== 'https:' ||
    !DOWNLOAD_HOST_SUFFIXES.some((suffix) => isHostWithin(url.hostname, suffix))
  ) {
    throw new AutentiqueApiError(
      'URL de arquivo fora dos hosts do Autentique.',
      'invalid_response',
    );
  }

  return url;
}

function isHostWithin(hostname: string, suffix: string) {
  const host = hostname.toLowerCase();
  return host === suffix || host.endsWith(`.${suffix}`);
}
