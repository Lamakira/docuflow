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
- **Commands (settled in #400).** A Timer Command addresses one Timer. A start records its mode, `add` or `switch`; a start without one is a switch, as every start was before, so a replay applies what was asked whatever the policy is later. The policy, the cap, the Task and Project rules and the single Workspace are checked when a start is received, never during a replay; a refused start is not recorded. The ADR-0030 floor is that Timer's latest command, or a later switch, which stopped it too; not the User's latest command: another Timer added later does not move a pause dated when the Member left. A command is late, and the User's commands are replayed, only when a command already applied comes after it and touches the same Timer: a command on that Timer, or a switch, which stops every Timer. The index allows one active Timer per User per Task, and per Project for a Timer without a Task; the cap of three, the whole Project a task-less Timer occupies and the single Workspace are checked under a per-User lock that every Timer Command takes, across Workspaces.
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

## Implementation notes (#400)

- **Migration.** `0045` drops the one-active-Timer-per-User index in the same deploy that adds its replacements, an exception to expand and contract recorded in `migrations/README.md`: during the publish the previous image loses only its guard against two simultaneous starts.

- **Launch.** The code ships before the launch. The operator sets `SIMULTANEOUS_TIMERS_LAUNCH_AT` (an ISO date) once the agent release that speaks protocol 2 is published. Before it, the minimum protocol stays 1, an agent that declares nothing counts as 1, and the option cannot be turned on. Members whose Devices declared less than 2 (or nothing) on a heartbeat in the last 30 days see a banner as soon as the date is set, and `npm run agents:warn-outdated -- --send` emails them. From the date the minimum is 2 and `POST /api/agent/timer/start` leaves the drain paths.
- **Worked Time.** Counted from the entries' seconds, minus the time Timers recorded by Timer Commands ran together; their running intervals come from those commands, so a paused Timer is not running. With no overlap every figure is the sum it was. Legacy entries keep their seconds whole, even where old records overlap. The stats, the register's totals, Analytics and the agent's day total read Worked Time; the export keeps one line per Time Entry and adds a `Worked (h)` column, the entry's share of its Member's Worked Time (overlapping time shared equally), so a Member's lines add up to it.
- **Activity Evidence.** A capture's row names one Timer; `time_entry_screenshot_timers` names every other Timer running at `capturedAt`, read from the Timer Commands. A Project's or a Time Entry's activity includes those captures; counts read the capture rows, so it counts once. Activity samples and idle periods are counted per Member and keep the one Time Entry they name.

