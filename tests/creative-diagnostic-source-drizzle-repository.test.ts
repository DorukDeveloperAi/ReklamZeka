import { describe, expect, it } from "vitest";
import { DrizzleCreativeDiagnosticSourceRepository, CreativeDiagnosticSourceError } from "@/connectors/meta/creative-diagnostic-source-drizzle-repository";

const uuid = "11111111-1111-4111-8111-111111111111"; const hash = "a".repeat(64);
function repo(rows: readonly unknown[]) { return new DrizzleCreativeDiagnosticSourceRepository({ execute: async () => ({ rows }) } as never); }
const row = { ad_id: uuid, creative_id: "22222222-2222-4222-8222-222222222222", binding_hash: hash, creative_hash: "b".repeat(64), ad_source_hash: hash, ad_set_source_hash: hash, campaign_source_hash: hash, creative_source_hash: "b".repeat(64), objective: "lead_generation", optimization: "lead", billing: "impressions", destination_url: "https://example.test" };

describe("creative diagnostic source reader", () => {
  it("projects direct mirror config and opaque destination evidence", async () => {
    const result = await repo([row]).readCurrent({ workspaceId: uuid, accountRef: "act_1", adRef: "ad_1" });
    expect(result.config).toMatchObject({ objective: { state: "known" }, optimization: { state: "known" }, billing: { state: "known" }, destination: { state: "known" } });
    expect(result.config.destination).not.toHaveProperty("value");
  });
  it("keeps absent mirror fields unknown and rejects ambiguity", async () => {
    const result = await repo([{ ...row, billing: null, destination_url: null }]).readCurrent({ workspaceId: uuid, accountRef: "act_1", adRef: "ad_1" });
    expect(result.config.billing).toEqual({ state: "unknown", reason: "not_observed" });
    await expect(repo([row, row]).readCurrent({ workspaceId: uuid, accountRef: "act_1", adRef: "ad_1" })).rejects.toMatchObject({ code: "ambiguous" } satisfies Partial<CreativeDiagnosticSourceError>);
  });
});
