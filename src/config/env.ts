// src/config/env.ts
export default () => ({
  port: Number(process.env.PORT ?? 3000),
  database: {
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5433),
    username: process.env.DB_USERNAME ?? 'lyra',
    password: process.env.DB_PASSWORD ?? 'lyra_dev_password',
    database: process.env.DB_NAME ?? 'lyra_core',
  },
  agencyDatabase: {
    host: process.env.AGENCY_DB_HOST ?? process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.AGENCY_DB_PORT ?? process.env.DB_PORT ?? 5433),
    username:
      process.env.AGENCY_DB_USERNAME ?? process.env.DB_USERNAME ?? 'lyra',
    password:
      process.env.AGENCY_DB_PASSWORD ??
      process.env.DB_PASSWORD ??
      'lyra_dev_password',
    database: process.env.AGENCY_DB_NAME ?? 'lyra_agency',
  },
  files: {
    s3: {
      endpoint:
        process.env.S3_ENDPOINT ??
        process.env.OBJECT_STORAGE_ENDPOINT ??
        'http://localhost:9200',
      bucket:
        process.env.S3_BUCKET ??
        process.env.OBJECT_STORAGE_BUCKET ??
        'lyra-assets',
      privateBucket: process.env.S3_PRIVATE_BUCKET ?? 'lyra-private-assets',
      region:
        process.env.S3_REGION ??
        process.env.OBJECT_STORAGE_REGION ??
        'us-east-1',
      accessKeyId:
        process.env.S3_ACCESS_KEY_ID ??
        process.env.OBJECT_STORAGE_ACCESS_KEY ??
        process.env.MINIO_ROOT_USER ??
        'lyraadmin',
      secretAccessKey:
        process.env.S3_SECRET_ACCESS_KEY ??
        process.env.OBJECT_STORAGE_SECRET_KEY ??
        process.env.MINIO_ROOT_PASSWORD ??
        'lyra_minio_dev_password',
      publicBaseUrl:
        process.env.S3_PUBLIC_BASE_URL ??
        `${process.env.S3_ENDPOINT ?? process.env.OBJECT_STORAGE_ENDPOINT ?? 'http://localhost:9200'}/${
          process.env.S3_BUCKET ??
          process.env.OBJECT_STORAGE_BUCKET ??
          'lyra-assets'
        }`,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
      createBucket: process.env.S3_CREATE_BUCKET !== 'false',
      setPublicReadPolicy: process.env.S3_SET_PUBLIC_READ_POLICY !== 'false',
    },
  },
  leadflowBriefing: {
    clamav: {
      host: process.env.LEADFLOW_BRIEFING_CLAMAV_HOST ?? 'localhost',
      port: Number(process.env.LEADFLOW_BRIEFING_CLAMAV_PORT ?? 3310),
      timeoutMs: Number(process.env.LEADFLOW_BRIEFING_CLAMAV_TIMEOUT_MS ?? 15000),
    },
    maxUploadBytes: Number(
      process.env.LEADFLOW_BRIEFING_MAX_UPLOAD_BYTES ?? 20 * 1024 * 1024,
    ),
    maxUrlFetchBytes: Number(
      process.env.LEADFLOW_BRIEFING_MAX_URL_FETCH_BYTES ?? 10 * 1024 * 1024,
    ),
    maxPasteBytes: Number(
      process.env.LEADFLOW_BRIEFING_MAX_PASTE_BYTES ?? 200 * 1024,
    ),
    maxTotalBytesPerSettings: Number(
      process.env.LEADFLOW_BRIEFING_MAX_TOTAL_BYTES_PER_SETTINGS ?? 200 * 1024 * 1024,
    ),
    urlFetchTimeoutMs: Number(
      process.env.LEADFLOW_BRIEFING_URL_FETCH_TIMEOUT_MS ?? 15000,
    ),
  },
});
