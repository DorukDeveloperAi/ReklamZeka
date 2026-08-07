import type { CanonicalDailyMetric, SourcePlatform } from "@/domain/ads/canonical";

export type ConnectorErrorCode = "authentication" | "rate_limited" | "transient" | "invalid_data";

export class ConnectorError extends Error {
  constructor(
    readonly code: ConnectorErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

export type ConnectorRateLimit = Readonly<{
  maxRequests: number;
  windowMs: number;
}>;

export type SourceRecord<TPayload = unknown> = Readonly<{
  id: string;
  updatedAt: string;
  payload: TPayload;
}>;

export type ConnectorPage<TPayload = unknown> = Readonly<{
  records: readonly SourceRecord<TPayload>[];
  nextCursor?: string;
  observedAt: string;
}>;

export interface ReadOnlyAdConnector<TPayload = unknown> {
  readonly platform: SourcePlatform;
  readonly access: "read_only";
  readonly rateLimit: ConnectorRateLimit;
  fetchPage(cursor?: string): Promise<ConnectorPage<TPayload>>;
  toCanonical(record: SourceRecord<TPayload>, workspaceId: string): CanonicalDailyMetric;
}
