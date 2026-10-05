import type { PresignInput, UploadBucket } from '@farmgo/contracts';
import type { z } from 'zod';
import { ApiError, SDK_ERROR_CODES } from './errors.js';
import type { HttpClient } from './http.js';
import type { PresignResult } from './types.js';

export type UploadContentType = z.infer<typeof PresignInput>['contentType'];

export interface UploadFileInput {
  bucket: UploadBucket;
  /** Local file URI (`file://...`, `content://...`, or a blob: URL on web). Read with fetch. */
  uri?: string;
  /** Already-loaded file. Takes precedence over `uri`. */
  blob?: Blob;
  contentType: UploadContentType;
  /** Bytes. Required with `uri` when the runtime cannot read the blob size; otherwise inferred. */
  size?: number;
  signal?: AbortSignal;
  /** Progress is not available with fetch PUT; provided for a future XHR transport. */
  onProgress?: (fraction: number) => void;
}

export interface UploadFileResult {
  /** Object key to reference in the related request (photos, podPhotoKey, nationalIdKey...). */
  key: string;
  size: number;
  contentType: UploadContentType;
}

type UploadsApi = {
  uploads: { presign(body: z.input<typeof PresignInput>): Promise<PresignResult> };
  http: HttpClient;
};

/**
 * Upload a photo or document: presign, PUT the bytes to storage with the returned headers, and
 * return the object key. Works in React Native (file:// URIs) and the browser (Blob/File).
 */
export async function uploadFile(api: UploadsApi, input: UploadFileInput): Promise<UploadFileResult> {
  const fetchImpl = api.http.fetchImpl;
  let blob = input.blob;
  if (!blob) {
    if (!input.uri) throw new Error('uploadFile needs a blob or a uri');
    let res: Response;
    try {
      res = await fetchImpl(input.uri, { signal: input.signal });
    } catch (cause) {
      throw new ApiError({
        status: 0,
        code: SDK_ERROR_CODES.NETWORK,
        message: 'Could not read the file to upload',
        cause,
      });
    }
    blob = await res.blob();
  }
  const size = input.size ?? blob.size;
  if (!size || size <= 0) throw new Error('uploadFile: file size is unknown; pass size');

  const presigned = await api.uploads.presign({ bucket: input.bucket, contentType: input.contentType, size });

  let put: Response;
  try {
    put = await fetchImpl(presigned.url, {
      method: presigned.method ?? 'PUT',
      headers: { ...presigned.headers, 'Content-Type': input.contentType },
      body: blob,
      signal: input.signal,
    });
  } catch (cause) {
    throw new ApiError({ status: 0, code: SDK_ERROR_CODES.NETWORK, message: 'Upload failed', cause });
  }
  if (!put.ok) {
    throw new ApiError({
      status: put.status,
      code: 'UPLOAD_FAILED',
      message: `Storage rejected the upload (${put.status})`,
      details: await put.text().catch(() => undefined),
    });
  }
  input.onProgress?.(1);
  return { key: presigned.key, size, contentType: input.contentType };
}
