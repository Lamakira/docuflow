import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Checkbox } from "@/components/ui/checkbox";
import { chromeRefusal } from "./chrome";
import {
  accessPath,
  composeManageAccess,
  toggleAccessMember,
  type AccessDraft,
  type AccessItemKind,
  type AccessMember,
  type AccessStateView,
} from "./manageAccess";
import { V2FormDialog } from "./V2FormDialog";
import { isStandingRefusal, notify } from "./notify";
import { V2FilterSelect } from "./V2Select";
import type { AccessLevel } from "@shared/documentAccess";

const WORKSPACE_MEMBERSHIPS_PATH = "/api/workspace/memberships";

/**
 * Manage access on a Workspace Document, File, or Folder (#278). The caller
 * renders the trigger only where the route said `canManageAccess`; the PUT
 * refuses everyone else anyway.
 */
export function V2ManageAccessDialog({
  kind,
  id,
  open,
  onOpenChange,
  readOnlyRefusal,
}: {
  kind: AccessItemKind;
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Set when the Workspace is Read-only, so saving refuses before it asks. */
  readOnlyRefusal?: string | null;
}) {
  const path = accessPath(kind, id);
  const { data: state } = useQuery<AccessStateView>({
    queryKey: [path],
    enabled: open,
    staleTime: 0,
  });
  const { data: memberships } = useQuery<{ memberships: AccessMember[] }>({
    queryKey: [WORKSPACE_MEMBERSHIPS_PATH],
    enabled: open,
  });
  const [draft, setDraft] = useState<AccessDraft | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setDraft(null);
      setRefusal(null);
      return;
    }
    if (state && !draft) setDraft({ level: state.level, memberIds: state.memberIds });
  }, [open, state, draft]);

  const save = useMutation({
    mutationFn: (next: AccessDraft) => apiRequest("PUT", path, next),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [path] });
      queryClient.invalidateQueries({ queryKey: ["/api/company-document-folders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company-documents"] });
      onOpenChange(false);
      notify.success("Document Access saved");
    },
    onError: (error: Error) => {
      if (!isStandingRefusal(error)) return notify.error(error);
      setRefusal(chromeRefusal({ kind: "generic", message: error.message }));
    },
  });

  const model = state && draft ? composeManageAccess(state, memberships?.memberships ?? [], draft) : null;

  function onSubmit() {
    if (!draft) return;
    if (readOnlyRefusal) {
      setRefusal(readOnlyRefusal);
      return;
    }
    save.mutate(draft);
  }

  return (
    <V2FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && save.isPending) return;
        onOpenChange(next);
      }}
      title={model?.title ?? "Manage access"}
      description="Choose who in this Workspace can find and open it. A Member without access never sees it anywhere: the register, search, previews, links, or Ask DocuFlow."
      submitLabel="Save access"
      pending={save.isPending}
      canSubmit={Boolean(model?.canSave)}
      onSubmit={onSubmit}
      refusal={refusal}
      testId={`v2-manage-access-${kind}`}
    >
      {model && draft ? (
        <>
          <p className="df-form-dialog-copy" data-testid="v2-manage-access-inherited">
            {model.inheritedCopy}
          </p>
          <label className="df-daily-field">
            ACCESS
            <V2FilterSelect
              label=""
              ariaLabel="Access level"
              value={draft.level}
              options={model.levelOptions}
              onChange={(level) => setDraft({ ...draft, level: level as AccessLevel })}
            />
          </label>
          {model.showMembers ? (
            <fieldset className="df-access-members" aria-label="Named Members">
              <legend className="df-mono df-meta">NAMED MEMBERS</legend>
              {model.memberChoices.length === 0 ? (
                <p className="df-empty">{model.membersEmptyCopy}</p>
              ) : (
                model.memberChoices.map((choice) => (
                  <div className="df-checkbox-row" key={choice.userId}>
                    <Checkbox
                      id={`df-access-member-${choice.userId}`}
                      className="df-checkbox"
                      checked={choice.checked}
                      onCheckedChange={(next) => setDraft(toggleAccessMember(draft, choice.userId, next === true))}
                    />
                    <label htmlFor={`df-access-member-${choice.userId}`}>
                      {choice.label}
                      {choice.owner ? <span className="df-mono df-meta"> · ADDED IT</span> : null}
                    </label>
                  </div>
                ))
              )}
            </fieldset>
          ) : null}
          {model.hint ? <p className="df-mono df-meta">{model.hint}</p> : null}
        </>
      ) : (
        <p className="df-empty">Loading access.</p>
      )}
    </V2FormDialog>
  );
}
