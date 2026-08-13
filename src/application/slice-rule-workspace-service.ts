import { createHash } from "node:crypto";

import {
  createSliceOperatingRuleDraft,
  type SliceOperatingRuleDraft,
  type SliceRule,
} from "@/domain/campaigns/slice-operating-rule";

export const SLICE_RULE_WORKSPACE_DRAFT_VERSION = "slice-rule-workspace-draft/1.0.0" as const;

export type ExactSliceRuleScope = Readonly<{
  market: "domestic" | "international";
  serviceRef: string;
  campaignFamilyRef: string;
  countryOrRegion?: string;
  audienceStrategy?: string;
  platform?: "facebook" | "instagram" | "mixed";
}>;

export type SliceRuleWorkspaceDraft = Readonly<{
  schemaVersion: typeof SLICE_RULE_WORKSPACE_DRAFT_VERSION;
  workspaceId: string;
  seriesRef: string;
  revision: number;
  previousDraftHash: "GENESIS" | string;
  draftRef: string;
  draftHash: string;
  idempotencyKey: string;
  status: "draft";
  operatingMode: "recommendation_only";
  scope: ExactSliceRuleScope;
  operatingRule: SliceOperatingRuleDraft;
  createdAt: string;
  authority: Readonly<{
    canPublish: false;
    canApprove: false;
    canExecute: false;
    canWriteMeta: false;
    canEnableAutomation: false;
  }>;
}>;

export type CreateSliceRuleWorkspaceDraftInput = Readonly<{
  workspaceId: string;
  seriesRef: string;
  revision: number;
  previousDraftHash: "GENESIS" | string;
  idempotencyKey: string;
  createdAt: string;
  scope: ExactSliceRuleScope;
  rule: SliceRule;
  priority: number;
  verification: Readonly<{
    metric: SliceOperatingRuleDraft["verification"]["metric"];
    reviewCadence: SliceOperatingRuleDraft["verification"]["reviewCadence"];
    rollbackWhen: string;
  }>;
}>;

export interface SliceRuleWorkspaceDraftPort {
  append(input: Readonly<{ draft: SliceRuleWorkspaceDraft; actorId: string }>): Promise<Readonly<{
    outcome: "inserted" | "unchanged";
    auditAppended: boolean;
  }>>;
}

export class SliceRuleWorkspaceError extends Error {
  constructor(readonly code: "invalid_input" | "invalid_scope" | "corrupt_draft") {
    super(`Slice Rule Workspace işlemi reddedildi: ${code}`);
    this.name = "SliceRuleWorkspaceError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = /^[a-z][a-z0-9_.:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const AUTHORITY = Object.freeze({ canPublish: false as const, canApprove: false as const, canExecute: false as const,
  canWriteMeta: false as const, canEnableAutomation: false as const });

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function exactScope(scope: ExactSliceRuleScope): ExactSliceRuleScope {
  if (!scope || typeof scope !== "object" || Array.isArray(scope) || Object.getPrototypeOf(scope) !== Object.prototype
    || Object.keys(scope).some((key) => !["market", "serviceRef", "campaignFamilyRef", "countryOrRegion", "audienceStrategy", "platform"].includes(key))
    || (scope.market !== "domestic" && scope.market !== "international")
    || typeof scope.serviceRef !== "string" || !REF.test(scope.serviceRef)
    || typeof scope.campaignFamilyRef !== "string" || !REF.test(scope.campaignFamilyRef)
    || scope.countryOrRegion !== undefined && (scope.countryOrRegion.trim() !== scope.countryOrRegion || scope.countryOrRegion.length < 1 || scope.countryOrRegion.length > 120)
    || scope.audienceStrategy !== undefined && (scope.audienceStrategy.trim() !== scope.audienceStrategy || scope.audienceStrategy.length < 1 || scope.audienceStrategy.length > 120)
    || scope.platform !== undefined && !["facebook", "instagram", "mixed"].includes(scope.platform)) {
    throw new SliceRuleWorkspaceError("invalid_scope");
  }
  return Object.freeze({ market: scope.market, serviceRef: scope.serviceRef, campaignFamilyRef: scope.campaignFamilyRef,
    ...(scope.countryOrRegion === undefined ? {} : { countryOrRegion: scope.countryOrRegion }),
    ...(scope.audienceStrategy === undefined ? {} : { audienceStrategy: scope.audienceStrategy }),
    ...(scope.platform === undefined ? {} : { platform: scope.platform }) });
}

function iso(value: string): string {
  const date = new Date(value);
  if (!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) || !Number.isFinite(date.valueOf()) || date.toISOString() !== value) {
    throw new SliceRuleWorkspaceError("invalid_input");
  }
  return value;
}

export function createSliceRuleWorkspaceDraft(input: CreateSliceRuleWorkspaceDraftInput): SliceRuleWorkspaceDraft {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype
    || Object.keys(input).length !== 10
    || Object.keys(input).some((key) => !["workspaceId", "seriesRef", "revision", "previousDraftHash", "idempotencyKey", "createdAt", "scope", "rule", "priority", "verification"].includes(key))
    || !UUID.test(input.workspaceId) || !REF.test(input.seriesRef) || !REF.test(input.idempotencyKey)
    || !Number.isInteger(input.revision) || input.revision < 1
    || (input.revision === 1 ? input.previousDraftHash !== "GENESIS" : !HASH.test(input.previousDraftHash))) {
    throw new SliceRuleWorkspaceError("invalid_input");
  }
  const scope = exactScope(input.scope);
  const operatingRule = createSliceOperatingRuleDraft({ slice: scope, rule: input.rule,
    automationMode: "recommendation_only", priority: input.priority, verification: input.verification });
  const core = Object.freeze({ schemaVersion: SLICE_RULE_WORKSPACE_DRAFT_VERSION, workspaceId: input.workspaceId,
    seriesRef: input.seriesRef, revision: input.revision, previousDraftHash: input.previousDraftHash,
    idempotencyKey: input.idempotencyKey, status: "draft" as const, operatingMode: "recommendation_only" as const,
    scope, operatingRule, createdAt: iso(input.createdAt), authority: AUTHORITY });
  const draftHash = digest(core);
  return Object.freeze({ ...core, draftRef: `slice_rule_draft_${draftHash.slice(0, 20)}`, draftHash });
}

export function verifySliceRuleWorkspaceDraft(value: unknown): value is SliceRuleWorkspaceDraft {
  try {
    if (!value || typeof value !== "object") return false;
    const draft = value as SliceRuleWorkspaceDraft;
    const rebuilt = createSliceRuleWorkspaceDraft({ workspaceId: draft.workspaceId, seriesRef: draft.seriesRef,
      revision: draft.revision, previousDraftHash: draft.previousDraftHash, idempotencyKey: draft.idempotencyKey,
      createdAt: draft.createdAt, scope: draft.scope, rule: draft.operatingRule.rule, priority: draft.operatingRule.priority,
      verification: draft.operatingRule.verification });
    return Object.keys(draft).length === Object.keys(rebuilt).length
      && draft.schemaVersion === rebuilt.schemaVersion && draft.status === "draft" && draft.operatingMode === "recommendation_only"
      && draft.draftRef === rebuilt.draftRef && draft.draftHash === rebuilt.draftHash
      && JSON.stringify(stable(draft)) === JSON.stringify(stable(rebuilt));
  } catch {
    return false;
  }
}

export class SliceRuleWorkspaceService {
  constructor(private readonly drafts: SliceRuleWorkspaceDraftPort) {}

  async saveDraft(actorId: string, input: CreateSliceRuleWorkspaceDraftInput) {
    if (!UUID.test(actorId)) throw new SliceRuleWorkspaceError("invalid_input");
    const draft = createSliceRuleWorkspaceDraft(input);
    const persistence = await this.drafts.append({ draft, actorId });
    return Object.freeze({ contractVersion: "slice-rule-workspace-result/1.0.0" as const, draft,
      persistence: persistence.outcome, auditAppended: persistence.auditAppended, authority: AUTHORITY });
  }
}
