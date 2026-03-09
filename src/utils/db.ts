import { openDB, DBSchema } from 'idb';
import { v4 as uuidv4 } from 'uuid';

export interface Book {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  lastReadAt: number;
  progress: number; // Current chunk index
  totalChunks: number;
}

interface ReaderDB extends DBSchema {
  books: {
    key: string;
    value: Book;
    indexes: { 'by-date': number };
  };
}

const DB_NAME = 'txt-voice-reader-db';
const DB_VERSION = 1;
const PROGRESS_CACHE_KEY = 'txt-voice-reader-progress-v1';

type ProgressSnapshot = {
  progress: number;
  totalChunks: number;
  lastReadAt: number;
};

const readProgressCache = (): Record<string, ProgressSnapshot> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(PROGRESS_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const writeProgressCache = (id: string, progress: number, totalChunks: number, lastReadAt: number) => {
  if (typeof window === 'undefined') return;
  try {
    const cache = readProgressCache();
    cache[id] = { progress, totalChunks, lastReadAt };
    window.localStorage.setItem(PROGRESS_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // no-op
  }
};

const applyCachedProgress = (book: Book): Book => {
  const cached = readProgressCache()[book.id];
  if (!cached) return book;
  if (cached.lastReadAt >= book.lastReadAt) {
    return {
      ...book,
      progress: cached.progress,
      totalChunks: cached.totalChunks,
      lastReadAt: cached.lastReadAt,
    };
  }
  return book;
};

const progressWriteQueue = new Map<string, Promise<void>>();

export const initDB = async () => {
  return openDB<ReaderDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('books')) {
        const store = db.createObjectStore('books', { keyPath: 'id' });
        store.createIndex('by-date', 'createdAt');
      }
    },
  });
};

export const addBook = async (title: string, content: string) => {
  const db = await initDB();
  const id = uuidv4();
  const book: Book = {
    id,
    title,
    content,
    createdAt: Date.now(),
    lastReadAt: Date.now(),
    progress: 0,
    totalChunks: 0, // Will be calculated on open
  };
  await db.add('books', book);
  return book;
};

export const getBooks = async () => {
  const db = await initDB();
  const books = await db.getAllFromIndex('books', 'by-date');
  return books.map(applyCachedProgress);
};

export const getBook = async (id: string) => {
  const db = await initDB();
  const book = await db.get('books', id);
  return book ? applyCachedProgress(book) : book;
};

export const updateProgress = async (id: string, progress: number, totalChunks: number) => {
  const lastReadAt = Date.now();
  writeProgressCache(id, progress, totalChunks, lastReadAt);

  const previous = progressWriteQueue.get(id) || Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const db = await initDB();
      const book = await db.get('books', id);
      if (!book) return;
      if (lastReadAt < book.lastReadAt) return;
      book.progress = progress;
      book.totalChunks = totalChunks;
      book.lastReadAt = lastReadAt;
      await db.put('books', book);
    });

  progressWriteQueue.set(id, next);
  await next;
};

export const deleteBook = async (id: string) => {
  const db = await initDB();
  await db.delete('books', id);
};
