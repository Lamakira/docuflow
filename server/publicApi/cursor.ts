/**
 * Cursor-only pagination for `/api/v1` (ADR-0011). Offset pagination is not
 * offered. Fetch `pageSize + 1` rows, then this helper either returns a
 * terminal page or an opaque next cursor.
 */

export type CursorPage<T> = {
  data: T[];
  nextCursor: string | null;
};

export function encodeCursor(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function cursorPage<T extends { id: string }>(
  rows: T[],
  pageSize: number,
  cursorOf: (row: T) => Record<string, unknown> = (row) => ({ id: row.id })
): CursorPage<T> {
  const hasMore = rows.length > pageSize;
  const data = hasMore ? rows.slice(0, pageSize) : rows;
  const last = hasMore ? data[data.length - 1] : undefined;
  return {
    data,
    nextCursor: last ? encodeCursor(cursorOf(last)) : null,
  };
}

/** Public-contract timestamps are RFC 3339 UTC. */
export function rfc3339Utc(date: Date): string {
  return date.toISOString();
}
