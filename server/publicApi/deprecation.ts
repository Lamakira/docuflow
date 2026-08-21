/**
 * Previous public majors live at least 12 months after a successor with
 * `Deprecation` / `Sunset` signaling (ADR-0011). This kernel ships only `v1`,
 * so these headers are not sent today.
 */
export function deprecationHeaders(sunset: Date): { Deprecation: "true"; Sunset: string } {
  return {
    Deprecation: "true",
    Sunset: sunset.toUTCString(),
  };
}
