/**
 * The outdated desktop app banner (ADR-0031, "Forced agent update").
 *
 * `GET /api/time-tracking/agent-update` lists the reader's Devices whose app
 * must be updated. The shell shows one persistent banner while any is listed:
 * before the launch it warns, after it says what no longer works.
 */

export const AGENT_UPDATE_PATH = "/api/time-tracking/agent-update";

export type AgentUpdateResponse = {
  launchAt: string | null;
  launched: boolean;
  devices: Array<{ id: string; name: string; clientVersion: string | null }>;
};

export type AgentUpdateBanner = {
  copy: string;
  linkLabel: string;
  href: string;
};

export function agentUpdateBanner(
  input: AgentUpdateResponse | null | undefined,
  options: { locale?: string; timeZone?: string } = {},
): AgentUpdateBanner | null {
  if (!input || input.devices.length === 0) return null;
  const names = new Intl.ListFormat(options.locale ?? "en-GB", { style: "long", type: "conjunction" }).format(
    input.devices.map((device) => device.name),
  );
  const link = { linkLabel: "Get the new version", href: "/devices" };
  if (input.launched) {
    return { copy: `Update the desktop app on ${names}. This version can no longer start a Timer.`, ...link };
  }
  const launch = input.launchAt ? new Date(input.launchAt) : null;
  const when =
    launch && !Number.isNaN(launch.getTime())
      ? new Intl.DateTimeFormat(options.locale ?? "en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: options.timeZone,
        }).format(launch)
      : null;
  return {
    copy: `Update the desktop app on ${names} ${when ? `before ${when}` : "soon"}. After that it can no longer start a Timer.`,
    ...link,
  };
}
