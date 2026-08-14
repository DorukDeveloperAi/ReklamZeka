import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { EFFECTIVE_CONTEXT_POLICY_AUTHORITY_COMPONENT_REF } from "@/analyses/effective-campaign-context";

type Executor = Readonly<{ execute(query: ReturnType<typeof sql>): Promise<unknown> }>;

const COMPONENT_TYPE = "policy_authority" as const;

function stable(value: unknown): unknown {
  return Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stable(child)])) : value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function rows(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) {
    throw new Error("policy authority context invalidation store response is malformed");
  }
  return value.rows as readonly Readonly<Record<string, unknown>>[];
}

/**
 * Invalidates only versions that are already persisted in frozen contexts. A
 * policy/catalog mutation must never invent a derived authority version: doing
 * so leaves historical contexts selectable as if their source were current.
 */
export async function invalidatePersistedPolicyAuthorityContexts(input: Readonly<{
  executor: Executor;
  workspaceId: string;
  observedAt: string;
  changeRef: string;
}>): Promise<void> {
  const versions = rows(await input.executor.execute(sql`
    select distinct component_version
      from effective_campaign_context_components
     where workspace_id = ${input.workspaceId}::uuid
       and component_type = ${COMPONENT_TYPE}
       and component_ref = ${EFFECTIVE_CONTEXT_POLICY_AUTHORITY_COMPONENT_REF}
     order by component_version
  `));
  for (const row of versions) {
    const componentVersion = row.component_version;
    if (typeof componentVersion !== "string" || !componentVersion.trim() || componentVersion.length > 256) {
      throw new Error("policy authority context component is corrupt");
    }
    const event = Object.freeze({ workspaceId: input.workspaceId, componentType: COMPONENT_TYPE,
      componentRef: EFFECTIVE_CONTEXT_POLICY_AUTHORITY_COMPONENT_REF, componentVersion,
      scopeKind: "workspace_component", entityType: null, entityRef: null, reasonCode: "source_changed",
      observedAt: input.observedAt, changeRef: input.changeRef });
    await input.executor.execute(sql`insert into effective_campaign_context_invalidations (workspace_id, event_hash, component_type,
      component_ref, component_version, scope_kind, entity_type, entity_ref, reason_code, observed_at)
      values (${input.workspaceId}::uuid, ${digest(event)}, ${COMPONENT_TYPE},
        ${EFFECTIVE_CONTEXT_POLICY_AUTHORITY_COMPONENT_REF}, ${componentVersion}, 'workspace_component',
        null, null, 'source_changed', ${input.observedAt}::timestamptz) on conflict (workspace_id, event_hash) do nothing`);
  }
}
