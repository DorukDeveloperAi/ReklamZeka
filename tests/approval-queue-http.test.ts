import { describe, expect, it, vi } from "vitest";

import { ApprovalQueueAgentContract } from "@/application/approval-queue-agent-contract";
import {
  ApprovalQueueReadError,
  ApprovalQueueReadService,
  type ApprovalQueueRecord,
  type ApprovalQueueRepository,
} from "@/application/approval-queue-read-service";
import { GET as disabledGet } from "@/app/api/approval-queue/route";
import {
  approvalQueueNotConfiguredResponse,
  createApprovalQueueHttpHandler,
} from "@/server/approval-queue-http";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const principal = Object.freeze({
  actor: Object.freeze({ userId: "user_viewer" }),
  workspaceId,
  workspaceRef: "workspace_public",
  readerRef: "reader_public",
});

function record(): ApprovalQueueRecord {
  return {
    unitRef: "action_unit_aaaaaaaaaaaaaaaaaaaa",
    bundleRef: "action_bundle_bbbbbbbbbbbbbbbbbbbb",
    status: "awaiting_approval",
    risk: "K2",
    actionType: "status_pause",
    accountRef: "account_0123456789abcdef",
    entity: { type: "campaign", ref: "entity_fedcba9876543210", label: "Korunan kampanya" },
    beforeAfter: { field: "configured_status", before: "ACTIVE", after: "PAUSED" },
    autonomy: {
      profileRef: "autonomy_0123456789abcdef",
      decision: "approval_required",
      trace: [{ scope: "risk", decision: "approval_required", reasonCode: "risk.k2" }],
    },
    expiresAt: "2026-08-07T14:00:00.000Z",
    createdAt: "2026-08-07T13:00:00.000Z",
    dependencies: [],
    summaryCode: "status.pause",
  };
}

function harness(repository: ApprovalQueueRepository = {
  list: vi.fn(async () => [record()]),
  get: vi.fn(async () => record()),
}, role: "owner" | "admin" | "analyst" | "viewer" = "viewer") {
  const resolvePrincipal = vi.fn(async (): Promise<typeof principal | null> => principal);
  const contract = new ApprovalQueueAgentContract(
    new ApprovalQueueReadService(repository),
    [{ userId: principal.actor.userId, workspaceId, role }],
  );
  return { repository, resolvePrincipal, GET: createApprovalQueueHttpHandler({ contract, resolvePrincipal }) };
}

describe("Approval Queue GET-only HTTP boundary", () => {
  it("exposes bounded list and detail reads with authority explicitly disabled", async () => {
    const api = harness();
    const list = await api.GET(new Request("http://localhost/api/approval-queue?view=list&limit=25"));
    expect(list.status).toBe(200);
    expect(list.headers.get("cache-control")).toContain("private, no-store");
    expect(list.headers.get("x-reklamzeka-access-mode")).toBe("read-only");
    expect(list.headers.get("x-reklamzeka-action-authority")).toBe("none");
    expect(await list.json()).toMatchObject({
      result: { view: "list", items: [{ unitRef: record().unitRef }] },
      authority: {
        readOnly: true,
        canApprove: false,
        canReject: false,
        canRequestChanges: false,
        canGrant: false,
        canExecute: false,
        canWriteMeta: false,
      },
    });

    const detail = await api.GET(new Request(`http://localhost/api/approval-queue?view=detail&unitRef=${record().unitRef}`));
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ result: { view: "detail", item: { unitRef: record().unitRef } } });
  });

  it("rejects identities, unknown/duplicate params, malformed limits, and mixed views before auth", async () => {
    const api = harness();
    const urls = [
      `http://localhost/api/approval-queue?workspaceId=${workspaceId}`,
      "http://localhost/api/approval-queue?view=list&limit=1&limit=2",
      "http://localhost/api/approval-queue?view=list&limit=1e2",
      "http://localhost/api/approval-queue?view=list&limit=101",
      `http://localhost/api/approval-queue?view=list&unitRef=${record().unitRef}`,
      `http://localhost/api/approval-queue?view=detail&unitRef=${record().unitRef}&cursor=opaque`,
      "http://localhost/api/approval-queue?view=detail",
    ];
    for (const url of urls) expect((await api.GET(new Request(url))).status).toBe(400);
    expect(api.resolvePrincipal).not.toHaveBeenCalled();
  });

  it("binds viewer/analyst reads to the trusted principal and never accepts request workspace scope", async () => {
    for (const role of ["viewer", "analyst"] as const) {
      const api = harness(undefined, role);
      expect((await api.GET(new Request("http://localhost/api/approval-queue"))).status).toBe(200);
      expect(api.repository.list).toHaveBeenCalledWith({ workspaceId, before: null, limit: 26 });
    }
    const unauthorized = harness(undefined, "viewer");
    unauthorized.resolvePrincipal.mockResolvedValueOnce(null);
    expect((await unauthorized.GET(new Request("http://localhost/api/approval-queue"))).status).toBe(403);
  });

  it("maps safe read failures without leaking source details", async () => {
    const missing = harness({ list: async () => [], get: async () => null });
    expect((await missing.GET(new Request(`http://localhost/api/approval-queue?view=detail&unitRef=${record().unitRef}`))).status).toBe(404);
    const unsafe = harness({ list: async () => { throw new ApprovalQueueReadError("unsafe_source"); }, get: async () => null });
    expect((await unsafe.GET(new Request("http://localhost/api/approval-queue"))).status).toBe(422);
    const unavailable = harness({ list: async () => { throw new Error("private database detail"); }, get: async () => null });
    const response = await unavailable.GET(new Request("http://localhost/api/approval-queue"));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private database detail");
  });

  it("fails closed when route assembly is absent and exports no mutation handler", async () => {
    for (const response of [disabledGet(), approvalQueueNotConfiguredResponse()]) {
      expect(response.status).toBe(503);
      expect(response.headers.get("x-reklamzeka-action-authority")).toBe("none");
      expect(await response.json()).toEqual({ error: {
        code: "source_not_configured",
        message: "Onay Kuyruğu çalışma alanı ve yerel kimlik bağlama katmanı henüz etkin değil.",
      } });
    }
  });
});
