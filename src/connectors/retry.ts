import { ConnectorError } from "./contract";

export type RetryOptions = Readonly<{
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  /** Stable injectable entropy keeps retry behavior reproducible in fixtures. */
  random?: () => number;
  jitterRatio?: number;
}>;

const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function withConnectorRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const jitterRatio = options.jitterRatio ?? 0;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new Error("maxAttempts en az 1 olmalıdır");
  if (!Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 1) throw new Error("jitterRatio 0 ile 1 arasında olmalıdır");

  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof ConnectorError) || !error.retryable || attempt >= maxAttempts) throw error;
      const baseDelay = error.retryAfterMs ?? baseDelayMs * 2 ** (attempt - 1);
      const delay = Math.round(baseDelay * (1 + ((random() * 2) - 1) * jitterRatio));
      await sleep(delay);
    }
  }
  throw new Error("Ulaşılamaz retry durumu");
}
