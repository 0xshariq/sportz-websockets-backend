import { Router } from 'express';
import { eq, desc } from 'drizzle-orm';
import { matchIdParamSchema } from '../validation/matches.js';
import { createCommentarySchema, listCommentaryQuerySchema } from '../validation/commentary.js';
import { db } from '../db/db.js';
import { commentary, matches } from '../db/schema.js';
import { AppError, asyncHandler } from '../middleware/errors.js';

export const commentaryRouter = Router({ mergeParams: true });

commentaryRouter.get('/', asyncHandler(async (req, res) => {
  const params = matchIdParamSchema.safeParse(req.params);
  const query = listCommentaryQuerySchema.safeParse(req.query);
  if (!params.success) throw new AppError(400, 'Invalid match ID.', params.error.issues);
  if (!query.success) throw new AppError(400, 'Invalid query parameters.', query.error.issues);
  const results = await db.select().from(commentary).where(eq(commentary.matchId, params.data.id)).orderBy(desc(commentary.createdAt)).limit(query.data.limit ?? 10);
  res.json({ data: results });
}));

commentaryRouter.post('/', asyncHandler(async (req, res) => {
  const params = matchIdParamSchema.safeParse(req.params);
  const body = createCommentarySchema.safeParse(req.body);
  if (!params.success) throw new AppError(400, 'Invalid match ID.', params.error.issues);
  if (!body.success) throw new AppError(400, 'Invalid commentary payload.', body.error.issues);
  const [match] = await db.select({ id: matches.id }).from(matches).where(eq(matches.id, params.data.id)).limit(1);
  if (!match) throw new AppError(404, 'Match not found');
  const [result] = await db.insert(commentary).values({ matchId: params.data.id, ...body.data }).returning();
  res.app.locals.broadcastCommentary?.(result.matchId, result);
  res.status(201).json({ data: result });
}));
