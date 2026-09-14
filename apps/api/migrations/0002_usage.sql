-- Record what each summary actually cost.
--
-- Claude reports exact token counts per run; until now the runner discarded
-- them. Rows written before this migration keep 0, which the admin view
-- reports as "unmeasured" rather than quietly folding into the totals as zero.

ALTER TABLE summaries ADD COLUMN input_tokens  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE summaries ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE summaries ADD COLUMN cost_usd      REAL    NOT NULL DEFAULT 0;
ALTER TABLE summaries ADD COLUMN chunks        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE summaries ADD COLUMN duration_ms   INTEGER NOT NULL DEFAULT 0;
