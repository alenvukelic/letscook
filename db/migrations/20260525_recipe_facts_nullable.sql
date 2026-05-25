BEGIN;

ALTER TABLE recipes
    ALTER COLUMN prep_time_minutes DROP DEFAULT,
    ALTER COLUMN prep_time_minutes DROP NOT NULL,
    ALTER COLUMN servings DROP NOT NULL,
    ALTER COLUMN author_complexity DROP NOT NULL;

UPDATE recipes
SET prep_time_minutes = NULL,
    servings = NULL,
    author_complexity = NULL;

COMMIT;
