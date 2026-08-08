import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mintLocalSessionCapability } from "@/security/local-session-capability";
import {
  consumeLocalSessionBootstrap,
  registerLocalSessionBootstrap,
} from "@/security/local-session-bootstrap-store";

const roots: string[] = [];

async function temporaryRoot() {
  const path = await mkdtemp(join(tmpdir(), "reklamzeka-bootstrap-test-"));
  roots.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function proof(now = 1_786_100_000) {
  return mintLocalSessionCapability({
    kind: "bootstrap",
    workspaceId: "11111111-1111-4111-a111-111111111111",
    workspaceRef: "workspace_local",
    userId: "22222222-2222-4222-a222-222222222222",
    readerRef: "reader_local_owner",
    osUid: process.getuid!(),
    issuedAt: now,
    expiresAt: now + 90,
  }, Buffer.alloc(32, 4));
}

describe("local session bootstrap proof store", () => {
  it("consumes a 0600 proof exactly once across process-local state", async () => {
    const base = await temporaryRoot();
    const value = proof();
    await registerLocalSessionBootstrap(value.claims, value.token, base);
    await expect(consumeLocalSessionBootstrap(value.claims, value.token, value.claims.issuedAt + 1, base))
      .resolves.toBeUndefined();
    await expect(consumeLocalSessionBootstrap(value.claims, value.token, value.claims.issuedAt + 1, base))
      .rejects.toThrow();
  });

  it("rejects a symlinked controlled parent instead of traversing it", async () => {
    const base = await temporaryRoot();
    const target = await temporaryRoot();
    await mkdir(join(target, "redirect"), { mode: 0o700 });
    await symlink(join(target, "redirect"), join(base, ".reklamzeka"));
    const value = proof();
    await expect(registerLocalSessionBootstrap(value.claims, value.token, base)).rejects.toThrow();
  });
});
