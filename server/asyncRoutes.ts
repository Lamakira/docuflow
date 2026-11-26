/**
 * Express 4 calls a handler and ignores what it returns, so an async handler
 * that rejects never reaches the error handler: the rejection is unhandled and
 * Node ends the process for everyone (F101). This hands every returned
 * rejection to `next`, as Express 5 does, for every route and middleware of
 * every router, present and future, without a wrapper at each site.
 *
 * Layer is taken from a live router rather than `express/lib/router/layer`:
 * `express` stays external in the server bundle, and this is the same module
 * instance the app's routers use.
 */

import express, { type NextFunction } from "express";

type Handler = (...args: unknown[]) => unknown;
type LayerPrototype = {
  handle: Handler;
  handle_request: (req: unknown, res: unknown, next: NextFunction) => void;
  handle_error: (error: unknown, req: unknown, res: unknown, next: NextFunction) => void;
  asyncRoutesInstalled?: true;
};

function forward(result: unknown, next: NextFunction): void {
  if (result && typeof (result as Promise<unknown>).then === "function") {
    (result as Promise<unknown>).then(undefined, (error) => next(error ?? new Error("Rejected promise")));
  }
}

export function layerPrototype(): LayerPrototype {
  const router = express.Router();
  router.use((_req, _res, next) => next());
  return Object.getPrototypeOf(router.stack[0]) as LayerPrototype;
}

export function installAsyncRoutes(): void {
  const layer = layerPrototype();
  if (layer.asyncRoutesInstalled) return;

  layer.handle_request = function (this: LayerPrototype, req, res, next) {
    const fn = this.handle;
    if (fn.length > 3) return next();
    try {
      forward(fn(req, res, next), next);
    } catch (error) {
      next(error);
    }
  };

  layer.handle_error = function (this: LayerPrototype, error, req, res, next) {
    const fn = this.handle;
    if (fn.length !== 4) return next(error);
    try {
      forward(fn(error, req, res, next), next);
    } catch (thrown) {
      next(thrown);
    }
  };

  layer.asyncRoutesInstalled = true;
}

/** Whether `installAsyncRoutes` has run in this process. */
export function asyncRoutesInstalled(): boolean {
  return layerPrototype().asyncRoutesInstalled === true;
}
