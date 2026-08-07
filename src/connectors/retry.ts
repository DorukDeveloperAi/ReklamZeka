import { ConnectorError } from "./contract";

export type RetryOptions = Readonly<{
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}>;

const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function withConnectorRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const sleep = options.sleep ?? defaultSleep;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new Error("maxAttempts en az 1 olmalıdır");

  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof ConnectorError) || !error.retryable || attempt >= maxAttempts) throw error;
      const delay = error.retryAfterMs ?? baseDelayMs * 2 ** (attempt - 1);
      await sleep(delay);
    }
  }
  throw new Error("Ulaşılamaz retry durumu");
}
