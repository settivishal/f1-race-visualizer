import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { appConfig } from '@/db/schema';

/**
 * The one settings row, or null on a fresh database with none yet. Each
 * caller decides what "no row" means for it: the cron skips, health reports
 * it, the home page falls back to the newest season.
 */
export async function readAppConfig(db: Db) {
  const [row] = await db.select().from(appConfig).where(eq(appConfig.id, 1)).limit(1);
  return row ?? null;
}
