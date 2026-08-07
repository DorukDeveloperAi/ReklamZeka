import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import {
  bootstrapLocalWorkspaceInTransaction,
  localWorkspaceBootstrapIdentity,
  type BootstrapQueryClient,
} from "../src/server/local-workspace-bootstrap";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("Database connection is not configured");

const suffix = randomBytes(8).toString("hex");
const identity = localWorkspaceBootstrapIdentity({
  REKLAMZEKA_BOOTSTRAP_USER_EMAIL: `bootstrap-${suffix}@reklamzeka.invalid`,
  REKLAMZEKA_BOOTSTRAP_WORKSPACE_NAME: `Bootstrap rollback ${suffix}`,
});
const foreignEmail = `foreign-${suffix}@reklamzeka.invalid`;
const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
const client = await pool.connect();
const queryClient: BootstrapQueryClient = {
  query: async <Row extends Record<string, unknown>>(text: string, values?: readonly unknown[]) => {
    const result = await client.query(text, values as unknown[] | undefined);
    return { rows: result.rows as readonly Row[], rowCount: result.rowCount };
  },
};

let createdThenReused = false;
let exactOwnerActive = false;
let foreignTenantUntouched = false;
let auditWritten = false;
let rollbackClean = false;

try {
  await client.query("begin isolation level serializable read write");
  const foreignUser = await client.query<{ id: string }>(
    "insert into users (email) values ($1) returning id::text as id", [foreignEmail],
  );
  const foreignWorkspace = await client.query<{ id: string }>(
    "insert into workspaces (name) values ($1) returning id::text as id", [identity.workspaceName],
  );
  await client.query(
    "insert into memberships (workspace_id, user_id, role) values ($1::uuid, $2::uuid, 'owner')",
    [foreignWorkspace.rows[0]!.id, foreignUser.rows[0]!.id],
  );

  const first = await bootstrapLocalWorkspaceInTransaction({ client: queryClient, identity, apply: true });
  const second = await bootstrapLocalWorkspaceInTransaction({ client: queryClient, identity, apply: true });
  createdThenReused = first.status === "created" && second.status === "existing"
    && first.workspaceId === second.workspaceId && first.userId === second.userId;
  const exact = await client.query<{ count: number }>(`
    select count(*)::int as count
    from users app_user
    join memberships membership on membership.user_id = app_user.id
    join workspaces workspace on workspace.id = membership.workspace_id
    where app_user.email = $1 and workspace.name = $2
      and membership.role = 'owner' and workspace.lifecycle_state = 'active'
  `, [identity.email, identity.workspaceName]);
  exactOwnerActive = exact.rows[0]?.count === 1;
  const foreign = await client.query<{ count: number }>(`
    select count(*)::int as count
    from users app_user
    join memberships membership on membership.user_id = app_user.id
    join workspaces workspace on workspace.id = membership.workspace_id
    where app_user.email = $1 and workspace.id = $2::uuid
      and membership.role = 'owner' and workspace.lifecycle_state = 'active'
  `, [foreignEmail, foreignWorkspace.rows[0]!.id]);
  foreignTenantUntouched = foreign.rows[0]?.count === 1 && first.workspaceId !== foreignWorkspace.rows[0]!.id;
  const audit = await client.query<{ count: number }>(`
    select count(*)::int as count from audit_events
    where workspace_id = $1::uuid and actor_id = $2::uuid
      and action = 'local_workspace.bootstrap_created'
  `, [first.workspaceId, first.userId]);
  auditWritten = audit.rows[0]?.count === 1;
  await client.query("rollback");

  const remaining = await client.query<{ count: number }>(
    "select count(*)::int as count from users where email in ($1, $2)", [identity.email, foreignEmail],
  );
  rollbackClean = remaining.rows[0]?.count === 0;
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}

const result = { createdThenReused, exactOwnerActive, foreignTenantUntouched, auditWritten, rollbackClean };
if (Object.values(result).some((value) => !value)) throw new Error("Local workspace bootstrap verification failed");
console.log(JSON.stringify({ status: "verified", ...result }));
