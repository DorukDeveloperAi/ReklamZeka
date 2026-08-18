import { describe, expect, it, vi } from "vitest";

import { ConnectorError } from "@/connectors/contract";
import { P06MetaStatusWriter } from "@/connectors/meta/p06-meta-status-writer";
import type { MetaFetch } from "@/connectors/meta/graph-client";
import {
  p06ExecutionV2Digest,
  runP06ExecutionV2,
  type P06ExecutionV2Control,
  type P06ExecutionV2Request,
} from "@/domain/actions/p06-execution-v2";

const fixedNow = new Date("2026-08-18T10:00:00.000Z");
const hash = p06ExecutionV2Digest;
const receipt = <T extends Readonly<Record<string, unknown>>>(core: T) =>
  Object.freeze({ core, receiptHash: hash(core) });
const control: P06ExecutionV2Control = Object.freeze({
  gate: vi.fn(async ({ phase, request: current }) => ({
    enabled: true,
    killSwitch: false,
    workspaceAllowlist: [current.workspaceRef],
    accountAllowlist: [current.accountRef],
    actionAllowlist: [current.action],
    snapshotHash: hash({ phase }),
    capturedAt: fixedNow.toISOString(),
  })),
  claim: vi.fn(async (input) => receipt({ ...input, owned: true as const })),
  idempotency: vi.fn(async (input) =>
    receipt({ kind: "fresh" as const, ...input }),
  ),
  terminal: vi.fn(async (input) => receipt(input)),
  release: vi.fn(async (input) =>
    receipt({ ...input, released: true as const }),
  ),
});
const request: P06ExecutionV2Request = Object.freeze({
  executionRef: "p06_execution_aaaaaaaaaaaaaaaaaaaaaaaa",
  workspaceRef: "workspace_aaaaaaaaaaaaaaaa",
  accountRef: "act_12345",
  entityRef: "adset_12345",
  action: "status_pause",
  expectedBefore: Object.freeze({ status: "ACTIVE", budgetMinor: null }),
  desired: Object.freeze({ status: "PAUSED", budgetMinor: null }),
  leaseTokenHash: "1".repeat(64),
  fenceHash: "2".repeat(64),
  evaluatedAt: "2026-08-18T09:59:00.000Z",
});

describe("P06MetaStatusWriter", () => {
  it("reads the exact Meta entity without leaking the token into evidence", async () => {
    const fetchImpl = vi.fn<MetaFetch>(
      async () =>
        new Response(
          JSON.stringify({
            id: "12345",
            status: "ACTIVE",
            effective_status: "ACTIVE",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    const writer = new P06MetaStatusWriter("secret-token", fetchImpl, {
      now: () => fixedNow,
    });

    const evidence = await writer.read({
      workspaceRef: request.workspaceRef,
      accountRef: request.accountRef,
      entityRef: request.entityRef,
      action: request.action,
    });

    expect(evidence.core).toMatchObject({
      entityRef: "adset_12345",
      value: { status: "ACTIVE", budgetMinor: null },
      observedAt: fixedNow.toISOString(),
    });
    expect(evidence.receiptHash).toMatch(/^[a-f0-9]{64}$/);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://graph.facebook.com/v23.0/12345?fields=id,status,effective_status",
    );
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer secret-token",
    );
    expect(JSON.stringify(evidence)).not.toContain("secret-token");
  });

  it("performs one typed status mutation and returns only hashed RAW evidence", async () => {
    const fetchImpl = vi.fn<MetaFetch>(
      async () =>
        new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    const writer = new P06MetaStatusWriter("secret-token", fetchImpl, {
      now: () => fixedNow,
    });
    const receipt = await writer.write({
      request,
      idempotencyKey: `p06_exec_idem_${"3".repeat(64)}`,
    });

    expect(receipt.core).toMatchObject({
      action: "status_pause",
      entityRef: "adset_12345",
      kind: "written",
    });
    expect(receipt.core.rawHash).toMatch(/^[a-f0-9]{64}$/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://graph.facebook.com/v23.0/12345");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe("status=PAUSED");
    expect(JSON.stringify(receipt)).not.toContain("secret-token");
  });

  it("reads and writes only the authenticated daily or lifetime budget field", async () => {
    const fetchImpl = vi.fn<MetaFetch>(async (_url, init) => init?.method === "GET"
      ? new Response(JSON.stringify({ id:"12345", status:"ACTIVE", effective_status:"ACTIVE", lifetime_budget:"10000" }), {status:200})
      : new Response(JSON.stringify({success:true}), {status:200}));
    const writer = new P06MetaStatusWriter("secret-token", fetchImpl, {now:()=>fixedNow});
    const budgetRequest: P06ExecutionV2Request = Object.freeze({ ...request, action:"budget_decrease", budgetKind:"lifetime",
      currency:"TRY", expectedBefore:Object.freeze({status:"ACTIVE",budgetMinor:10000}), desired:Object.freeze({status:"ACTIVE",budgetMinor:9000}) });
    const evidence = await writer.read({workspaceRef:budgetRequest.workspaceRef,accountRef:budgetRequest.accountRef,
      entityRef:budgetRequest.entityRef,action:budgetRequest.action,budgetKind:budgetRequest.budgetKind,currency:budgetRequest.currency});
    expect(evidence.core.value).toEqual({status:"ACTIVE",budgetMinor:10000});
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("fields=id,status,effective_status,lifetime_budget");
    await writer.write({request:budgetRequest,idempotencyKey:`p06_exec_idem_${"4".repeat(64)}`});
    expect(fetchImpl.mock.calls[1]?.[1]?.body).toBe("lifetime_budget=9000");
  });

  it("never retries an ambiguous mutation transport", async () => {
    const fetchImpl = vi.fn<MetaFetch>(async () => {
      throw new Error("socket closed after dispatch secret-token");
    });
    const writer = new P06MetaStatusWriter("secret-token", fetchImpl, {
      now: () => fixedNow,
    });
    const receipt = await writer.write({
      request,
      idempotencyKey: "3".repeat(64),
    });

    expect(receipt.core.kind).toBe("ambiguous_transport");
    expect(receipt.core.rawHash).toMatch(/^[a-f0-9]{64}$/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(receipt)).not.toContain("secret-token");
  });

  it("fails closed for budget, raw/create, foreign target and definite Meta rejection", async () => {
    const fetchImpl = vi.fn<MetaFetch>(
      async () =>
        new Response(JSON.stringify({ error: { message: "denied" } }), {
          status: 400,
        }),
    );
    const writer = new P06MetaStatusWriter("secret-token", fetchImpl, {
      now: () => fixedNow,
    });

    await expect(
      writer.read({
        workspaceRef: request.workspaceRef,
        accountRef: request.accountRef,
        entityRef: "ad_12345",
        action: request.action,
      }),
    ).rejects.toBeInstanceOf(ConnectorError);
    await expect(
      writer.write({
        request: { ...request, action: "budget_decrease" } as unknown as P06ExecutionV2Request,
        idempotencyKey: "3".repeat(64),
      }),
    ).rejects.toBeInstanceOf(ConnectorError);
    await expect(
      writer.write({ request, idempotencyKey: "3".repeat(64) }),
    ).rejects.toMatchObject({ code: "invalid_data" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("treats a 5xx or success-without-confirmation as ambiguous, not retryable success", async () => {
    const responses = [
      new Response(JSON.stringify({ error: { message: "unknown" } }), {
        status: 503,
      }),
      new Response(JSON.stringify({ id: "12345" }), { status: 200 }),
    ];
    const fetchImpl = vi.fn<MetaFetch>(async () => responses.shift()!);
    const writer = new P06MetaStatusWriter("secret-token", fetchImpl, {
      now: () => fixedNow,
    });

    expect(
      (await writer.write({ request, idempotencyKey: "3".repeat(64) })).core
        .kind,
    ).toBe("ambiguous_transport");
    expect(
      (await writer.write({ request, idempotencyKey: "4".repeat(64) })).core
        .kind,
    ).toBe("ambiguous_transport");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("executes one real transport mutation through the ten-step state machine", async () => {
    const responses = [
      new Response(JSON.stringify({ id: "12345", status: "ACTIVE" }), {
        status: 200,
      }),
      new Response(JSON.stringify({ success: true }), { status: 200 }),
      new Response(JSON.stringify({ id: "12345", status: "PAUSED" }), {
        status: 200,
      }),
    ];
    const fetchImpl = vi.fn<MetaFetch>(async () => responses.shift()!);
    const writer = new P06MetaStatusWriter("secret-token", fetchImpl, {
      now: () => fixedNow,
    });

    const result = await runP06ExecutionV2({ request, writer, control });

    expect(result.outcome).toBe("written_verified");
    expect(result.writes).toBe(1);
    expect(result.trace).toHaveLength(10);
    expect(
      fetchImpl.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
  });

  it("resolves an ambiguous POST by reading desired state without a second mutation", async () => {
    let call = 0;
    const fetchImpl = vi.fn<MetaFetch>(async (_input, init) => {
      call += 1;
      if (init?.method === "POST")
        throw new Error("connection reset after dispatch");
      return new Response(
        JSON.stringify({
          id: "12345",
          status: call === 1 ? "ACTIVE" : "PAUSED",
        }),
        { status: 200 },
      );
    });
    const writer = new P06MetaStatusWriter("secret-token", fetchImpl, {
      now: () => fixedNow,
    });

    const result = await runP06ExecutionV2({ request, writer, control });

    expect(result.outcome).toBe("ambiguous_resolved");
    expect(result.writes).toBe(1);
    expect(
      result.trace.find((entry) => entry.step === "ambiguous_read_before_retry")
        ?.outcome,
    ).toBe("ok");
    expect(
      fetchImpl.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
  });
});
