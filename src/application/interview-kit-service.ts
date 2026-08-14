import { createHash, randomBytes } from "node:crypto";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";
import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";

export const INTERVIEW_KIT_VERSION = "orchestrator-interview-kit/1.0.0" as const;
export type InterviewKitIntent = "explain" | "compare" | "question";
export type InterviewKitPage = "today" | "campaigns" | "analysis" | "budgets" | "rules" | "settings" | "agent" | "approvals" | "alerts" | "timeline";
export type OfficialSourceOption = Readonly<{ optionId: string; title: string; url: string; freshness: "fresh" }>;
export type InterviewKit = Readonly<{ kitRef: string; revision: number; state: "active" | "archived"; name: string; explanation: string; questions: readonly string[]; applicability: Readonly<{ pages: readonly InterviewKitPage[]; intents: readonly InterviewKitIntent[] }>; source: OfficialSourceOption }>;
export type InterviewKitRepository = Readonly<{
  list(workspaceId: string): Promise<readonly InterviewKit[]>;
  sources(workspaceId: string): Promise<readonly OfficialSourceOption[]>;
  create(input: Readonly<{ workspaceId: string; actorId: string; name: string; explanation: string; questions: readonly string[]; pages: readonly InterviewKitPage[]; intents: readonly InterviewKitIntent[]; sourceOptionId: string }>): Promise<InterviewKit>;
  revise(input: Readonly<{ workspaceId: string; actorId: string; kitRef: string; expectedRevision: number; name: string; explanation: string; questions: readonly string[]; pages: readonly InterviewKitPage[]; intents: readonly InterviewKitIntent[]; sourceOptionId: string }>): Promise<InterviewKit>;
  archive(input: Readonly<{ workspaceId: string; actorId: string; kitRef: string; expectedRevision: number }>): Promise<InterviewKit>;
}>;
const PAGES = new Set<InterviewKitPage>(["today","campaigns","analysis","budgets","rules","settings","agent","approvals","alerts","timeline"]);
const INTENTS = new Set<InterviewKitIntent>(["explain","compare","question"]);
const REF = /^interview_kit_[a-f0-9]{32}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
function bad(): never { throw new Error("invalid_input"); }
function clean(value: unknown, max: number): string { if (typeof value !== "string") bad(); const normalized = value.trim(); if (!normalized || normalized.length > max || CONTROL.test(normalized)) bad(); return normalized; }
function draft(value: Readonly<{ name: unknown; explanation: unknown; questions: unknown; pages: unknown; intents: unknown; sourceOptionId: unknown }>) {
  const questions = !Array.isArray(value.questions) ? bad() : value.questions.map((item) => clean(item, 500));
  const pages = !Array.isArray(value.pages) ? bad() : value.pages;
  const intents = !Array.isArray(value.intents) ? bad() : value.intents;
  if (questions.length < 1 || questions.length > 12 || new Set(questions).size !== questions.length || pages.length < 1 || intents.length < 1 || pages.some((x) => typeof x !== "string" || !PAGES.has(x as InterviewKitPage)) || intents.some((x) => typeof x !== "string" || !INTENTS.has(x as InterviewKitIntent))) bad();
  return Object.freeze({ name: clean(value.name, 160), explanation: clean(value.explanation, 1_000), questions: Object.freeze(questions), pages: Object.freeze([...new Set(pages as InterviewKitPage[])]), intents: Object.freeze([...new Set(intents as InterviewKitIntent[])]), sourceOptionId: clean(value.sourceOptionId, 128) });
}
export class InterviewKitService {
  constructor(private readonly repo: InterviewKitRepository, private readonly memberships: readonly WorkspaceMembership[]) {}
  async list(principal: TrustedDecisionRoomPrincipal) { authorizeWorkspace(principal.actor, principal.workspaceId, "guidance:read", this.memberships); return Object.freeze({ contractVersion: INTERVIEW_KIT_VERSION, kits: await this.repo.list(principal.workspaceId), sources: await this.repo.sources(principal.workspaceId), authority: Object.freeze({ canPersist: false, canCreateRule: false, canDraftPolicy: false, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false }) }); }
  async create(principal: TrustedDecisionRoomPrincipal, input: Parameters<typeof draft>[0]) { authorizeWorkspace(principal.actor, principal.workspaceId, "guidance:draft", this.memberships); return this.repo.create({ workspaceId: principal.workspaceId, actorId: principal.actor.userId, ...draft(input) }); }
  async revise(principal: TrustedDecisionRoomPrincipal, input: Parameters<typeof draft>[0] & Readonly<{ kitRef: unknown; expectedRevision: unknown }>) { authorizeWorkspace(principal.actor, principal.workspaceId, "guidance:draft", this.memberships); if (typeof input.kitRef !== "string" || !REF.test(input.kitRef) || typeof input.expectedRevision !== "number" || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) bad(); return this.repo.revise({ workspaceId: principal.workspaceId, actorId: principal.actor.userId, kitRef: input.kitRef, expectedRevision: input.expectedRevision, ...draft(input) }); }
  async archive(principal: TrustedDecisionRoomPrincipal, kitRef: unknown, expectedRevision: unknown) { authorizeWorkspace(principal.actor, principal.workspaceId, "guidance:draft", this.memberships); if (typeof kitRef !== "string" || !REF.test(kitRef) || typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision) || expectedRevision < 1) bad(); return this.repo.archive({ workspaceId: principal.workspaceId, actorId: principal.actor.userId, kitRef, expectedRevision }); }
}
export const interviewKitHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const newInterviewKitRef = () => `interview_kit_${randomBytes(16).toString("hex")}`;
