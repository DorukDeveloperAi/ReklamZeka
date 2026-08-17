import { createHash } from "node:crypto";

export const NAMING_TEMPLATE_VERSION = "naming-template/1.0.0" as const;
export const NAMING_TEMPLATE_REPLAY_VERSION = "naming-template-replay/1.0.0" as const;

export type NamingEntityLevel = "campaign" | "ad_set";
export type NamingEvidenceKind = "objective" | "optimization" | "geo" | "targeting" | "platform" | "creative" | "cta" | "destination";

export type NamingTemplateRevision = Readonly<{
  version: typeof NAMING_TEMPLATE_VERSION;
  workspaceRef: string;
  accountRef: string;
  templateRef: string;
  revision: number;
  previousRevisionHash: string | null;
  state: "draft" | "published" | "disabled";
  namingFamily: string;
  entityLevel: NamingEntityLevel;
  nameRules: readonly Readonly<{
    source: "campaign_name" | "ad_set_name";
    match: "all" | "any";
    tokens: readonly string[];
  }>[];
  corroboration: readonly Readonly<{
    kind: NamingEvidenceKind;
    operator: "equals" | "includes_all" | "includes_any" | "present";
    expected: readonly string[];
  }>[];
  proposedAssignments: readonly Readonly<{ dimensionRef: string; definitionRef: string }>[];
  authority: Readonly<{
    canPropose: true;
    canAssign: false;
    canPublish: false;
    canApprove: false;
    canExecute: false;
    canWriteMeta: false;
  }>;
  revisionHash: string;
}>;

export type NamingReplayInput = Readonly<{
  workspaceRef: string;
  accountRef: string;
  entityLevel: NamingEntityLevel;
  entityRef: string;
  names: Readonly<{
    campaign: Readonly<{ value: string; evidenceRef: string }>;
    adSet: Readonly<{ value: string; evidenceRef: string }> | null;
  }>;
  evidence: readonly Readonly<{
    kind: NamingEvidenceKind;
    state: "known" | "missing" | "partial" | "conflict";
    values: readonly string[];
    evidenceRef: string;
  }>[];
  currentAssignments: readonly Readonly<{
    dimensionRef: string;
    definitionRef: string;
    manualLock: boolean;
    evidenceRef: string;
  }>[];
}>;

type ReplayCore = Readonly<{
  version: typeof NAMING_TEMPLATE_REPLAY_VERSION;
  status: "candidate" | "conflict" | "insufficient_evidence";
  template: Readonly<{ templateRef: string; revision: number; revisionHash: string }>;
  scope: Readonly<{ accountRef: string; entityLevel: NamingEntityLevel; entityRef: string }>;
  evidenceRefs: readonly string[];
  proposals: readonly Readonly<{
    dimensionRef: string;
    definitionRef: string;
    disposition: "proposed" | "already_manually_locked";
  }>[];
  reasonCodes: readonly string[];
  authority: NamingTemplateRevision["authority"];
}>;

export type NamingTemplateReplayResult = ReplayCore & Readonly<{ resultHash: string }>;

export type NamingTemplateTransitionInput = Parameters<typeof createNamingTemplateRevision>[0];

export class NamingTemplateError extends Error {
  constructor(readonly code: "invalid_input" | "invalid_scope" | "invalid_revision" | "corrupt_template") {
    super(`Naming template rejected: ${code}`);
    this.name = "NamingTemplateError";
  }
}

const AUTHORITY = Object.freeze({ canPropose: true as const, canAssign: false as const, canPublish: false as const,
  canApprove: false as const, canExecute: false as const, canWriteMeta: false as const });
const HASH = /^[a-f0-9]{64}$/;
const OPAQUE_REF = /^[a-z][a-z0-9_]{0,31}_[a-f0-9]{20,64}$/;
const ACCOUNT_REF = /^account_[a-f0-9]{24}$/;
const ENTITY_REF: Readonly<Record<NamingEntityLevel, RegExp>> = Object.freeze({
  campaign: /^campaign_[a-f0-9]{24}$/,
  ad_set: /^ad_set_[a-f0-9]{24}$/,
});
const DIMENSION_REF = /^dimension_[a-f0-9]{24}$/;
const DEFINITION_REF = /^category_[a-f0-9]{24}$/;
const TEMPLATE_REF = /^naming_template_[a-z0-9][a-z0-9_.:-]{0,95}$/;
const KEY = /^[a-z][a-z0-9_.:-]{0,63}$/;
const RULE_TOKEN = /^[\p{L}\p{N}]+$/u;
const EVIDENCE_KINDS = new Set<NamingEvidenceKind>([
  "objective", "optimization", "geo", "targeting", "platform", "creative", "cta", "destination",
]);

function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => compare(left, right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function canonicalEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => canonicalEqual(value, right[index]));
  }
  if (left && typeof left === "object" || right && typeof right === "object") {
    if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
    const leftRecord = left as Record<string, unknown>; const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).sort(compare); const rightKeys = Object.keys(rightRecord).sort(compare);
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index]
      && canonicalEqual(leftRecord[key], rightRecord[key]));
  }
  return Object.is(left, right);
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function fail(code: NamingTemplateError["code"] = "invalid_input"): never { throw new NamingTemplateError(code); }
function unique<T>(values: readonly T[]): boolean { return new Set(values).size === values.length; }
function opaque(value: string): string { if (!OPAQUE_REF.test(value)) fail(); return value; }
function key(value: string): string { if (!KEY.test(value)) fail(); return value; }

function nameTokens(value: string): readonly string[] {
  if (typeof value !== "string" || !value.trim() || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) fail();
  const tokens = value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length > 128 || tokens.some((token) => token.length > 64)) fail();
  return Object.freeze(tokens);
}

function normalizedRuleToken(value: string): string {
  if (typeof value !== "string" || value.length > 64 || !RULE_TOKEN.test(value)) fail();
  const tokens = nameTokens(value);
  if (tokens.length !== 1 || tokens[0]!.length > 64) fail();
  return tokens[0]!;
}

function stringValues(values: readonly string[]): readonly string[] {
  if (!Array.isArray(values) || values.length > 64) fail();
  const result = values.map((value) => key(value));
  if (!unique(result)) fail();
  return Object.freeze([...result].sort(compare));
}

type TemplateInput = Omit<NamingTemplateRevision, "version" | "authority" | "revisionHash" | "nameRules" | "corroboration" | "proposedAssignments"> & Readonly<{
  nameRules: NamingTemplateRevision["nameRules"];
  corroboration: NamingTemplateRevision["corroboration"];
  proposedAssignments: NamingTemplateRevision["proposedAssignments"];
}>;

/** Creates one immutable normalized revision. It carries no publish or assignment authority. */
export function createNamingTemplateRevision(input: TemplateInput): NamingTemplateRevision {
  if (!OPAQUE_REF.test(input.workspaceRef) || !ACCOUNT_REF.test(input.accountRef) || !TEMPLATE_REF.test(input.templateRef)
    || !Number.isSafeInteger(input.revision) || input.revision < 1 || input.revision > 1_000_000
    || !["draft", "published", "disabled"].includes(input.state) || !["campaign", "ad_set"].includes(input.entityLevel)
    || input.revision === 1 && input.previousRevisionHash !== null
    || input.revision === 1 && input.state !== "draft"
    || input.revision > 1 && (typeof input.previousRevisionHash !== "string" || !HASH.test(input.previousRevisionHash))
  ) fail("invalid_revision");
  const namingFamily = key(input.namingFamily);
  if (!Array.isArray(input.nameRules) || input.nameRules.length < 1 || input.nameRules.length > 8) fail();
  const nameRules = input.nameRules.map((rule) => {
    if (!["campaign_name", "ad_set_name"].includes(rule.source) || !["all", "any"].includes(rule.match)
      || input.entityLevel === "campaign" && rule.source === "ad_set_name"
      || !Array.isArray(rule.tokens) || rule.tokens.length < 1 || rule.tokens.length > 12) fail();
    const tokens = Object.freeze(rule.tokens.map(normalizedRuleToken).sort(compare));
    if (!unique(tokens)) fail();
    return Object.freeze({ source: rule.source, match: rule.match, tokens });
  }).sort((left, right) => compare(`${left.source}:${left.match}:${left.tokens.join(".")}`, `${right.source}:${right.match}:${right.tokens.join(".")}`));
  if (!unique(nameRules.map((rule) => `${rule.source}:${rule.match}:${rule.tokens.join(".")}`))) fail();

  if (!Array.isArray(input.corroboration) || input.corroboration.length < 1 || input.corroboration.length > 16) fail();
  const corroboration = input.corroboration.map((selector) => {
    if (!["objective", "optimization", "geo", "targeting", "platform", "creative", "cta", "destination"].includes(selector.kind)
      || !["equals", "includes_all", "includes_any", "present"].includes(selector.operator)
      || selector.operator === "present" && selector.expected.length !== 0
      || selector.operator !== "present" && (selector.expected.length < 1 || selector.expected.length > 32)) fail();
    const expected = stringValues(selector.expected);
    return Object.freeze({ kind: selector.kind, operator: selector.operator, expected });
  }).sort((left, right) => compare(`${left.kind}:${left.operator}:${left.expected.join(".")}`, `${right.kind}:${right.operator}:${right.expected.join(".")}`));
  if (!unique(corroboration.map((selector) => `${selector.kind}:${selector.operator}:${selector.expected.join(".")}`))) fail();

  if (!Array.isArray(input.proposedAssignments) || input.proposedAssignments.length < 1 || input.proposedAssignments.length > 16) fail();
  const proposedAssignments = input.proposedAssignments.map((proposal) => {
    if (!DIMENSION_REF.test(proposal.dimensionRef) || !DEFINITION_REF.test(proposal.definitionRef)) fail();
    return Object.freeze({ dimensionRef: proposal.dimensionRef, definitionRef: proposal.definitionRef });
  }).sort((left, right) => compare(`${left.dimensionRef}:${left.definitionRef}`, `${right.dimensionRef}:${right.definitionRef}`));
  if (!unique(proposedAssignments.map((proposal) => `${proposal.dimensionRef}:${proposal.definitionRef}`))) fail();
  if (!unique(proposedAssignments.map((proposal) => proposal.dimensionRef))) fail();

  const core = Object.freeze({ version: NAMING_TEMPLATE_VERSION, workspaceRef: opaque(input.workspaceRef), accountRef: input.accountRef,
    templateRef: input.templateRef, revision: input.revision, previousRevisionHash: input.previousRevisionHash,
    state: input.state, namingFamily, entityLevel: input.entityLevel, nameRules: Object.freeze(nameRules),
    corroboration: Object.freeze(corroboration), proposedAssignments: Object.freeze(proposedAssignments), authority: AUTHORITY });
  return Object.freeze({ ...core, revisionHash: digest(core) });
}

function validateRevision(template: NamingTemplateRevision): void {
  const rebuilt = createNamingTemplateRevision({ workspaceRef: template.workspaceRef, accountRef: template.accountRef,
    templateRef: template.templateRef, revision: template.revision, previousRevisionHash: template.previousRevisionHash,
    state: template.state, namingFamily: template.namingFamily, entityLevel: template.entityLevel,
    nameRules: template.nameRules, corroboration: template.corroboration, proposedAssignments: template.proposedAssignments });
  if (rebuilt.revisionHash !== template.revisionHash || !canonicalEqual(rebuilt, template)) fail("corrupt_template");
}

/** Creates a new immutable revision only when the requested lifecycle transition is valid. */
export function transitionNamingTemplateRevision(
  previous: NamingTemplateRevision,
  input: NamingTemplateTransitionInput,
): NamingTemplateRevision {
  validateRevision(previous);
  const allowed = previous.state === "draft" ? input.state === "draft" || input.state === "published"
    : previous.state === "published" ? input.state === "draft" || input.state === "disabled" : false;
  if (input.workspaceRef !== previous.workspaceRef || input.accountRef !== previous.accountRef
    || input.templateRef !== previous.templateRef || input.namingFamily !== previous.namingFamily
    || input.entityLevel !== previous.entityLevel || input.revision !== previous.revision + 1
    || input.previousRevisionHash !== previous.revisionHash || !allowed) {
    fail("invalid_revision");
  }
  return createNamingTemplateRevision(input);
}

function evidenceRefs(refs: ReadonlySet<string>): readonly string[] {
  const normalized = [...refs].map(opaque);
  return Object.freeze([...new Set(normalized)].sort(compare));
}

function result(template: NamingTemplateRevision, input: NamingReplayInput, status: ReplayCore["status"],
  proposals: ReplayCore["proposals"], reasonCodes: readonly string[], usedEvidenceRefs: ReadonlySet<string>): NamingTemplateReplayResult {
  const core: ReplayCore = Object.freeze({ version: NAMING_TEMPLATE_REPLAY_VERSION, status,
    template: Object.freeze({ templateRef: template.templateRef, revision: template.revision, revisionHash: template.revisionHash }),
    scope: Object.freeze({ accountRef: input.accountRef, entityLevel: input.entityLevel, entityRef: input.entityRef }),
    evidenceRefs: evidenceRefs(usedEvidenceRefs), proposals: Object.freeze([...proposals]),
    reasonCodes: Object.freeze([...new Set(reasonCodes)].sort(compare)), authority: AUTHORITY });
  return Object.freeze({ ...core, resultHash: digest(core) });
}

function selectorMatches(operator: NamingTemplateRevision["corroboration"][number]["operator"],
  expected: readonly string[], actual: readonly string[]): boolean {
  if (operator === "present") return actual.length > 0;
  if (operator === "equals") return expected.length === actual.length && expected.every((value, index) => value === actual[index]);
  if (operator === "includes_all") return expected.every((value) => actual.includes(value));
  return expected.some((value) => actual.includes(value));
}

/** Deterministic, read-only replay. It can only return proposed category refs. */
export function replayNamingTemplate(template: NamingTemplateRevision, input: NamingReplayInput): NamingTemplateReplayResult {
  validateRevision(template);
  if (!OPAQUE_REF.test(input.workspaceRef) || input.workspaceRef !== template.workspaceRef || input.accountRef !== template.accountRef
    || input.entityLevel !== template.entityLevel || !ENTITY_REF[input.entityLevel].test(input.entityRef)) fail("invalid_scope");
  if (!input.names || !input.names.campaign || input.entityLevel === "ad_set" && !input.names.adSet
    || input.entityLevel === "campaign" && input.names.adSet !== null) fail();
  if (!Array.isArray(input.evidence) || input.evidence.length > EVIDENCE_KINDS.size
    || !Array.isArray(input.currentAssignments) || input.currentAssignments.length > 64) fail();
  opaque(input.names.campaign.evidenceRef);
  if (input.names.adSet) opaque(input.names.adSet.evidenceRef);
  const names = Object.freeze({ campaign_name: nameTokens(input.names.campaign.value),
    ad_set_name: input.names.adSet ? nameTokens(input.names.adSet.value) : Object.freeze([]) });
  const evidence = new Map<NamingEvidenceKind, NamingReplayInput["evidence"][number]>();
  for (const item of input.evidence) {
    if (!EVIDENCE_KINDS.has(item.kind) || evidence.has(item.kind)
      || !["known", "missing", "partial", "conflict"].includes(item.state)) fail();
    opaque(item.evidenceRef); const values = stringValues(item.values);
    if (item.state === "known" ? values.length === 0 : item.state === "missing" && values.length > 0) fail();
    evidence.set(item.kind, Object.freeze({ ...item, values }));
  }
  for (const assignment of input.currentAssignments) {
    if (!DIMENSION_REF.test(assignment.dimensionRef) || !DEFINITION_REF.test(assignment.definitionRef)
      || typeof assignment.manualLock !== "boolean") fail();
    opaque(assignment.evidenceRef);
  }
  const usedEvidenceRefs = new Set<string>();
  if (template.state === "disabled") return result(template, input, "insufficient_evidence", [], ["template_disabled"], usedEvidenceRefs);
  const unmatchedName = template.nameRules.some((rule) => {
    usedEvidenceRefs.add(rule.source === "campaign_name" ? input.names.campaign.evidenceRef : input.names.adSet!.evidenceRef);
    const actual = names[rule.source];
    return rule.match === "all" ? !rule.tokens.every((token) => actual.includes(token)) : !rule.tokens.some((token) => actual.includes(token));
  });
  if (unmatchedName) return result(template, input, "insufficient_evidence", [], ["name_rule_unmatched"], usedEvidenceRefs);

  const missing: string[] = []; const conflicts: string[] = [];
  for (const selector of template.corroboration) {
    const fact = evidence.get(selector.kind);
    if (fact) usedEvidenceRefs.add(fact.evidenceRef);
    if (!fact || fact.state === "missing" || fact.state === "partial") { missing.push(`${selector.kind}_insufficient`); continue; }
    if (fact.state === "conflict" || !selectorMatches(selector.operator, selector.expected, fact.values)) {
      conflicts.push(`${selector.kind}_conflict`);
    }
  }
  if (conflicts.length) return result(template, input, "conflict", [], conflicts, usedEvidenceRefs);
  if (missing.length) return result(template, input, "insufficient_evidence", [], missing, usedEvidenceRefs);

  const proposals: Array<NamingTemplateReplayResult["proposals"][number]> = [];
  for (const proposal of template.proposedAssignments) {
    const current = input.currentAssignments.filter((assignment) => assignment.dimensionRef === proposal.dimensionRef);
    current.forEach((assignment) => usedEvidenceRefs.add(assignment.evidenceRef));
    const lockedConflict = current.some((assignment) => assignment.manualLock && assignment.definitionRef !== proposal.definitionRef);
    if (lockedConflict) conflicts.push("manual_lock_conflict");
    else if (current.some((assignment) => assignment.manualLock && assignment.definitionRef === proposal.definitionRef)) {
      proposals.push(Object.freeze({ ...proposal, disposition: "already_manually_locked" }));
    } else if (current.some((assignment) => assignment.definitionRef !== proposal.definitionRef)) conflicts.push("existing_assignment_conflict");
    else proposals.push(Object.freeze({ ...proposal, disposition: "proposed" }));
  }
  if (conflicts.length) return result(template, input, "conflict", [], conflicts, usedEvidenceRefs);
  return result(template, input, "candidate", proposals, [], usedEvidenceRefs);
}
