import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { GuideBudgetDryRunService } from "@/application/guide-budget-dry-run-service";
import { DrizzleGuideBudgetEvidenceRepository } from "@/connectors/guides/guide-budget-evidence-drizzle-repository";
import { DrizzleOperationReadRepository } from "@/connectors/operations/operation-read-drizzle-repository";
import { createGuideBudgetContractV2 } from "@/domain/guides/guide-budget-contract-v2";
import {
  canonicalGuideWorkspaceRef,
  createGuideRevision,
} from "@/domain/guides/guide-revision";
import {
  categoryDefinitionPublicRef,
  categoryDimensionPublicRef,
} from "@/domain/categories/public-reference";
import { metaPublicReference } from "@/domain/meta/public-reference";
import {
  META_CHANGE_SNAPSHOT_SCHEMA_VERSION,
  normalizeMetaChangeSnapshot,
} from "@/domain/meta/snapshot-diff";
import { createSliceRevision } from "@/domain/slices/slice-definition";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const connectionString =
  process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("postgres_connection_not_configured");
const migration = readFileSync(
  "drizzle/20260817170000_guide_budget_contract_v2.sql",
  "utf8",
);
const migrationHash = createHash("sha256").update(migration).digest("hex");
const migrationJournal = JSON.parse(
  readFileSync("drizzle/meta/_journal.json", "utf8"),
) as Readonly<{ entries: readonly Readonly<{ tag: string; when: number }>[] }>;
const migrationJournalEntry = migrationJournal.entries.filter(
  (entry) => entry.tag === "20260817170000_guide_budget_contract_v2",
);
if (
  migrationJournalEntry.length !== 1 ||
  migrationJournalEntry[0]!.when !== 1786983600000
)
  throw new Error("guide_budget_contract_migration_journal_mismatch");
const migrationTimestamp = migrationJournalEntry[0]!.when;
const verifyMode = process.env.GUIDE_BUDGET_CONTRACT_VERIFY_MODE ?? "pre";
if (verifyMode !== "pre" && verifyMode !== "post")
  throw new Error("guide_budget_contract_verify_mode_invalid");
const pool = new Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 8_000,
});
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const rejected = async (work: () => Promise<unknown>) => {
  try {
    await work();
    return false;
  } catch {
    return true;
  }
};
const trace = (stage: string) => {
  if (process.env.P04_TRACE === "1") console.error(`p04:${stage}`);
};

try {
  const client = await pool.connect();
  try {
    let migrationLedgerExact = verifyMode === "pre";
    const q = (text: string, values: readonly unknown[] = []) =>
      client.query(text, [...values]);
    const rejectedSql = async (
      name: string,
      text: string,
      values: readonly unknown[] = [],
    ) => {
      await q(`savepoint ${name}`);
      try {
        await q(text, values);
        await q(`release savepoint ${name}`);
        return false;
      } catch {
        await q(`rollback to savepoint ${name}`);
        await q(`release savepoint ${name}`);
        return true;
      }
    };
    if (verifyMode === "post") {
      const applied = (
        await q(
          "select to_regclass('public.guide_budget_contracts')::text contracts,to_regclass('public.meta_complete_snapshot_receipts')::text receipts,(select count(*)::int from drizzle.__drizzle_migrations where hash=$1 and created_at=$2) exact_ledger_count,(select count(*)::int from drizzle.__drizzle_migrations where hash=$1) hash_count,(select count(*)::int from drizzle.__drizzle_migrations where created_at=$2) timestamp_count",
          [migrationHash, migrationTimestamp],
        )
      ).rows[0];
      if (
        !applied?.contracts ||
        !applied?.receipts ||
        Number(applied.exact_ledger_count) !== 1 ||
        Number(applied.hash_count) !== 1 ||
        Number(applied.timestamp_count) !== 1
      )
        throw new Error(
          `guide_budget_contract_post_migration_not_applied_or_ledger_mismatch:${JSON.stringify(applied)}`,
        );
      migrationLedgerExact = true;
    }
    await q("begin");
    if (verifyMode === "pre") await q(migration); // PRE only: no migration journal entry is ever made.
    const tables = [
      "guide_budget_contracts",
      "meta_complete_snapshot_receipts",
    ];
    const rlsRows = await q(
      "select relrowsecurity,relforcerowsecurity from pg_class where oid=any($1::regclass[])",
      [tables.map((table) => `public.${table}`)],
    );
    const rls =
      rlsRows.rows.length === tables.length &&
      rlsRows.rows.every(
        (row) => row.relrowsecurity && row.relforcerowsecurity,
      );
    const ws = randomUUID(),
      foreignWs = randomUUID(),
      actor = randomUUID(),
      dim = randomUUID(),
      yerli = randomUUID(),
      yabanci = randomUUID(),
      connection = randomUUID(),
      source = randomUUID(),
      account = randomUUID(),
      campaign = randomUUID(),
      adset = randomUUID(),
      aboSource = randomUUID(),
      aboAccount = randomUUID(),
      aboCampaign = randomUUID(),
      aboAdset = randomUUID(),
      org = randomUUID(),
      slice = randomUUID(),
      sliceRevisionId = randomUUID(),
      guideOne = randomUUID(),
      guideTwo = randomUUID(),
      unrelatedGuide = randomUUID(),
      statusOnlyGuide = randomUUID(),
      guideRevisionOneId = randomUUID(),
      guideRevisionTwoId = randomUUID(),
      unrelatedGuideRevisionId = randomUUID(),
      statusOnlyGuideRevisionId = randomUUID();
    const campaignExternal = `campaign_${campaign.slice(0, 12)}`,
      adsetExternal = `adset_${adset.slice(0, 12)}`,
      aboCampaignExternal = `campaign_${aboCampaign.slice(0, 12)}`,
      aboAdsetExternal = `adset_${aboAdset.slice(0, 12)}`;
    const sliceRevision = createSliceRevision({
      sliceRef: "slice_budget_contract_v2",
      revisionRef: "slice_revision_budget_contract_v2",
      revisionNumber: 1,
      market: {
        dimensionId: categoryDimensionPublicRef("market"),
        valueId: categoryDefinitionPublicRef("market", "yerli"),
        key: "yerli",
      },
      predicates: [],
    });
    const targetScopeRef = metaPublicReference("campaign", ws, campaign),
      unrelatedTargetScopeRef = metaPublicReference("ad_set", ws, aboAdset);
    const makeRevision = (guideRef: string) =>
      createGuideRevision({
        workspaceRef: canonicalGuideWorkspaceRef(ws),
        guideRef,
        revision: 1,
        previousRevisionHash: null,
        sliceRef: sliceRevision.sliceRef,
        market: "yerli",
        freeText: "Bütçe kanıtı ile değerlendir.",
        strict: {
          budgetRefs: [
            {
              limitRef: "limit_org_budget",
              scopeKind: "organization_campaign",
            },
            { limitRef: "limit_campaign_budget", scopeKind: "campaign_ad_set" },
          ],
          rollbackConditions: [],
          budgetInterpretation: null,
        },
        schedule: {
          frequency: "daily",
          timezone: "Europe/Istanbul",
          localTime: "09:00",
        },
        mode: "limited_autonomy",
        actionAllowlist: ["budget_decrease", "status_pause"],
      });
    const revOne = makeRevision("guide_budget_contract_one"),
      revTwo = makeRevision("guide_budget_contract_two"),
      unrelatedRevision = makeRevision("guide_budget_contract_unrelated"),
      statusOnlyRevision = createGuideRevision({
        workspaceRef: canonicalGuideWorkspaceRef(ws),
        guideRef: "guide_status_only_unrelated",
        revision: 1,
        previousRevisionHash: null,
        sliceRef: sliceRevision.sliceRef,
        market: "yerli",
        freeText: "Sadece durum yönetimi.",
        strict: {
          budgetRefs: [],
          rollbackConditions: [],
          budgetInterpretation: null,
        },
        schedule: {
          frequency: "daily",
          timezone: "Europe/Istanbul",
          localTime: "09:00",
        },
        mode: "limited_autonomy",
        actionAllowlist: ["status_pause"],
      });
    const makeContract = (
      guideRevisionHash: string,
      second = false,
      scopedTarget = targetScopeRef,
      restriction: unknown = second
        ? {
            restrictionRef: "restriction_budget_human",
            kind: "protection",
            disposition: "human_approval",
            actions: ["budget_decrease"],
          }
        : null,
    ) =>
      createGuideBudgetContractV2({
        guideRevisionHash,
        market: "yerli",
        currency: "TRY",
        targetScopeRef: scopedTarget,
        expression: { kind: "money", amountDecimal: "90", currency: "TRY" },
        maximumEvidenceAgeSeconds: 3600,
        overlapEnvelope: {
          restrictionsComplete: true,
          actionAllowlist: ["budget_decrease"],
          restrictions: restriction ? ([restriction] as never) : [],
          numericCaps: [
            {
              capRef: second ? "cap_budget_50" : "cap_budget_75",
              action: "budget_decrease",
              kind: "maximum_absolute_budget_delta_minor",
              value: second ? 5000 : 7500,
              currency: "TRY",
            },
          ],
          unresolvedConflictRefs: [],
        },
      });
    const contractOne = makeContract(revOne.revisionHash),
      contractTwo = makeContract(revTwo.revisionHash, true),
      unrelatedContract = makeContract(
        unrelatedRevision.revisionHash,
        false,
        unrelatedTargetScopeRef,
      );
    await q("insert into users(id,email) values($1,$2)", [
      actor,
      `budget-contract-${actor}@invalid.local`,
    ]);
    await q(
      "insert into workspaces(id,name) values($1,'budget contract verifier'),($2,'budget contract foreign')",
      [ws, foreignWs],
    );
    await q(
      "insert into memberships(workspace_id,user_id,role) values($1,$2,'owner')",
      [ws, actor],
    );
    await q(
      "insert into category_dimensions(id,workspace_id,key,name,cardinality,allowed_entity_levels) values($1,$2,'market','Market','single',array['campaign','ad_set']::category_entity_level[])",
      [dim, ws],
    );
    await q(
      "insert into category_definitions(id,workspace_id,dimension_id,key,label) values($1,$2,$3,'yerli','Yerli'),($4,$2,$3,'yabanci','Yabancı')",
      [yerli, ws, dim, yabanci],
    );
    await q(
      "insert into meta_connections(id,workspace_id,external_connection_key,display_name,graph_api_version,field_catalog_version) values($1,$2,$3,'fixture','v23.0','fixture')",
      [connection, ws, `budget-${connection}`],
    );
    await q(
      "insert into data_sources(id,workspace_id,meta_connection_id,platform,external_account_id,display_name) values($1,$2,$3,'meta_ads',$4,'fixture'),($5,$2,$3,'meta_ads',$6,'abo fixture')",
      [
        source,
        ws,
        connection,
        `act_${account}`,
        aboSource,
        `act_${aboAccount}`,
      ],
    );
    await q(
      "insert into ad_accounts(id,workspace_id,data_source_id,external_account_id,name,currency,timezone) values($1,$2,$3,$4,'cbo fixture','TRY','Europe/Istanbul'),($5,$2,$6,$7,'abo fixture','TRY','Europe/Istanbul')",
      [
        account,
        ws,
        source,
        `act_${account}`,
        aboAccount,
        aboSource,
        `act_${aboAccount}`,
      ],
    );
    await q(
      "insert into ad_campaigns(id,workspace_id,ad_account_id,external_campaign_id,name,campaign_budget_optimization,daily_budget_minor) values($1,$2,$3,$4,'cbo campaign',true,10000),($5,$2,$6,$7,'abo campaign',false,null)",
      [
        campaign,
        ws,
        account,
        campaignExternal,
        aboCampaign,
        aboAccount,
        aboCampaignExternal,
      ],
    );
    await q(
      "insert into meta_ad_sets(id,workspace_id,ad_account_id,campaign_id,external_ad_set_id,name,daily_budget_minor,raw_payload_hash,source_graph_version,field_catalog_version,provenance) values($1,$2,$3,$4,$5,'cbo adset',null,$6,'fixture','fixture','{}'::jsonb),($7,$2,$8,$9,$10,'abo adset',9000,$11,'fixture','fixture','{}'::jsonb)",
      [
        adset,
        ws,
        account,
        campaign,
        adsetExternal,
        "a".repeat(64),
        aboAdset,
        aboAccount,
        aboCampaign,
        aboAdsetExternal,
        "b".repeat(64),
      ],
    );
    await q(
      "insert into category_assignments(workspace_id,dimension_id,definition_id,entity_level,campaign_id,operation,source,evidence,confidence) values($1,$2,$3,'campaign',$4,'add','manual',$5::jsonb,1),($1,$2,$3,'campaign',$6,'add','manual',$5::jsonb,1)",
      [
        ws,
        dim,
        yerli,
        campaign,
        JSON.stringify([{ kind: "fixture", ref: "budget" }]),
        aboCampaign,
      ],
    );
    await q(
      "insert into organization_campaigns(id,workspace_id,label,market_definition_id,created_by_actor_id) values($1,$2,'Kurum',$3,$4)",
      [org, ws, yerli, actor],
    );
    await q(
      "insert into organization_campaign_meta_memberships(workspace_id,organization_campaign_id,campaign_id,market_definition_id,effective_from,assigned_by_actor_id) values($1,$2,$3,$4,now(),$5),($1,$2,$6,$4,now(),$5)",
      [ws, org, campaign, yerli, actor, aboCampaign],
    );
    await q(
      "insert into slices(id,workspace_id,slice_ref,label,market_definition_id,created_by_actor_id) values($1,$2,$3,'Scope',$4,$5)",
      [slice, ws, sliceRevision.sliceRef, yerli, actor],
    );
    await q(
      "insert into slice_revisions(id,workspace_id,slice_id,slice_ref,revision_number,revision_ref,definition_hash,market_definition_id,lifecycle,created_by_actor_id) values($1,$2,$3,$4,1,$5,$6,$7,'published',$8)",
      [
        sliceRevisionId,
        ws,
        slice,
        sliceRevision.sliceRef,
        sliceRevision.revisionRef,
        sliceRevision.definitionHash,
        yerli,
        actor,
      ],
    );
    await q("update slices set current_published_revision_id=$1 where id=$2", [
      sliceRevisionId,
      slice,
    ]);
    const persistGuide = async (
      guideId: string,
      revisionId: string,
      revision: typeof revOne,
    ) => {
      await q(
        "insert into guides(id,workspace_id,guide_ref,label,slice_id,market_definition_id,created_by_actor_id) values($1,$2,$3,$4,$5,$6,$7)",
        [
          guideId,
          ws,
          revision.guideRef,
          revision.guideRef,
          slice,
          yerli,
          actor,
        ],
      );
      await q(
        "insert into guide_revisions(id,workspace_id,guide_id,guide_ref,revision_number,revision_hash,previous_revision_hash,source_revision_id,slice_revision_id,slice_ref,market_definition_id,market_key,free_text,strict_payload,schedule_payload,mode,interpretation_hash,created_by_actor_id) values($1,$2,$3,$4,$5,$6,$7,null,$8,$9,$10,'yerli',$11,$12::jsonb,$13::jsonb,$14,$15,$16)",
        [
          revisionId,
          ws,
          guideId,
          revision.guideRef,
          revision.revision,
          revision.revisionHash,
          revision.previousRevisionHash,
          sliceRevisionId,
          revision.sliceRef,
          yerli,
          revision.freeText,
          JSON.stringify(revision.strict),
          JSON.stringify(revision.schedule),
          revision.mode,
          revision.interpretationHash,
          actor,
        ],
      );
      for (const action of revision.actionAllowlist) {
        const authority = revision.authority.autonomousActions.includes(action)
          ? "limited_autonomy"
          : revision.authority.humanApprovalActions.includes(action)
            ? "human_approval"
            : "none";
        await q(
          "insert into guide_revision_actions(workspace_id,guide_revision_id,action,authority) values($1,$2,$3,$4)",
          [ws, revisionId, action, authority],
        );
      }
      for (const [index, budgetRef] of revision.strict.budgetRefs.entries())
        await q(
          "insert into guide_revision_budget_refs(workspace_id,guide_revision_id,budget_ref,scope_kind,ordinal) values($1,$2,$3,$4,$5)",
          [ws, revisionId, budgetRef.limitRef, budgetRef.scopeKind, index + 1],
        );
      await q(
        "insert into guide_heads(workspace_id,guide_id,latest_revision_id,current_active_revision_id,version) values($1,$2,$3,null,0)",
        [ws, guideId, revisionId],
      );
      await q(
        "insert into guide_interpretation_acceptances(workspace_id,guide_revision_id,interpretation_hash,accepted_by_actor_id,accepted_at) values($1,$2,$3,$4,'2026-08-17T00:00:00.000Z')",
        [ws, revisionId, revision.interpretationHash, actor],
      );
      await q(
        "update guide_heads set current_active_revision_id=$1,version=1 where workspace_id=$2 and guide_id=$3",
        [revisionId, ws, guideId],
      );
    };
    await persistGuide(guideOne, guideRevisionOneId, revOne);
    await persistGuide(guideTwo, guideRevisionTwoId, revTwo);
    await persistGuide(
      unrelatedGuide,
      unrelatedGuideRevisionId,
      unrelatedRevision,
    );
    await persistGuide(
      statusOnlyGuide,
      statusOnlyGuideRevisionId,
      statusOnlyRevision,
    );
    const insertContract = (revisionId: string, contract: typeof contractOne) =>
      q(
        "insert into guide_budget_contracts(workspace_id,guide_revision_id,guide_revision_hash,schema_version,contract_hash,market_key,currency,target_scope_ref,contract_payload,maximum_evidence_age_seconds) values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)",
        [
          ws,
          revisionId,
          contract.guideRevisionHash,
          contract.schemaVersion,
          contract.contractHash,
          contract.market,
          contract.currency,
          contract.targetScopeRef,
          JSON.stringify(contract),
          contract.maximumEvidenceAgeSeconds,
        ],
      );
    await insertContract(guideRevisionOneId, contractOne);
    await insertContract(guideRevisionTwoId, contractTwo);
    await insertContract(unrelatedGuideRevisionId, unrelatedContract);
    const capturedAt = "2026-08-17T00:00:00.000Z",
      parentRunRef = "run_budget_contract_v2",
      observation = <T>(value: T) => ({ state: "known" as const, value }),
      snapshotFor = (
        externalAccountId: string,
        externalCampaignId: string,
        externalAdSetId: string,
        cbo: boolean,
        campaignDaily: number | null,
        adSetDaily: number | null,
      ) =>
        normalizeMetaChangeSnapshot({
          schemaVersion: META_CHANGE_SNAPSHOT_SCHEMA_VERSION,
          workspaceId: ws,
          externalAccountId,
          capturedAt,
          campaigns: [
            {
              externalCampaignId,
              configuredStatus: observation("ACTIVE"),
              effectiveStatus: observation("ACTIVE"),
              campaignBudgetOptimization: observation(cbo),
              dailyBudgetMinor: observation(campaignDaily),
              lifetimeBudgetMinor: observation(null),
            },
          ],
          adSets: [
            {
              externalAdSetId,
              externalCampaignId,
              configuredStatus: observation("ACTIVE"),
              effectiveStatus: observation("ACTIVE"),
              dailyBudgetMinor: observation(adSetDaily),
              lifetimeBudgetMinor: observation(null),
              targetingSignature: observation(null),
            },
          ],
          ads: [],
        });
    const cboSnapshot = snapshotFor(
        `act_${account}`,
        campaignExternal,
        adsetExternal,
        true,
        10000,
        null,
      ),
      aboSnapshot = snapshotFor(
        `act_${aboAccount}`,
        aboCampaignExternal,
        aboAdsetExternal,
        false,
        null,
        9000,
      ),
      snapshot = randomUUID(),
      aboSnapshotId = randomUUID();
    const insertSnapshot = async (
      id: string,
      accountId: string,
      canonical: typeof cboSnapshot,
    ) => {
      const compositionEvidenceHash = hash({
        parentRunRef,
        workspaceId: ws,
        connectionId: connection,
        account: canonical.externalAccountId,
        capturedAt: canonical.capturedAt,
        lane: "normal_inventory_complete",
      });
      await q(
        "insert into meta_change_snapshots(id,workspace_id,meta_connection_id,ad_account_id,public_ref,snapshot_hash,schema_version,field_catalog_version,captured_at,canonical_payload,safe_aggregate) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb)",
        [
          id,
          ws,
          connection,
          accountId,
          `snapshot_${canonical.snapshotHash.slice(0, 20)}`,
          canonical.snapshotHash,
          canonical.schemaVersion,
          canonical.fieldCatalogVersion,
          canonical.capturedAt,
          JSON.stringify(canonical),
          JSON.stringify({
            entityCounts: { campaign: 1, adSet: 1, ad: 0 },
            knownFieldCount: 0,
            unknownFieldCount: 0,
          }),
        ],
      );
      await q(
        "insert into meta_complete_snapshot_receipts(workspace_id,meta_connection_id,ad_account_id,snapshot_id,snapshot_hash,captured_at,parent_run_ref,composition_evidence_hash,lane) values($1,$2,$3,$4,$5,$6,$7,$8,'normal_inventory_complete')",
        [
          ws,
          connection,
          accountId,
          id,
          canonical.snapshotHash,
          canonical.capturedAt,
          parentRunRef,
          compositionEvidenceHash,
        ],
      );
    };
    await insertSnapshot(snapshot, account, cboSnapshot);
    await insertSnapshot(aboSnapshotId, aboAccount, aboSnapshot);
    const base = drizzle(client),
      outerBound = new Proxy(base, {
        get(target, key) {
          if (key !== "execute") return Reflect.get(target, key);
          return async (statement: any) => {
            const text =
              statement?.queryChunks
                ?.flatMap((part: any) => part?.value ?? [])
                .join("")
                .toLowerCase() ?? "";
            return text.startsWith("set local transaction")
              ? { rows: [] }
              : target.execute(statement);
          };
        },
      }),
      database = {
        transaction: async <T>(work: (tx: any) => Promise<T>) =>
          work(outerBound),
      };
    const operationRepository = new DrizzleOperationReadRepository(
      database as never,
    );
    const evidenceRepository = new DrizzleGuideBudgetEvidenceRepository(
      database as never,
      operationRepository,
    );
    const service = new GuideBudgetDryRunService(evidenceRepository);
    const execute = () =>
      service.execute({
        workspaceId: ws,
        guideRevisionId: guideRevisionOneId,
        at: "2026-08-17T00:30:00.000Z",
      });
    trace("before_ready");
    let ready;
    try {
      ready = await execute();
      trace("after_ready");
    } catch (error) {
      try {
        await evidenceRepository.load({
          workspaceId: ws,
          guideRevisionId: guideRevisionOneId,
          at: "2026-08-17T00:30:00.000Z",
        });
      } catch (cause) {
        throw new Error(
          `canonical_fixture_evidence_failure:${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
      throw error;
    }
    trace("before_second");
    const second = await service.execute({
      workspaceId: ws,
      guideRevisionId: guideRevisionTwoId,
      at: "2026-08-17T00:30:00.000Z",
    });
    trace("after_second");
    const cboReceiptBackedReady =
      ready.status === "ready" &&
      ready.effectiveBudgetOwner?.budgetOwnerKind === "campaign" &&
      ready.effectiveBudgetOwner.budgetOwnerRef === targetScopeRef;
    const overlapMostRestrictiveOrderInvariant =
      ready.dryRunHash === second.dryRunHash &&
      ready.effectiveRequiresHumanApproval ===
        second.effectiveRequiresHumanApproval &&
      ready.effectiveMaximumAbsoluteDeltaDecimal === "50";
    const aboScopeRef = metaPublicReference("ad_set", ws, aboAdset),
      aboOne = makeContract(revOne.revisionHash, false, aboScopeRef, null),
      aboTwo = makeContract(revTwo.revisionHash, true, aboScopeRef, {
        restrictionRef: "restriction_budget_human",
        kind: "protection",
        disposition: "human_approval",
        actions: ["budget_decrease"],
      });
    await q("savepoint abo_owner");
    await q("set local session_replication_role='replica'");
    for (const [revisionId, contract] of [
      [guideRevisionOneId, aboOne],
      [guideRevisionTwoId, aboTwo],
    ] as const)
      await q(
        "update guide_budget_contracts set guide_revision_hash=$1,schema_version=$2,contract_hash=$3,market_key=$4,currency=$5,target_scope_ref=$6,contract_payload=$7::jsonb,maximum_evidence_age_seconds=$8 where workspace_id=$9 and guide_revision_id=$10",
        [
          contract.guideRevisionHash,
          contract.schemaVersion,
          contract.contractHash,
          contract.market,
          contract.currency,
          contract.targetScopeRef,
          JSON.stringify(contract),
          contract.maximumEvidenceAgeSeconds,
          ws,
          revisionId,
        ],
      );
    const abo = await service.execute({
      workspaceId: ws,
      guideRevisionId: guideRevisionOneId,
      at: "2026-08-17T00:30:00.000Z",
    });
    const aboOwnerReady =
      abo.status === "ready" &&
      abo.effectiveBudgetOwner?.budgetOwnerKind === "adset" &&
      abo.effectiveBudgetOwner.budgetOwnerRef === aboScopeRef;
    await q("rollback to savepoint abo_owner");
    await q("release savepoint abo_owner");
    const deniedOne = makeContract(revOne.revisionHash, false, targetScopeRef, {
        restrictionRef: "restriction_budget_deny",
        kind: "deny",
        actions: ["budget_decrease"],
      }),
      deniedTwo = makeContract(revTwo.revisionHash, true, targetScopeRef, {
        restrictionRef: "restriction_budget_lock",
        kind: "manual_lock",
        actions: ["budget_decrease"],
      });
    await q("savepoint deny_lock");
    await q("set local session_replication_role='replica'");
    for (const [revisionId, contract] of [
      [guideRevisionOneId, deniedOne],
      [guideRevisionTwoId, deniedTwo],
    ] as const)
      await q(
        "update guide_budget_contracts set contract_hash=$1,contract_payload=$2::jsonb where workspace_id=$3 and guide_revision_id=$4",
        [contract.contractHash, JSON.stringify(contract), ws, revisionId],
      );
    const denyManualLockHeld =
      (
        await service.execute({
          workspaceId: ws,
          guideRevisionId: guideRevisionOneId,
          at: "2026-08-17T00:30:00.000Z",
        })
      ).status === "held";
    await q("rollback to savepoint deny_lock");
    await q("release savepoint deny_lock");
    const withSavepoint = async (
      name: string,
      mutation: string,
      values: readonly unknown[] = [],
    ) => {
      await q(`savepoint ${name}`);
      await q(mutation, values);
      const held = await rejected(execute);
      await q(`rollback to savepoint ${name}`);
      await q(`release savepoint ${name}`);
      return held;
    };
    const withReplicaMutation = async (
      name: string,
      mutation: string,
      values: readonly unknown[] = [],
    ) => {
      await q(`savepoint ${name}`);
      await q("set local session_replication_role='replica'");
      await q(mutation, values);
      const held = await rejected(execute);
      await q(`rollback to savepoint ${name}`);
      await q(`release savepoint ${name}`);
      return held;
    };
    const missingContractGuideId = randomUUID(),
      missingContractRevisionId = randomUUID(),
      missingContractRevision = makeRevision("guide_budget_contract_missing");
    await q("savepoint incomplete_budget_guide");
    await persistGuide(
      missingContractGuideId,
      missingContractRevisionId,
      missingContractRevision,
    );
    const missingContractBudgetCapableHeld = await rejected(execute);
    await q("rollback to savepoint incomplete_budget_guide");
    await q("release savepoint incomplete_budget_guide");
    const receiptMutationRejected = await rejectedSql(
      "receipt_mutation",
      "update meta_complete_snapshot_receipts set lane='recovery' where workspace_id=$1",
      [ws],
    );
    const appendOnlyRejected = await rejectedSql(
      "contract_mutation",
      "update guide_budget_contracts set currency='USD' where workspace_id=$1",
      [ws],
    );
    const forgedReceiptRejected = await rejectedSql(
      "forged_receipt",
      "insert into meta_complete_snapshot_receipts(workspace_id,meta_connection_id,ad_account_id,snapshot_id,snapshot_hash,captured_at,parent_run_ref,composition_evidence_hash,lane) values($1,$2,$3,$4,repeat('e',64),$5,'forged',repeat('a',64),'normal_inventory_complete')",
      [ws, connection, account, snapshot, capturedAt],
    );
    const missingReceiptHeld = await withReplicaMutation(
      "missing_receipt",
      "delete from meta_complete_snapshot_receipts where workspace_id=$1",
      [ws],
    );
    const recoveryLaneRejected = await rejectedSql(
      "recovery_lane",
      "update meta_complete_snapshot_receipts set lane='recovery' where workspace_id=$1",
      [ws],
    );
    const recoveryActual = missingReceiptHeld && recoveryLaneRejected;
    const partialActual = await withReplicaMutation(
      "partial_receipt",
      "update meta_change_snapshots set canonical_payload='{\"entities\":[]}'::jsonb where id=$1",
      [snapshot],
    );
    const forgedCbo = snapshotFor(
      `act_${account}`,
      campaignExternal,
      adsetExternal,
      true,
      12000,
      null,
    );
    const forgedPayloadReceiptHeld = await withReplicaMutation(
      "forged_payload_receipt",
      "update meta_change_snapshots set canonical_payload=$1::jsonb,snapshot_hash=$2 where id=$3",
      [JSON.stringify(forgedCbo), forgedCbo.snapshotHash, snapshot],
    );
    const staleActual = await withReplicaMutation(
      "stale",
      "update meta_change_snapshots set captured_at='2026-08-16T00:00:00.000Z' where id=$1",
      [snapshot],
    );
    const currencyHeld = await withSavepoint(
      "currency",
      "update ad_accounts set currency='USD' where id=$1",
      [account],
    );
    const marketHeld = await withReplicaMutation(
      "market",
      "update guide_revisions set market_key='yabanci' where workspace_id=$1 and id=$2",
      [ws, guideRevisionOneId],
    );
    const crossTenantRejected = await rejected(() =>
      service.execute({
        workspaceId: foreignWs,
        guideRevisionId: guideRevisionOneId,
        at: "2026-08-17T00:30:00.000Z",
      }),
    );
    await q("savepoint contract_tamper");
    await q("set local session_replication_role='replica'");
    await q(
      "update guide_budget_contracts set contract_hash=repeat('0',64),contract_payload=jsonb_set(contract_payload,'{contractHash}',to_jsonb(repeat('0',64))) where workspace_id=$1 and guide_revision_id=$2",
      [ws, guideRevisionOneId],
    );
    const tamperedContractRejected = await rejected(execute);
    await q("rollback to savepoint contract_tamper");
    await q("release savepoint contract_tamper");
    const forgedTargetContract = makeContract(
      revTwo.revisionHash,
      true,
      unrelatedTargetScopeRef,
      {
        restrictionRef: "restriction_budget_human",
        kind: "protection",
        disposition: "human_approval",
        actions: ["budget_decrease"],
      },
    );
    await q("savepoint target_discriminator_tamper");
    await q("set local session_replication_role='replica'");
    // The production CHECK independently prevents this write. Drop it only
    // inside the outer rollback fixture to prove the reader still rejects a
    // superuser-style payload/column discriminator forgery.
    await q(
      "alter table guide_budget_contracts drop constraint guide_budget_contracts_identity",
    );
    await q(
      "update guide_budget_contracts set target_scope_ref=$1,contract_payload=$2::jsonb where workspace_id=$3 and guide_revision_id=$4",
      [
        forgedTargetContract.targetScopeRef,
        JSON.stringify(forgedTargetContract),
        ws,
        guideRevisionTwoId,
      ],
    );
    const targetDiscriminatorTamperRejected = await rejected(execute);
    await q("rollback to savepoint target_discriminator_tamper");
    await q("release savepoint target_discriminator_tamper");
    const crossTenantDirectRejected = await rejectedSql(
      "cross_tenant",
      "insert into guide_budget_contracts(workspace_id,guide_revision_id,guide_revision_hash,schema_version,contract_hash,market_key,currency,target_scope_ref,contract_payload,maximum_evidence_age_seconds) values($1,$2,$3,$4,$5,'yerli','TRY',$6,$7::jsonb,3600)",
      [
        foreignWs,
        guideRevisionOneId,
        contractOne.guideRevisionHash,
        contractOne.schemaVersion,
        "e".repeat(64),
        targetScopeRef,
        JSON.stringify({ ...contractOne, contractHash: "e".repeat(64) }),
      ],
    );
    const crossMarketDirectRejected = await rejectedSql(
      "cross_market",
      "insert into guide_budget_contracts(workspace_id,guide_revision_id,guide_revision_hash,schema_version,contract_hash,market_key,currency,target_scope_ref,contract_payload,maximum_evidence_age_seconds) values($1,$2,$3,$4,$5,'yabanci','TRY',$6,$7::jsonb,3600)",
      [
        ws,
        guideRevisionOneId,
        contractOne.guideRevisionHash,
        contractOne.schemaVersion,
        "e".repeat(64),
        targetScopeRef,
        JSON.stringify({
          ...contractOne,
          market: "yabanci",
          contractHash: "e".repeat(64),
        }),
      ],
    );
    const grants =
        Number(
          (
            await q(
              "select count(*)::int n from information_schema.role_table_grants where table_schema='public' and table_name=any($1::text[]) and grantee=any(array['PUBLIC','anon','authenticated','service_role'])",
              [tables],
            )
          ).rows[0]?.n,
        ) === 0,
      policies =
        Number(
          (
            await q(
              "select count(*)::int n from pg_policies where schemaname='public' and tablename=any($1::text[])",
              [tables],
            )
          ).rows[0]?.n,
        ) === 0,
      names = (
        await q(
          "select indexname from pg_indexes where schemaname='public' and tablename=any($1::text[])",
          [tables],
        )
      ).rows.map((row) => String(row.indexname)),
      indexesPresent = [
        "guide_budget_contracts_workspace_revision_fk_idx",
        "meta_complete_snapshot_receipts_workspace_snapshot_fk_idx",
      ].every((name) => names.includes(name));
    const triggerNames = [
        "guide_budget_contract_guard",
        "meta_complete_snapshot_receipt_guard",
      ],
      triggersEnabled =
        Number(
          (
            await q(
              "select count(*)::int n from pg_trigger where tgrelid=any($1::regclass[]) and tgname=any($2::text[]) and tgenabled='O' and not tgisinternal",
              [tables.map((table) => `public.${table}`), triggerNames],
            )
          ).rows[0]?.n,
        ) === triggerNames.length,
      constraintNames = [
        "guide_budget_contracts_identity",
        "guide_budget_contracts_revision_scope_fk",
        "meta_complete_snapshot_receipts_contract",
        "meta_complete_snapshot_receipts_snapshot_scope_fk",
      ],
      constraintsValid =
        Number(
          (
            await q(
              "select count(*)::int n from pg_constraint where conname=any($1::text[]) and convalidated",
              [constraintNames],
            )
          ).rows[0]?.n,
        ) === constraintNames.length;
    await q("rollback");
    const zeroResidue =
        Number(
          (await q("select count(*)::int n from workspaces where id=$1", [ws]))
            .rows[0]?.n,
        ) === 0,
      schemaObjectsGone =
        (
          await q(
            "select to_regclass('public.guide_budget_contracts') is null and to_regclass('public.meta_complete_snapshot_receipts') is null as gone",
          )
        ).rows[0]?.gone === true;
    const schemaObjectsPresent = !schemaObjectsGone,
      schemaObjectsExpected =
        verifyMode === "pre" ? schemaObjectsGone : schemaObjectsPresent;
    const multiLayerBudgetRefsExact = ready.status === "ready",
      unrelatedAndStatusOnlyGuidesIgnored = ready.status === "ready";
    const ok =
      rls &&
      cboReceiptBackedReady &&
      aboOwnerReady &&
      denyManualLockHeld &&
      overlapMostRestrictiveOrderInvariant &&
      multiLayerBudgetRefsExact &&
      unrelatedAndStatusOnlyGuidesIgnored &&
      missingContractBudgetCapableHeld &&
      receiptMutationRejected &&
      appendOnlyRejected &&
      forgedReceiptRejected &&
      missingReceiptHeld &&
      recoveryActual &&
      partialActual &&
      forgedPayloadReceiptHeld &&
      staleActual &&
      currencyHeld &&
      marketHeld &&
      crossTenantRejected &&
      tamperedContractRejected &&
      targetDiscriminatorTamperRejected &&
      crossTenantDirectRejected &&
      crossMarketDirectRejected &&
      grants &&
      policies &&
      indexesPresent &&
      triggersEnabled &&
      constraintsValid &&
      migrationLedgerExact &&
      zeroResidue &&
      schemaObjectsExpected;
    if (!ok)
      throw new Error(
        JSON.stringify({
          rls,
          cboReceiptBackedReady,
          aboOwnerReady,
          denyManualLockHeld,
          overlapMostRestrictiveOrderInvariant,
          multiLayerBudgetRefsExact,
          unrelatedAndStatusOnlyGuidesIgnored,
          missingContractBudgetCapableHeld,
          receiptMutationRejected,
          appendOnlyRejected,
          forgedReceiptRejected,
          missingReceiptHeld,
          recoveryActual,
          partialActual,
          forgedPayloadReceiptHeld,
          staleActual,
          currencyHeld,
          marketHeld,
          crossTenantRejected,
          tamperedContractRejected,
          targetDiscriminatorTamperRejected,
          crossTenantDirectRejected,
          crossMarketDirectRejected,
          grants,
          policies,
          indexesPresent,
          triggersEnabled,
          constraintsValid,
          migrationLedgerExact,
          zeroResidue,
          schemaObjectsGone,
          schemaObjectsPresent,
          ready,
        }),
      );
    console.log(
      JSON.stringify({
        ok: true,
        mode:
          verifyMode === "pre"
            ? "pre_unjournaled_outer_rollback"
            : "post_applied_outer_rollback",
        cboReceiptBackedReady,
        aboOwnerReady,
        denyManualLockHeld,
        multiLayerBudgetRefsExact,
        unrelatedAndStatusOnlyGuidesIgnored,
        missingContractBudgetCapableHeld,
        missingReceiptHeld,
        forgedReceiptRejected,
        forgedPayloadReceiptHeld,
        recoveryReceiptHeld: recoveryActual,
        partialReceiptHeld: partialActual,
        staleHeld: staleActual,
        currencyHeld,
        marketHeld,
        crossTenantRejected,
        overlapMostRestrictiveOrderInvariant,
        tamperedContractRejected,
        targetDiscriminatorTamperRejected,
        appendOnlyRejected,
        rls,
        grants,
        policies,
        indexesPresent,
        triggersEnabled,
        constraintsValid,
        migrationLedgerExact,
        zeroResidue,
        schemaObjectsGone,
        schemaObjectsPresent,
      }),
    );
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
