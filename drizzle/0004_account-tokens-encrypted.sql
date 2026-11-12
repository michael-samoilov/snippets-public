-- Idempotent: src/server/token-encryption.ts encrypts the old plaintext tokens and adds this constraint on first use, so it adds it only if it is absent and no plaintext token is left.
DO $migrate$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_tokens_encrypted')
		AND NOT EXISTS (SELECT 1 FROM "account" WHERE NOT (("access_token" is null or "access_token" like '$ba$%' or "access_token" ~ '^([0-9a-fA-F]{2})+$') and ("refresh_token" is null or "refresh_token" like '$ba$%' or "refresh_token" ~ '^([0-9a-fA-F]{2})+$') and ("id_token" is null or "id_token" like '$ba$%' or "id_token" ~ '^([0-9a-fA-F]{2})+$'))) THEN
		ALTER TABLE "account" ADD CONSTRAINT "account_tokens_encrypted" CHECK (("access_token" is null or "access_token" like '$ba$%' or "access_token" ~ '^([0-9a-fA-F]{2})+$') and ("refresh_token" is null or "refresh_token" like '$ba$%' or "refresh_token" ~ '^([0-9a-fA-F]{2})+$') and ("id_token" is null or "id_token" like '$ba$%' or "id_token" ~ '^([0-9a-fA-F]{2})+$'));
	END IF;
END
$migrate$;
