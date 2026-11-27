/**
 * Devices whose desktop agent cannot run beside several Timers (#400, ADR-0031).
 * Before the launch of Simultaneous Timers their Members are warned, by email
 * (scripts/warn-outdated-agents.ts) and in the app; from the launch those
 * agents may no longer start a Timer.
 *
 * Outdated: an agent that declared a protocol below the server's, or none, on
 * a Device that is not revoked and was seen in the last 30 days.
 */

import { and, asc, eq, gte, isNull, lt, or } from "drizzle-orm";
import { devices, users } from "@shared/schema";
import { db, type Db } from "../../db";
import { AGENT_PROTOCOL_VERSION } from "../../agentProtocol";

export const OUTDATED_AGENT_SEEN_WITHIN_MS = 30 * 24 * 60 * 60 * 1000;

export interface OutdatedAgentDevice {
  id: string;
  name: string;
  clientVersion: string | null;
  lastSeenAt: Date | null;
}

export interface MemberWithOutdatedAgents {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  devices: OutdatedAgentDevice[];
}

function outdated(now: Date) {
  return and(
    isNull(devices.revokedAt),
    gte(devices.lastSeenAt, new Date(now.getTime() - OUTDATED_AGENT_SEEN_WITHIN_MS)),
    or(isNull(devices.agentProtocolVersion), lt(devices.agentProtocolVersion, AGENT_PROTOCOL_VERSION)),
  );
}

export async function outdatedAgentDevicesForUser(
  userId: string,
  now: Date = new Date(),
  executor: Pick<Db, "select"> = db,
): Promise<OutdatedAgentDevice[]> {
  return executor
    .select({ id: devices.id, name: devices.name, clientVersion: devices.clientVersion, lastSeenAt: devices.lastSeenAt })
    .from(devices)
    .where(and(eq(devices.userId, userId), outdated(now)))
    .orderBy(asc(devices.name));
}

/** Every Member to warn, across Workspaces: an operator read. */
export async function membersWithOutdatedAgents(
  now: Date = new Date(),
  executor: Pick<Db, "select"> = db,
): Promise<MemberWithOutdatedAgents[]> {
  const rows = await executor
    .select({
      userId: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      isArchived: users.isArchived,
      id: devices.id,
      name: devices.name,
      clientVersion: devices.clientVersion,
      lastSeenAt: devices.lastSeenAt,
    })
    .from(devices)
    .innerJoin(users, eq(users.id, devices.userId))
    .where(outdated(now))
    .orderBy(asc(users.email), asc(devices.name));
  const members = new Map<string, MemberWithOutdatedAgents>();
  for (const row of rows) {
    if (row.isArchived || !row.email) continue;
    const member = members.get(row.userId)
      ?? { userId: row.userId, email: row.email, firstName: row.firstName, lastName: row.lastName, devices: [] };
    member.devices.push({ id: row.id, name: row.name, clientVersion: row.clientVersion, lastSeenAt: row.lastSeenAt });
    members.set(row.userId, member);
  }
  return Array.from(members.values());
}
