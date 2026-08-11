import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatchSchema } from '../src/validation/matches.js';
import { createCommentarySchema } from '../src/validation/commentary.js';

test('rejects a match with reversed timestamps', () => {
  const result = createMatchSchema.safeParse({ sport: 'football', homeTeam: 'A', awayTeam: 'B', startTime: '2026-01-02T10:00:00.000Z', endTime: '2026-01-02T09:00:00.000Z' });
  assert.equal(result.success, false);
});

test('accepts valid commentary', () => {
  const result = createCommentarySchema.safeParse({ minute: 12, message: 'Goal' });
  assert.equal(result.success, true);
});
