# Scope project access to Project Assignment

Supersedes ADR-0019 (#310). ADR-0019 left project visibility Workspace-wide by omission, on purpose, until the same boundary could land on the browser and the desktop agent together. That boundary is Project Assignment: the relationship that grants a Member responsibility for and default visibility into a Project, and grants no Workspace-level authority.

The Owner and Administrators reach every Project in the Workspace. A Member reaches a Project they belong to, or one they are assigned while it has no Members. Anyone else is answered as a Project that is not there: 404 on the project routes, and the Project left out of the lists. The v2 Project Dossier draws that 404 the way it draws a Project that does not exist. The desktop agent's project list, tasks and timer start use the same rule, so the picker no longer offers a Project the next call refuses.

An Opportunity is stored as a Project, so the same rule holds for the Opportunities: a Member sees the ones they belong to, not the whole pipeline. The Opportunity Owner also reaches the Opportunity they own, won or not, even when someone else created it: the Owner is not added to its Members, so without this a Member named Owner could not see the Opportunity they are accountable for.

A Member cannot start the Timer on a Project they cannot reach. No Workspace Role besides the Owner and Administrators reaches every Project. Only its author edits or deletes a note: nobody else does, the Owner and Administrators included, and the note has to be that Project's. A Member cannot add themselves to a Project they cannot reach.

Other Workspaces stay isolated. Deleting a Project stays with the Owner and Administrators.

## Rejected

Keeping the Workspace-wide answer would leave a direct link, and the API, open to every Member. Tightening only the desktop would bring back the disagreement ADR-0019 removed: the browser wide and the agent narrow for the same User. Letting whoever reaches the Project edit or delete any note on it was rejected: a note belongs to its author.
