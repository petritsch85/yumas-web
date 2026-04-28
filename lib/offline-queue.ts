import { openDB } from 'idb';

const DB_NAME = 'yumas-offline';
const STORE   = 'pending-submissions';

export type PendingSubmission = {
  id?:             number;
  locationId:      string;
  locationName:    string;
  userId:          string;
  data:            { section: string; name: string; unit: string; quantity: number }[];
  comment:         string | null;
  durationSeconds: number | null;
  queuedAt:        string;
};

async function getDB() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    },
  });
}

export async function enqueue(submission: Omit<PendingSubmission, 'id'>) {
  const db = await getDB();
  await db.add(STORE, submission);
}

export async function dequeueAll(): Promise<PendingSubmission[]> {
  const db = await getDB();
  return db.getAll(STORE);
}

export async function removeFromQueue(id: number) {
  const db = await getDB();
  await db.delete(STORE, id);
}

export async function pendingCount(): Promise<number> {
  const db = await getDB();
  return db.count(STORE);
}
