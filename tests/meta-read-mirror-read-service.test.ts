import { describe, expect, it, vi } from "vitest";
import { MetaReadMirrorReadService } from "@/application/meta-read-mirror-read-service";

describe("Meta read mirror read service", () => {
  it("only delegates the trusted workspace read and exposes no mutation operation", async () => {
    const projection = { version: "meta-read-mirror-projection/1.0.0" } as never;
    const load = vi.fn().mockResolvedValue(projection);
    const service = new MetaReadMirrorReadService({ load });
    await expect(service.read("11111111-1111-4111-8111-111111111111")).resolves.toBe(projection);
    expect(load).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    expect(Object.getOwnPropertyNames(MetaReadMirrorReadService.prototype)).toEqual(["constructor", "read"]);
  });
});
