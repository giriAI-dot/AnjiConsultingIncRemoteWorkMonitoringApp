const DB_NAME = 'SecureWorkDB';
const STORE_CHUNKS = 'session_chunks'; // Temporary recovery chunks
const STORE_LOGS = 'session_logs';     // Full analysis logs
const STORE_VIDEOS = 'session_videos'; // Completed videos

export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 3); // Bump version
    request.onupgradeneeded = (e: any) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) db.createObjectStore(STORE_CHUNKS);
      if (!db.objectStoreNames.contains(STORE_LOGS)) db.createObjectStore(STORE_LOGS, { keyPath: 'sessionId' });
      if (!db.objectStoreNames.contains(STORE_VIDEOS)) db.createObjectStore(STORE_VIDEOS);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const saveVideoToDB = async (sessionId: string, blob: Blob) => {
    try {
        const db = await initDB();
        return new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_VIDEOS, 'readwrite');
            tx.objectStore(STORE_VIDEOS).put(blob, sessionId);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.error("DB Save Video Error", e);
    }
};

export const getVideoFromDB = async (sessionId: string): Promise<Blob | undefined> => {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_VIDEOS, 'readonly');
            const req = tx.objectStore(STORE_VIDEOS).get(sessionId);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    } catch (e) {
        return undefined;
    }
};

export const saveLogsToDB = async (sessionId: string, logs: any[]) => {
    try {
        const db = await initDB();
        return new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_LOGS, 'readwrite');
            tx.objectStore(STORE_LOGS).put({ sessionId, logs });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.error("DB Save Logs Error", e);
    }
};

export const getLogsFromDB = async (sessionId: string): Promise<any[]> => {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_LOGS, 'readonly');
            const req = tx.objectStore(STORE_LOGS).get(sessionId);
            req.onsuccess = () => resolve(req.result?.logs || []);
            req.onerror = () => reject(req.error);
        });
    } catch (e) {
        return [];
    }
};

// Recovery helpers
export const saveRecoveryChunks = async (chunks: Blob[]) => {
    try {
        const db = await initDB();
        return new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_CHUNKS, 'readwrite');
            tx.objectStore(STORE_CHUNKS).put(chunks, 'active_session');
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.error("DB Recovery Save Error", e);
    }
};

export const loadRecoveryChunks = async (): Promise<Blob[]> => {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_CHUNKS, 'readonly');
            const req = tx.objectStore(STORE_CHUNKS).get('active_session');
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    } catch (e) {
        return [];
    }
};

export const clearRecoveryChunks = async () => {
    try {
        const db = await initDB();
        const tx = db.transaction(STORE_CHUNKS, 'readwrite');
        tx.objectStore(STORE_CHUNKS).delete('active_session');
    } catch (e) {
        // ignore
    }
};