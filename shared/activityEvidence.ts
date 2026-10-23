/**
 * What a capture says about the minute before it (#341). Facts about one
 * capture, never a score about the Member: the gallery and the server filter
 * read the same rules from here.
 */

/** Below this share of the minute, on keyboard and on mouse, a capture is low activity. */
export const DEFAULT_LOW_ACTIVITY_THRESHOLD_PERCENT = 10;

/** At most this many of the 64 fingerprint bits differ between two Similar captures. */
export const SIMILAR_MAX_HAMMING_DISTANCE = 5;

export type CaptureActivity = {
  keyboardActivityPercent?: number | null;
  mouseActivityPercent?: number | null;
};

/** Whether the agent recorded the minute before this capture. Captures from before #330 did not. */
export function hasActivityData(capture: CaptureActivity): boolean {
  return capture.keyboardActivityPercent != null && capture.mouseActivityPercent != null;
}

/**
 * Low activity: both keyboard and mouse below the threshold. A capture without
 * metrics is never low activity — no data is not idleness.
 */
export function isLowActivityCapture(capture: CaptureActivity, thresholdPercent: number): boolean {
  if (!hasActivityData(capture)) return false;
  return capture.keyboardActivityPercent! < thresholdPercent && capture.mouseActivityPercent! < thresholdPercent;
}

/** A threshold the Tracking Policy accepts: an integer from 0 to 100. */
export function isLowActivityThreshold(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
}

const FINGERPRINT = /^[0-9a-f]{16}$/;

/** Bits that differ between two 16-hex-digit fingerprints; null when either is missing or malformed. */
export function hammingDistance(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b || !FINGERPRINT.test(a) || !FINGERPRINT.test(b)) return null;
  let bits = 0;
  // One hex digit at a time: four bits each, no BigInt (the build targets ES2017).
  for (let i = 0; i < 16; i++) {
    let diff = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (diff) {
      bits += diff & 1;
      diff >>= 1;
    }
  }
  return bits;
}

/** Whether two captures show the same screen. A missing fingerprint is never Similar. */
export function isSimilarFingerprint(a: string | null | undefined, b: string | null | undefined): boolean {
  const distance = hammingDistance(a, b);
  return distance !== null && distance <= SIMILAR_MAX_HAMMING_DISTANCE;
}
