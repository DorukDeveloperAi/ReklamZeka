import { describe, expect, it } from "vitest";
import { buildMetaPortfolioCapability, MetaPortfolioCapabilityError } from "@/domain/meta/portfolio-capability";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const connection = { id: "22222222-2222-4222-8222-222222222222", displayName: "Business One", status: "active" as const,
  accessMode: "read_only" as const, grantedScopes: ["ads_read"], enabledCapabilities: ["accounts.read"],
  capabilityCheckedAt: "2026-08-10T12:00:00.000Z" };
const account = { id: "33333333-3333-4333-8333-333333333333", connectionId: connection.id, name: "TR Leads",
  currency: "TRY", timezone: "Europe/Istanbul", spendCapMinor: 250000, disappearedAt: null,
  permissionSnapshot: ["ads_read"], capabilitySnapshot: { schemaVersion: "meta-account-capability/1.0.0", checkedAt: "2026-08-10T12:00:00.000Z", canReadAccount: true }, groupRefs: ["account_group_turkiye"] };

describe("Meta portfolio capability", () => {
  it("keeps each account's read readiness, cap, currency and timezone independent while exposing current group context", () => {
    const result = buildMetaPortfolioCapability({ workspaceId, connections: [connection], accounts: [account, {
      ...account, id: "44444444-4444-4444-8444-444444444444", name: "UK Leads", currency: "GBP", timezone: "Europe/London",
      spendCapMinor: 500000, groupRefs: ["account_group_international"],
    }] });
    expect(result.connections).toEqual([expect.objectContaining({ displayName: "Business One", readReady: true, accountCount: 2 })]);
    expect(result.accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "TR Leads", currency: "TRY", timezone: "Europe/Istanbul", groupRefs: ["account_group_turkiye"],
        readReadiness: "ready", capabilities: expect.objectContaining({ canRead: true, canPlan: true, canWriteMeta: false }) }),
      expect.objectContaining({ name: "UK Leads", currency: "GBP", timezone: "Europe/London", groupRefs: ["account_group_international"] }),
    ]));
  });

  it("does not turn a group into permission or write authority", () => {
    const result = buildMetaPortfolioCapability({ workspaceId, connections: [connection], accounts: [{ ...account,
      permissionSnapshot: null, capabilitySnapshot: null, groupRefs: ["account_group_shared"] } ] });
    expect(result.accounts[0]).toMatchObject({ readReadiness: "partial", reasonCodes: ["account_permission_not_observed", "account_capability_not_observed"],
      capabilities: { canRead: false, canPlan: false, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false } });
  });

  it("marks disconnected and disappeared accounts unavailable rather than borrowing another connection's access", () => {
    const result = buildMetaPortfolioCapability({ workspaceId, connections: [{ ...connection, status: "disconnected" }], accounts: [{ ...account,
      disappearedAt: "2026-08-10T13:00:00.000Z" }] });
    expect(result.accounts[0]).toMatchObject({ readReadiness: "unavailable", reasonCodes: ["connection_not_active", "account_disappeared"],
      capabilities: { canRead: false, canPlan: false, canWriteMeta: false } });
  });

  it("rejects cross-connection accounts, malformed group facts and unbounded portfolio inputs", () => {
    expect(() => buildMetaPortfolioCapability({ workspaceId, connections: [connection], accounts: [{ ...account, connectionId: "missing" }] }))
      .toThrowError(expect.objectContaining({ code: "corrupt_store" }));
    expect(() => buildMetaPortfolioCapability({ workspaceId, connections: [connection], accounts: [{ ...account, groupRefs: ["topic_not_group"] }] }))
      .toThrow(MetaPortfolioCapabilityError);
  });
});
