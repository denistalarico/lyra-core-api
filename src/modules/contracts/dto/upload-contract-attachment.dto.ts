import { IsEnum, IsOptional } from 'class-validator';
import { UploadManuallySignedContractDto } from './upload-manually-signed-contract.dto';
import { ContractAttachmentKind } from '../enums';
export class UploadContractAttachmentDto extends UploadManuallySignedContractDto {
  @IsOptional()
  @IsEnum(ContractAttachmentKind)
  attachmentKind?: ContractAttachmentKind;
}
