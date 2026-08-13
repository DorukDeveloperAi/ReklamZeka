export const WORKSPACE_TOMBSTONE_TRANSPORT_ATTEMPTS = 2;

/**
 * A tombstone transaction is deliberately large and serializable.  A failed
 * transport can leave its commit outcome unknown to the caller, so only retry
 * connection-level failures and let the caller verify a completed tombstone
 * before starting a fresh normal service attempt.
 */
export function isRetryableWorkspaceTombstoneTransportError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as Readonly<{ code?: unknown; message?: unknown }>;
  if (typeof candidate.code === "string" && ["ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT"].includes(candidate.code)) {
    return true;
  }
  if (typeof candidate.message !== "string") return false;
  return /connection terminated|connection timeout|query read timeout|socket hang up/i.test(candidate.message);
}

export async function retryWorkspaceTombstoneTransport(input: Readonly<{
  execute: () => Promise<void>;
  reconnect: () => Promise<void>;
  completedAfterReconnect: () => Promise<boolean>;
}>): Promise<void> {
  for (let attempt = 1; attempt <= WORKSPACE_TOMBSTONE_TRANSPORT_ATTEMPTS; attempt += 1) {
    try {
      await input.execute();
      return;
    } catch (error) {
      if (!isRetryableWorkspaceTombstoneTransportError(error) || attempt === WORKSPACE_TOMBSTONE_TRANSPORT_ATTEMPTS) throw error;
      await input.reconnect();
      if (await input.completedAfterReconnect()) return;
    }
  }
}
