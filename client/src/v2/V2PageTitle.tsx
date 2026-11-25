import { useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { parseFileViewerQuery } from "./fileViewer";
import { APP_NAME, pageTitleFor } from "./presentation";
import { useRecordLabel, useRecordRoot } from "./useRecordLabel";

/**
 * Names the browser tab after the screen on it, the record's name first, so
 * several tabs of the app can be told apart. Draws nothing.
 */
export function V2PageTitle() {
  const [location] = useLocation();
  const search = useSearch();
  const recordLabel = useRecordLabel(location);
  const title = pageTitleFor(location, recordLabel ?? (parseFileViewerQuery(search).name || undefined), useRecordRoot(location));

  useEffect(() => {
    document.title = title;
    return () => {
      document.title = APP_NAME;
    };
  }, [title]);

  return null;
}
