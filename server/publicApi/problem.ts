import type { Response } from "express";

export type Problem = {
  type: string;
  title: string;
  status: number;
};

export const UNAUTHORIZED: Problem = {
  type: "urn:docuflow:problem:unauthorized",
  title: "Unauthorized",
  status: 401,
};

export const NOT_FOUND: Problem = {
  type: "urn:docuflow:problem:not-found",
  title: "Not Found",
  status: 404,
};

export const CONFLICT: Problem = {
  type: "urn:docuflow:problem:conflict",
  title: "Conflict",
  status: 409,
};

export const RATE_LIMITED: Problem = {
  type: "urn:docuflow:problem:rate-limited",
  title: "Too Many Requests",
  status: 429,
};

export const INTERNAL: Problem = {
  type: "urn:docuflow:problem:internal",
  title: "Internal Server Error",
  status: 500,
};

/**
 * RFC 9457 problem+json. `requestId` is the OpenTelemetry trace id (ADR-0011).
 */
export function sendProblem(res: Response, problem: Problem, requestId: string): void {
  if (res.headersSent) return;
  res.status(problem.status);
  res.setHeader("Content-Type", "application/problem+json; charset=utf-8");
  res.send(JSON.stringify({ ...problem, requestId }));
}
