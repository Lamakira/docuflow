-- Drop leftover cookie-session store (#162). Clerk is the only web session.
-- No down migration: rollback is the previous image.
DROP TABLE "sessions" CASCADE;
