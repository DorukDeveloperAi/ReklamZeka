import { describe, expect, it, vi } from "vitest";
import { DrizzleMetaReadMirrorRepository } from "@/connectors/meta/read-mirror-drizzle-repository";

const workspaceId = "11111111-1111-4111-8111-111111111111";
function sqlText(value: unknown): string {
  if (!value || typeof value !== "object" || !("queryChunks" in value) || !Array.isArray(value.queryChunks)) return "";
  return value.queryChunks.flatMap((chunk) => chunk && typeof chunk === "object" && "value" in chunk && Array.isArray(chunk.value)
    ? chunk.value.filter((part: unknown): part is string => typeof part === "string") : []).join("");
}

describe("Drizzle Meta read mirror repository", () => {
  it("uses one read-only repeatable-read transaction and maps canonical rows", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        connection_id: "22222222-2222-4222-8222-222222222222", connection_name: "Ana Meta", connection_status: "active",
        access_mode: "read_only", account_id: "33333333-3333-4333-8333-333333333333", account_name: "Yabancı",
        currency: "TRY", timezone: "Europe/Istanbul", account_fetched_at: new Date("2026-08-13T11:59:00.000Z"),
        inventory_stream_status: "completed", inventory_stream_updated_at: new Date("2026-08-13T11:59:00.000Z"),
        creative_stream_status: "completed", creative_stream_updated_at: new Date("2026-08-13T11:59:00.000Z"),
        insight_stream_status: "completed", insight_stream_updated_at: new Date("2026-08-13T11:59:30.000Z"), insight_canonical_row_count: "0",
        campaign_id: null, campaign_name: null, campaign_status: null, campaign_objective: null,
        campaign_daily_budget_minor: null, campaign_lifetime_budget_minor: null, campaign_fetched_at: null,
        ad_set_id: null, ad_set_name: null, ad_set_status: null, optimization_goal: null, targeting_summary: null,
        ad_set_daily_budget_minor: null, ad_set_lifetime_budget_minor: null, ad_set_fetched_at: null,
        ad_id: null, ad_name: null, ad_status: null, ad_fetched_at: null, creative_id: null, creative_name: null,
        creative_source_type: null, primary_text: null, headline: null, description: null, caption: null,
        call_to_action_type: null, destination_url: null, creative_format: null, creative_fetched_at: null,
        post_id: null, post_media_type: null, post_permalink: null, post_message: null, post_caption: null,
        post_published_at: null, post_fetched_at: null,
      }] });
    const transaction = vi.fn(async (callback: (transaction: { execute: typeof execute }) => Promise<unknown>) => callback({ execute }));
    const result = await new DrizzleMetaReadMirrorRepository({ transaction } as never,
      () => new Date("2026-08-13T12:00:00.000Z")).load(workspaceId);
    expect(result).toMatchObject({ sourceState: "empty", summary: { connections: 1, accounts: 1, campaigns: 0 },
      authority: { actionAuthority: "none", canWriteMeta: false } });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(sqlText(execute.mock.calls[0]![0])).toContain("repeatable read");
    expect(sqlText(execute.mock.calls[1]![0])).toContain("read only");
    expect(sqlText(execute.mock.calls[2]![0])).toContain("insight_counts");
  });

  it("rejects caller-controlled invalid workspace scope before DB access", async () => {
    const transaction = vi.fn();
    await expect(new DrizzleMetaReadMirrorRepository({ transaction } as never).load("workspace_other")).rejects.toThrow("invalid_scope");
    expect(transaction).not.toHaveBeenCalled();
  });
});
