import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type {
  GuideBudgetEvidenceBundle,
  GuideBudgetEvidenceReadPort,
} from "@/application/guide-budget-dry-run-service";
import {
  DrizzleOperationReadRepository,
  type CurrentSliceEvidence,
  type OperationReadTransaction,
} from "@/connectors/operations/operation-read-drizzle-repository";
import { organizationCampaignPublicRef } from "@/domain/campaigns/organization-campaign";
import {
  resolveEffectiveGuideOverlap,
  type EffectiveGuideBinding,
} from "@/domain/guides/effective-guide-overlap";
import {
  createGuideBudgetContractV2,
  type GuideBudgetContractV2,
} from "@/domain/guides/guide-budget-contract-v2";
import {
  canonicalGuideWorkspaceRef,
  createGuideRevision,
  type GuideRevisionDraft,
} from "@/domain/guides/guide-revision";
import { metaPublicReference } from "@/domain/meta/public-reference";
import {
  diffMetaChangeSnapshots,
  type CanonicalMetaChangeSnapshot,
} from "@/domain/meta/snapshot-diff";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Row = Record<string, any>;
type Target = Readonly<{
  id: string;
  level: "campaign" | "ad_set";
  ref: string;
  market: "yerli" | "yabanci" | undefined;
}>;
const UUID = /^[0-9a-f-]{36}$/i,
  HASH = /^[a-f0-9]{64}$/;
const rows = (x: unknown): readonly Row[] =>
  x && typeof x === "object" && "rows" in x && Array.isArray(x.rows)
    ? (x.rows as Row[])
    : [];
const stable = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value as Row)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, v]) => [k, stable(v)]),
        )
      : value;
const minor = (value: number) =>
  `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`.replace(
    /\.00$/,
    "",
  );
const failure = (message: string): never => {
  throw new Error(`budget evidence unavailable: ${message}`);
};

/** Read-only evidence adapter. No mutable mirror value can substitute a receipt. */
export class DrizzleGuideBudgetEvidenceRepository implements GuideBudgetEvidenceReadPort {
  constructor(
    private readonly database: Pick<Database, "transaction">,
    private readonly scopes: Pick<
      DrizzleOperationReadRepository,
      "currentSliceEvidenceInTransaction"
    >,
  ) {}
  async load(
    input: Readonly<{
      workspaceId: string;
      guideRevisionId: string;
      at: string;
    }>,
  ): Promise<GuideBudgetEvidenceBundle> {
    if (!UUID.test(input.workspaceId) || !UUID.test(input.guideRevisionId))
      failure("scope");
    return this.database.transaction(async (tx) => {
      await tx.execute(
        sql`set local transaction isolation level repeatable read`,
      );
      await tx.execute(sql`set local transaction read only`);
      const selected = rows(
        await tx.execute(
          sql`select r.slice_ref,r.market_key,c.target_scope_ref,c.contract_payload,c.contract_hash,c.schema_version,c.guide_revision_hash from guide_budget_contracts c join guide_revisions r on r.workspace_id=c.workspace_id and r.id=c.guide_revision_id join guide_heads h on h.workspace_id=r.workspace_id and h.guide_id=r.guide_id and h.current_active_revision_id=r.id where c.workspace_id=${input.workspaceId}::uuid and c.guide_revision_id=${input.guideRevisionId}::uuid limit 2`,
        ),
      );
      if (selected.length !== 1) failure("active_contract");
      const selectedRow = selected[0]!,
        contract = this.contract(selectedRow),
        scope = await this.scopes.currentSliceEvidenceInTransaction(
          tx as OperationReadTransaction,
          input.workspaceId,
          String(selectedRow.slice_ref),
        );
      if (scope.sliceId === null) failure("stale_slice");
      const target = this.target(
        scope,
        input.workspaceId,
        contract.targetScopeRef,
      );
      if (!target || target.market !== contract.market)
        failure("target_market");
      const scopedTarget = target as Target;
      const active = rows(
        await tx.execute(
          sql`select r.id::text revision_id,r.guide_ref,r.revision_number,r.revision_hash,r.previous_revision_hash,r.slice_ref,r.market_key,r.free_text,r.strict_payload,r.schedule_payload,r.mode,r.interpretation_hash,c.target_scope_ref,c.contract_payload,c.contract_hash,c.schema_version,c.guide_revision_hash,action_rows.actions,budget_rows.budgets from guide_heads h join guide_revisions r on r.workspace_id=h.workspace_id and r.id=h.current_active_revision_id left join guide_budget_contracts c on c.workspace_id=r.workspace_id and c.guide_revision_id=r.id left join lateral (select coalesce(jsonb_agg(jsonb_build_object('action',a.action,'authority',a.authority) order by a.action),'[]'::jsonb) actions from guide_revision_actions a where a.workspace_id=r.workspace_id and a.guide_revision_id=r.id) action_rows on true left join lateral (select coalesce(jsonb_agg(jsonb_build_object('budget_ref',b.budget_ref,'scope_kind',b.scope_kind,'ordinal',b.ordinal) order by b.ordinal),'[]'::jsonb) budgets from guide_revision_budget_refs b where b.workspace_id=r.workspace_id and b.guide_revision_id=r.id) budget_rows on true where h.workspace_id=${input.workspaceId}::uuid and r.slice_ref=${selectedRow.slice_ref} and r.market_key=${contract.market} order by r.guide_ref,r.revision_number,r.revision_hash limit 1001`,
        ),
      );
      if (active.length === 0 || active.length > 1000) failure("active_guides");
      const bindings: EffectiveGuideBinding[] = [];
      for (const row of active) {
        const hasContract =
          row.contract_payload !== null ||
          row.contract_hash !== null ||
          row.target_scope_ref !== null;
        if (hasContract) {
          const activeContract = this.contract(row);
          // A v2 contract is target-scoped. It has no authority over this
          // selected target unless its authenticated target is exactly equal.
          if (activeContract.targetScopeRef !== contract.targetScopeRef)
            continue;
          bindings.push(
            this.binding(
              row,
              input.workspaceId,
              contract.targetScopeRef,
              contract.market,
            ),
          );
          continue;
        }
        // A revision that can affect a budget must have a target-bound v2
        // contract. Status-only guidance is deliberately out of this reader.
        if (this.isBudgetCapable(row)) failure("incomplete_budget_guide");
      }
      if (bindings.length === 0) failure("active_guides");
      if (
        !bindings.some(
          (binding) =>
            binding.revision.revisionHash === contract.guideRevisionHash,
        )
      )
        failure("selected_not_active");
      const effective = resolveEffectiveGuideOverlap({
        workspaceRef: canonicalGuideWorkspaceRef(input.workspaceId),
        entityRef: scopedTarget.ref,
        market: contract.market,
        guides: bindings,
      });
      if (effective.hold.state !== "clear") failure("overlap_conflict");
      const evidence = await this.snapshotEvidence(
        tx,
        input.workspaceId,
        scopedTarget,
        contract,
        input.at,
      );
      const constraints = (["budget_increase", "budget_decrease"] as const).map(
        (action) => {
          const absolute = effective.numericCaps.find(
              (cap) =>
                cap.action === action &&
                cap.kind === "maximum_absolute_budget_delta_minor",
            ),
            relative = effective.numericCaps.find(
              (cap) =>
                cap.action === action &&
                cap.kind === "maximum_relative_budget_delta_basis_points",
            ),
            permitted =
              effective.recommendationActions.includes(action) ||
              effective.humanApprovalActions.includes(action) ||
              effective.autonomousActions.includes(action);
          return Object.freeze({
            guideRef: `guide_overlap_${effective.effectiveGuideSetHash}`,
            action,
            allowed: permitted,
            requiresHumanApproval:
              !effective.autonomousActions.includes(action),
            maximumAbsoluteDeltaDecimal: absolute
              ? minor(absolute.value)
              : null,
            maximumRelativeDeltaBasisPoints: relative?.value ?? null,
            parentCeilingDecimal: null,
          });
        },
      );
      return Object.freeze({
        contract,
        targetCurrentBudgetDecimal: evidence.current,
        scopeEvidence: evidence.scopes,
        constraints,
      });
    });
  }
  private contract(row: Row): GuideBudgetContractV2 {
    if (
      typeof row.contract_hash !== "string" ||
      typeof row.schema_version !== "string" ||
      typeof row.guide_revision_hash !== "string" ||
      !row.contract_payload ||
      typeof row.contract_payload !== "object" ||
      Array.isArray(row.contract_payload)
    )
      failure("contract_shape");
    const payload = row.contract_payload as Row;
    const { schemaVersion, contractHash, ...draft } = payload;
    if (
      Object.keys(payload).length !== 9 ||
      typeof schemaVersion !== "string" ||
      typeof contractHash !== "string"
    )
      failure("contract_payload");
    let contract: GuideBudgetContractV2;
    try {
      contract = createGuideBudgetContractV2(draft as never);
    } catch {
      return failure("contract_payload");
    }
    if (
      !HASH.test(String(row.guide_revision_hash)) ||
      schemaVersion !== contract.schemaVersion ||
      contractHash !== contract.contractHash ||
      contract.contractHash !== row.contract_hash ||
      contract.schemaVersion !== row.schema_version ||
      contract.guideRevisionHash !== row.guide_revision_hash ||
      typeof row.target_scope_ref !== "string" ||
      contract.targetScopeRef !== row.target_scope_ref
    )
      failure("contract_tamper");
    return contract;
  }
  private target(
    scope: CurrentSliceEvidence,
    workspaceId: string,
    targetScopeRef: string,
  ): Target | null {
    const targets: Target[] = [
      ...scope.campaignIds.map((id) => ({
        id,
        level: "campaign" as const,
        ref: metaPublicReference("campaign", workspaceId, id),
        market: scope.campaignMarkets.get(id),
      })),
      ...scope.adSetIds.map((id) => ({
        id,
        level: "ad_set" as const,
        ref: metaPublicReference("ad_set", workspaceId, id),
        market: scope.adSetMarkets.get(id),
      })),
    ].filter((item) => item.ref === targetScopeRef);
    return targets.length === 1 ? targets[0]! : null;
  }
  private isBudgetCapable(row: Row): boolean {
    const actions = Array.isArray(row.actions)
      ? row.actions
      : failure("actions");
    const budgets = Array.isArray(row.budgets)
      ? row.budgets
      : failure("budgets");
    if (actions.length > 7 || budgets.length > 64) failure("guide_bounds");
    if (actions.some((item) => typeof (item as Row).action !== "string"))
      failure("actions");
    if (
      budgets.some((item) => {
        const budget = item as Row;
        return (
          typeof budget.budget_ref !== "string" ||
          typeof budget.scope_kind !== "string" ||
          !Number.isInteger(budget.ordinal)
        );
      })
    )
      failure("budget_refs");
    return (
      budgets.length > 0 ||
      actions.some((item) => {
        const action = (item as Row).action;
        return action === "budget_increase" || action === "budget_decrease";
      })
    );
  }
  private binding(
    row: Row,
    workspaceId: string,
    expectedTarget: string,
    expectedMarket: "yerli" | "yabanci",
  ): EffectiveGuideBinding {
    const actions = Array.isArray(row.actions)
        ? row.actions
        : failure("actions"),
      budgets = Array.isArray(row.budgets) ? row.budgets : failure("budgets");
    if (
      actions.length > 7 ||
      budgets.length > 64 ||
      new Set(actions.map((item) => (item as Row).action)).size !==
        actions.length
    )
      failure("actions_unique");
    const budgetRefs = budgets.map((item, index) => {
      const budget = item as Row;
      if (
        budget.ordinal !== index + 1 ||
        typeof budget.budget_ref !== "string" ||
        typeof budget.scope_kind !== "string"
      )
        failure("budget_refs");
      return { limitRef: budget.budget_ref, scopeKind: budget.scope_kind };
    });
    const persistedStrict = row.strict_payload;
    if (
      !persistedStrict ||
      typeof persistedStrict !== "object" ||
      Array.isArray(persistedStrict) ||
      JSON.stringify(stable((persistedStrict as Row).budgetRefs)) !==
        JSON.stringify(stable(budgetRefs))
    )
      failure("strict_payload");
    let revision: ReturnType<typeof createGuideRevision>;
    try {
      revision = createGuideRevision({
        workspaceRef: canonicalGuideWorkspaceRef(workspaceId),
        guideRef: row.guide_ref as string,
        revision: Number(row.revision_number),
        previousRevisionHash: (row.previous_revision_hash ?? null) as
          string | null,
        sliceRef: row.slice_ref as string,
        market: row.market_key as "yerli" | "yabanci",
        freeText: row.free_text as string,
        strict: {
          ...(persistedStrict as Row),
          budgetRefs,
        } as unknown as GuideRevisionDraft["strict"],
        schedule: row.schedule_payload as GuideRevisionDraft["schedule"],
        mode: row.mode as GuideRevisionDraft["mode"],
        actionAllowlist: actions.map(
          (item) => (item as Row).action,
        ) as unknown as GuideRevisionDraft["actionAllowlist"],
      });
    } catch {
      return failure("revision");
    }
    const authority: Map<string, string> = new Map(
      revision.actionAllowlist.map((action) => [
        action,
        revision.authority.autonomousActions.includes(action)
          ? "limited_autonomy"
          : revision.authority.humanApprovalActions.includes(action)
            ? "human_approval"
            : "none",
      ]),
    );
    if (
      revision.revisionHash !== row.revision_hash ||
      revision.interpretationHash !== row.interpretation_hash ||
      revision.market !== expectedMarket ||
      actions.some(
        (item) =>
          typeof (item as Row).action !== "string" ||
          (item as Row).authority !==
            authority.get((item as Row).action as string),
      )
    )
      failure("revision_tamper");
    const contract = this.contract(row),
      expectedActions = revision.actionAllowlist.filter(
        (action) =>
          action === "budget_increase" || action === "budget_decrease",
      );
    if (
      contract.market !== expectedMarket ||
      contract.targetScopeRef !== expectedTarget ||
      JSON.stringify(contract.overlapEnvelope.actionAllowlist) !==
        JSON.stringify(expectedActions) ||
      contract.overlapEnvelope.restrictionsComplete !== true
    )
      failure("overlap_envelope");
    return Object.freeze({
      revision,
      restrictions: contract.overlapEnvelope.restrictions,
      numericCaps: contract.overlapEnvelope.numericCaps,
      unresolvedConflictRefs: contract.overlapEnvelope.unresolvedConflictRefs,
    });
  }
  private async snapshotEvidence(
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    workspaceId: string,
    target: Target,
    contract: GuideBudgetContractV2,
    at: string,
  ) {
    const data = rows(
      await tx.execute(
        sql`with target as (select c.id,c.id campaign_id,c.ad_account_id,c.external_campaign_id external_id,'campaign'::text level from ad_campaigns c where ${target.level}='campaign' and c.workspace_id=${workspaceId}::uuid and c.id=${target.id}::uuid union all select a.id,a.campaign_id,a.ad_account_id,a.external_ad_set_id,'ad_set'::text from meta_ad_sets a where ${target.level}='ad_set' and a.workspace_id=${workspaceId}::uuid and a.id=${target.id}::uuid),latest as (select distinct on(s.ad_account_id) s.id,s.snapshot_hash,s.schema_version,s.field_catalog_version,s.captured_at,s.canonical_payload,s.ad_account_id,r.meta_connection_id,r.parent_run_ref,r.composition_evidence_hash,r.lane,aa.external_account_id from meta_complete_snapshot_receipts r join meta_change_snapshots s on s.workspace_id=r.workspace_id and s.id=r.snapshot_id and s.meta_connection_id=r.meta_connection_id and s.ad_account_id=r.ad_account_id and s.snapshot_hash=r.snapshot_hash and s.captured_at=r.captured_at join ad_accounts aa on aa.workspace_id=s.workspace_id and aa.id=s.ad_account_id where r.workspace_id=${workspaceId}::uuid and r.lane='normal_inventory_complete' order by s.ad_account_id,s.captured_at desc,s.persisted_at desc,s.id desc) select t.external_id,t.level,t.campaign_id::text,a.currency,l.snapshot_hash,l.schema_version,l.field_catalog_version,to_char(l.captured_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') captured_at,l.canonical_payload,l.meta_connection_id::text,l.parent_run_ref,l.composition_evidence_hash,l.lane,l.external_account_id,o.id::text org_id from target t join ad_accounts a on a.workspace_id=${workspaceId}::uuid and a.id=t.ad_account_id left join latest l on l.ad_account_id=t.ad_account_id left join organization_campaign_meta_memberships m on m.workspace_id=${workspaceId}::uuid and m.campaign_id=t.campaign_id and m.effective_to is null left join organization_campaigns o on o.workspace_id=m.workspace_id and o.id=m.organization_campaign_id limit 2`,
      ),
    );
    if (data.length !== 1) failure("snapshot_scope");
    const row = data[0]!;
    if (
      row.currency !== contract.currency ||
      typeof row.snapshot_hash !== "string" ||
      !HASH.test(row.snapshot_hash) ||
      typeof row.captured_at !== "string" ||
      typeof row.meta_connection_id !== "string" ||
      typeof row.external_account_id !== "string" ||
      typeof row.parent_run_ref !== "string" ||
      typeof row.composition_evidence_hash !== "string" ||
      row.lane !== "normal_inventory_complete" ||
      typeof row.org_id !== "string" ||
      typeof row.campaign_id !== "string"
    )
      failure("snapshot_receipt");
    const observedAt = new Date(row.captured_at).toISOString();
    if (
      observedAt !== row.captured_at ||
      Date.parse(at) < Date.parse(observedAt)
    )
      failure("snapshot_time");
    const composition = createHash("sha256")
      .update(
        JSON.stringify({
          parentRunRef: row.parent_run_ref,
          workspaceId,
          connectionId: row.meta_connection_id,
          account: row.external_account_id,
          capturedAt: observedAt,
          lane: "normal_inventory_complete",
        }),
      )
      .digest("hex");
    if (composition !== row.composition_evidence_hash)
      failure("receipt_forged");
    if (
      !row.canonical_payload ||
      typeof row.canonical_payload !== "object" ||
      Array.isArray(row.canonical_payload) ||
      typeof row.schema_version !== "number" ||
      typeof row.field_catalog_version !== "string"
    )
      failure("snapshot_payload");
    const persisted = row.canonical_payload as CanonicalMetaChangeSnapshot,
      { snapshotHash, ...persistedCore } = persisted;
    const snapshot = {
      ...(stable(persistedCore) as Omit<
        CanonicalMetaChangeSnapshot,
        "snapshotHash"
      >),
      snapshotHash,
    } as CanonicalMetaChangeSnapshot;
    try {
      diffMetaChangeSnapshots({ previous: snapshot, current: snapshot });
    } catch {
      return failure("snapshot_hash");
    }
    if (
      snapshot.snapshotHash !== row.snapshot_hash ||
      snapshot.workspaceId !== workspaceId ||
      snapshot.externalAccountId !== row.external_account_id ||
      snapshot.capturedAt !== observedAt ||
      snapshot.schemaVersion !== row.schema_version ||
      snapshot.fieldCatalogVersion !== row.field_catalog_version
    )
      failure("snapshot_identity");
    const entities = snapshot.entities,
      matching = entities.filter(
        (item) =>
          item?.externalId === row.external_id &&
          item?.entityType === target.level,
      );
    if (matching.length !== 1) failure("snapshot_entity_scope");
    const owner = matching[0]!.fields?.budget_owner;
    if (!owner || owner.state !== "known") failure("budget_owner");
    const knownOwner = owner as Readonly<{ state: "known"; value: unknown }>;
    if (!knownOwner.value || typeof knownOwner.value !== "object")
      failure("budget_owner");
    const ownerValue = knownOwner.value as Row;
    if (
      !Number.isSafeInteger(ownerValue.amountMinor) ||
      Number(ownerValue.amountMinor) < 0 ||
      (ownerValue.level !== "campaign" && ownerValue.level !== "ad_set") ||
      (ownerValue.model !== "CBO" && ownerValue.model !== "ABO") ||
      (ownerValue.budgetType !== "daily" &&
        ownerValue.budgetType !== "lifetime")
    )
      failure("budget_owner");
    const ownerRef =
        ownerValue.level === "campaign"
          ? metaPublicReference("campaign", workspaceId, row.campaign_id)
          : metaPublicReference("ad_set", workspaceId, target.id),
      current = minor(ownerValue.amountMinor as number);
    const common = Object.freeze({
      market: contract.market,
      currency: contract.currency,
      budgetOwnerRef: ownerRef,
      budgetOwnerKind:
        ownerValue.level === "campaign"
          ? ("campaign" as const)
          : ("adset" as const),
      currentBudgetDecimal: current,
      freshness: "fresh" as const,
      observedAt,
      evidenceHash: row.snapshot_hash,
    });
    return Object.freeze({
      current,
      scopes: Object.freeze([
        Object.freeze({
          ...common,
          scopeLayer: "campaign_ad_set" as const,
          scopeRef: contract.targetScopeRef,
        }),
        Object.freeze({
          ...common,
          scopeLayer: "organization_campaign" as const,
          scopeRef: organizationCampaignPublicRef(workspaceId, row.org_id),
        }),
      ]),
    });
  }
}
