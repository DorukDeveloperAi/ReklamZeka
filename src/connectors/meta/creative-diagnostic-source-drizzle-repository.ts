import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { createCreativeDiagnosticConfigSnapshot, type CreativeDiagnosticConfigField, type CreativeDiagnosticConfigSnapshot } from "@/domain/meta/creative-diagnostic-config-snapshot";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Row = Readonly<Record<string, unknown>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
function rows<T extends Row>(value: unknown): readonly T[] { if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) throw new CreativeDiagnosticSourceError("corrupt_store"); return value.rows as readonly T[]; }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function opaque(prefix: string, value: string): string { return `${prefix}_${hash(value).slice(0, 24)}`; }
function known(prefix: string, value: unknown, sourceRef: string, sourceHash: unknown): CreativeDiagnosticConfigField {
  if (typeof value !== "string" || !value.trim() || typeof sourceHash !== "string" || !HASH.test(sourceHash)) return Object.freeze({ state: "unknown", reason: "not_observed" });
  return Object.freeze({ state: "known", ref: opaque(prefix, value), sourceRef, sourceHash });
}

export class CreativeDiagnosticSourceError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "ambiguous" | "corrupt_store") { super(`Creative diagnostic source reddedildi: ${code}`); this.name = "CreativeDiagnosticSourceError"; }
}

/** Current read-only mirror projection. It does not read promoted_object. */
export class DrizzleCreativeDiagnosticSourceRepository {
  constructor(private readonly database: Database) {}

  async readCurrent(input: Readonly<{ workspaceId: string; accountRef: string; adRef: string }>): Promise<Readonly<{ config: CreativeDiagnosticConfigSnapshot; adId: string; creativeId: string }>> {
    if (!input || !UUID.test(input.workspaceId) || !input.accountRef.trim() || !input.adRef.trim()) throw new CreativeDiagnosticSourceError("invalid_input");
    const result = rows<Readonly<{ ad_id: string; creative_id: string; binding_hash: string; creative_hash: string; ad_source_hash: string; ad_set_source_hash: string; campaign_source_hash: string; creative_source_hash: string; objective: string | null; optimization: string | null; billing: string | null; destination_url: string | null }>>(await this.database.execute(sql`
      select ad.id::text as ad_id, creative.id::text as creative_id,
        binding.binding_payload_hash as binding_hash, creative.raw_payload_hash as creative_hash,
        ad.provenance->>'payloadHash' as ad_source_hash, ad_set.raw_payload_hash as ad_set_source_hash,
        campaign.raw_payload_hash as campaign_source_hash, creative.raw_payload_hash as creative_source_hash,
        campaign.objective_source as objective, ad_set.optimization_goal as optimization,
        ad_set.billing_event as billing, creative.destination_url
      from workspaces workspace
      join ad_accounts account on account.workspace_id = workspace.id and account.external_account_id = ${input.accountRef} and account.disappeared_at is null
      join meta_ads ad on ad.workspace_id = workspace.id and ad.ad_account_id = account.id and ad.external_ad_id = ${input.adRef}
      join meta_ad_sets ad_set on ad_set.workspace_id = workspace.id and ad_set.id = ad.ad_set_id and ad_set.disappeared_at is null
      join ad_campaigns campaign on campaign.workspace_id = workspace.id and campaign.id = ad.campaign_id and campaign.disappeared_at is null
      join meta_ad_creative_bindings binding on binding.workspace_id = workspace.id and binding.ad_id = ad.id and binding.disappeared_at is null
      join meta_creatives creative on creative.workspace_id = workspace.id and creative.id = binding.creative_id and creative.disappeared_at is null
      where workspace.id = ${input.workspaceId}::uuid and workspace.lifecycle_state = 'active'
      limit 2
    `));
    if (result.length === 0) throw new CreativeDiagnosticSourceError("not_found");
    if (result.length !== 1) throw new CreativeDiagnosticSourceError("ambiguous");
    const row = result[0]!;
    if (!UUID.test(row.ad_id) || !UUID.test(row.creative_id) || !HASH.test(row.binding_hash) || !HASH.test(row.creative_hash)) throw new CreativeDiagnosticSourceError("corrupt_store");
    const bindingRef = opaque("binding", `${row.ad_id}:${row.creative_id}`);
    const config = createCreativeDiagnosticConfigSnapshot({
      bindingRef, bindingHash: row.binding_hash, creativeContentHash: row.creative_hash,
      objective: known("objective", row.objective, opaque("campaign", input.accountRef), row.campaign_source_hash),
      optimization: known("optimization", row.optimization, opaque("adset", row.ad_id), row.ad_set_source_hash),
      billing: known("billing", row.billing, opaque("adset", row.ad_id), row.ad_set_source_hash),
      destination: known("destination", row.destination_url, opaque("creative", row.creative_id), row.creative_source_hash),
    });
    return Object.freeze({ config, adId: row.ad_id, creativeId: row.creative_id });
  }
}
