-- Drop `users.password` and `users.last_generated_password` (#161). Credentials
-- live at the IdentityProvider. No down migration: rollback is the previous image.
ALTER TABLE "users" DROP COLUMN "password";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "last_generated_password";
