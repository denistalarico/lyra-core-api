import { randomUUID } from 'crypto';

export type AutentiqueSignerPayload = {
  id: string;
  role: string;
  name: string;
  email: string;
  document?: string | null;
  signatureOrder?: number | null;
};

export type AutentiqueSendPayload = {
  provider: 'autentique';
  apiBaseUrl: string;
  contract: {
    id: string;
    title: string;
    targetType: string;
    targetId?: string | null;
  };
  document: {
    id: string;
    fileName: string;
    fileKey: string;
    mimeType: string;
    sizeBytes: string | number;
  };
  signers: AutentiqueSignerPayload[];
  options: {
    message: string;
    sandboxEnabled: boolean;
  };
};

export type AutentiqueSendResult = {
  provider: 'autentique';
  mode: 'mock';
  externalDocumentId: string;
  externalStatus: 'created';
  signingUrl: string;
  signers: Array<{
    id: string;
    name: string;
    email: string;
    externalSignerId: string;
    signingUrl: string;
  }>;
  raw: Record<string, unknown>;
};

export function sendAutentiqueSignatureRequestMock(
  payload: AutentiqueSendPayload,
): AutentiqueSendResult {
  const externalDocumentId = `mock_autentique_${randomUUID()}`;

  return {
    provider: 'autentique',
    mode: 'mock',
    externalDocumentId,
    externalStatus: 'created',
    signingUrl: `https://mock.autentique.local/documents/${externalDocumentId}`,
    signers: payload.signers.map((signer) => {
      const externalSignerId = `mock_signer_${randomUUID()}`;

      return {
        id: signer.id,
        name: signer.name,
        email: signer.email,
        externalSignerId,
        signingUrl: `https://mock.autentique.local/documents/${externalDocumentId}/sign/${externalSignerId}`,
      };
    }),
    raw: {
      mock: true,
      createdAt: new Date().toISOString(),
      contractId: payload.contract.id,
      documentId: payload.document.id,
      signersCount: payload.signers.length,
    },
  };
}
