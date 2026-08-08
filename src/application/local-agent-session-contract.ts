import { randomBytes } from "node:crypto";
import {
  LOCAL_AGENT_CLIENT_CONTRACT_VERSION,
  LOCAL_AGENT_TOOL_CATALOG_VERSION,
  createLocalAgentSessionDescriptor,
  type LocalAgentSessionDescriptor,
  type LocalAgentToolName,
  type LocalAgentTransport,
} from "@/application/local-agent-client";
import { LOCAL_SESSION_RUNTIME_SCOPES, type LocalSessionClaims, type LocalSessionScope } from
  "@/security/local-session-capability";

export const LOCAL_AGENT_SESSION_LIFECYCLE_VERSION = "local-agent-session-lifecycle/1.0.0" as const;

export type LocalAgentHandoffContext = Readonly<{
  intent: "analysis" | "existing_post_promotion";
  entityRef: string;
  timeframeRef: string;
  contextRef: string;
  contextVersion: number;
  templateRef: string | null;
  correlationRef: string;
}>;

export type LocalAgentSessionRecord = Readonly<{
  sessionRef: string;
  workspaceId: string;
  workspaceRef: string;
  userId: string;
  clientRef: string;
  transport: LocalAgentTransport;
  toolCatalogVersion: typeof LOCAL_AGENT_TOOL_CATALOG_VERSION;
  allowedTools: readonly LocalAgentToolName[];
  startedAt: number;
  lastSeenAt: number;
  expiresAt: number;
}>;

export type LocalAgentHandoffRecord = Readonly<{
  handoffRef: string;
  workspaceId: string;
  workspaceRef: string;
  creatorSessionRef: string;
  targetSessionRef: string;
  context: LocalAgentHandoffContext;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
}>;

export type LocalAgentSessionRepository = Readonly<{
  register: (record: LocalAgentSessionRecord) => Promise<"inserted" | "unchanged" | "conflict">;
  heartbeat: (input: Readonly<{ workspaceId: string; sessionRef: string; at: number }>) => Promise<LocalAgentSessionRecord | "missing" | "clock_regression">;
  findSession: (input: Readonly<{ workspaceId: string; sessionRef: string }>) => Promise<LocalAgentSessionRecord | null>;
  listActiveSessions: (input: Readonly<{
    workspaceId: string;
    userId: string;
    at: number;
    limit: number;
  }>) => Promise<readonly LocalAgentSessionRecord[]>;
  createHandoff: (record: LocalAgentHandoffRecord) => Promise<"inserted" | "conflict">;
  consumeHandoff: (input: Readonly<{ workspaceId: string; sessionRef: string; handoffRef: string; at: number }>) => Promise<
    | Readonly<{ status: "consumed"; record: LocalAgentHandoffRecord }>
    | Readonly<{ status: "missing" | "expired" | "already_consumed" | "scope_rejected" }>
  >;
}>;

export type LocalAgentSessionLifecycleErrorCode =
  | "invalid_input"
  | "session_expired"
  | "session_conflict"
  | "session_missing"
  | "clock_regression"
  | "handoff_conflict"
  | "handoff_missing"
  | "handoff_expired"
  | "handoff_consumed"
  | "handoff_scope_rejected";

export class LocalAgentSessionLifecycleError extends Error {
  constructor(readonly code: LocalAgentSessionLifecycleErrorCode) {
    super("Local agent session lifecycle rejected");
    this.name = "LocalAgentSessionLifecycleError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_REF = /^session_[a-f0-9]{32}$/;
const HANDOFF_REF = /^handoff_[a-f0-9]{32}$/;
const NONCE = /^[a-f0-9]{64}$/;
const PUBLIC_REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,94}$/;
const CORRELATION_REF = /^correlation_[a-f0-9]{32}$/;
const FORBIDDEN_REF = /(token|secret|prompt|raw|hash|sql|uuid|grant|approve|execute|human)/i;
const AUTHORITY = Object.freeze({ sessionCoordination: true as const, businessMutation: false as const,
  modelExecution: false as const, humanPresence: false as const, approval: false as const, grant: false as const,
  execution: false as const, rawMeta: false as const, rawSql: false as const, metaWrite: false as const });

function fail(code: LocalAgentSessionLifecycleErrorCode): never {
  throw new LocalAgentSessionLifecycleError(code);
}

function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) fail("invalid_input");
}

function publicRef(value: unknown): value is string {
  return typeof value === "string" && PUBLIC_REF.test(value) && !FORBIDDEN_REF.test(value);
}

function epoch(clock: () => Date): number {
  const value = clock().getTime();
  if (!Number.isSafeInteger(value) || value < 0) fail("invalid_input");
  return Math.floor(value / 1000);
}

function validateBinding(claims: LocalSessionClaims, descriptor: LocalAgentSessionDescriptor, now: number): LocalAgentSessionDescriptor {
  exact(claims, ["version", "kind", "sessionRef", "nonce", "workspaceId", "workspaceRef", "userId", "readerRef", "scopes", "issuedAt", "expiresAt", "osUid"]);
  exact(descriptor, ["contractVersion", "clientRef", "sessionRef", "transport", "workspaceRef", "toolCatalogVersion", "allowedTools", "authority"]);
  if (claims.version !== 1 || claims.kind !== "session" || !SESSION_REF.test(claims.sessionRef)
    || !NONCE.test(claims.nonce) || !UUID.test(claims.workspaceId) || !UUID.test(claims.userId)
    || !publicRef(claims.workspaceRef) || !publicRef(claims.readerRef)
    || !Array.isArray(claims.scopes) || claims.scopes.length < 1 || new Set(claims.scopes).size !== claims.scopes.length
    || JSON.stringify(claims.scopes) !== JSON.stringify(LOCAL_SESSION_RUNTIME_SCOPES)
    || !Number.isSafeInteger(claims.issuedAt) || !Number.isSafeInteger(claims.expiresAt)
    || claims.expiresAt <= claims.issuedAt || claims.expiresAt - claims.issuedAt > 28_800
    || claims.issuedAt > now + 30 || !Number.isSafeInteger(claims.osUid) || claims.osUid < 0
    || descriptor.contractVersion !== LOCAL_AGENT_CLIENT_CONTRACT_VERSION
    || descriptor.toolCatalogVersion !== LOCAL_AGENT_TOOL_CATALOG_VERSION
    || descriptor.sessionRef !== claims.sessionRef || descriptor.workspaceRef !== claims.workspaceRef) fail("invalid_input");
  if (claims.expiresAt <= now) fail("session_expired");
  try {
    return createLocalAgentSessionDescriptor({
      clientRef: descriptor.clientRef,
      sessionRef: descriptor.sessionRef,
      transport: descriptor.transport,
      workspaceRef: descriptor.workspaceRef,
      sessionScopes: claims.scopes as readonly LocalSessionScope[],
      allowedTools: descriptor.allowedTools,
    });
  } catch {
    fail("invalid_input");
  }
}

function recordMatchesBinding(record: LocalAgentSessionRecord, claims: LocalSessionClaims,
  descriptor: LocalAgentSessionDescriptor): boolean {
  return record.sessionRef === claims.sessionRef && record.workspaceId === claims.workspaceId.toLowerCase()
    && record.workspaceRef === claims.workspaceRef && record.userId === claims.userId.toLowerCase()
    && record.clientRef === descriptor.clientRef && record.transport === descriptor.transport
    && record.toolCatalogVersion === descriptor.toolCatalogVersion
    && JSON.stringify(record.allowedTools) === JSON.stringify(descriptor.allowedTools)
    && record.expiresAt === claims.expiresAt;
}

function requiredHandoffTool(intent: LocalAgentHandoffContext["intent"]): LocalAgentToolName {
  return intent === "analysis" ? "decision_room_list" : "existing_post_promotion_preflight";
}

function context(value: LocalAgentHandoffContext): LocalAgentHandoffContext {
  exact(value, ["intent", "entityRef", "timeframeRef", "contextRef", "contextVersion", "templateRef", "correlationRef"]);
  if ((value.intent !== "analysis" && value.intent !== "existing_post_promotion")
    || !publicRef(value.entityRef) || !publicRef(value.timeframeRef) || !publicRef(value.contextRef)
    || !Number.isSafeInteger(value.contextVersion) || value.contextVersion < 1 || value.contextVersion > 1_000_000
    || (value.templateRef !== null && !publicRef(value.templateRef))
    || (value.intent === "analysis" && value.templateRef !== null)
    || (value.intent === "existing_post_promotion" && value.templateRef === null)
    || !CORRELATION_REF.test(value.correlationRef)) fail("invalid_input");
  return Object.freeze({ ...value });
}

function publicSession(record: LocalAgentSessionRecord) {
  return Object.freeze({
    clientRef: record.clientRef,
    sessionRef: record.sessionRef,
    transport: record.transport,
    workspaceRef: record.workspaceRef,
    startedAt: new Date(record.startedAt * 1000).toISOString(),
    lastSeenAt: new Date(record.lastSeenAt * 1000).toISOString(),
    expiresAt: new Date(record.expiresAt * 1000).toISOString(),
  });
}

function publicHandoff(record: LocalAgentHandoffRecord) {
  return Object.freeze({
    handoffRef: record.handoffRef,
    targetSessionRef: record.targetSessionRef,
    context: record.context,
    createdAt: new Date(record.createdAt * 1000).toISOString(),
    expiresAt: new Date(record.expiresAt * 1000).toISOString(),
  });
}

export class LocalAgentSessionLifecycleService {
  constructor(
    private readonly repository: LocalAgentSessionRepository,
    private readonly clock: () => Date = () => new Date(),
    private readonly handoffRef: () => string = () => `handoff_${randomBytes(16).toString("hex")}`,
  ) {}

  async register(input: Readonly<{ claims: LocalSessionClaims; descriptor: LocalAgentSessionDescriptor }>) {
    exact(input, ["claims", "descriptor"]);
    const now = epoch(this.clock);
    const descriptor = validateBinding(input.claims, input.descriptor, now);
    const record: LocalAgentSessionRecord = Object.freeze({
      sessionRef: input.claims.sessionRef, workspaceId: input.claims.workspaceId.toLowerCase(), workspaceRef: input.claims.workspaceRef,
      userId: input.claims.userId.toLowerCase(), clientRef: descriptor.clientRef, transport: descriptor.transport,
      toolCatalogVersion: descriptor.toolCatalogVersion, allowedTools: descriptor.allowedTools,
      startedAt: now, lastSeenAt: now, expiresAt: input.claims.expiresAt,
    });
    const outcome = await this.repository.register(record);
    if (outcome === "conflict") fail("session_conflict");
    return Object.freeze({ contractVersion: LOCAL_AGENT_SESSION_LIFECYCLE_VERSION, outcome,
      session: publicSession(record), authority: AUTHORITY });
  }

  async heartbeat(input: Readonly<{ claims: LocalSessionClaims; descriptor: LocalAgentSessionDescriptor }>) {
    exact(input, ["claims", "descriptor"]);
    const now = epoch(this.clock);
    const descriptor = validateBinding(input.claims, input.descriptor, now);
    const result = await this.repository.heartbeat({ workspaceId: input.claims.workspaceId.toLowerCase(), sessionRef: input.claims.sessionRef, at: now });
    if (result === "missing") fail("session_missing");
    if (result === "clock_regression") fail("clock_regression");
    if (!recordMatchesBinding(result, input.claims, descriptor)) fail("session_conflict");
    if (result.expiresAt <= now) fail("session_expired");
    return Object.freeze({ contractVersion: LOCAL_AGENT_SESSION_LIFECYCLE_VERSION,
      session: publicSession(result), authority: AUTHORITY });
  }

  async listActiveSessions(input: Readonly<{
    claims: LocalSessionClaims;
    descriptor: LocalAgentSessionDescriptor;
  }>) {
    exact(input, ["claims", "descriptor"]);
    const now = epoch(this.clock);
    validateBinding(input.claims, input.descriptor, now);
    const sessions = await this.repository.listActiveSessions({
      workspaceId: input.claims.workspaceId.toLowerCase(),
      userId: input.claims.userId.toLowerCase(),
      at: now,
      limit: 20,
    });
    if (sessions.length > 20 || sessions.some((record) =>
      record.workspaceId !== input.claims.workspaceId.toLowerCase()
      || record.workspaceRef !== input.claims.workspaceRef
      || record.userId !== input.claims.userId.toLowerCase()
      || record.expiresAt <= now)) fail("session_conflict");
    return Object.freeze({
      contractVersion: LOCAL_AGENT_SESSION_LIFECYCLE_VERSION,
      sessions: Object.freeze(sessions.filter((record) => record.clientRef !== "client_dashboard").map(publicSession)),
      authority: AUTHORITY,
    });
  }

  async createHandoff(input: Readonly<{ claims: LocalSessionClaims; descriptor: LocalAgentSessionDescriptor;
    targetSessionRef: string; context: LocalAgentHandoffContext; ttlSeconds: number }>) {
    exact(input, ["claims", "descriptor", "targetSessionRef", "context", "ttlSeconds"]);
    const now = epoch(this.clock);
    const descriptor = validateBinding(input.claims, input.descriptor, now);
    if (!SESSION_REF.test(input.targetSessionRef) || !Number.isSafeInteger(input.ttlSeconds)
      || input.ttlSeconds < 15 || input.ttlSeconds > 120) fail("invalid_input");
    const creator = await this.repository.findSession({ workspaceId: input.claims.workspaceId.toLowerCase(),
      sessionRef: input.claims.sessionRef });
    if (!creator) fail("session_missing");
    if (!recordMatchesBinding(creator, input.claims, descriptor)) fail("session_conflict");
    const target = await this.repository.findSession({ workspaceId: input.claims.workspaceId.toLowerCase(), sessionRef: input.targetSessionRef });
    if (!target) fail("session_missing");
    if (target.workspaceRef !== input.claims.workspaceRef || target.expiresAt <= now) fail("session_expired");
    if (target.userId !== input.claims.userId.toLowerCase()) fail("handoff_scope_rejected");
    const normalizedContext = context(input.context);
    if (!target.allowedTools.includes(requiredHandoffTool(normalizedContext.intent))) fail("handoff_scope_rejected");
    const expiresAt = Math.min(now + input.ttlSeconds, target.expiresAt, input.claims.expiresAt);
    if (expiresAt < now + 15) fail("session_expired");
    const handoffRef = this.handoffRef();
    if (!HANDOFF_REF.test(handoffRef)) fail("invalid_input");
    const record: LocalAgentHandoffRecord = Object.freeze({
      handoffRef, workspaceId: input.claims.workspaceId.toLowerCase(), workspaceRef: input.claims.workspaceRef,
      creatorSessionRef: input.claims.sessionRef, targetSessionRef: target.sessionRef,
      context: normalizedContext, createdAt: now, expiresAt, consumedAt: null,
    });
    if (await this.repository.createHandoff(record) === "conflict") fail("handoff_conflict");
    return Object.freeze({ contractVersion: LOCAL_AGENT_SESSION_LIFECYCLE_VERSION,
      handoff: publicHandoff(record), authority: AUTHORITY });
  }

  async consumeHandoff(input: Readonly<{ claims: LocalSessionClaims; descriptor: LocalAgentSessionDescriptor; handoffRef: string }>) {
    exact(input, ["claims", "descriptor", "handoffRef"]);
    const now = epoch(this.clock);
    const descriptor = validateBinding(input.claims, input.descriptor, now);
    if (!HANDOFF_REF.test(input.handoffRef)) fail("invalid_input");
    const target = await this.repository.findSession({ workspaceId: input.claims.workspaceId.toLowerCase(),
      sessionRef: input.claims.sessionRef });
    if (!target) fail("session_missing");
    if (!recordMatchesBinding(target, input.claims, descriptor)) fail("session_conflict");
    const result = await this.repository.consumeHandoff({ workspaceId: input.claims.workspaceId.toLowerCase(),
      sessionRef: input.claims.sessionRef, handoffRef: input.handoffRef, at: now });
    if (result.status === "missing") fail("handoff_missing");
    if (result.status === "expired") fail("handoff_expired");
    if (result.status === "already_consumed") fail("handoff_consumed");
    if (result.status === "scope_rejected") fail("handoff_scope_rejected");
    if (result.status !== "consumed") fail("handoff_missing");
    return Object.freeze({ contractVersion: LOCAL_AGENT_SESSION_LIFECYCLE_VERSION,
      handoff: publicHandoff(result.record), authority: AUTHORITY });
  }
}
