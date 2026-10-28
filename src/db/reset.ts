import { db } from './db';

/** Wipes every table, including settings (so the API keys are also removed). */
export async function resetAllData(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });
}
