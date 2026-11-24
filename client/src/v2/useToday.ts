import { useMemo } from "react";
import { dateToDay } from "./dates";

/** One instant per local day, so a page left open past midnight moves to the new one. */
export function useToday(): Date {
  const day = dateToDay(new Date());
  return useMemo(() => new Date(), [day]);
}
