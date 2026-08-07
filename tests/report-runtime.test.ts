import { describe, expect, it } from "vitest";
import {
  DemoReportShareService,
  reportSigningKeyFromBase64,
  ReportRuntimeConfigurationError,
} from "@/reports/demo-share";
import { isShareLinkError, ShareLinkError } from "@/reports/share";

const key = Buffer.alloc(32, 7);
const start = "2026-08-06T12:00:00.000Z";

describe("signed demo report runtime", () => {
  it("requires a canonical base64 key with at least 32 bytes", () => {
    expect(reportSigningKeyFromBase64(key.toString("base64"))).toEqual(key);
    expect(() => reportSigningKeyFromBase64(undefined)).toThrow(ReportRuntimeConfigurationError);
    expect(() => reportSigningKeyFromBase64("not-base64")).toThrow(/base64/);
    expect(() => reportSigningKeyFromBase64(Buffer.alloc(16).toString("base64"))).toThrow(/32 byte/);
  });

  it("creates a read-only snapshot-bound report and CSV under an expiring token", () => {
    const service = new DemoReportShareService(key);
    const created = service.create(start, 60);
    expect(created).toMatchObject({ access: "read_only", expiresAt: "2026-08-06T13:00:00.000Z" });
    const report = service.read(created.token, "2026-08-06T12:30:00.000Z");
    expect(report).toMatchObject({ access: "read_only", workspaceId: "demo-workspace", snapshotId: "demo:delayed:7" });
    expect(service.csv(created.token, "2026-08-06T12:30:00.000Z")).toContain('"Yaz fırsatları","meta_ads"');
    expect(service.auditEvents().map((event) => event.action)).toEqual(["report.shared"]);
  });

  it("rejects expired links and permanently rejects a revoked token in the runtime", () => {
    const service = new DemoReportShareService(key);
    const expired = service.create(start, 60);
    expect(() => service.read(expired.token, expired.expiresAt)).toThrowError(expect.objectContaining({ code: "expired" }));

    const active = service.create(start, 120);
    expect(service.revoke(active.token, "2026-08-06T12:10:00.000Z")).toBe(active.shareId);
    expect(() => service.read(active.token, "2026-08-06T12:11:00.000Z"))
      .toThrowError(expect.objectContaining({ code: "revoked" }));
    expect(service.auditEvents().map((event) => event.action)).toEqual([
      "report.shared", "report.shared", "report.revoked",
    ]);
  });

  it("rejects invalid lifetimes before signing", () => {
    const service = new DemoReportShareService(key);
    expect(() => service.create(start, 0)).toThrow(ShareLinkError);
    expect(() => service.create(start, 30 * 24 * 60 + 1)).toThrow(ShareLinkError);
  });

  it("recognizes serialized share errors across server bundle boundaries", () => {
    expect(isShareLinkError({ name: "ShareLinkError", code: "revoked", message: "revoked" })).toBe(true);
    expect(isShareLinkError({ name: "ShareLinkError", code: "unknown" })).toBe(false);
  });
});
