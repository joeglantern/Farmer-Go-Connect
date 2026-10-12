import { makeObjectKey, presignGet, presignPut } from '@farmgo/core';
import { describe, expect, it } from 'vitest';

/** Presigned uploads must work against MinIO exactly as a phone or browser sends them. */
describe('presigned uploads', () => {
  it('carries no checksum of an empty body, and a real upload succeeds', async () => {
    const key = makeObjectKey('chat', 'presign-test', 'image/webp');
    const body = new Uint8Array(2048).map((_, i) => i % 251);
    const put = await presignPut(key, 'image/webp', body.byteLength);
    expect(put.url).not.toMatch(/x-amz-checksum|x-amz-sdk-checksum/i);

    const res = await fetch(put.url, { method: 'PUT', headers: put.headers, body });
    expect(res.status, await res.text()).toBe(200);

    const back = await fetch(await presignGet(key));
    expect(back.status).toBe(200);
    expect(new Uint8Array(await back.arrayBuffer())).toEqual(body);
  });
});
