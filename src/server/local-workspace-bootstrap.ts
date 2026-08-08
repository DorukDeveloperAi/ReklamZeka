import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";

export type BootstrapIdentity = Readonly<{
  email: string;
  workspaceName: string;
  workspaceRef: string;
  readerRef: string;
  origin: string;
}>;

export type BootstrapResult = Readonly<{
  status: "would_create" | "existing" | "created";
  workspaceId?: string;
  userId?: string;
}>;

type QueryResult<Row extends Record<string, unknown> = Record<string, unknown>> = Readonly<{
  rows: readonly Row[];
  rowCount?: number | null;
}>;

export type BootstrapQueryClient = Readonly<{
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}>;

export type BootstrapPool = Readonly<{
  connect(): Promise<BootstrapQueryClient & Readonly<{ release(): void }>>;
}>;

type BindingRow = Readonly<{ user_id: string; workspace_id: string }>;
type IdRow = Readonly<{ id: string }>;

const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/;
const OPAQUE_REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCK_NAMESPACE = "reklamzeka.local-workspace-bootstrap.v1";

export class LocalWorkspaceBootstrapError extends Error {
  constructor(readonly code: "invalid_identity" | "ambiguous_identity" | "database_rejected" | "unsafe_config_path") {
    super(`Local workspace bootstrap rejected: ${code}`);
    this.name = "LocalWorkspaceBootstrapError";
  }
}

function invalid(): never {
  throw new LocalWorkspaceBootstrapError("invalid_identity");
}

function exactKeys(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== allowed.length
    || Object.keys(value).some((key) => !allowed.includes(key))) invalid();
}

function cleanText(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value !== value.trim() || value.length < 1 || value.length > maximum
    || /[\u0000-\u001f\u007f]/.test(value)) invalid();
  return value;
}

export function localWorkspaceBootstrapIdentity(environment: Readonly<Record<string, string | undefined>>): BootstrapIdentity {
  const email = (environment.REKLAMZEKA_BOOTSTRAP_USER_EMAIL ?? "local-owner@reklamzeka.invalid").trim().toLowerCase();
  const workspaceName = (environment.REKLAMZEKA_BOOTSTRAP_WORKSPACE_NAME ?? "ReklamZeka Local").trim();
  const workspaceRef = environment.REKLAMZEKA_BOOTSTRAP_WORKSPACE_REF ?? "workspace_local";
  const readerRef = environment.REKLAMZEKA_BOOTSTRAP_READER_REF ?? "reader_local_owner";
  const rawOrigin = environment.REKLAMZEKA_BOOTSTRAP_LOCAL_ORIGIN ?? "http://localhost:3000";
  cleanText(email, 320);
  cleanText(workspaceName, 120);
  if (!EMAIL.test(email) || !OPAQUE_REF.test(workspaceRef) || !OPAQUE_REF.test(readerRef)) invalid();
  let origin: URL;
  try {
    origin = new URL(rawOrigin);
  } catch {
    return invalid();
  }
  if (origin.origin !== rawOrigin || origin.protocol !== "http:" || origin.hostname !== "localhost"
    || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) invalid();
  return Object.freeze({ email, workspaceName, workspaceRef, readerRef, origin: origin.origin });
}

function assertIdentity(identity: BootstrapIdentity): void {
  exactKeys(identity, ["email", "workspaceName", "workspaceRef", "readerRef", "origin"]);
  const expected = localWorkspaceBootstrapIdentity({
    REKLAMZEKA_BOOTSTRAP_USER_EMAIL: identity.email,
    REKLAMZEKA_BOOTSTRAP_WORKSPACE_NAME: identity.workspaceName,
    REKLAMZEKA_BOOTSTRAP_WORKSPACE_REF: identity.workspaceRef,
    REKLAMZEKA_BOOTSTRAP_READER_REF: identity.readerRef,
    REKLAMZEKA_BOOTSTRAP_LOCAL_ORIGIN: identity.origin,
  });
  if (Object.keys(expected).some((key) => (
    expected[key as keyof BootstrapIdentity] !== identity[key as keyof BootstrapIdentity]
  ))) invalid();
}

const FIND_BINDING = `
  select app_user.id::text as user_id, workspace.id::text as workspace_id
  from users app_user
  join memberships membership on membership.user_id = app_user.id
  join workspaces workspace on workspace.id = membership.workspace_id
  where app_user.email = $1
    and workspace.name = $2
    and membership.role = 'owner'
    and workspace.lifecycle_state = 'active'
  order by workspace.id
  limit 2
`;

async function exactBinding(client: BootstrapQueryClient, identity: BootstrapIdentity): Promise<BindingRow | null> {
  const result = await client.query<BindingRow>(FIND_BINDING, [identity.email, identity.workspaceName]);
  if (result.rows.length > 1) throw new LocalWorkspaceBootstrapError("ambiguous_identity");
  const row = result.rows[0];
  if (!row) return null;
  if (!UUID.test(row.user_id) || !UUID.test(row.workspace_id)) {
    throw new LocalWorkspaceBootstrapError("database_rejected");
  }
  return row;
}

/**
 * Resolves only the exact email + active workspace name + owner binding. It
 * never adopts, renames, reactivates, or changes a foreign workspace/member.
 */
export async function bootstrapLocalWorkspace(input: Readonly<{
  pool: BootstrapPool;
  identity: BootstrapIdentity;
  apply: boolean;
  now?: () => Date;
}>): Promise<BootstrapResult> {
  exactKeys(input, ["pool", "identity", "apply", ...(input.now ? ["now"] : [])]);
  assertIdentity(input.identity);
  if (typeof input.apply !== "boolean" || (input.now !== undefined && typeof input.now !== "function")) invalid();
  const client = await input.pool.connect();
  let committed = false;
  try {
    await client.query(input.apply
      ? "begin isolation level serializable read write"
      : "begin isolation level serializable read only");
    const result = await bootstrapLocalWorkspaceInTransaction({
      client, identity: input.identity, apply: input.apply, now: input.now,
    });
    await client.query("commit");
    committed = true;
    return result;
  } catch (error) {
    if (!committed) await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Transaction body exposed for rollback-only applied database verification. */
export async function bootstrapLocalWorkspaceInTransaction(input: Readonly<{
  client: BootstrapQueryClient;
  identity: BootstrapIdentity;
  apply: boolean;
  now?: () => Date;
}>): Promise<BootstrapResult> {
  assertIdentity(input.identity);
  if (typeof input.apply !== "boolean" || (input.now !== undefined && typeof input.now !== "function")) invalid();
  if (input.apply) {
    await input.client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
      JSON.stringify([LOCK_NAMESPACE, input.identity.email, input.identity.workspaceName]),
    ]);
  }
  const existing = await exactBinding(input.client, input.identity);
  if (existing) {
    return Object.freeze({ status: "existing", workspaceId: existing.workspace_id, userId: existing.user_id });
  }
  if (!input.apply) return Object.freeze({ status: "would_create" });

  const users = await input.client.query<IdRow>(
    "select id::text as id from users where email = $1 order by id limit 2",
    [input.identity.email],
  );
  if (users.rows.length > 1) throw new LocalWorkspaceBootstrapError("ambiguous_identity");
  const createdUser = users.rows.length === 0;
  const user = users.rows[0] ?? (await input.client.query<IdRow>(
    "insert into users (email) values ($1) returning id::text as id",
    [input.identity.email],
  )).rows[0];
  if (!user || !UUID.test(user.id)) throw new LocalWorkspaceBootstrapError("database_rejected");

  // A same-named foreign workspace is deliberately not selected. This new
  // workspace becomes identifiable only through the exact owner binding.
  const workspace = (await input.client.query<IdRow>(
    "insert into workspaces (name) values ($1) returning id::text as id",
    [input.identity.workspaceName],
  )).rows[0];
  if (!workspace || !UUID.test(workspace.id)) throw new LocalWorkspaceBootstrapError("database_rejected");
  await input.client.query(
    "insert into memberships (workspace_id, user_id, role) values ($1::uuid, $2::uuid, 'owner')",
    [workspace.id, user.id],
  );

  const occurredAt = (input.now?.() ?? new Date()).toISOString();
  const previousHash = "GENESIS";
  const auditBody = {
    workspaceId: workspace.id,
    actorId: user.id,
    action: "local_workspace.bootstrap_created",
    resourceType: "workspace",
    resourceId: "local-workspace-bootstrap",
    occurredAt,
    metadata: { version: 1, createdUser },
    previousHash,
  };
  const eventHash = createHash("sha256").update(JSON.stringify(auditBody)).digest("hex");
  await input.client.query(`
      insert into audit_events (
        workspace_id, actor_id, action, resource_type, resource_id, metadata,
        previous_hash, event_hash, occurred_at
      ) values ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, $7, $8, $9::timestamptz)
  `, [workspace.id, user.id, auditBody.action, auditBody.resourceType, auditBody.resourceId,
    JSON.stringify(auditBody.metadata), previousHash, eventHash, occurredAt]);

  const resolved = await exactBinding(input.client, input.identity);
  if (!resolved || resolved.workspace_id !== workspace.id || resolved.user_id !== user.id) {
    throw new LocalWorkspaceBootstrapError("database_rejected");
  }
  return Object.freeze({ status: "created", workspaceId: workspace.id, userId: user.id });
}

function configBody(identity: BootstrapIdentity, result: BootstrapResult): string {
  if (!result.workspaceId || !result.userId) throw new LocalWorkspaceBootstrapError("database_rejected");
  return [
    "# Generated by npm run local-workspace:bootstrap -- --apply",
    "# Server-private, secret-free identity binding. Do not commit.",
    "REKLAMZEKA_LOCAL_SESSION_ENABLED=true",
    `REKLAMZEKA_LOCAL_ORIGIN=${identity.origin}`,
    `REKLAMZEKA_LOCAL_WORKSPACE_ID=${result.workspaceId}`,
    `REKLAMZEKA_LOCAL_WORKSPACE_REF=${identity.workspaceRef}`,
    `REKLAMZEKA_LOCAL_USER_ID=${result.userId}`,
    `REKLAMZEKA_LOCAL_READER_REF=${identity.readerRef}`,
    "",
  ].join("\n");
}

/** Writes no signing key and prints no IDs. The existing env model can source/copy this file. */
export async function writeLocalWorkspaceSessionConfig(input: Readonly<{
  baseDirectory: string;
  identity: BootstrapIdentity;
  result: BootstrapResult;
}>): Promise<string> {
  const osUid = typeof process.getuid === "function" ? process.getuid() : -1;
  if (osUid < 0) throw new LocalWorkspaceBootstrapError("unsafe_config_path");
  const directory = resolve(input.baseDirectory, ".reklamzeka");
  await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  const directoryStat = await lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || directoryStat.uid !== osUid
    || (directoryStat.mode & 0o077) !== 0) throw new LocalWorkspaceBootstrapError("unsafe_config_path");
  const target = resolve(directory, "local-session-config");
  try {
    const targetStat = await lstat(target);
    if (!targetStat.isFile() || targetStat.isSymbolicLink() || targetStat.uid !== osUid
      || (targetStat.mode & 0o077) !== 0) throw new LocalWorkspaceBootstrapError("unsafe_config_path");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = resolve(directory, `.local-session-config.${process.pid}.${Date.now()}.tmp`);
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(configBody(input.identity, input.result), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return target;
}
