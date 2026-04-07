import { useCallback, useEffect, useRef } from 'react';

const DB_NAME = 'pronunciation-recordings';
const STORE_NAME = 'recordings';
const DB_VERSION = 1;
const MAX_AGE_DAYS = 30;

export interface RecordingEntry {
  id?: number;
  blob: Blob;
  referenceText: string;
  score: number | null;
  difficulty: string;
  createdAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function useRecordingStorage() {
  const dbRef = useRef<IDBDatabase | null>(null);

  useEffect(() => {
    openDB().then(db => {
      dbRef.current = db;
      // Auto-prune old recordings
      const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('createdAt');
      const range = IDBKeyRange.upperBound(cutoff);
      const req = index.openCursor(range);
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
    }).catch(console.error);
    return () => { dbRef.current?.close(); };
  }, []);

  const saveRecording = useCallback(async (
    blob: Blob,
    referenceText: string,
    score: number | null,
    difficulty: string,
  ): Promise<number> => {
    const db = dbRef.current ?? await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const entry: RecordingEntry = { blob, referenceText, score, difficulty, createdAt: Date.now() };
      const req = store.add(entry);
      req.onsuccess = () => resolve(req.result as number);
      req.onerror = () => reject(req.error);
    });
  }, []);

  const getRecordings = useCallback(async (limit = 50): Promise<RecordingEntry[]> => {
    const db = dbRef.current ?? await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('createdAt');
      const results: RecordingEntry[] = [];
      const req = index.openCursor(null, 'prev');
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor && results.length < limit) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }, []);

  const deleteRecording = useCallback(async (id: number): Promise<void> => {
    const db = dbRef.current ?? await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }, []);

  const clearAll = useCallback(async (): Promise<void> => {
    const db = dbRef.current ?? await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }, []);

  return { saveRecording, getRecordings, deleteRecording, clearAll };
}
