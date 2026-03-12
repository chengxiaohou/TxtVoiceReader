import { openDB } from 'idb';

const DB_NAME = 'tts-audio-cache-db';
const STORE_NAME = 'audio';

interface AudioCacheEntry {
  key: string;
  audio: ArrayBuffer;
  createdAt: number;
  lastAccessed: number;
  size: number;
}

export const hashString = (input: string) => {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(16);
};

const openAudioCacheDb = () =>
  openDB(DB_NAME, 1, {
    upgrade(db) {
      const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      store.createIndex('lastAccessed', 'lastAccessed');
    },
  });

export async function getCachedAudio(key: string): Promise<ArrayBuffer | null> {
  const db = await openAudioCacheDb();
  const entry = await db.get(STORE_NAME, key) as AudioCacheEntry | undefined;
  if (!entry) return null;
  const now = Date.now();
  await db.put(STORE_NAME, { ...entry, lastAccessed: now });
  return entry.audio;
}

export async function setCachedAudio(
  key: string, 
  audio: ArrayBuffer, 
  maxEntries: number,
  maxBytes: number
): Promise<void> {
  const db = await openAudioCacheDb();
  const now = Date.now();
  const entry: AudioCacheEntry = {
    key,
    audio,
    createdAt: now,
    lastAccessed: now,
    size: audio.byteLength,
  };
  await db.put(STORE_NAME, entry);

  const limitEntries = Number.isFinite(maxEntries) ? Math.max(0, Math.floor(maxEntries)) : 0;
  const limitBytes = Number.isFinite(maxBytes) ? Math.max(0, Math.floor(maxBytes)) : 0;
  if (limitEntries <= 0 && limitBytes <= 0) return;

  const tx = db.transaction(STORE_NAME, 'readwrite');
  const index = tx.store.index('lastAccessed');
  let cursor = await index.openCursor();
  let count = 0;
  let totalBytes = 0;
  const entries: { key: string; size: number }[] = [];
  while (cursor) {
    const value = cursor.value as AudioCacheEntry;
    count += 1;
    totalBytes += value.size || 0;
    entries.push({ key: value.key, size: value.size || 0 });
    cursor = await cursor.continue();
  }

  let deleteIndex = 0;
  while (
    deleteIndex < entries.length &&
    ((limitEntries > 0 && count > limitEntries) || (limitBytes > 0 && totalBytes > limitBytes))
  ) {
    const target = entries[deleteIndex];
    await tx.store.delete(target.key);
    count -= 1;
    totalBytes -= target.size;
    deleteIndex += 1;
  }

  await tx.done;
}

export async function getAudioCacheStats(): Promise<{ count: number; totalBytes: number }> {
  const db = await openAudioCacheDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  let cursor = await tx.store.openCursor();
  let count = 0;
  let totalBytes = 0;
  while (cursor) {
    const value = cursor.value as AudioCacheEntry;
    count += 1;
    totalBytes += value.size || 0;
    cursor = await cursor.continue();
  }
  await tx.done;
  return { count, totalBytes };
}

export async function clearAudioCache(): Promise<void> {
  const db = await openAudioCacheDb();
  await db.clear(STORE_NAME);
}
