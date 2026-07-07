CREATE TABLE "user_keys" (
	"user_id" text PRIMARY KEY NOT NULL,
	"passphrase_key" jsonb NOT NULL,
	"recovery_key" jsonb NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_keys" ADD CONSTRAINT "user_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;