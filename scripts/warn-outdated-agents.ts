/**
 * warn-outdated-agents.ts - email the Members whose desktop app must be updated
 * before Simultaneous Timers launch (#400, ADR-0031).
 *
 *   npm run agents:warn-outdated              # dry run: list who would be mailed
 *   npm run agents:warn-outdated -- --send    # send the emails
 *
 * Needs SIMULTANEOUS_TIMERS_LAUNCH_AT set to the launch date, the same value
 * the server reads, and the email settings of the server (RESEND_API_KEY). An
 * outdated Device declared a protocol below the server's, or none, is not
 * revoked, and was seen in the last 30 days. Running it again mails everyone
 * still outdated again.
 */

import { isEntryPoint } from "./lib/entrypoint";

export interface WarnOutdatedAgentsResult {
  members: number;
  sent: number;
  failed: Array<{ email: string; error: string }>;
}

export async function warnOutdatedAgents(
  options: { send?: boolean } = {},
  report: (message: string) => void = () => {},
): Promise<WarnOutdatedAgentsResult> {
  // Server modules resolve configuration at import; load them only when run.
  const { simultaneousTimersLaunchAt } = await import("../server/simultaneousTimersLaunch");
  const { membersWithOutdatedAgents } = await import("../server/modules/identity/outdatedAgents");
  const { sendAgentUpdateEmail } = await import("../server/email");
  const { config } = await import("../server/config");

  const launchAt = simultaneousTimersLaunchAt();
  if (!launchAt) throw new Error("Set SIMULTANEOUS_TIMERS_LAUNCH_AT to the launch date first");

  const members = await membersWithOutdatedAgents();
  const result: WarnOutdatedAgentsResult = { members: members.length, sent: 0, failed: [] };
  report(`${members.length} Member(s) with an outdated desktop app, launch ${launchAt.toISOString()}`);
  for (const member of members) {
    const names = member.devices.map((device) => `${device.name} (${device.clientVersion ?? "unknown version"})`);
    report(`  ${member.email}: ${names.join(", ")}`);
    if (!options.send) continue;
    const sent = await sendAgentUpdateEmail({
      toEmail: member.email,
      recipientName: [member.firstName, member.lastName].filter(Boolean).join(" ") || member.email,
      launchAt,
      deviceNames: member.devices.map((device) => device.name),
      appUrl: config.appUrl,
    });
    if (sent.success) result.sent++;
    else result.failed.push({ email: member.email, error: sent.error ?? "unknown error" });
  }
  if (!options.send) report("Dry run: nothing sent. Add --send to send.");
  return result;
}

if (isEntryPoint(import.meta.url)) {
  const send = process.argv.includes("--send");
  warnOutdatedAgents({ send }, (message) => console.log(message))
    .then((result) => {
      if (send) console.log(`sent: ${result.sent}, failed: ${result.failed.length}`);
      for (const failure of result.failed) console.log(`  failed ${failure.email}: ${failure.error}`);
      process.exit(result.failed.length > 0 ? 1 : 0);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
