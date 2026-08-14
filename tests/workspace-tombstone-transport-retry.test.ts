import { describe, expect, it, vi } from "vitest";

import {
  isRetryableWorkspaceTombstoneTransportError,
  retryWorkspaceTombstoneTransport,
} from "../scripts/support/workspace-tombstone-transport-retry";

describe("workspace tombstone transport retry", () => {
  it("reconnects once and retries only a connection-level failure", async () => {
    const execute = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("Connection terminated unexpectedly"), { code: "ECONNRESET" }))
      .mockResolvedValueOnce(undefined);
    const reconnect = vi.fn(async () => undefined);
    const completedAfterReconnect = vi.fn(async () => false);

    await retryWorkspaceTombstoneTransport({ execute, reconnect, completedAfterReconnect });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(reconnect).toHaveBeenCalledOnce();
    expect(completedAfterReconnect).toHaveBeenCalledOnce();
  });

  it("does not replay an unknown outcome when post-reconnect evidence proves completion", async () => {
    const execute = vi.fn().mockRejectedValueOnce(new Error("Query read timeout"));
    const reconnect = vi.fn(async () => undefined);
    const completedAfterReconnect = vi.fn(async () => true);

    await retryWorkspaceTombstoneTransport({ execute, reconnect, completedAfterReconnect });

    expect(execute).toHaveBeenCalledOnce();
    expect(reconnect).toHaveBeenCalledOnce();
  });

  it("never retries a lifecycle or revision error", async () => {
    const execute = vi.fn().mockRejectedValueOnce(Object.assign(new Error("revision changed"), { code: "revision_changed" }));
    const reconnect = vi.fn(async () => undefined);

    await expect(retryWorkspaceTombstoneTransport({ execute, reconnect, completedAfterReconnect: async () => false }))
      .rejects.toThrow("revision changed");
    expect(reconnect).not.toHaveBeenCalled();
  });

  it("recognizes only bounded transport classifications", () => {
    expect(isRetryableWorkspaceTombstoneTransportError({ code: "ETIMEDOUT" })).toBe(true);
    expect(isRetryableWorkspaceTombstoneTransportError(new Error("socket hang up"))).toBe(true);
    expect(isRetryableWorkspaceTombstoneTransportError({ code: "revision_changed" })).toBe(false);
  });
});
