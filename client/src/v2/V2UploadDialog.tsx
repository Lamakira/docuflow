import { useEffect, useState, type DragEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { V2FormDialog } from "./V2FormDialog";

/** The object path a stored upload answers with, before any row points at it. */
export async function storeUpload(file: File): Promise<string> {
  const { uploadURL, objectPath } = (await apiRequest("POST", "/api/company-documents/upload-url")) as {
    uploadURL: string;
    objectPath: string;
  };
  const response = await fetch(uploadURL, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type },
  });
  if (!response.ok) throw new Error(`Failed to upload ${file.name}`);
  return objectPath;
}

export function fileTitle(file: File): string {
  return file.name.replace(/\.[^/.]+$/, "");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The upload dialog (#273), shared by Workspace Documents and Project
 * Documentation (#278). Each chosen file is uploaded in turn; one that fails
 * stays listed with the refusal, so the reader can retry without choosing
 * again.
 */
export function V2UploadDialog({
  open,
  onOpenChange,
  description,
  upload,
  pending,
  canUpload = true,
  beforeUpload,
  refusal,
  testId,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  description: string;
  /** Stores one file and creates its row; a rejection keeps the file listed. */
  upload: (file: File) => Promise<unknown>;
  pending: boolean;
  /** False while a field the upload needs, such as its Project, is unset. */
  canUpload?: boolean;
  /** Refuses before anything is sent, such as in a Read-only Workspace. */
  beforeUpload?: () => boolean;
  refusal: string | null;
  testId: string;
  /** The destination fields under the file list. */
  children?: ReactNode;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [dropOver, setDropOver] = useState(false);

  useEffect(() => {
    if (open) setFiles([]);
  }, [open]);

  function add(list: FileList | null) {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list);
    setFiles((current) => [
      ...current,
      ...incoming.filter((file) => !current.some((kept) => kept.name === file.name && kept.size === file.size)),
    ]);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDropOver(false);
    add(event.dataTransfer.files);
  }

  async function onSubmit() {
    if (files.length === 0) return;
    if (beforeUpload?.()) return;
    for (const file of files) {
      try {
        await upload(file);
        setFiles((current) => current.filter((kept) => kept !== file));
      } catch {
        return;
      }
    }
    onOpenChange(false);
  }

  return (
    <V2FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return;
        onOpenChange(next);
      }}
      title="Upload Files"
      description={description}
      submitLabel={files.length > 1 ? `Upload ${files.length} Files` : "Upload File"}
      pending={pending}
      canSubmit={files.length > 0 && canUpload}
      onSubmit={() => void onSubmit()}
      refusal={refusal}
      testId={testId}
    >
      <label
        className="df-drop-zone"
        data-over={dropOver ? "true" : "false"}
        onDragOver={(event) => {
          event.preventDefault();
          setDropOver(true);
        }}
        onDragLeave={() => setDropOver(false)}
        onDrop={onDrop}
      >
        <strong>Drop files here</strong>
        <span>or click to choose them</span>
        <input
          type="file"
          multiple
          aria-label="Choose files to upload"
          onChange={(event) => {
            add(event.target.files);
            event.target.value = "";
          }}
        />
      </label>
      {files.length > 0 ? (
        <ul className="df-file-list" aria-label="Files to upload">
          {files.map((file) => (
            <li key={`${file.name}-${file.size}`}>
              <span className="df-row-title">{file.name}</span>
              <span className="df-mono df-meta">{formatSize(file.size)}</span>
              <Button
                variant="ghost"
                size="icon"
                type="button"
                className="df-btn"
                aria-label={`Remove ${file.name}`}
                disabled={pending}
                onClick={() => setFiles((current) => current.filter((kept) => kept !== file))}
              >
                <X width={14} height={14} strokeWidth={1.6} />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {children}
    </V2FormDialog>
  );
}
