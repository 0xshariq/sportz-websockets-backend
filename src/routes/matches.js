import { Router } from 'express';
import {
    MATCH_STATUS,
    createMatchSchema,
    listMatchesQuerySchema,
    matchIdParamSchema,
    updateScoreSchema,
} from "../validation/matches.js";
import { matches } from "../db/schema.js";
import { db } from "../db/db.js";
import { getMatchStatus, syncMatchStatus } from "../utils/match-status.js";
import { desc, eq } from "drizzle-orm";

export const matchRouter = Router();

const MAX_LIMIT = 100;

// GET /matches
matchRouter.get('/', async (req, res) => {
    // Validate the query parameters against the listMatchesQuerySchema
    const parsed = listMatchesQuerySchema.safeParse(req.query);

    // If the validation fails, return a 400 Bad Request response with the validation errors
    if (!parsed.success) {
        return res.status(400).json({
            error: 'Invalid query.',
            details: parsed.error.issues
        });
    }

    // Determine the limit for the number of matches to return, defaulting to 50 if not specified,
    // and ensuring it does not exceed MAX_LIMIT
    const limit = Math.min(parsed.data.limit ?? 50, MAX_LIMIT);

    try {
        // Query the database to retrieve the list of matches, ordered by creation date in descending order,
        // and limited to the specified number of matches
        const data = await db
            .select()
            .from(matches)
            .orderBy(desc(matches.createdAt))
            .limit(limit);

        // Derive the current status only when both timestamps are present
        const updatedData = data.map((match) => ({
            ...match,
            status:
                match.startTime && match.endTime
                    ? getMatchStatus(match.startTime, match.endTime)
                    : match.status,
        }));

        // Return the list of matches with the current status
        res.json({ data: updatedData });
    } catch (e) {
        // If an error occurs during the database operation, return a 500 Internal Server Error response with the error details
        res.status(500).json({ error: 'Failed to list matches.' });
    }
});

// POST /matches
matchRouter.post('/', async (req, res) => {

    // Validate the request body against the createMatchSchema
    const parsed = createMatchSchema.safeParse(req.body);

    // If the validation fails, return a 400 Bad Request response with the validation errors
    if (!parsed.success) {
        return res.status(400).json({
            error: 'Invalid payload.',
            details: parsed.error.issues
        });
    }

    // Destructure the parsed data to extract startTime, endTime, homeScore, and awayScore
    const { data: { startTime, endTime, homeScore, awayScore } } = parsed;

    try {

        // Insert the new match into the database
        const [event] = await db.insert(matches).values({
            ...parsed.data,
            startTime: new Date(startTime),
            endTime: new Date(endTime),
            homeScore: homeScore ?? 0,
            awayScore: awayScore ?? 0,
            status: getMatchStatus(startTime, endTime),
        }).returning();

        // Broadcast the new match independently from the database mutation
        if (res.app.locals.broadcastMatchCreated) {
            try {
                await res.app.locals.broadcastMatchCreated(event);
            } catch (err) {
                console.error('Failed to broadcast match creation:', err);
            }
        }

        // Return a 201 Created response with the newly created match data
        res.status(201).json({ data: event });
    } catch (e) {
        console.error('Failed to create match:', e);
        res.status(500).json({ error: 'Failed to create match.' });
    }
});

matchRouter.patch('/:id/score', async (req, res) => {
    const paramsParsed = matchIdParamSchema.safeParse(req.params);
    if (!paramsParsed.success) {
        return res
            .status(400)
            .json({ error: 'Invalid match id', details: paramsParsed.error.issues });
    }

    const bodyParsed = updateScoreSchema.safeParse(req.body);
    if (!bodyParsed.success) {
        return res
            .status(400)
            .json({ error: 'Invalid payload', details: formatZodError(bodyParsed.error) });
    }

    const matchId = paramsParsed.data.id;

    try {
        const [existing] = await db
            .select({
                id: matches.id,
                status: matches.status,
                startTime: matches.startTime,
                endTime: matches.endTime,
            })
            .from(matches)
            .where(eq(matches.id, matchId))
            .limit(1);

        if (!existing) {
            return res.status(404).json({ error: 'Match not found' });
        }

        await syncMatchStatus(existing, async (nextStatus) => {
            await db
                .update(matches)
                .set({ status: nextStatus })
                .where(eq(matches.id, matchId));
        });

        if (existing.status !== MATCH_STATUS.LIVE) {
            return res.status(409).json({ error: 'Match is not live' });
        }

        const [updated] = await db
            .update(matches)
            .set({
                homeScore: bodyParsed.data.homeScore,
                awayScore: bodyParsed.data.awayScore,
            })
            .where(eq(matches.id, matchId))
            .returning();

        // Broadcast the score update independently from the database mutation
        if (res.app.locals.broadcastScoreUpdate) {
            try {
                await res.app.locals.broadcastScoreUpdate(matchId, {
                    homeScore: updated.homeScore,
                    awayScore: updated.awayScore,
                });
            } catch (err) {
                console.error('Failed to broadcast score update:', err);
            }
        }

        res.json({ data: updated });
    } catch (err) {
        console.error('Failed to update score:', err);
        res.status(500).json({ error: 'Failed to update score' });
    }
});