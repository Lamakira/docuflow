import type { Request } from "express";
import type { PrincipalContext } from "../modules/identity";

export type PublicApiRequest = Request & {
  principalContext?: PrincipalContext;
  publicApiRequestId?: string;
};
