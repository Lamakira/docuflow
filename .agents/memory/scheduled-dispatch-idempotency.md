---
name: Scheduled dispatch idempotency
description: Why setInterval "once per day" jobs need DB-backed dedup, not just in-memory guards
---

Any recurring in-process scheduler (setInterval) that must fire an action "once
per day/period" cannot rely solely on an in-memory guard variable to dedup.

**Why:** the process restarts frequently (deploys, crashes, workflow restarts).
An in-memory `lastRunDayKey` resets to null on restart, so a restart after the
trigger time re-fires the whole batch — duplicate notifications/emails. This is
also broken under any multi-instance deployment.

**How to apply:** keep the in-memory guard as a cheap fast-path, but the durable
safeguard must be a persisted check. For per-recipient sends, check for an
existing persisted record (e.g. a notification of the given type since start of
period) per recipient before sending, and skip if present. Timezone day
boundaries should use a DST-safe Intl-based day-key helper, not local server tz.
