import type { AppResponse, ErrorResponse, SuccessResponse } from "./models/response";

export function createSuccessResponse<T>(
  data: T,
  durationMs: number,
  host?: string,
  warnings: string[] = [],
): SuccessResponse<T> {
  return {
    ok: true,
    data,
    meta: createMeta(durationMs, host),
    warnings,
  };
}

export function createErrorResponse(
  code: string,
  message: string,
  durationMs: number,
  host?: string,
  details?: unknown,
  warnings: string[] = [],
): ErrorResponse {
  return {
    ok: false,
    error: {
      code,
      message,
      details,
    },
    meta: createMeta(durationMs, host),
    warnings,
  };
}

export type { AppResponse };

function createMeta(durationMs: number, host?: string) {
  return {
    ...(host ? { host } : {}),
    collectedAt: new Date().toISOString(),
    durationMs,
  };
}
