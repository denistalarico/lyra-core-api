import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import sharp from 'sharp';

export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

type UploadImageAssetInput = {
  file: Express.Multer.File;
  path: string;
  maxDimension: number;
};

type StoredFile = {
  url: string;
  path: string;
};

type AssetFile = {
  body: Readable;
  contentType: string;
  cacheControl: string;
};

@Injectable()
export class FilesService {
  private readonly client: S3Client;
  private readonly endpoint: string;
  private readonly bucket: string;
  private readonly privateBucket: string;
  private readonly shouldCreateBucket: boolean;
  private readonly shouldSetPublicReadPolicy: boolean;
  private bucketReady?: Promise<void>;
  private privateBucketReady?: Promise<void>;

  constructor(private readonly configService: ConfigService) {
    this.endpoint =
      this.configService.get<string>('files.s3.endpoint') ??
      'http://localhost:9200';
    this.bucket =
      this.configService.get<string>('files.s3.bucket') ?? 'lyra-assets';
    this.privateBucket =
      this.configService.get<string>('files.s3.privateBucket') ??
      'lyra-private-assets';
    this.shouldCreateBucket =
      this.configService.get<boolean>('files.s3.createBucket') ?? true;
    this.shouldSetPublicReadPolicy =
      this.configService.get<boolean>('files.s3.setPublicReadPolicy') ?? true;

    this.client = new S3Client({
      region: this.configService.get<string>('files.s3.region') ?? 'us-east-1',
      endpoint: this.endpoint,
      forcePathStyle:
        this.configService.get<boolean>('files.s3.forcePathStyle') ?? true,
      credentials: {
        accessKeyId:
          this.configService.get<string>('files.s3.accessKeyId') ?? 'lyraadmin',
        secretAccessKey:
          this.configService.get<string>('files.s3.secretAccessKey') ??
          'lyra_minio_dev_password',
      },
    });
  }

  async uploadImageAsset({
    file,
    path,
    maxDimension,
  }: UploadImageAssetInput): Promise<StoredFile> {
    this.assertValidImage(file);

    const optimized = await this.optimizeImage(file.buffer, maxDimension);

    await this.ensureBucket();

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: path,
        Body: optimized,
        ContentType: 'image/webp',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    return {
      path,
      url: this.buildProxiedUrl(path),
    };
  }

  async uploadRawFile({
    file,
    path,
  }: {
    file: Express.Multer.File;
    path: string;
  }): Promise<StoredFile> {
    if (file.size > 10 * 1024 * 1024) {
      throw new BadRequestException('File exceeds 10 MB limit');
    }

    await this.ensureBucket();

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: path,
        Body: file.buffer,
        ContentType: file.mimetype,
        ContentDisposition: `attachment; filename="${encodeURIComponent(file.originalname)}"`,
      }),
    );

    return {
      path,
      url: this.buildProxiedUrl(path),
    };
  }

  async getAsset(path: string): Promise<AssetFile> {
    const normalizedPath = this.normalizeAssetPath(path);

    try {
      await this.ensureBucket();

      const object = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: normalizedPath,
        }),
      );

      if (!(object.Body instanceof Readable)) {
        throw new InternalServerErrorException('Asset stream is unavailable.');
      }

      return {
        body: object.Body,
        contentType: object.ContentType ?? 'application/octet-stream',
        cacheControl:
          object.CacheControl ?? 'public, max-age=31536000, immutable',
      };
    } catch (error) {
      const statusCode = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      const errorName = (error as { name?: string }).name;

      if (statusCode === 404 || errorName === 'NoSuchKey') {
        throw new NotFoundException('Asset not found.');
      }

      throw error;
    }
  }

  async uploadPrivateBuffer(input: {
    body: Buffer;
    path: string;
    contentType: string;
  }): Promise<{ path: string }> {
    const normalizedPath = this.normalizeAssetPath(input.path);
    await this.ensurePrivateBucket();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.privateBucket,
        Key: normalizedPath,
        Body: input.body,
        ContentType: input.contentType,
        CacheControl: 'private, no-store',
      }),
    );
    return { path: normalizedPath };
  }

  async getPrivateAsset(path: string): Promise<AssetFile> {
    const normalizedPath = this.normalizeAssetPath(path);
    try {
      await this.ensurePrivateBucket();
      const object = await this.client.send(
        new GetObjectCommand({
          Bucket: this.privateBucket,
          Key: normalizedPath,
        }),
      );
      if (!(object.Body instanceof Readable)) {
        throw new InternalServerErrorException('Asset stream is unavailable.');
      }
      return {
        body: object.Body,
        contentType: object.ContentType ?? 'application/octet-stream',
        cacheControl: 'private, no-store',
      };
    } catch (error) {
      const statusCode = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (
        statusCode === 404 ||
        (error as { name?: string }).name === 'NoSuchKey'
      ) {
        throw new NotFoundException('Asset not found.');
      }
      throw error;
    }
  }

  private assertValidImage(file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Image file is required.');
    }

    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Unsupported image format.');
    }

    if (!file.buffer?.length) {
      throw new BadRequestException('Image file is empty.');
    }

    if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
      throw new BadRequestException('Image file exceeds the 5MB limit.');
    }
  }

  private async optimizeImage(buffer: Buffer, maxDimension: number) {
    try {
      return await sharp(buffer, { failOn: 'error' })
        .rotate()
        .resize({
          width: maxDimension,
          height: maxDimension,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      throw new BadRequestException('Invalid or corrupted image file.');
    }
  }

  private ensureBucket() {
    if (!this.bucketReady) {
      this.bucketReady = this.resolveBucket();
    }

    return this.bucketReady;
  }

  private ensurePrivateBucket() {
    if (!this.privateBucketReady) {
      this.privateBucketReady = this.resolvePrivateBucket();
    }
    return this.privateBucketReady;
  }

  private async resolvePrivateBucket() {
    try {
      await this.client.send(
        new HeadBucketCommand({ Bucket: this.privateBucket }),
      );
      return;
    } catch {
      if (!this.shouldCreateBucket) {
        throw new InternalServerErrorException(
          'Private assets bucket is not available.',
        );
      }
    }
    await this.client.send(
      new CreateBucketCommand({ Bucket: this.privateBucket }),
    );
  }

  private async resolveBucket() {
    let bucketExists = false;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      bucketExists = true;
    } catch {
      // Bucket not found
    }

    if (!bucketExists) {
      if (!this.shouldCreateBucket) {
        throw new InternalServerErrorException(
          'Assets bucket is not available.',
        );
      }
      try {
        await this.client.send(
          new CreateBucketCommand({ Bucket: this.bucket }),
        );
      } catch {
        throw new InternalServerErrorException(
          'Could not create assets bucket.',
        );
      }
    }

    if (this.shouldSetPublicReadPolicy) {
      try {
        await this.ensurePublicReadPolicy();
      } catch {
        // Policy setting failed — bucket is still usable
      }
    }
  }

  private async ensurePublicReadPolicy() {
    if (!this.shouldSetPublicReadPolicy) {
      return;
    }

    await this.client.send(
      new PutBucketPolicyCommand({
        Bucket: this.bucket,
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: '*',
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${this.bucket}/*`],
            },
          ],
        }),
      }),
    );
  }

  private buildProxiedUrl(path: string) {
    const encodedPath = path
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/');

    return `/api/assets/${encodedPath}`;
  }

  private normalizeAssetPath(path: string) {
    const normalizedPath = path.trim();

    if (
      !normalizedPath ||
      normalizedPath.startsWith('/') ||
      normalizedPath.includes('..') ||
      normalizedPath.includes('\\')
    ) {
      throw new BadRequestException('Invalid asset path.');
    }

    return normalizedPath;
  }
}
