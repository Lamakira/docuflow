import { Button } from "@/components/ui/button";
import { REGISTER_PAGE_SIZES, type RegisterPaging } from "./paging";
import { V2FilterSelect } from "./V2Select";

/** The register foot: the count, then page size and Previous / Next once there is more than one small page (#275). */
export function V2RegisterPager({
  paging,
  ariaLabel,
  onPage,
  onPageSize,
}: {
  paging: RegisterPaging;
  ariaLabel: string;
  onPage: (page: number) => void;
  onPageSize: (pageSize: number) => void;
}) {
  return (
    <nav className="df-library-foot df-register-pager" aria-label={ariaLabel}>
      <span>{paging.label}</span>
      {paging.showControls ? (
        <span className="df-register-pager-controls">
          <V2FilterSelect
            label="PER PAGE"
            ariaLabel="Rows per page"
            value={String(paging.pageSize)}
            options={REGISTER_PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }))}
            onChange={(value) => onPageSize(Number(value))}
          />
          <Button
            variant="outline"
            type="button"
            className="df-btn"
            disabled={!paging.hasPrevious}
            onClick={() => onPage(paging.page - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            type="button"
            className="df-btn"
            disabled={!paging.hasNext}
            onClick={() => onPage(paging.page + 1)}
          >
            Next
          </Button>
        </span>
      ) : null}
    </nav>
  );
}
