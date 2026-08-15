import { Router } from 'express';
import { desc, eq, and } from 'drizzle-orm';
import { MATCH_STATUS, createMatchSchema, listMatchesQuerySchema, matchIdParamSchema, updateScoreSchema } from '../validation/matches.js';
import { matches } from '../db/schema.js';
import { db } from '../db/db.js';
import { getMatchStatus, syncMatchStatus } from '../utils/match-status.js';
import { AppError, asyncHandler } from '../middleware/errors.js';
import { MAX_LIST_LIMIT } from '../constants.js';

export const matchRouter = Router();

matchRouter.get('/', asyncHandler(async (req, res) => {
  const parsed = listMatchesQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new AppError(400, 'Invalid query.', parsed.error.issues);
  const limit = Math.min(parsed.data.limit ?? 50, MAX_LIST_LIMIT);
  const filters = [];
  if (parsed.data.sport) filters.push(eq(matches.sport, parsed.data.sport));
  const rows = await db
    .select()
    .from(matches)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(matches.createdAt));
  const data = rows
    .map((match) => ({ ...match, status: match.startTime && match.endTime ? getMatchStatus(match.startTime, match.endTime) : match.status }))
    .filter((match) => !parsed.data.status || match.status === parsed.data.status)
    .slice(0, limit);
  res.json({ data });
}));

matchRouter.get('/:id', asyncHandler(async (req, res) => {
  const params = matchIdParamSchema.safeParse(req.params);
  if (!params.success) throw new AppError(400, 'Invalid match id.', params.error.issues);
  const [match] = await db.select().from(matches).where(eq(matches.id, params.data.id)).limit(1);
  if (!match) throw new AppError(404, 'Match not found');
  res.json({ data: { ...match, status: match.startTime && match.endTime ? getMatchStatus(match.startTime, match.endTime) : match.status } });
}));

matchRouter.post('/', asyncHandler(async (req, res) => {
  const parsed = createMatchSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'Invalid payload.', parsed.error.issues);
  const { startTime, endTime, homeScore, awayScore } = parsed.data;
  const [event] = await db.insert(matches).values({ ...parsed.data, startTime: new Date(startTime), endTime: new Date(endTime), homeScore: homeScore ?? 0, awayScore: awayScore ?? 0, status: getMatchStatus(startTime, endTime) }).returning();
  res.app.locals.broadcastMatchCreated?.(event);
  res.status(201).json({ data: event });
}));

matchRouter.patch('/:id/score', asyncHandler(async (req, res) => {
  const params = matchIdParamSchema.safeParse(req.params);
  const body = updateScoreSchema.safeParse(req.body);
  if (!params.success) throw new AppError(400, 'Invalid match id.', params.error.issues);
  if (!body.success) throw new AppError(400, 'Invalid payload.', body.error.issues);
  const matchId = params.data.id;
  const [existing] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!existing) throw new AppError(404, 'Match not found');
  await syncMatchStatus(existing, async (nextStatus) => { await db.update(matches).set({ status: nextStatus }).where(eq(matches.id, matchId)); });
  if (existing.status !== MATCH_STATUS.LIVE) throw new AppError(409, 'Match is not live');
  const [updated] = await db.update(matches).set(body.data).where(and(eq(matches.id, matchId), eq(matches.status, MATCH_STATUS.LIVE))).returning();
  if (!updated) throw new AppError(409, 'Match is no longer live');
  res.app.locals.broadcastScoreUpdate?.(matchId, { homeScore: updated.homeScore, awayScore: updated.awayScore });
  res.json({ data: updated });
}));
