import { PgDialect } from "drizzle-orm/pg-core";
import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  POLICY_BUNDLE_AGENT_TOOLS,
  PolicyBundleAgentContract,
} from "@/application/policy-bundle-agent-contract";
import type { PolicyBundleStudioResult } from "@/application/policy-bundle-studio-service";
import { createLocalPolicyBundleAgentAdapter } from "@/server/local-policy-bundle-agent-runtime";
import { localDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { mintLocalSessionCapability } from "@/security/local-session-capability";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const userId = "22222222-2222-4222-a222-222222222222";
const principal = Object.freeze({ actor: Object.freeze({ userId }), workspaceId,
  workspaceRef: "workspace_local", readerRef: "reader_local_owner" });
const membership = Object.freeze({ userId, workspaceId, role: "owner" as const });

function studioResult(): PolicyBundleStudioResult {
  return Object.freeze({
    contractVersion: "policy-bundle-studio/1.1.0",
    approvalPolicies: Object.freeze([]),
    guardrails: Object.freeze([]),
    scopeCatalog: Object.freeze({ accounts: Object.freeze([]), adSets: Object.freeze([]),
      internalCategories: Object.freeze([]) }),
    readiness: Object.freeze({ approvalPolicy: "missing" as const, guardrail: "missing" as const,
      workspaceAutonomy: "missing" as const, authenticEvidence: "evaluated_per_proposal" as const,
      compatibility: "evaluated_per_selection" as const, policyBundleReady: false, proposalReady: false as const }),
    authority: Object.freeze({ canDraft: true, canPublish: false as const, canDisable: false as const,
      canApproveAction: false as const, canGrant: false as const, canExecute: false as const, canWriteMeta: false as const }),
  });
}

describe("K4 Policy Bundle model-agnostic agent contract", () => {
  it("reads the same studio projection while removing the caller role's draft authority", async () => {
    const list = vi.fn(async () => studioResult());
    const result = await new PolicyBundleAgentContract({ list }, [membership]).execute(principal, {
      name: "policy_bundle_read", arguments: {},
    });

    expect(list).toHaveBeenCalledWith(principal);
    expect(result).toMatchObject({ contractVersion: "policy-bundle-agent-tools/1.0.0", result: {
      contractVersion: "policy-bundle-studio/1.1.0",
      readiness: { compatibility: "evaluated_per_selection", policyBundleReady: false, proposalReady: false },
      authority: { readOnly: true, canDraft: false, canPublish: false, canDisable: false,
        canApproveAction: false, canGrant: false, canExecute: false, canWriteMeta: false },
    }, authority: { readOnly: true, canDraft: false, canPublish: false, canDisable: false,
      canApproveAction: false, canGrant: false, canExecute: false, canWriteMeta: false } });
    expect(result.result.authority).not.toBe(studioResult().authority);
  });

  it("publishes one zero-argument read tool and rejects identity or mutation injection", async () => {
    const list = vi.fn(async () => studioResult());
    const contract = new PolicyBundleAgentContract({ list }, [membership]);
    expect(POLICY_BUNDLE_AGENT_TOOLS).toEqual([expect.objectContaining({
      name: "policy_bundle_read", inputSchema: { type: "object", additionalProperties: false, properties: {} },
    })]);
    expect(POLICY_BUNDLE_AGENT_TOOLS.map((tool) => tool.name).join("|")).not.toMatch(
      /draft|publish|approve|grant|execute|write/i,
    );
    for (const call of [
      { name: "policy_bundle_read", arguments: { workspaceId } },
      { name: "policy_bundle_read", arguments: { canDraft: true } },
      { name: "policy_bundle_publish", arguments: {} },
    ]) await expect(contract.execute(principal, call as never)).rejects.toMatchObject({ code: "invalid_input" });
    expect(list).not.toHaveBeenCalled();
  });

  it("denies a foreign or missing membership before the shared service is read", async () => {
    const list = vi.fn(async () => studioResult());
    await expect(new PolicyBundleAgentContract({ list }, [{ ...membership,
      workspaceId: "33333333-3333-4333-a333-333333333333" }]).execute(principal, {
      name: "policy_bundle_read", arguments: {},
    })).rejects.toMatchObject({ status: 403 });
    expect(list).not.toHaveBeenCalled();
  });
});

describe("local K4 Policy Bundle server-private agent adapter", () => {
  it("accepts a scoped CLI bearer, rebinds current membership, and returns an empty source-backed read", async () => {
    const signingKey = randomBytes(32);
    const config = localDecisionRoomConfig({ DATABASE_URL: "postgresql://local.invalid/reklamzeka",
      REKLAMZEKA_LOCAL_SESSION_ENABLED: "true", REKLAMZEKA_LOCAL_ORIGIN: "http://localhost:3000",
      REKLAMZEKA_LOCAL_WORKSPACE_ID: workspaceId, REKLAMZEKA_LOCAL_WORKSPACE_REF: principal.workspaceRef,
      REKLAMZEKA_LOCAL_USER_ID: userId, REKLAMZEKA_LOCAL_READER_REF: principal.readerRef,
      REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: signingKey.toString("base64") })!;
    const dialect = new PgDialect();
    const database = { execute: vi.fn(async (statement: Parameters<PgDialect["sqlToQuery"]>[0]) => {
      const query = dialect.sqlToQuery(statement).sql;
      if (query.includes("from memberships membership")) return { rows: [{ workspace_id: workspaceId,
        user_id: userId, role: "owner", lifecycle_state: "active" }] };
      if (query.includes("select id, lifecycle_state from workspaces")) {
        return { rows: [{ id: workspaceId, lifecycle_state: "active" }] };
      }
      return { rows: [] };
    }), transaction: vi.fn(async (operation: (transaction: unknown) => unknown) => operation(database)) };
    const now = Math.floor(Date.now() / 1000);
    const token = mintLocalSessionCapability({ kind: "session", workspaceId, workspaceRef: principal.workspaceRef,
      userId, readerRef: principal.readerRef, osUid: process.getuid!(), issuedAt: now, expiresAt: now + 300 }, signingKey).token;
    const request = new Request("http://localhost:3000/private/policy-bundle-agent", { headers: {
      Host: "localhost:3000", Authorization: `Bearer ${token}`, "Sec-Fetch-Site": "none",
    } });

    const result = await createLocalPolicyBundleAgentAdapter({ database: database as never, config })
      .execute(request, { name: "policy_bundle_read", arguments: {} });
    expect(result.result).toMatchObject({ approvalPolicies: [], guardrails: [], readiness: {
      policyBundleReady: false, proposalReady: false }, authority: { readOnly: true, canDraft: false } });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(workspaceId);
    expect(serialized).not.toContain(userId);
    expect(serialized).not.toMatch(/canonicalHash|policyHash|actorRef|rawTargeting|targetingSpec|accessToken/i);
    expect(database.execute).toHaveBeenCalled();
  });
});
