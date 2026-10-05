import { randomUUID } from 'node:crypto';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@farmgo/config';
import { UPLOAD_BUCKETS, type UploadBucket } from '@farmgo/contracts';
import { logger } from '../logger.js';

const makeClient = (endpoint: string) =>
  new S3Client({
    endpoint,
    region: env.S3_REGION,
    forcePathStyle: true, // MinIO
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  });

/** Internal client (server to MinIO) and a signing client that uses the public hostname. */
const internal = makeClient(env.S3_ENDPOINT);
const signer = makeClient(env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT);

export const bucketName = (b: UploadBucket) => `${env.S3_BUCKET_PREFIX}${b}`;

/** Private buckets are only readable via short-lived presigned GET URLs. */
export const PRIVATE_BUCKETS: readonly UploadBucket[] = ['kyc', 'qa-evidence', 'proof-of-delivery', 'chat'];

/** Public buckets (produce and farm photos, avatars) can be read by anyone with the URL. */
export const PUBLIC_BUCKETS: readonly UploadBucket[] = UPLOAD_BUCKETS.filter(
  (b) => !PRIVATE_BUCKETS.includes(b),
);

/** Anonymous read-only access to objects (not listing) in a public bucket. */
function publicReadPolicy(bucket: string): string {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { AWS: ['*'] },
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
    ],
  });
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export async function ensureBuckets(): Promise<void> {
  for (const b of UPLOAD_BUCKETS) {
    const Bucket = bucketName(b);
    try {
      await internal.send(new HeadBucketCommand({ Bucket }));
    } catch {
      await internal.send(new CreateBucketCommand({ Bucket }));
      logger.info({ bucket: Bucket }, 'created bucket');
    }
    // Re-applied on every start so a bucket created by hand still gets the right policy.
    if (PUBLIC_BUCKETS.includes(b)) {
      await internal.send(new PutBucketPolicyCommand({ Bucket, Policy: publicReadPolicy(Bucket) }));
    }
  }
}

/**
 * The URL a client loads a stored file from, or null when there is no file. Clients never build
 * storage URLs themselves.
 *   - Public buckets: a stable, cacheable URL on S3_PUBLIC_ENDPOINT.
 *   - Private buckets: `GET /v1/files/<key>` on the API, which checks access and redirects to a
 *     short-lived presigned URL (send the usual Authorization header).
 * Values that are already absolute URLs (e.g. an avatar from a social sign-in) pass through.
 */
export function fileUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  if (/^https?:\/\//i.test(key)) return key;
  const parsed = parseObjectKey(key);
  if (!parsed) return null;
  if (PRIVATE_BUCKETS.includes(parsed.bucket)) return `${env.API_URL.replace(/\/$/, '')}/v1/files/${key}`;
  const base = (env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT).replace(/\/$/, '');
  return `${base}/${bucketName(parsed.bucket)}/${parsed.path}`;
}

/** Object keys are "<bucket>/<owner>/<uuid>.<ext>" so the bucket can be recovered from the key. */
export function makeObjectKey(bucket: UploadBucket, ownerId: string, contentType: string): string {
  return `${bucket}/${ownerId}/${randomUUID()}.${EXT[contentType] ?? 'bin'}`;
}

export function parseObjectKey(key: string): { bucket: UploadBucket; ownerId: string; path: string } | null {
  const [bucket, ownerId, ...rest] = key.split('/');
  if (!bucket || !ownerId || rest.length === 0) return null;
  if (!(UPLOAD_BUCKETS as readonly string[]).includes(bucket)) return null;
  return { bucket: bucket as UploadBucket, ownerId, path: `${ownerId}/${rest.join('/')}` };
}

export async function presignPut(key: string, contentType: string, size: number, expiresIn = 600) {
  const parsed = parseObjectKey(key);
  if (!parsed) throw new Error(`invalid object key ${key}`);
  const url = await getSignedUrl(
    signer,
    new PutObjectCommand({
      Bucket: bucketName(parsed.bucket),
      Key: parsed.path,
      ContentType: contentType,
      ContentLength: size,
    }),
    { expiresIn },
  );
  return { url, method: 'PUT' as const, headers: { 'Content-Type': contentType }, expiresIn };
}

export async function presignGet(key: string, expiresIn = 900): Promise<string> {
  const parsed = parseObjectKey(key);
  if (!parsed) throw new Error(`invalid object key ${key}`);
  return getSignedUrl(signer, new GetObjectCommand({ Bucket: bucketName(parsed.bucket), Key: parsed.path }), {
    expiresIn,
  });
}

export async function objectExists(key: string): Promise<boolean> {
  const parsed = parseObjectKey(key);
  if (!parsed) return false;
  try {
    await internal.send(new HeadObjectCommand({ Bucket: bucketName(parsed.bucket), Key: parsed.path }));
    return true;
  } catch {
    return false;
  }
}

export async function putObject(key: string, body: Buffer | string, contentType: string): Promise<void> {
  const parsed = parseObjectKey(key);
  if (!parsed) throw new Error(`invalid object key ${key}`);
  await internal.send(
    new PutObjectCommand({
      Bucket: bucketName(parsed.bucket),
      Key: parsed.path,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function storageHealthy(): Promise<boolean> {
  try {
    await internal.send(new HeadBucketCommand({ Bucket: bucketName('produce-photos') }));
    return true;
  } catch {
    return false;
  }
}
