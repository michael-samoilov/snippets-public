-- IF NOT EXISTS: src/server/speech-guard.ts also creates this table on first use, so either may run first.
CREATE TABLE IF NOT EXISTS "speech_rate_limit" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" bigint NOT NULL,
	"count" integer NOT NULL
);
