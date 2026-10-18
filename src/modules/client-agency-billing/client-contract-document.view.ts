import type { ContractDocument, ContractRecord } from '../contracts/entities';
import { ContractDocumentType } from '../contracts/enums';
import { contractObject, isSignedContract } from '../contracts/contract-term';
export const clientContractDocumentTypes = [
  ContractDocumentType.SignedPdf,
  ContractDocumentType.ManuallySignedPdf,
  ContractDocumentType.Attachment,
];
/** A legacy manual principal PDF is signed evidence only through the canonical record's exact reference. */
export function isClientSignedDocument(
  record: ContractRecord,
  document: ContractDocument,
): boolean {
  if (document.contractId !== record.id) return false;
  if (
    [
      ContractDocumentType.SignedPdf,
      ContractDocumentType.ManuallySignedPdf,
    ].includes(document.type)
  )
    return true;
  const client = contractObject(record.metadata.clientContract),
    attached = contractObject(client.attachedPdf);
  return (
    document.type === ContractDocumentType.Attachment &&
    client.mode === 'manual' &&
    attached.documentId === document.id &&
    attached.signed !== false &&
    isSignedContract(record)
  );
}
