/**
 * Server paging for the v2 registers (#275). The page and its size live in the
 * URL beside the filters, so a shared link opens on the same rows.
 */

export const REGISTER_PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_REGISTER_PAGE_SIZE = 50;

export function readPage(params: URLSearchParams): number {
  const page = Number(params.get("page"));
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export function readPageSize(params: URLSearchParams): number {
  const size = Number(params.get("size"));
  return (REGISTER_PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_REGISTER_PAGE_SIZE;
}

/** Writes page and size, leaving the defaults out of the URL. */
export function writePaging(params: URLSearchParams, page: number, pageSize: number): void {
  if (page > 1) params.set("page", String(page));
  else params.delete("page");
  if (pageSize !== DEFAULT_REGISTER_PAGE_SIZE) params.set("size", String(pageSize));
  else params.delete("size");
}

export type RegisterPaging = {
  page: number;
  pageCount: number;
  pageSize: number;
  /** "1–50 of 132 PROJECTS", or the bare count when it all fits on one page. */
  label: string;
  hasPrevious: boolean;
  hasNext: boolean;
  /** The size picker only helps once there is more than the smallest page. */
  showControls: boolean;
};

export function composePaging(input: {
  page: number;
  pageSize: number;
  total: number;
  noun: { one: string; many: string };
}): RegisterPaging {
  const pageSize = Math.max(1, input.pageSize);
  const total = Math.max(0, input.total);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, input.page), pageCount);
  const noun = total === 1 ? input.noun.one : input.noun.many;
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return {
    page,
    pageCount,
    pageSize,
    label: pageCount > 1 ? `${first}–${last} OF ${total} ${noun}` : `${total} ${noun}`,
    hasPrevious: page > 1,
    hasNext: page < pageCount,
    showControls: total > REGISTER_PAGE_SIZES[0],
  };
}
