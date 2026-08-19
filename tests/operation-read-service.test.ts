import { describe, expect, it } from "vitest";
import { OperationReadService } from "@/application/operation-read-service";
const workspaceId = "11111111-1111-4111-8111-111111111111";
describe("operation read service", () => {
  const service = new OperationReadService({ load: async () => ({ facts: [], unavailable: false, nextCursor: null }) }, () => new Date("2026-08-17T12:00:00Z"));
  it("defaults to a bounded last seven day server period", async () => expect((await service.read(workspaceId)).period).toEqual({ startDate: "2026-08-11", endDate: "2026-08-17" }));
  it("rejects malformed query values and opaque cursor abuse", async () => { await expect(service.read(workspaceId, { period: "wat" as never })).rejects.toThrow(); await expect(service.read(workspaceId, { cursor: "uuid" })).rejects.toThrow(); });
  it("does not silently choose UTC when the canonical account timezone is mixed", async () => {
    const timezoneAware = new OperationReadService({ workspaceTimeZone: async () => null, load: async () => ({ facts: [], unavailable: false, nextCursor: null }) });
    await expect(timezoneAware.read(workspaceId)).rejects.toThrow("timezone");
  });
});
