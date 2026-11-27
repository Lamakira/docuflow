import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Check, Clock, Users } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  WORKSPACE_NAME_MAX,
  composeWorkspaceCard,
  composeWorkspaceTimeZone,
  workspaceNameIssue,
  workspacePath,
  workspaceSettingsPath,
  workspaceTimeZoneChoices,
} from "./administration";
import { errorMessage, notify } from "./notify";
import { SkeletonBand } from "./V2Skeleton";
import { V2FormDialog } from "./V2FormDialog";
import { V2LoadFailed } from "./V2EmptyState";
import {
  AdministrationRefused,
  useAdministrationRead,
  useAdministrationWrites,
  type AdministrationContext,
} from "./V2AdministrationParts";
import type { WorkspaceMemberRow } from "./workspace";

type WorkspaceMembershipsResponse = { memberships: WorkspaceMemberRow[] };

type WorkspaceSettingsResponse = {
  /** The Workspace time zone Workday Daily Update reminders count in (#341). */
  timeZone?: string | null;
};

/** The chrome reads the Workspace's name from here; a rename refreshes it. */
const CHROME_MEMBERSHIPS_KEY = ["/api/memberships"];

/**
 * The Workspace tab (F110): its name (the Owner renames it through a dialog),
 * its Owner, how many Members it holds, and the time zone its reminders count in.
 */
export function V2AdministrationWorkspace({
  context,
  nameDraft,
  onNameDraft,
  zoneDraft,
  onZoneDraft,
}: {
  context: AdministrationContext;
  nameDraft: string | null;
  onNameDraft: (draft: string | null) => void;
  zoneDraft: string | null;
  onZoneDraft: (draft: string | null) => void;
}) {
  const members = useAdministrationRead<WorkspaceMembershipsResponse>("/api/workspace/memberships", "Members", "members", {
    refusable: false,
  });
  const card = composeWorkspaceCard({
    workspaceName: context.workspaceName,
    workspaceRole: context.workspaceRole,
    ownerName: context.ownerName,
    members: members.data?.memberships,
  });
  const [nameProblem, setNameProblem] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);

  const rename = useMutation({
    mutationFn: (name: string) => apiRequest("PATCH", workspacePath(), { name }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CHROME_MEMBERSHIPS_KEY });
      onNameDraft(null);
      setNameProblem(null);
      setRenameOpen(false);
      notify.success("Workspace renamed");
    },
    onError: (error) => setNameProblem(errorMessage(error, "The Workspace could not be renamed.")),
  });

  function onRenameOpenChange(open: boolean) {
    setRenameOpen(open);
    if (!open) {
      onNameDraft(null);
      setNameProblem(null);
    }
  }

  function onRename() {
    if (nameDraft === null) return;
    const issue = workspaceNameIssue(nameDraft);
    if (issue) return setNameProblem(issue);
    rename.mutate(nameDraft.trim());
  }

  return (
    <>
      <section className="df-card" data-testid="v2-administration-workspace">
        <div className="df-card-head">
          <div className="df-card-head-text">
            <h2 className="df-card-title">Workspace</h2>
            <p className="df-card-sub">The name everyone here sees, who owns it, the Workspace Role you hold in it, and the time zone its reminders follow.</p>
          </div>
        </div>
        <div className="df-admin-identity" data-testid="v2-administration-workspace-identity">
          <span className="df-admin-identity-tile" aria-hidden="true">{card.initials}</span>
          <div className="df-admin-identity-text">
            <span className="df-admin-identity-name">{card.name}</span>
            <span className="df-admin-identity-sub">{card.renameNote ?? "Your Workspace"}</span>
          </div>
          <span className="df-status df-admin-identity-role" data-tone="active">{card.roleBadge}</span>
          {card.renamable ? (
            <Button
              variant="outline"
              type="button"
              className="df-btn"
              onClick={() => setRenameOpen(true)}
              data-testid="v2-administration-workspace-rename"
            >
              Rename
            </Button>
          ) : null}
        </div>
        <V2FormDialog
          open={renameOpen}
          onOpenChange={onRenameOpenChange}
          title="Rename Workspace"
          description="The name everyone in this Workspace sees."
          submitLabel={rename.isPending ? "Saving…" : "Save name"}
          pending={rename.isPending}
          canSubmit={nameDraft !== null}
          onSubmit={onRename}
          refusal={nameProblem}
          testId="v2-administration-workspace-rename-dialog"
        >
          <label className="df-daily-field">
            Name
            <Input
              value={nameDraft ?? card.name}
              maxLength={WORKSPACE_NAME_MAX + 20}
              aria-invalid={nameProblem ? true : undefined}
              onChange={(event) => {
                setNameProblem(null);
                onNameDraft(event.target.value === card.name ? null : event.target.value);
              }}
              autoFocus
              data-testid="v2-administration-workspace-name"
            />
          </label>
        </V2FormDialog>
        {members.state === "loading" ? (
          <div className="df-admin-facts" aria-hidden="true">
            <SkeletonBand tiles={2} />
          </div>
        ) : members.state === "ready" ? (
          <div className="df-admin-facts" data-testid="v2-administration-workspace-facts">
            <div className="df-admin-fact">
              <Avatar className="df-admin-fact-avatar">
                <AvatarFallback className="df-admin-fact-avatar-fallback">{card.owner?.initials ?? "-"}</AvatarFallback>
              </Avatar>
              <div className="df-admin-fact-text">
                <span className="df-admin-fact-label">Owner</span>
                <span className="df-admin-fact-value">{card.owner?.name ?? "-"}</span>
              </div>
            </div>
            {card.members ? (
              <div className="df-admin-fact">
                <Users size={16} strokeWidth={1.5} className="df-admin-fact-icon" aria-hidden="true" />
                <div className="df-admin-fact-text">
                  <span className="df-admin-fact-label">Members</span>
                  <span className="df-admin-fact-value">{card.members}</span>
                </div>
                <Link href="/people" className="df-admin-fact-link" data-testid="v2-administration-workspace-people">
                  Manage in People
                  <ArrowRight size={14} strokeWidth={1.5} aria-hidden="true" />
                </Link>
              </div>
            ) : null}
          </div>
        ) : (
          <V2LoadFailed title="The Owner and Members could not be loaded" onRetry={members.retry} testId="v2-administration-workspace-failed" />
        )}
        <WorkspaceTimeZoneFact context={context} zoneDraft={zoneDraft} onZoneDraft={onZoneDraft} />
      </section>
    </>
  );
}

/** The time zone as a line of the Workspace summary, changed in a dialog like the name. */
function WorkspaceTimeZoneFact({
  context,
  zoneDraft,
  onZoneDraft,
}: {
  context: AdministrationContext;
  zoneDraft: string | null;
  onZoneDraft: (draft: string | null) => void;
}) {
  const settings = useAdministrationRead<WorkspaceSettingsResponse>(workspaceSettingsPath(), "The Workspace time zone", "settings");
  const writes = useAdministrationWrites(context);
  const [open, setOpen] = useState(false);
  const saved = settings.data ? (settings.data.timeZone ?? "") : null;
  const editable = context.condition !== "Read-only";
  const zone = composeWorkspaceTimeZone({
    saved,
    draft: zoneDraft ?? saved ?? "",
    editable,
  });

  const save = useMutation({
    mutationFn: (timeZone: string) => apiRequest("PATCH", workspaceSettingsPath(), { timeZone }),
    onSuccess: async (_data, timeZone) => {
      queryClient.setQueryData<WorkspaceSettingsResponse | null>([workspaceSettingsPath()], (old) => (old ? { ...old, timeZone } : old));
      onZoneDraft(null);
      writes.clear();
      setOpen(false);
      notify.success("Workspace time zone saved");
      await queryClient.invalidateQueries({ queryKey: [workspaceSettingsPath()] });
    },
    onError: (error: Error) => writes.refuse(error.message),
  });

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      onZoneDraft(null);
      writes.clear();
    }
  }

  if (settings.state === "loading") {
    return (
      <div className="df-admin-facts" aria-hidden="true">
        <SkeletonBand tiles={1} />
      </div>
    );
  }
  if (settings.state === "failed") {
    return <V2LoadFailed title="The time zone could not be loaded" onRetry={settings.retry} testId="v2-administration-workspace-timezone-failed" />;
  }
  if (settings.state === "refused") return <AdministrationRefused context={context} />;

  return (
    <div className="df-admin-facts" data-testid="v2-administration-workspace-timezone">
      <div className="df-admin-fact">
        <Clock size={16} strokeWidth={1.5} className="df-admin-fact-icon" aria-hidden="true" />
        <div className="df-admin-fact-text">
          <span className="df-admin-fact-label">Time zone</span>
          <span className="df-admin-fact-value df-mono">{zone.current}</span>
        </div>
        {editable ? (
          <Button
            variant="outline"
            type="button"
            className="df-btn df-admin-fact-action"
            onClick={() => setOpen(true)}
            data-testid="v2-administration-workspace-timezone-change"
          >
            Change
          </Button>
        ) : null}
      </div>
      <V2FormDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Change time zone"
        description={zone.copy}
        submitLabel={save.isPending ? "Saving…" : "Save time zone"}
        pending={save.isPending}
        canSubmit={zone.canSave}
        onSubmit={() => {
          if (!writes.guard()) return;
          save.mutate((zoneDraft ?? "").trim());
        }}
        refusal={writes.refusal ?? zone.issue}
        testId="v2-administration-workspace-timezone-dialog"
      >
        <div className="df-daily-field">
          <span id="df-workspace-zone-label">Time zone</span>
          <TimeZoneList
            value={zoneDraft ?? saved ?? ""}
            saved={saved}
            disabled={!editable}
            onChoose={(next) => onZoneDraft(next === saved ? null : next)}
          />
        </div>
      </V2FormDialog>
    </div>
  );
}

/**
 * The IANA zones as a shadcn Command list (F110): chosen from the list, never
 * typed. It sits in the Change dialog itself: a popover over the dialog opened
 * upwards over its title, and the dialog's scroll lock kept the wheel from
 * moving a list rendered outside it.
 */
function TimeZoneList({
  value,
  saved,
  disabled,
  onChoose,
}: {
  value: string;
  saved: string | null;
  disabled: boolean;
  onChoose: (zone: string) => void;
}) {
  const zones = workspaceTimeZoneChoices(saved);
  return (
    <Command
      className="df-timezone-list"
      label="Time zone"
      defaultValue={value}
      data-testid="v2-workspace-timezone-picker"
    >
      <CommandInput placeholder="Search time zones" aria-label="Search time zones" autoFocus disabled={disabled} />
      <CommandList>
        <CommandEmpty>No time zone matches</CommandEmpty>
        {zones.map((zone) => (
          <CommandItem
            key={zone}
            value={zone}
            disabled={disabled}
            className="df-select-item"
            data-chosen={zone === value ? "true" : undefined}
            onSelect={() => onChoose(zone)}
          >
            {zone}
            {zone === value ? <Check strokeWidth={1.6} aria-hidden className="df-timezone-check" /> : null}
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  );
}
