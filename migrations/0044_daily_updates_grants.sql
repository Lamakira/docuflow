-- The Daily Updates grant moves from the account to the Membership (F86).
-- `users.can_view_daily_updates` opened them in every Workspace of the account;
-- access now reads `membership_capabilities`. Every Membership of an account
-- with the flag keeps what it had, an archived one included (it may be
-- restored), unless its Workspace Role already carries the Capability.
--
-- The column stays for v1's platform console. ON CONFLICT: re-running is a no-op.
INSERT INTO "membership_capabilities" ("membership_id", "capability_id", "workspace_id")
SELECT m."id", c."id", m."workspace_id"
	FROM "memberships" m
	JOIN "users" u ON u."id" = m."user_id" AND u."can_view_daily_updates" = 1
	JOIN "capabilities" c ON c."id" = 'view_daily_updates'
	WHERE NOT EXISTS (
		SELECT 1 FROM "workspace_role_capabilities" rc
			WHERE rc."workspace_role_id" = m."workspace_role_id" AND rc."capability_id" = c."id"
	)
ON CONFLICT ("membership_id", "capability_id") DO NOTHING;
