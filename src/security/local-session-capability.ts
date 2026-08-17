import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const LOCAL_SESSION_COOKIE = "__Host-rzka_local_session" as const;
export type LocalSessionScope = "approval_queue:decide" | "approval_queue:read" | "autonomy_rules:read" | "autonomy_rules:draft" | "category_registry:read" | "category_registry:publish" | "instruction_policy:read" | "instruction_policy:draft" | "instruction_policy:publish" | "guidance:read" | "guidance:draft" | "guidance:publish" | "policy_bundle:read" | "policy_bundle:draft" | "policy_bundle:publish" | "decision_cadence:publish" | "experiment_record:mutate" | "business_outcome:record" | "business_outcome:read" | "budget_lab:draft" | "budget_lab:read" | "decision_room:read" | "decision_room:mark_read" | "decision_room:dry_run" | "meta_sync:trigger" | "practice_lab:read" | "practice_lab:draft" | "practice_lab:standardize" | "promotion_catalog:read" | "promotion_preflight:read" | "promotion_proposal:draft" | "promotion_lifecycle:read" | "promotion_lifecycle:draft" | "promotion_lifecycle:publish" | "local_session:bootstrap";
export type LocalSessionKind = "bootstrap" | "session";

export type LocalSessionClaims = Readonly<{
  version: 1;
  kind: LocalSessionKind;
  sessionRef: string;
  nonce: string;
  workspaceId: string;
  workspaceRef: string;
  userId: string;
  readerRef: string;
  scopes: readonly LocalSessionScope[];
  issuedAt: number;
  expiresAt: number;
  osUid: number;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$/;
const SESSION = /^session_[a-f0-9]{32}$/;
const NONCE = /^[a-f0-9]{64}$/;
const TOKEN = /^rzs1\.([A-Za-z0-9_-]{64,2048})\.([A-Za-z0-9_-]{43})$/;
export const LOCAL_SESSION_RUNTIME_SCOPES: readonly LocalSessionScope[] = Object.freeze([
  "approval_queue:decide", "approval_queue:read", "autonomy_rules:draft", "autonomy_rules:read",
  "category_registry:publish", "category_registry:read",
  "instruction_policy:draft", "instruction_policy:publish", "instruction_policy:read",
  "guidance:draft", "guidance:publish", "guidance:read",
  "policy_bundle:draft", "policy_bundle:publish", "policy_bundle:read", "decision_cadence:publish", "experiment_record:mutate", "business_outcome:record", "business_outcome:read", "budget_lab:draft", "budget_lab:read",
  "decision_room:mark_read", "decision_room:read", "decision_room:dry_run", "meta_sync:trigger", "practice_lab:read", "practice_lab:draft", "practice_lab:standardize", "promotion_catalog:read",
  "promotion_preflight:read", "promotion_proposal:draft",
  "promotion_lifecycle:read", "promotion_lifecycle:draft", "promotion_lifecycle:publish",
]);
export const LOCAL_SESSION_SCOPES: readonly LocalSessionScope[] = Object.freeze([
  ...LOCAL_SESSION_RUNTIME_SCOPES, "local_session:bootstrap",
]);
const SCOPES = new Set<LocalSessionScope>(LOCAL_SESSION_SCOPES);

export class LocalSessionCapabilityError extends Error {
  constructor() {
    super("Local session capability rejected");
    this.name = "LocalSessionCapabilityError";
  }
}

function fail(): never {
  throw new LocalSessionCapabilityError();
}

function exact(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== allowed.length
    || Object.keys(value).some((key) => !allowed.includes(key))) fail();
}

export function localSessionSigningKey(value: unknown): Buffer {
  if (typeof value !== "string") fail();
  const key = Buffer.from(value, "base64");
  if (key.byteLength !== 32 || key.toString("base64") !== value) fail();
  return key;
}

function validClaims(value: unknown): LocalSessionClaims {
  exact(value, [
    "version", "kind", "sessionRef", "nonce", "workspaceId", "workspaceRef", "userId",
    "readerRef", "scopes", "issuedAt", "expiresAt", "osUid",
  ]);
  if (value.version !== 1 || (value.kind !== "bootstrap" && value.kind !== "session")
    || typeof value.sessionRef !== "string" || !SESSION.test(value.sessionRef)
    || typeof value.nonce !== "string" || !NONCE.test(value.nonce)
    || typeof value.workspaceId !== "string" || !UUID.test(value.workspaceId)
    || typeof value.workspaceRef !== "string" || !REF.test(value.workspaceRef)
    || typeof value.userId !== "string" || !UUID.test(value.userId)
    || typeof value.readerRef !== "string" || !REF.test(value.readerRef)
    || !Array.isArray(value.scopes) || value.scopes.length < 1 || value.scopes.length > LOCAL_SESSION_RUNTIME_SCOPES.length
    || new Set(value.scopes).size !== value.scopes.length
    || value.scopes.some((scope) => typeof scope !== "string" || !SCOPES.has(scope as LocalSessionScope))
    || !Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt)
    || !Number.isSafeInteger(value.osUid) || (value.osUid as number) < 0
    || (value.expiresAt as number) <= (value.issuedAt as number)) fail();
  const scopes = [...value.scopes] as LocalSessionScope[];
  const expected = value.kind === "bootstrap" ? ["local_session:bootstrap"] : LOCAL_SESSION_RUNTIME_SCOPES;
  if (JSON.stringify(scopes) !== JSON.stringify(expected)) fail();
  return Object.freeze({ ...(value as unknown as LocalSessionClaims), scopes: Object.freeze(scopes) });
}

function payload(claims: LocalSessionClaims): string {
  return Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
}

export function mintLocalSessionCapability(input: Readonly<{
  kind: LocalSessionKind;
  workspaceId: string;
  workspaceRef: string;
  userId: string;
  readerRef: string;
  osUid: number;
  issuedAt: number;
  expiresAt: number;
  sessionRef?: string;
  nonce?: string;
}>, key: Buffer): Readonly<{ token: string; claims: LocalSessionClaims }> {
  if (key.byteLength !== 32) fail();
  const claims = validClaims({
    version: 1,
    kind: input.kind,
    sessionRef: input.sessionRef ?? `session_${randomBytes(16).toString("hex")}`,
    nonce: input.nonce ?? randomBytes(32).toString("hex"),
    workspaceId: input.workspaceId.toLowerCase(),
    workspaceRef: input.workspaceRef,
    userId: input.userId.toLowerCase(),
    readerRef: input.readerRef,
    scopes: input.kind === "bootstrap" ? ["local_session:bootstrap"] as const : LOCAL_SESSION_RUNTIME_SCOPES,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    osUid: input.osUid,
  });
  const encoded = payload(claims);
  const signature = createHmac("sha256", key).update(`rzs1.${encoded}`).digest("base64url");
  return Object.freeze({ token: `rzs1.${encoded}.${signature}`, claims });
}

export function verifyLocalSessionCapability(input: Readonly<{
  token: unknown;
  key: Buffer;
  now: number;
  osUid: number;
  requiredScope: LocalSessionScope;
  expected: Readonly<{ workspaceId: string; workspaceRef: string; userId: string; readerRef: string }>;
}>): LocalSessionClaims {
  if (typeof input.token !== "string" || input.key.byteLength !== 32) fail();
  const match = TOKEN.exec(input.token);
  if (!match) fail();
  const expectedSignature = createHmac("sha256", input.key).update(`rzs1.${match[1]}`).digest();
  let actualSignature: Buffer;
  try {
    actualSignature = Buffer.from(match[2]!, "base64url");
  } catch {
    fail();
  }
  if (actualSignature.toString("base64url") !== match[2]
    || actualSignature.byteLength !== expectedSignature.byteLength
    || !timingSafeEqual(actualSignature, expectedSignature)) fail();
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(match[1]!, "base64url").toString("utf8"));
  } catch {
    fail();
  }
  const claims = validClaims(decoded);
  if (!Number.isSafeInteger(input.now) || claims.issuedAt > input.now + 30 || claims.expiresAt <= input.now
    || claims.expiresAt - claims.issuedAt > (claims.kind === "bootstrap" ? 120 : 28_800)
    || claims.osUid !== input.osUid || !claims.scopes.includes(input.requiredScope)
    || claims.workspaceId !== input.expected.workspaceId.toLowerCase()
    || claims.workspaceRef !== input.expected.workspaceRef
    || claims.userId !== input.expected.userId.toLowerCase()
    || claims.readerRef !== input.expected.readerRef) fail();
  return claims;
}

export function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization === null) return null;
  const match = /^Bearer (rzs1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization);
  if (!match) fail();
  return match[1]!;
}

export function cookieToken(request: Request): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  const matches = cookie.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${LOCAL_SESSION_COOKIE}=`));
  if (matches.length !== 1) fail();
  return decodeURIComponent(matches[0]!.slice(LOCAL_SESSION_COOKIE.length + 1));
}
