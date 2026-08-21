-- Public `/api/v1` catalogue Capabilities (#127, ADR-0011).
-- Identity owns the catalog; Service Accounts grant these explicitly.
-- ON CONFLICT: a database whose catalog was seeded out of band is a no-op.
INSERT INTO "capabilities" ("id", "name")
VALUES
	('clients_read', 'Read Clients'),
	('clients_write', 'Create Clients'),
	('projects_read', 'Read Projects'),
	('time_entries_read', 'Read Time Entries')
ON CONFLICT ("id") DO NOTHING;
