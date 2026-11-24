import { useState } from "react";

/**
 * A capture's image. One that cannot be read leaves a quiet placeholder in the
 * same frame instead of the browser's broken-image icon (F79).
 */
export function V2CaptureImage({
  src,
  alt,
  lazy = false,
}: {
  src: string;
  alt: string;
  lazy?: boolean;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === src) {
    return <span className="df-capture-missing">Image unavailable</span>;
  }
  return <img src={src} alt={alt} loading={lazy ? "lazy" : undefined} onError={() => setFailedSrc(src)} />;
}
