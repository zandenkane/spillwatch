/**
 * S3-compatible object storage client.
 *
 * Handles photo uploads for incident reports. Works with any
 * S3-compatible service (AWS S3, MinIO, DigitalOcean Spaces, etc.).
 * Connection params come from environment variables.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function loadConfig(): S3Config {
  return {
    endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
    region: process.env.S3_REGION ?? "us-east-1",
    bucket: process.env.S3_BUCKET ?? "spillwatch",
    accessKeyId: process.env.S3_ACCESS_KEY ?? "minioadmin",
    secretAccessKey: process.env.S3_SECRET_KEY ?? "minioadmin",
  };
}

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!client) {
    const cfg = loadConfig();
    client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
      forcePathStyle: true, // required for MinIO and most S3-compatible services
    });
  }
  return client;
}

function getBucket(): string {
  return loadConfig().bucket;
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/**
 * Upload a file buffer to S3. Returns the object key.
 *
 * Keys are structured as: reports/{reportId}/{filename}
 */
export async function uploadFile(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  const params: PutObjectCommandInput = {
    Bucket: getBucket(),
    Key: key,
    Body: body,
    ContentType: contentType,
  };

  await getClient().send(new PutObjectCommand(params));
  console.log(`[s3] uploaded ${key} (${body.byteLength} bytes)`);
  return key;
}

/**
 * Build the S3 object key for a report photo.
 */
export function buildPhotoKey(
  reportId: string,
  filename: string,
): string {
  // Sanitize the filename to prevent path traversal
  let safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  // Strip any remaining dot-dot sequences that could escape the directory
  safe = safe.replace(/\.\./g, "_");
  return `reports/${reportId}/${safe}`;
}

// ---------------------------------------------------------------------------
// Presigned URLs
// ---------------------------------------------------------------------------

/**
 * Generate a presigned GET URL so the browser can fetch a photo
 * directly from S3 without proxying through the app server.
 */
export async function getPresignedDownloadUrl(
  key: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: getBucket(),
    Key: key,
  });

  return getSignedUrl(getClient(), command, {
    expiresIn: expiresInSeconds,
  });
}

/**
 * Generate a presigned PUT URL so the browser can upload a photo
 * directly to S3 without streaming through the app server.
 */
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresInSeconds = 600,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: contentType,
  });

  return getSignedUrl(getClient(), command, {
    expiresIn: expiresInSeconds,
  });
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Delete a file from S3.
 */
export async function deleteFile(key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({
      Bucket: getBucket(),
      Key: key,
    }),
  );
  console.log(`[s3] deleted ${key}`);
}

// ---------------------------------------------------------------------------
// Check existence
// ---------------------------------------------------------------------------

/**
 * Check whether an object exists in S3.
 */
export async function fileExists(key: string): Promise<boolean> {
  try {
    await getClient().send(
      new HeadObjectCommand({
        Bucket: getBucket(),
        Key: key,
      }),
    );
    return true;
  } catch {
    return false;
  }
}
