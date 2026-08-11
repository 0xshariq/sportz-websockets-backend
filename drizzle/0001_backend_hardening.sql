CREATE INDEX IF NOT EXISTS matches_created_at_idx ON matches (created_at);
CREATE INDEX IF NOT EXISTS matches_status_idx ON matches (status);
CREATE INDEX IF NOT EXISTS commentary_match_created_at_idx ON commentary (match_id, created_at);
ALTER TABLE commentary DROP CONSTRAINT IF EXISTS commentary_match_id_matches_id_fk;
ALTER TABLE commentary ADD CONSTRAINT commentary_match_id_matches_id_fk FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE;
