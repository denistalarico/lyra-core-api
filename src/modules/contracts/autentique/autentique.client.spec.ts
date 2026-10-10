import { AutentiqueApiError, AutentiqueClient } from './autentique.client';

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

type Operations = {
  query: string;
  variables: Record<string, unknown>;
};

function initOf(fetchImpl: jest.Mock, index = 0) {
  return (fetchImpl.mock.calls[index] as [string, RequestInit])[1];
}

function operationsOf(form: FormData) {
  return JSON.parse(form.get('operations') as string) as Operations;
}

function makeClient(
  fetchImpl: jest.Mock,
  apiBaseUrl = 'https://api.autentique.com.br/v2',
) {
  return new AutentiqueClient({
    apiBaseUrl,
    apiToken: 'secret-token',
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
}

describe('AutentiqueClient', () => {
  it('builds the GraphQL multipart request for createDocument (operations/map/file)', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse({
        data: {
          createDocument: {
            id: 'doc-1',
            name: 'Contrato',
            signatures: [
              { public_id: 'sig-1', email: 'cliente@example.com', link: null },
            ],
          },
        },
      }),
    );
    const pdf = Buffer.from('%PDF-1.4 conteudo');

    const document = await makeClient(fetchImpl).createDocument({
      name: 'Contrato',
      pdf,
      fileName: 'contrato.pdf',
      signers: [{ name: 'Cliente', email: 'cliente@example.com' }],
      sandbox: true,
      message: 'Assine, por favor',
    });

    expect(document.id).toBe('doc-1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.autentique.com.br/v2/graphql');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer secret-token');
    // The runtime must set the multipart boundary itself.
    expect(headers['Content-Type']).toBeUndefined();

    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);

    const operations = operationsOf(form);
    expect(operations.query).toContain('createDocument(sandbox: true');
    expect(operations.query).toContain('$file: Upload!');
    expect(operations.variables.file).toBeNull();
    expect(operations.variables.document).toEqual({
      name: 'Contrato',
      message: 'Assine, por favor',
    });
    expect(operations.variables.signers).toEqual([
      { name: 'Cliente', email: 'cliente@example.com', action: 'SIGN' },
    ]);

    expect(JSON.parse(form.get('map') as string)).toEqual({
      file: ['variables.file'],
    });

    const file = form.get('file') as File;
    expect(file.name).toBe('contrato.pdf');
    expect(file.type).toBe('application/pdf');
    expect(Buffer.from(await file.arrayBuffer()).equals(pdf)).toBe(true);
  });

  it('sends sandbox: false when the account is in production mode', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse({
        data: { createDocument: { id: 'doc-2', signatures: [] } },
      }),
    );

    await makeClient(fetchImpl).createDocument({
      name: 'Contrato',
      pdf: Buffer.from('%PDF'),
      fileName: 'c.pdf',
      signers: [{ name: 'A', email: 'a@example.com' }],
      sandbox: false,
    });

    const form = initOf(fetchImpl).body as FormData;
    expect(operationsOf(form).query).toContain('createDocument(sandbox: false');
  });

  it('returns the account from me()', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse({
        data: { me: { id: '1', name: 'Agência', email: 'ops@agencia.com' } },
      }),
    );

    await expect(makeClient(fetchImpl).me()).resolves.toEqual({
      id: '1',
      name: 'Agência',
      email: 'ops@agencia.com',
    });
    const init = initOf(fetchImpl);
    expect((JSON.parse(init.body as string) as Operations).query).toContain(
      'me { id name email }',
    );
  });

  it('maps HTTP 429 to a rate_limited error with retry-after', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse({}, { status: 429, headers: { 'retry-after': '12' } }),
      );

    const error = await makeClient(fetchImpl)
      .me()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AutentiqueApiError);
    expect((error as AutentiqueApiError).code).toBe('rate_limited');
    expect((error as AutentiqueApiError).retryAfterSeconds).toBe(12);
    expect((error as AutentiqueApiError).outcomeUncertain).toBe(false);
  });

  it('maps GraphQL errors to a definite (not uncertain) failure', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse({ errors: [{ message: 'validation' }], data: null }),
      );

    const error = (await makeClient(fetchImpl)
      .me()
      .catch((e: unknown) => e)) as AutentiqueApiError;
    expect(error.code).toBe('graphql');
    expect(error.outcomeUncertain).toBe(false);
  });

  it('treats a timeout as an uncertain outcome', async () => {
    const fetchImpl = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    const client = new AutentiqueClient({
      apiToken: 't',
      timeoutMs: 5,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const error = (await client
      .me()
      .catch((e: unknown) => e)) as AutentiqueApiError;
    expect(error.code).toBe('timeout');
    expect(error.outcomeUncertain).toBe(true);
  });

  it('refuses an API base URL outside autentique.com.br (token never leaves)', () => {
    expect(() => makeClient(jest.fn(), 'https://evil.example.com/v2')).toThrow(
      AutentiqueApiError,
    );
    expect(() =>
      makeClient(jest.fn(), 'http://api.autentique.com.br/v2'),
    ).toThrow(AutentiqueApiError);
  });

  describe('downloadFile', () => {
    it('follows a redirect to storage without forwarding the token', async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValueOnce(
          new Response(null, {
            status: 302,
            headers: {
              location: 'https://storage.googleapis.com/bucket/signed.pdf',
            },
          }),
        )
        .mockResolvedValueOnce(
          new Response(Buffer.from('%PDF-1.7 assinado'), { status: 200 }),
        );

      const buffer = await makeClient(fetchImpl).downloadFile(
        'https://painel.autentique.com.br/documentos/abc/assinado.pdf',
      );

      expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
      const first = initOf(fetchImpl, 0);
      const second = initOf(fetchImpl, 1);
      expect((first.headers as Record<string, string>).Authorization).toBe(
        'Bearer secret-token',
      );
      expect(
        (second.headers as Record<string, string>).Authorization,
      ).toBeUndefined();
    });

    it('rejects hosts outside the allowlist', async () => {
      const fetchImpl = jest.fn();
      await expect(
        makeClient(fetchImpl).downloadFile('https://example.com/file.pdf'),
      ).rejects.toBeInstanceOf(AutentiqueApiError);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('rejects a body that is not a PDF', async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(new Response('<html>login</html>', { status: 200 }));
      await expect(
        makeClient(fetchImpl).downloadFile(
          'https://painel.autentique.com.br/documentos/abc/assinado.pdf',
        ),
      ).rejects.toThrow('não é um PDF');
    });
  });
});
