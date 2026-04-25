import { put, del, get } from "@vercel/blob";

export { put, del };

export type StreamedBlob = {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  etag: string | undefined;
};

export async function streamBlob(urlOrPathname: string): Promise<StreamedBlob | null> {
  const result = await get(urlOrPathname, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return {
    stream: result.stream,
    contentType: result.blob.contentType,
    etag: result.blob.etag,
  };
}
