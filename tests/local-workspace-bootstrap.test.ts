import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  bootstrapLocalWorkspace,
  localWorkspaceBootstrapIdentity,
  writeLocalWorkspaceSessionConfig,
  type BootstrapQueryClient,
} from "@/server/local-workspace-bootstrap";

const roots: string[] = [];
const userId = "11111111-1111-4111-a111-111111111111";
const workspaceId = "22222222-2222-4222-a222-222222222222";

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function identity(overrides: Record<string, string> = {}) {
  return localWorkspaceBootstrapIdentity(overrides);
}

function fakeClient(mode: "missing" | "existing") {
  const calls: Array<Readonly<{ text: string; values?: readonly unknown[] }>> = [];
  let binding = mode === "existing";
  const client: { query: BootstrapQueryClient["query"]; release(): void } = {
    async query<Row extends Record<string, unknown>>(text: string, values?: readonly unknown[]) {
      calls.push({ text, values });
      let rows: readonly Record<string, unknown>[] = [];
      if (text.includes("from users app_user")) rows = binding ? [{ user_id: userId, workspace_id: workspaceId }] : [];
      else if (text.startsWith("insert into users")) rows = [{ id: userId }];
      else if (text.startsWith("insert into workspaces")) rows = [{ id: workspaceId }];
      else if (text.startsWith("insert into memberships")) binding = true;
      return { rows: rows as readonly Row[] };
    },
    release() {},
  };
  return { pool: { connect: async () => client }, client, calls };
}

describe("local workspace bootstrap", () => {
  it("is read-only by default and returns no invented identifiers", async () => {
    const fake = fakeClient("missing");
    const result = await bootstrapLocalWorkspace({ pool: fake.pool, identity: identity(), apply: false });
    expect(result).toEqual({ status: "would_create" });
    expect(fake.calls[0]?.text).toContain("read only");
    expect(fake.calls.some((call) => call.text.startsWith("insert"))).toBe(false);
  });

  it("reuses only the exact active owner binding without mutations", async () => {
    const fake = fakeClient("existing");
    const result = await bootstrapLocalWorkspace({ pool: fake.pool, identity: identity(), apply: true });
    expect(result).toEqual({ status: "existing", workspaceId, userId });
    expect(fake.calls.some((call) => call.text.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(fake.calls.some((call) => call.text.startsWith("insert"))).toBe(false);
  });

  it("uses bound parameters for hostile-looking but valid display values", async () => {
    const fake = fakeClient("missing");
    const malicious = identity({
      REKLAMZEKA_BOOTSTRAP_USER_EMAIL: "owner+drop@example.invalid",
      REKLAMZEKA_BOOTSTRAP_WORKSPACE_NAME: "Local'); drop table users; --",
    });
    await bootstrapLocalWorkspace({ pool: fake.pool, identity: malicious, apply: true, now: () => new Date("2026-08-07T12:00:00Z") });
    expect(fake.calls.some((call) => call.text.includes(malicious.workspaceName))).toBe(false);
    expect(fake.calls.some((call) => call.values?.includes(malicious.workspaceName))).toBe(true);
  });

  it("creates once and resolves the same exact binding on restart", async () => {
    const fake = fakeClient("missing");
    const first = await bootstrapLocalWorkspace({ pool: fake.pool, identity: identity(), apply: true });
    const second = await bootstrapLocalWorkspace({ pool: fake.pool, identity: identity(), apply: true });
    expect(first).toEqual({ status: "created", workspaceId, userId });
    expect(second).toEqual({ status: "existing", workspaceId, userId });
    expect(fake.calls.filter((call) => call.text.startsWith("insert into workspaces"))).toHaveLength(1);
    expect(fake.calls.filter((call) => call.text.includes("insert into audit_events"))).toHaveLength(1);
  });

  it("rolls back the transaction when the audit write is rejected", async () => {
    const fake = fakeClient("missing");
    const original = fake.client.query.bind(fake.client);
    fake.client.query = async <Row extends Record<string, unknown>>(text: string, values?: readonly unknown[]) => {
      if (text.includes("insert into audit_events")) throw new Error("fixture failure");
      return original<Row>(text, values);
    };
    await expect(bootstrapLocalWorkspace({ pool: fake.pool, identity: identity(), apply: true })).rejects.toThrow();
    expect(fake.calls.at(-1)?.text).toBe("rollback");
    expect(fake.calls.some((call) => call.text === "commit")).toBe(false);
  });

  it("writes only non-secret bindings into a private ignored artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "reklamzeka-local-workspace-"));
    roots.push(root);
    const path = await writeLocalWorkspaceSessionConfig({
      baseDirectory: root,
      identity: identity(),
      result: { status: "created", workspaceId, userId },
    });
    const body = await readFile(path, "utf8");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(body).toContain(`REKLAMZEKA_LOCAL_WORKSPACE_ID=${workspaceId}`);
    expect(body).not.toMatch(/SIGNING|TOKEN|SECRET/);
  });

  it("rejects non-loopback origin, control characters, and malformed refs", () => {
    expect(() => identity({ REKLAMZEKA_BOOTSTRAP_LOCAL_ORIGIN: "https://example.com" })).toThrow();
    expect(() => identity({ REKLAMZEKA_BOOTSTRAP_WORKSPACE_NAME: "bad\nname" })).toThrow();
    expect(() => identity({ REKLAMZEKA_BOOTSTRAP_WORKSPACE_REF: "workspace" })).toThrow();
  });
});
