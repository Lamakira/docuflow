import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { CompanyDocument } from "@shared/schema";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { chromeRefusal } from "./chrome";
import { moveDestinations, moveRequest } from "./documentEditor";
import type { LibraryFolder } from "./library";
import { isStandingRefusal, notify } from "./notify";
import { V2FormDialog } from "./V2FormDialog";
import { V2FilterSelect, V2_SELECT_NONE } from "./V2Select";

const MAX_DOCUMENT_NAME = 500;

async function loadFolders(): Promise<LibraryFolder[]> {
  const body = await apiRequest("GET", "/api/company-documents/register");
  return body.folders ?? [];
}

/**
 * Files a Workspace Document in another Folder, and renames a File, whose name
 * has no editor to change it in (F54). The caller renders the trigger only
 * where the route said `canManageAccess`; the PATCH refuses everyone else.
 */
export function V2MoveDocumentDialog({
  kind,
  id,
  name,
  folderId,
  folderName,
  onOpenChange,
  readOnlyRefusal,
  beforeSave,
  onSaved,
}: {
  kind: "document" | "file";
  id: string;
  name: string;
  folderId: string | null;
  /** The current Folder's name, so it is named even when the reader's list does not hold it. */
  folderName: string | null;
  onOpenChange: (open: boolean) => void;
  readOnlyRefusal?: string | null;
  /** Lets the editor's own save land first, so the move does not read as someone else's change. */
  beforeSave?: () => Promise<void>;
  onSaved: (row: CompanyDocument, folder: { id: string; name: string } | null) => void;
}) {
  const [target, setTarget] = useState(folderId ?? V2_SELECT_NONE);
  const [nextName, setNextName] = useState(name);
  const [refusal, setRefusal] = useState<string | null>(null);
  const { data: folders = [], isError } = useQuery<LibraryFolder[]>({
    queryKey: ["/api/company-documents", "register", "move-folders"],
    queryFn: loadFolders,
    staleTime: 0,
  });
  useEffect(() => {
    if (isError) notify.error(null, { fallback: "The Folders could not be loaded.", id: "v2-move-folders" });
  }, [isError]);

  const destinations = moveDestinations(folders, folderId ? { id: folderId, name: folderName ?? "Current Folder" } : null);
  const request = moveRequest({
    folderId,
    name,
    target: target === V2_SELECT_NONE ? null : target,
    nextName: kind === "file" ? nextName : name,
  });

  const save = useMutation({
    mutationFn: async (body: NonNullable<typeof request>) => {
      await beforeSave?.();
      return (await apiRequest("PATCH", `/api/company-documents/${id}`, body)) as CompanyDocument;
    },
    onSuccess: (row) => {
      onSaved(row, row.folderId ? folders.find((folder) => folder.id === row.folderId) ?? null : null);
      notify.success(kind === "file" ? "File updated" : "Document moved");
      onOpenChange(false);
    },
    onError: (error: Error) => {
      if (!isStandingRefusal(error)) return notify.error(error);
      setRefusal(chromeRefusal({ kind: "generic", message: error.message }));
    },
  });

  function onSubmit() {
    if (!request) return;
    if (readOnlyRefusal) {
      setRefusal(readOnlyRefusal);
      return;
    }
    save.mutate(request);
  }

  return (
    <V2FormDialog
      open
      onOpenChange={(next) => {
        if (!next && save.isPending) return;
        onOpenChange(next);
      }}
      title={kind === "file" ? "Rename or move" : "Move Document"}
      description={
        kind === "file"
          ? "Change the File's name, the Folder it is filed in, or both."
          : "Choose the Folder this Document is filed in. Who can open it follows the Folder."
      }
      submitLabel={kind === "file" ? "Save" : "Move"}
      pending={save.isPending}
      canSubmit={Boolean(request)}
      onSubmit={onSubmit}
      refusal={refusal}
      testId={`v2-move-${kind}`}
    >
      {kind === "file" ? (
        <label className="df-daily-field">
          Name
          <Input
            type="text"
            value={nextName}
            maxLength={MAX_DOCUMENT_NAME}
            onChange={(event) => setNextName(event.target.value)}
            aria-label="File name"
          />
        </label>
      ) : null}
      <label className="df-daily-field">
        Folder
        <V2FilterSelect
          label=""
          ariaLabel="Folder"
          value={target}
          options={[{ value: V2_SELECT_NONE, label: "Workspace root" }, ...destinations]}
          onChange={setTarget}
        />
      </label>
    </V2FormDialog>
  );
}
