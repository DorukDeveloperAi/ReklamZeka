import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { localSessionSigningKey, mintLocalSessionCapability, type LocalSessionClaims } from
  "@/security/local-session-capability";

const MAX_ENV_BYTES = 65_536;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$/;
const ALLOWED = new Set([
  "REKLAMZEKA_LOCAL_SESSION_ENABLED",
  "REKLAMZEKA_LOCAL_ORIGIN",
  "REKLAMZEKA_LOCAL_WORKSPACE_ID",
  "REKLAMZEKA_LOCAL_WORKSPACE_REF",
  "REKLAMZEKA_LOCAL_USER_ID",
  "REKLAMZEKA_LOCAL_READER_REF",
  "REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY",
]);

export class PrivateLocalEnvironmentError extends Error {
  constructor() { super("Private local MCP environment rejected"); this.name = "PrivateLocalEnvironmentError"; }
}
function fail(): never { throw new PrivateLocalEnvironmentError(); }

function value(source: string): string {
  const trimmed = source.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) return trimmed.slice(1, -1);
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/\\([\\"nrt])/g, (_match, escaped: string) =>
      escaped === "n" ? "\n" : escaped === "r" ? "\r" : escaped === "t" ? "\t" : escaped);
  }
  return trimmed.replace(/\s+#.*$/, "");
}

function parseWhitelisted(source: string): Readonly<Record<string, string>> {
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trimStart();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (!match) continue;
    const key = match[1]!;
    // Values of every non-whitelisted key remain unread and unparsed.
    if (!ALLOWED.has(key)) continue;
    if (Object.hasOwn(result, key)) fail();
    result[key] = value(line.slice(match[0].length));
  }
  return Object.freeze(result);
}

function privateFile(path: string): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : -1;
  if (uid < 0) fail();
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.uid !== uid || (before.mode & 0o077) !== 0
    || before.size < 1 || before.size > MAX_ENV_BYTES) fail();
  let descriptor = -1;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const after = fstatSync(descriptor);
    if (!after.isFile() || after.uid !== uid || (after.mode & 0o077) !== 0
      || after.dev !== before.dev || after.ino !== before.ino || after.size > MAX_ENV_BYTES) fail();
    return readFileSync(descriptor, "utf8");
  } finally {
    if (descriptor >= 0) closeSync(descriptor);
  }
}

function loopbackOrigin(input: unknown): string {
  if (typeof input !== "string") fail();
  let origin: URL;
  try { origin = new URL(input); } catch { return fail(); }
  if (!(origin.hostname === "localhost" || origin.hostname === "127.0.0.1" || origin.hostname === "[::1]")
    || !(origin.protocol === "http:" || origin.protocol === "https:")
    || origin.protocol === "http:" && origin.hostname !== "localhost"
    || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) fail();
  return origin.origin;
}

export type PrivateLocalMcpRuntime = Readonly<{
  origin: string;
  token: string;
  claims: LocalSessionClaims;
}>;

/** Loads only the seven namespaced MCP bindings and mints one process-memory capability. */
export function loadPrivateLocalMcpRuntime(input: Readonly<{
  path: string;
  now?: number;
  osUid?: number;
}>): PrivateLocalMcpRuntime {
  const environment = parseWhitelisted(privateFile(input.path));
  const uid = input.osUid ?? (typeof process.getuid === "function" ? process.getuid() : -1);
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const workspaceId = environment.REKLAMZEKA_LOCAL_WORKSPACE_ID;
  const userId = environment.REKLAMZEKA_LOCAL_USER_ID;
  const workspaceRef = environment.REKLAMZEKA_LOCAL_WORKSPACE_REF;
  const readerRef = environment.REKLAMZEKA_LOCAL_READER_REF;
  if (environment.REKLAMZEKA_LOCAL_SESSION_ENABLED !== "true" || uid < 0 || !Number.isSafeInteger(now)
    || !workspaceId || !UUID.test(workspaceId) || !userId || !UUID.test(userId)
    || !workspaceRef || !REF.test(workspaceRef) || !readerRef || !REF.test(readerRef)) fail();
  const minted = mintLocalSessionCapability({ kind: "session", workspaceId, workspaceRef, userId, readerRef,
    osUid: uid, issuedAt: now, expiresAt: now + 28_800 },
  localSessionSigningKey(environment.REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY));
  return Object.freeze({ origin: loopbackOrigin(environment.REKLAMZEKA_LOCAL_ORIGIN), ...minted });
}
