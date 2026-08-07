import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  DecisionRoomAgentContract,
  type TrustedDecisionRoomPrincipal,
} from "@/application/decision-room-agent-contract";
import { DecisionRoomReadService } from "@/application/decision-room-read-service";
import { DrizzleDecisionRoomReadRepository } from "@/connectors/decisions/decision-room-drizzle-adapters";
import * as schema from "@/db/schema";
import {
  createDecisionRoomHttpHandlers,
  decisionRoomNotConfiguredResponse,
} from "@/server/decision-room-http";
import type { WorkspaceMembership, WorkspaceRole } from "@/security/authorization";
import {
  bearerToken,
  cookieToken,
  localSessionSigningKey,
  verifyLocalSessionCapability,
  type LocalSessionScope,
  type LocalSessionClaims,
} from "@/security/local-session-capability";

type Database = NodePgDatabase<typeof schema>;
type LocalDatabase = Pick<Database, "execute" | "transaction">;

export type LocalDecisionRoomEnvironment = Readonly<{
  DATABASE_URL?: string;
  REKLAMZEKA_LOCAL_SESSION_ENABLED?: string;
  REKLAMZEKA_LOCAL_ORIGIN?: string;
  REKLAMZEKA_LOCAL_WORKSPACE_ID?: string;
  REKLAMZEKA_LOCAL_WORKSPACE_REF?: string;
  REKLAMZEKA_LOCAL_USER_ID?: string;
  REKLAMZEKA_LOCAL_READER_REF?: string;
  REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY?: string;
}>;

export type LocalDecisionRoomConfig = Readonly<{
  origin: string;
  workspaceId: string;
  workspaceRef: string;
  userId: string;
  readerRef: string;
  signingKey: Buffer;
}>;

type MembershipRow = Readonly<{
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  lifecycle_state: "active" | "tombstoning" | "tombstoned";
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$/;
const ROLES = new Set<WorkspaceRole>(["owner", "admin", "analyst", "viewer"]);
const FORWARDED_HEADERS = [
  "forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto",
  "x-real-ip", "cf-connecting-ip",
] as const;

export class LocalDecisionRoomBoundaryError extends Error {
  constructor(readonly code: "invalid_config" | "untrusted_request" | "principal_unavailable") {
    super(`Local Decision Room boundary rejected: ${code}`);
    this.name = "LocalDecisionRoomBoundaryError";
  }
}

function exactKeys(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new LocalDecisionRoomBoundaryError("invalid_config");
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function opaqueRef(value: unknown): string {
  if (typeof value !== "string" || !OPAQUE_REF.test(value)
    || /(token|secret|prompt|raw[_-]?(payload|request|response|json))/i.test(value)) {
    throw new LocalDecisionRoomBoundaryError("invalid_config");
  }
  return value;
}

/**
 * Reads namespaced, secret-free identity bindings only. DATABASE_URL is checked
 * for presence by the route assembly but is never retained in this public config.
 */
export function localDecisionRoomConfig(environment: LocalDecisionRoomEnvironment): LocalDecisionRoomConfig | null {
  exactKeys(environment, [
    "DATABASE_URL", "REKLAMZEKA_LOCAL_SESSION_ENABLED", "REKLAMZEKA_LOCAL_ORIGIN",
    "REKLAMZEKA_LOCAL_WORKSPACE_ID", "REKLAMZEKA_LOCAL_WORKSPACE_REF",
    "REKLAMZEKA_LOCAL_USER_ID", "REKLAMZEKA_LOCAL_READER_REF",
    "REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY",
  ]);
  if (environment.REKLAMZEKA_LOCAL_SESSION_ENABLED !== "true") return null;
  if (!environment.DATABASE_URL?.trim()) return null;
  const workspaceId = environment.REKLAMZEKA_LOCAL_WORKSPACE_ID;
  const userId = environment.REKLAMZEKA_LOCAL_USER_ID;
  if (!workspaceId || !UUID.test(workspaceId) || !userId || !UUID.test(userId)) {
    throw new LocalDecisionRoomBoundaryError("invalid_config");
  }
  let origin: URL;
  try {
    origin = new URL(environment.REKLAMZEKA_LOCAL_ORIGIN ?? "");
  } catch {
    throw new LocalDecisionRoomBoundaryError("invalid_config");
  }
  if (!(["http:", "https:"] as const).includes(origin.protocol as "http:" | "https:")
    || !isLoopbackHostname(origin.hostname)
    || (origin.protocol === "http:" && origin.hostname !== "localhost")
    || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new LocalDecisionRoomBoundaryError("invalid_config");
  }
  return Object.freeze({
    origin: origin.origin,
    workspaceId: workspaceId.toLowerCase(),
    workspaceRef: opaqueRef(environment.REKLAMZEKA_LOCAL_WORKSPACE_REF),
    userId: userId.toLowerCase(),
    readerRef: opaqueRef(environment.REKLAMZEKA_LOCAL_READER_REF),
    signingKey: localSessionSigningKey(environment.REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY),
  });
}

/**
 * A forwarded address is never evidence of locality. The local HTTP mode only
 * accepts an exact configured loopback URL/Host pair and rejects all proxy hops.
 */
export function assertTrustedLocalDecisionRoomRequest(
  request: Request,
  config: LocalDecisionRoomConfig,
  operation: "read" | "mark_read" | "draft" | "decide" | "publish",
  credential: "cookie" | "bearer" = "cookie",
): void {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    throw new LocalDecisionRoomBoundaryError("untrusted_request");
  }
  const configured = new URL(config.origin);
  if (url.origin !== configured.origin || !isLoopbackHostname(url.hostname)
    || request.headers.get("host") !== configured.host
    || FORWARDED_HEADERS.some((header) => request.headers.has(header))) {
    throw new LocalDecisionRoomBoundaryError("untrusted_request");
  }
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if ((origin !== null && origin !== config.origin)
    || (fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none")) {
    throw new LocalDecisionRoomBoundaryError("untrusted_request");
  }
  if (operation === "mark_read" && request.headers.get("x-reklamzeka-intent") !== "mark-inbox-read") {
    throw new LocalDecisionRoomBoundaryError("untrusted_request");
  }
  if (operation === "draft" && !["budget-lab-dry-run", "budget-lab-save-draft"].includes(
    request.headers.get("x-reklamzeka-intent") ?? "",
  ) && request.headers.get("x-reklamzeka-intent") !== "autonomy-rule-create-draft") throw new LocalDecisionRoomBoundaryError("untrusted_request");
  if (operation === "decide" && ![
    "approval-queue-confirm-human-presence", "approval-queue-approve", "approval-queue-reject", "approval-queue-request-changes",
  ].includes(
    request.headers.get("x-reklamzeka-intent") ?? "",
  )) throw new LocalDecisionRoomBoundaryError("untrusted_request");
  if (operation === "publish" && ![
    "policy-bundle-confirm-human-presence", "policy-bundle-publish-approval-policy",
    "policy-bundle-publish-guardrail-policy",
  ].includes(request.headers.get("x-reklamzeka-intent") ?? "")) throw new LocalDecisionRoomBoundaryError("untrusted_request");
  if ((operation === "mark_read" || operation === "draft" || operation === "decide" || operation === "publish") && credential === "cookie"
    && (origin !== config.origin || fetchSite !== "same-origin")) {
    throw new LocalDecisionRoomBoundaryError("untrusted_request");
  }
}

function authenticate(
  request: Request,
  config: LocalDecisionRoomConfig,
  operation: "read" | "mark_read" | "draft" | "decide",
): Readonly<{ claims: LocalSessionClaims; credential: "cookie" | "bearer" }> {
  const bearer = bearerToken(request);
  const cookie = cookieToken(request);
  if ((bearer === null) === (cookie === null)) throw new LocalDecisionRoomBoundaryError("untrusted_request");
  const credential = bearer === null ? "cookie" as const : "bearer" as const;
  if (operation === "decide" && credential !== "cookie") throw new LocalDecisionRoomBoundaryError("untrusted_request");
  const token = bearer ?? cookie!;
  const osUid = typeof process.getuid === "function" ? process.getuid() : -1;
  if (osUid < 0) throw new LocalDecisionRoomBoundaryError("untrusted_request");
  const claims = verifyLocalSessionCapability({
    token,
    key: config.signingKey,
    now: Math.floor(Date.now() / 1000),
    osUid,
    requiredScope: operation === "read" ? "decision_room:read" : operation === "draft" ? "budget_lab:draft"
      : operation === "decide" ? "approval_queue:decide" : "decision_room:mark_read",
    expected: config,
  });
  return Object.freeze({ claims, credential });
}

function rows<T>(result: unknown): readonly T[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) {
    throw new LocalDecisionRoomBoundaryError("principal_unavailable");
  }
  return result.rows as readonly T[];
}

async function bindPrincipal(database: Pick<Database, "execute">, config: LocalDecisionRoomConfig): Promise<Readonly<{
  principal: TrustedDecisionRoomPrincipal;
  membership: WorkspaceMembership;
}>> {
  const result = rows<MembershipRow>(await database.execute(sql`
    select membership.workspace_id, membership.user_id, membership.role, workspace.lifecycle_state
    from memberships membership
    join workspaces workspace on workspace.id = membership.workspace_id
    join users app_user on app_user.id = membership.user_id
    where membership.workspace_id = ${config.workspaceId}::uuid
      and membership.user_id = ${config.userId}::uuid
      and workspace.lifecycle_state = 'active'
    limit 2
  `));
  if (result.length !== 1) throw new LocalDecisionRoomBoundaryError("principal_unavailable");
  const row = result[0]!;
  if (row.workspace_id.toLowerCase() !== config.workspaceId || row.user_id.toLowerCase() !== config.userId
    || row.lifecycle_state !== "active" || !ROLES.has(row.role)) {
    throw new LocalDecisionRoomBoundaryError("principal_unavailable");
  }
  return Object.freeze({
    principal: Object.freeze({
      actor: Object.freeze({ userId: config.userId }),
      workspaceId: config.workspaceId,
      workspaceRef: config.workspaceRef,
      readerRef: config.readerRef,
    }),
    membership: Object.freeze({ userId: config.userId, workspaceId: config.workspaceId, role: row.role }),
  });
}

/** Shared, fail-closed local reader binding used by server-side read tools. */
export async function resolveTrustedLocalReadPrincipal(input: Readonly<{
  request: Request;
  database: Pick<Database, "execute">;
  config: LocalDecisionRoomConfig;
  requiredScope: Extract<LocalSessionScope, "approval_queue:read" | "budget_lab:read" | "decision_room:read" | "policy_bundle:read" | "practice_lab:read" | "promotion_catalog:read" | "promotion_preflight:read" | "promotion_proposal:draft">;
}>): Promise<Readonly<{ principal: TrustedDecisionRoomPrincipal; membership: WorkspaceMembership }>> {
  exactKeys(input, ["request", "database", "config", "requiredScope"]);
  const authenticated = authenticate(input.request, input.config, "read");
  verifyLocalSessionCapability({
    token: authenticated.credential === "bearer" ? bearerToken(input.request)! : cookieToken(input.request)!,
    key: input.config.signingKey,
    now: Math.floor(Date.now() / 1000),
    osUid: typeof process.getuid === "function" ? process.getuid() : -1,
    requiredScope: input.requiredScope,
    expected: input.config,
  });
  assertTrustedLocalDecisionRoomRequest(input.request, input.config, "read", authenticated.credential);
  return bindPrincipal(input.database, input.config);
}

export async function resolveTrustedLocalDraftPrincipal(input: Readonly<{
  request: Request;
  database: Pick<Database, "execute">;
  config: LocalDecisionRoomConfig;
}>): Promise<Readonly<{ principal: TrustedDecisionRoomPrincipal; membership: WorkspaceMembership }>> {
  exactKeys(input, ["request", "database", "config"]);
  const authenticated = authenticate(input.request, input.config, "draft");
  assertTrustedLocalDecisionRoomRequest(input.request, input.config, "draft", authenticated.credential);
  return bindPrincipal(input.database, input.config);
}

/** Cookie-only, separately scoped Autonomy Studio binding. */
export async function resolveTrustedLocalAutonomyRulePrincipal(input: Readonly<{
  request: Request;
  database: Pick<Database, "execute">;
  config: LocalDecisionRoomConfig;
  requiredScope: Extract<LocalSessionScope, "autonomy_rules:read" | "autonomy_rules:draft">;
}>): Promise<Readonly<{ principal: TrustedDecisionRoomPrincipal; membership: WorkspaceMembership }>> {
  exactKeys(input, ["request", "database", "config", "requiredScope"]);
  if (bearerToken(input.request) !== null || cookieToken(input.request) === null) {
    throw new LocalDecisionRoomBoundaryError("untrusted_request");
  }
  verifyLocalSessionCapability({
    token: cookieToken(input.request)!, key: input.config.signingKey, now: Math.floor(Date.now() / 1000),
    osUid: typeof process.getuid === "function" ? process.getuid() : -1, requiredScope: input.requiredScope,
    expected: input.config,
  });
  assertTrustedLocalDecisionRoomRequest(input.request, input.config,
    input.requiredScope === "autonomy_rules:read" ? "read" : "draft", "cookie");
  return bindPrincipal(input.database, input.config);
}

/** Cookie-only, separately scoped K4 Policy Bundle Studio binding. */
export async function resolveTrustedLocalPolicyBundlePrincipal(input: Readonly<{
  request: Request;
  database: Pick<Database, "execute">;
  config: LocalDecisionRoomConfig;
  requiredScope: Extract<LocalSessionScope, "policy_bundle:read" | "policy_bundle:draft" | "policy_bundle:publish">;
}>): Promise<Readonly<{ principal: TrustedDecisionRoomPrincipal; membership: WorkspaceMembership }>> {
  exactKeys(input, ["request", "database", "config", "requiredScope"]);
  if (bearerToken(input.request) !== null || cookieToken(input.request) === null) {
    throw new LocalDecisionRoomBoundaryError("untrusted_request");
  }
  verifyLocalSessionCapability({
    token: cookieToken(input.request)!, key: input.config.signingKey, now: Math.floor(Date.now() / 1000),
    osUid: typeof process.getuid === "function" ? process.getuid() : -1, requiredScope: input.requiredScope,
    expected: input.config,
  });
  assertTrustedLocalDecisionRoomRequest(input.request, input.config,
    input.requiredScope === "policy_bundle:read" ? "read"
      : input.requiredScope === "policy_bundle:draft" ? "draft" : "publish", "cookie");
  return bindPrincipal(input.database, input.config);
}

/** Cookie-only approval mutation binding; membership is re-read every request. */
export async function resolveTrustedLocalApprovalDecisionPrincipal(input: Readonly<{
  request: Request;
  database: Pick<Database, "execute">;
  config: LocalDecisionRoomConfig;
}>): Promise<Readonly<{ principal: TrustedDecisionRoomPrincipal; membership: WorkspaceMembership }>> {
  exactKeys(input, ["request", "database", "config"]);
  const authenticated = authenticate(input.request, input.config, "decide");
  assertTrustedLocalDecisionRoomRequest(input.request, input.config, "decide", authenticated.credential);
  return bindPrincipal(input.database, input.config);
}

function unavailable() {
  return decisionRoomNotConfiguredResponse();
}

/**
 * Production/local route assembly. Membership is re-read for every request, so
 * revocation or workspace tombstoning takes effect without a process restart.
 */
export function createLocalDecisionRoomRouteHandlers(input: Readonly<{
  database: LocalDatabase;
  config: LocalDecisionRoomConfig;
}>) {
  exactKeys(input, ["database", "config"]);
  const execute = async (request: Request, operation: "read" | "mark_read") => {
    try {
      const authenticated = authenticate(request, input.config, operation);
      assertTrustedLocalDecisionRoomRequest(request, input.config, operation, authenticated.credential);
      const bound = await bindPrincipal(input.database, input.config);
      const repository = new DrizzleDecisionRoomReadRepository(
        input.database as never,
        input.config.workspaceId,
        input.config.workspaceRef,
      );
      const contract = new DecisionRoomAgentContract(
        new DecisionRoomReadService(repository),
        [bound.membership],
      );
      const handlers = createDecisionRoomHttpHandlers({
        contract,
        resolvePrincipal: async () => bound.principal,
      });
      return operation === "read" ? handlers.GET(request) : handlers.PATCH(request);
    } catch {
      // Locality/config/principal details and database errors are deliberately
      // indistinguishable at the public boundary and never logged here.
      return unavailable();
    }
  };
  return Object.freeze({
    GET: (request: Request) => execute(request, "read"),
    PATCH: (request: Request) => execute(request, "mark_read"),
  });
}
