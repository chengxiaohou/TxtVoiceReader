import { openDB } from 'idb';

const DB_NAME = 'tts-models-db';
const STORE_NAME = 'models';

export async function getCachedFile(
  url: string, 
  onProgress?: (percent: number) => void
): Promise<Uint8Array> {
  const db = await openDB(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore(STORE_NAME);
    },
  });

  const cached = await db.get(STORE_NAME, url);
  if (cached) {
    if (onProgress) onProgress(100);
    return cached;
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);

  const contentLength = response.headers.get('content-length');
  const total = contentLength ? parseInt(contentLength, 10) : 0;
  let loaded = 0;

  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = await response.arrayBuffer();
    const data = new Uint8Array(buffer);
    await db.put(STORE_NAME, data, url);
    if (onProgress) onProgress(100);
    return data;
  }

  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.length;
      if (total > 0 && onProgress) {
        onProgress(Math.round((loaded / total) * 100));
      }
    }
  }

  const data = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  
  await db.put(STORE_NAME, data, url);
  return data;
}
