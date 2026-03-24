export interface ResponseMeta {
  host?: string;
  collectedAt: string;
  durationMs: number;
}

export interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export interface SuccessResponse<T> {
  ok: true;
  data: T;
  meta: ResponseMeta;
  warnings: string[];
}

export interface ErrorResponse {
  ok: false;
  error: ErrorBody;
  meta: ResponseMeta;
  warnings: string[];
}

export type AppResponse<T> = SuccessResponse<T> | ErrorResponse;

