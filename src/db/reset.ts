import { db } from './db';

/** Wipes every table, including settings (so the Gemini API key is also removed). */
export async function resetAllData(): Promise<void> {
  await db.transaction(
    'rw',
    [db.settings, db.profile, db.topicProgress, db.sessions, db.attempts, db.customTopics, db.generatedExercises],
    async () => {
      await Promise.all([
        db.settings.clear(),
        db.profile.clear(),
        db.topicProgress.clear(),
        db.sessions.clear(),
        db.attempts.clear(),
        db.customTopics.clear(),
        db.generatedExercises.clear(),
      ]);
    }
  );
}
