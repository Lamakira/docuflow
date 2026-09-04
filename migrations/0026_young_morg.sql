-- `users.password` becomes nullable so a new User can be invited at the
-- IdentityProvider without a placeholder hash (#160). Existing hashes stay
-- until the column drops (#161). Pure DDL; no data movement.
ALTER TABLE "users" ALTER COLUMN "password" DROP NOT NULL;