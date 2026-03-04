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
  return db.getAllFromIndex('books', 'by-date');
};

export const getBook = async (id: string) => {
  const db = await initDB();
  return db.get('books', id);
};

export const updateProgress = async (id: string, progress: number, totalChunks: number) => {
  const db = await initDB();
  const book = await db.get('books', id);
  if (book) {
    book.progress = progress;
    book.totalChunks = totalChunks;
    book.lastReadAt = Date.now();
    await db.put('books', book);
  }
};

export const deleteBook = async (id: string) => {
  const db = await initDB();
  await db.delete('books', id);
};
