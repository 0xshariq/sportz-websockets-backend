import { and, eq, ne } from 'drizzle-orm';
import { db as defaultDb } from '../db/db.js';
import { matches } from '../db/schema.js';
import { getMatchStatus } from '../utils/match-status.js';
import { MATCH_STATUS } from '../validation/matches.js';

const DEFAULT_INTERVAL_MS = 30_000;

export async function syncOpenMatchStatuses({ db = defaultDb, broadcastStatusUpdate, now = new Date() } = {}) {
  const openMatches = await db
    .select()
    .from(matches)
    .where(ne(matches.status, MATCH_STATUS.FINISHED));

  let updatedCount = 0;
  for (const match of openMatches) {
    const nextStatus = getMatchStatus(match.startTime, match.endTime, now);
    if (!nextStatus || nextStatus === match.status) continue;

    const [updated] = await db
      .update(matches)
      .set({ status: nextStatus })
      .where(and(eq(matches.id, match.id), eq(matches.status, match.status)))
      .returning({ id: matches.id, status: matches.status });

    if (updated) {
      updatedCount += 1;
      broadcastStatusUpdate?.(updated.id, updated.status);
    }
  }

  return updatedCount;
}

export function startMatchSyncService({ db = defaultDb, broadcastStatusUpdate, intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  let running = false;
  let stopping = false;
  let activeTick = Promise.resolve();

  const tick = async () => {
    if (running || stopping) return;
    running = true;
    activeTick = (async () => {
      try {
        await syncOpenMatchStatuses({ db, broadcastStatusUpdate });
      } catch (error) {
        console.error('Match status synchronization failed:', error);
      } finally {
        running = false;
      }
    })();
    await activeTick;
  };

  void tick();
  const interval = setInterval(() => void tick(), intervalMs);
  interval.unref?.();

  return async () => {
    stopping = true;
    clearInterval(interval);
    await activeTick;
  };
}

export { DEFAULT_INTERVAL_MS };
        
