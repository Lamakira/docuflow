import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { uploadHelpCenterPublicImage } from "@/lib/helpCenterPublicImageUpload";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { HelpScreenshotSlotId } from "@shared/helpCenterScreenshotSlots";
import { Loader2, ImagePlus } from "lucide-react";
import { cn } from "@/lib/utils";

type ScreenshotMap = Record<string, string | null>;

async function fetchScreenshotMap(): Promise<ScreenshotMap> {
  return apiRequest("GET", "/api/help-center/screenshot-map");
}

interface HelpScreenshotProps {
  slotId: HelpScreenshotSlotId;
  /** Shown under the image; always safe for all users. */
  caption: string;
  /** Expected capture — shown to admins in empty state and as subtle hint when an image exists. */
  expectedLabel: string;
}

export function HelpScreenshot({ slotId, caption, expectedLabel }: HelpScreenshotProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { data: map, isLoading } = useQuery<ScreenshotMap>({
    queryKey: ["/api/help-center/screenshot-map"],
    queryFn: fetchScreenshotMap,
    staleTime: 30_000,
  });

  const url = map?.[slotId] ?? null;

  const saveMutation = useMutation({
    mutationFn: async (publicUrl: string) => {
      await apiRequest("PATCH", "/api/admin/org-settings", {
        helpCenterScreenshots: { [slotId]: publicUrl },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/help-center/screenshot-map"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/org-settings"] });
      toast({ title: "Screenshot saved", description: "Help Center image updated for this slot." });
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Upload failed";
      toast({ title: "Could not save screenshot", description: msg, variant: "destructive" });
    },
  });

  async function onFileChange(files: FileList | null) {
    const file = files?.[0];
    if (!file || !isAdmin) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Choose an image file (PNG, JPEG, or WebP).", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const publicUrl = await uploadHelpCenterPublicImage(file);
      await saveMutation.mutateAsync(publicUrl);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      toast({ title: "Upload failed", description: msg, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Loading…
      </div>
    );
  }

  // Non-admin + no asset: render nothing (no unfinished UI).
  if (!url && !isAdmin) {
    return null;
  }

  if (url) {
    return (
      <figure className="my-8 space-y-3 not-prose">
        <div className="relative overflow-hidden rounded-xl border border-border/70 bg-muted/30 shadow-inner ring-1 ring-border/30">
          <img src={url} alt={caption} className="w-full max-h-[min(70vh,520px)] object-contain bg-background/80" loading="lazy" />
          {isAdmin ? (
            <div className="absolute bottom-2 right-2 flex items-center gap-1">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => onFileChange(e.target.files)}
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-7 text-xs shadow-sm"
                disabled={uploading || saveMutation.isPending}
                onClick={() => fileRef.current?.click()}
              >
                {uploading || saveMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  "Replace"
                )}
              </Button>
            </div>
          ) : null}
        </div>
        <figcaption className="text-xs text-muted-foreground px-1 leading-relaxed">{caption}</figcaption>
        {isAdmin ? (
          <p className="text-[11px] text-muted-foreground font-mono" data-testid={`help-screenshot-slot-${slotId}`}>
            Slot: {slotId}
          </p>
        ) : null}
      </figure>
    );
  }

  // Admin + missing asset
  return (
    <div
      className={cn(
        "my-8 rounded-xl border-2 border-dashed border-violet-500/45 bg-violet-500/[0.07] p-5 space-y-3 shadow-sm ring-1 ring-violet-500/10",
        "text-sm text-foreground/90",
      )}
    >
      <div className="flex items-start gap-2">
        <ImagePlus className="h-4 w-4 text-violet-600 dark:text-violet-400 shrink-0 mt-0.5" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-200">
            Screenshot required (admin only)
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">{expectedLabel}</p>
          <p className="text-[11px] font-mono text-muted-foreground">Slot: {slotId}</p>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => onFileChange(e.target.files)}
      />
      <Button
        type="button"
        size="sm"
        variant="default"
        disabled={uploading || saveMutation.isPending}
        onClick={() => fileRef.current?.click()}
      >
        {uploading || saveMutation.isPending ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Uploading…
          </>
        ) : (
          <>
            <ImagePlus className="h-4 w-4 mr-2" />
            Upload image
          </>
        )}
      </Button>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Images are stored in organisation public object storage and linked to this help slot. Users will see the image
        once uploaded; until then they see no placeholder.
      </p>
    </div>
  );
}
