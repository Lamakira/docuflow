# Date away and idle pauses when the Member left

Amends ADR-0009 (#333) and reverses the earlier desktop decision, taken while matching Time Doctor 2 ("TD2", problem 2 of the 2026-06-25 idle-tracking brief), that a sleep or screen lock pauses the Timer on the device only. That decision assumed the server would stop counting once the device did. It does not: the server's Time Entry stayed `running`, heartbeats kept adding to it, a stop after a night's sleep counted the night, and an idle pause (#293) counted the idle minutes because the agent routes dated every command at receipt.

## Decision

A pause the desktop agent makes because the Member left reaches the server, dated when the Member left:

- **Sleep and screen lock** queue a `pause` Timer Command effective at the moment the machine slept or locked, or where an idle countdown already running began. Wake keeps the Timer paused until the Member resumes, as before; it also sends the queued commands before anything else.
- **Idle pause** sends `idleSince` as the pause's effective time. **"I'm back" during the countdown** sends a pause at `idleSince` and a resume at the answer, so the server keeps the same total as the desktop. **"I'm not working"** sends its stop dated where the idle time began.
- The agent queue carries an optional `effectiveAt`; the agent pause and stop routes accept it as the command's claimed effective time. Older agents send none and keep the receipt time.
- The ingest clamps such a claim to receipt, as ADR-0009 already does, and **floors it at the entry's start and at the User's latest Timer Command** (in practice the entry's last start or resume). A claim cannot reach back across a span the server already settled, and it always applies incrementally: no late arrival, so no rematerialization, and heartbeat accrual past the claim is taken back exactly.
- **Heartbeats name no Time Entry while the Timer is paused on the device**, so they add nothing whatever order commands and heartbeats arrive in.
- A command that never reached the server (no network, or a 502/503/504) stays queued for the next sync instead of being failed, so a pause made at sleep still arrives after a slow wake.

## Consequences

- Worked time on the server matches what the Member saw on the desktop after a lock, a sleep or an idle pause.
- The floor uses the User's latest command, not only the entry's: a description change made after the last resume moves the floor to that change, so a pause can then over-count by the span between the two. Accepted, because it keeps every agent claim on the incremental path and never rewrites a legacy entry through replay.
- A queued command now waits behind an unreachable server indefinitely rather than being dropped. A refusal from the server still fails it, as before.
- A sleep the operating system does not report (no `suspend` event) is still counted by the first heartbeat after it.

## Rejected

- **Keep the pause local and have the server ignore heartbeat gaps.** The stop still lands at receipt, so the gap is counted anyway.
- **Accept any claimed time and let late arrivals rematerialize.** Rematerialization ignores heartbeat accrual and stops a legacy entry it cannot replay; the floor avoids both for no loss in the cases that matter.
