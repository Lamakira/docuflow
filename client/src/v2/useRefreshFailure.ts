import { useEffect } from "react";
import { notify } from "./notify";

/** A refresh that fails keeps what is on screen and says so once. */
export function useRefreshFailure(failed: boolean, message: string, id: string) {
  useEffect(() => {
    if (failed) notify.error(null, { fallback: message, id });
  }, [failed, message, id]);
}
