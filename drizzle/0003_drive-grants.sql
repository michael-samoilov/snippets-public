-- IF NOT EXISTS: src/server/drive-grant.ts also creates this table on first use, so either may run first.
CREATE TABLE IF NOT EXISTS "drive_grant" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "drive_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drive_grant_user" ON "drive_grant" USING btree ("user_id");
