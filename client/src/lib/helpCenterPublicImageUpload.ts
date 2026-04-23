/**
 * Upload a single image to public object storage (same flow as CRM note attachments).
 * Returns the `/public-objects/…` URL for use with Help Center screenshot slots.
 */
export async function uploadHelpCenterPublicImage(file: File): Promise<string> {
  const uploadUrlRes = await fetch("/api/objects/upload-public", {
    method: "POST",
    credentials: "include",
  });
  if (!uploadUrlRes.ok) throw new Error("Failed to get upload URL");
  const { uploadURL } = await uploadUrlRes.json();

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error("Upload failed"));
    });
    xhr.addEventListener("error", () => reject(new Error("Upload failed")));
    xhr.open("PUT", uploadURL);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.send(file);
  });

  const gcsUrl = uploadURL.split("?")[0];
  const urlParts = new URL(gcsUrl);
  const pathParts = urlParts.pathname.split("/").filter(Boolean);
  const publicIndex = pathParts.findIndex((p) => p === "public");
  const objectPath =
    publicIndex >= 0 ? pathParts.slice(publicIndex + 1).join("/") : pathParts.slice(1).join("/");
  return `/public-objects/${objectPath}`;
}
