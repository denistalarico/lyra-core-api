import { IsObject, IsOptional, IsString } from 'class-validator';

export class MarkContractManuallySignedDto {
@IsOptional()
@IsString()
fileName?: string | null;

@IsOptional()
@IsString()
fileKey?: string | null;

@IsOptional()
@IsString()
mimeType?: string | null;

@IsOptional()
@IsString()
sizeBytes?: string | null;

@IsOptional()
@IsString()
note?: string | null;

@IsOptional()
@IsObject()
metadata?: Record<string, unknown>;
}
