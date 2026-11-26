# Let up to three Timers run at once and count Worked Time once

Amends [ADR-0009](0009-ingest-time-and-activity-through-idempotent-commands.md) (at most one active Timer per User) and [ADR-0030](0030-date-away-and-idle-pauses-when-the-member-left.md) (claims floored at the User's latest Timer Command).

Members do work on several Projects at the same moment: a day can hold 4h on Project A and 2h on Project B, 1h30 of it on both at once. With one Timer per User, one of the two goes unrecorded. We now allow Simultaneous Timers and count the day separately from the Projects, so each Project gets its full time and the Member's day still counts each hour once.

## Decision

- **Who and how many.** When the Workspace's Tracking Policy allows it (off by default; the Owner or an Administrator turns it on), a User runs up to three Timers at once, all in the same Workspace, never two on the same Task. A Timer without a Task occupies its whole Project. Starter has one Project and no Tasks, so it cannot run Simultaneous Timers and does not show the option.
- **Two counts.** Each Task counts its Time Entries in full, Simultaneous Time included. A Project counts the time during which at least one of its Timers ran, once: two Tasks of one Project running together for an hour give each Task an hour and the Project an hour, so a client is never billed twice for the same hour. That Project time feeds budget, profitability, client billing, the Project Dossier. **Worked Time**, the part of the day during which at least one Timer ran, counted once, feeds the Timesheet total, payroll exports, attendance and the day totals on Today and in the desktop agent. Screens show it as "Worked time 4h30 · 1h30 simultaneous".
- **Starting.** With the option on, Start on a Project while another Timer runs asks whether to **add** this Timer or **switch** to it (stopping the others). Each Timer has its own pause and stop, plus a stop-all. With the option off, Start switches, as before. Turning the option off leaves running Timers running until each is stopped; no new one can be added.
- **Activity Evidence.** One screenshot, activity sample or idle period taken while several Timers run is attached to every running Timer, visible in each Project's activity, and counted once in the day.
- **Away and idle.** Sleep, lock and idle pause every running Timer, dated when the Member left (ADR-0030). "I'm back" resumes every Timer that was running; "I'm not working" stops them all.
- **Reminders.** The no-timer reminder fires only when no Timer runs. The forgotten-timer stop applies to each Timer on its own.
- **Commands (proposed, to settle at implementation).** A Timer Command addresses one Timer, and today's start, which stops the active Timer, becomes the "switch" case. Proposed: the ADR-0030 floor becomes that Timer's latest command rather than the User's, and ADR-0009's late-arrival re-materialization runs per Timer. The one-active-Timer-per-User invariant becomes: at most one active Timer per User per Task (per Project for a Timer without a Task), at most three per User, all in one Workspace.
- **Forced agent update.** A desktop agent built for one Timer cannot run beside several, so the launch forces every agent to update, in every Workspace, whether or not it turns the option on:
  - The held agent release that removes auto-start on task and project creation also starts declaring its protocol version and shows a blocking "update required" screen, with a download link, when the server refuses its version.
  - At launch the minimum protocol version rises, and an agent that declares no version counts as below it. Today a below-minimum agent may still start, pause, resume and stop Timers; from launch it may no longer start one, while its pause, resume and stop still pass. A refused agent stops capturing; a Timer already running stays on the server and can be stopped from the web. Queued Timer Commands, evidence batches and screenshot uploads are still accepted, so nothing already recorded is lost.
  - Before launch, Members whose Devices report an older version are warned by email and in the app.

## Consequences

- A Timesheet's lines per Project can add up to more than its total. The Timesheet says how much of it was simultaneous.
- One User can now have overlapping Time Entries. Public API and webhook consumers that assumed otherwise must be told before launch.
- Agents installed before the held release stop working at launch, beyond sending what they had queued; their Members see a generic error until they update.
- The cap of three is a starting point, to be revisited from Member feedback.

## Rejected

- **Several Timers open, one running at a time** (pause one, run another, resume with a click). It removes the friction of switching but still records only one Project per hour, which is the problem.
- **Counting Simultaneous Time twice in the day.** It would pay and approve the same hour twice.
- **Letting older agents keep a one-Timer view** (show the latest Timer, Start always switches). The server would have to serve two protocols indefinitely; forcing the update was preferred.
