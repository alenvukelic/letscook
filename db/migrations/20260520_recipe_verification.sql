BEGIN;

ALTER TABLE recipes
    ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT TRUE;

INSERT INTO actions (code, description) VALUES
    ('recipe.verified', 'Recipe verified or unverified')
ON CONFLICT (code) DO NOTHING;

COMMIT;
