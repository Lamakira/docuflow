# Let the global role write no Workspace Role

A change to a User's global `users.role` changes that column and nothing else (#266). `PATCH /api/admin/users/:id/role` and `POST /api/admin/users` no longer call `alignWorkspaceRoleToGlobalRole`, and the function is gone.

It had been added on purpose, with ADR-0025. Once #238 moved Administration onto the Workspace Role, v1's `/admin` promote would otherwise have stopped granting Administration, so the write kept that meaning by moving the target between Member and Administrator in the Workspace the request had entered. That Workspace was the promoter's active one, not a choice anyone made: promoting a User to platform admin made them an Administrator of whichever Workspace the promoter happened to be in, and demoting them put them back to Member there. It coupled again the two roles ADR-0025 separates — one over every account on the platform, one over a single Workspace — and did it silently.

v2's answer to the directory (#261) removed the reason it existed. The platform console is a platform surface, reached on the global role alone; the Workspace Role is People's to change, per Workspace, by the Workspace's own Owner or Administrator. The console's role confirmation says the Workspace Role does not change, and `administration-authority.test.ts` asserts it: a Member promoted to platform admin is still refused Administration, and an Administrator demoted from it keeps it.

The alternative was to keep the write and make the console say which Workspace it would touch. It was rejected because the answer would still be an accident of where the promoter was standing, and because a platform role has no business granting authority inside a Workspace whose Owner did not grant it.
