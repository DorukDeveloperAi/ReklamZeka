import { describe, expect, it } from "vitest";
import { deriveMetaAccountReadCapabilityEvidence, MetaAccountReadCapabilityEvidenceError } from "@/domain/meta/account-read-capability-evidence";
import { normalizeMetaAssetMirror } from "@/domain/meta/asset-mirror";

function snapshot(status: "verified" | "empty" | "permission_missing" | "unsupported" | "unavailable") {
  const fetchedAt = "2026-08-10T12:00:00.000Z";
  return normalizeMetaAssetMirror({ schemaVersion: 1, workspaceId: "workspace_a", connectionExternalKey: "connection_a",
    adAccountExternalIds: ["act_2", "act_1"], assets: [], edges: [], fetchedAt, writeOperations: 0,
    discoveries: [{ resource: "ad_accounts", sourceType: "connection", sourceExternalId: null, status,
      reason: status === "verified" ? null : "read unavailable", itemCount: status === "verified" ? 2 : 0,
      provenance: { sourceEdge: "/me/adaccounts", fetchedAt, sourceGraphVersion: "v23.0", fieldCatalogVersion: "meta-assets-v1", rawPayloadHash: "a".repeat(64) } }],
  });
}

describe("Meta account read capability evidence", () => {
  it("materializes only the source-bound accessible account list with all write capabilities false", () => {
    const result = deriveMetaAccountReadCapabilityEvidence(snapshot("verified"));
    expect(result.map((row) => row.externalAccountId)).toEqual(["act_1", "act_2"]);
    expect(result[0]).toMatchObject({ permissionSnapshot: ["ads_read"], capabilitySnapshot: {
      schemaVersion: "meta-account-capability/1.0.0", sourceStatus: "verified", canReadAccount: true,
      capabilities: { canRead: true, canPlan: true, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false },
    } });
  });

  it.each(["empty", "permission_missing", "unsupported", "unavailable"] as const)("fails closed when account discovery is %s", (status) => {
    for (const row of deriveMetaAccountReadCapabilityEvidence(snapshot(status))) {
      expect(row).toMatchObject({ permissionSnapshot: [], capabilitySnapshot: {
        sourceStatus: status, canReadAccount: false, capabilities: { canRead: false, canPlan: false, canWriteMeta: false },
      } });
    }
  });

  it("marks a known account absent from a verified full list unreadable instead of retaining an older grant", () => {
    const result = deriveMetaAccountReadCapabilityEvidence(snapshot("verified"), ["act_1", "act_absent"]);
    expect(result).toEqual(expect.arrayContaining([expect.objectContaining({ externalAccountId: "act_absent", permissionSnapshot: [],
      capabilitySnapshot: expect.objectContaining({ canReadAccount: false, capabilities: expect.objectContaining({ canRead: false, canPlan: false }) }) })]));
  });

  it("rejects an ambiguous account discovery instead of selecting one", () => {
    const base = snapshot("verified");
    expect(() => deriveMetaAccountReadCapabilityEvidence({ ...base, discoveries: [...base.discoveries, base.discoveries[0]!] }))
      .toThrow(MetaAccountReadCapabilityEvidenceError);
  });
});
