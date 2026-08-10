import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ApprovalQueueReadSurface, recordApprovalDecision } from "@/app/dashboard/approval-queue-panel";
import type { ApprovalQueueRecord } from "@/application/approval-queue-read-service";

const callbacks = { onRetry: vi.fn(), onSelect: vi.fn() };
const item = {
  unitRef: "action_unit_aaaaaaaaaaaaaaaaaaaa",
  bundleRef: "action_bundle_bbbbbbbbbbbbbbbbbbbb",
  status: "awaiting_approval",
  risk: "K2",
  actionType: "budget_decrease",
  accountRef: "account_1111111111111111",
  campaignRef: "entity_2222222222222222",
  entity: { type: "campaign", ref: "entity_2222222222222222", label: "GCC Lead Kampanyası" },
  beforeAfter: { field: "daily_budget_minor", beforeMinor: 170_000, afterMinor: 156_400, currency: "TRY" },
  autonomy: {
    profileRef: "autonomy_3333333333333333",
    decision: "approval_required",
    trace: [
      { scope: "workspace", decision: "approval_required", reasonCode: "workspace.default" },
      { scope: "risk", decision: "approval_required", reasonCode: "risk.k2" },
    ],
  },
  expiresAt: "2026-08-08T09:00:00.000Z",
  createdAt: "2026-08-07T09:00:00.000Z",
  dependencies: [{ unitRef: "action_unit_cccccccccccccccccccc", status: "verified" }],
  summaryCode: "pacing_guardrail",
} satisfies ApprovalQueueRecord;

function ready(selected: ApprovalQueueRecord | null = null) {
  return {
    status: "ready" as const,
    result: {
      contractVersion: "approval-queue-read-model/1.2.0" as const,
      view: "list" as const,
      entityRef: null,
      campaignRef: null,
      items: [item],
      nextCursor: null,
      authority: {
        readOnly: true as const, canApprove: false as const, canReject: false as const,
        canRequestChanges: false as const, canGrant: false as const, canExecute: false as const,
        canWriteMeta: false as const,
      },
    },
    selected,
    detailLoading: false,
  };
}

describe("Approval Queue dashboard", () => {
  it("distinguishes unavailable, error, and true empty without a fixture fallback", () => {
    const unavailable = renderToStaticMarkup(createElement(ApprovalQueueReadSurface, {
      ...callbacks, state: { status: "unavailable", message: "Yerel oturum gerekli." },
    }));
    const error = renderToStaticMarkup(createElement(ApprovalQueueReadSurface, {
      ...callbacks, state: { status: "error", message: "Kaynak güvenli değil." },
    }));
    const empty = renderToStaticMarkup(createElement(ApprovalQueueReadSurface, {
      ...callbacks,
      state: { ...ready(), result: { ...ready().result, items: [] } },
    }));
    expect(unavailable).toContain("Kaynak henüz bağlı değil");
    expect(unavailable).toContain("Fixture kayıtlar canlı kuyruk gibi gösterilmez");
    expect(error).toContain("Onay kuyruğu okunamadı");
    expect(empty).toContain("Kaynak bağlı · kuyruk boş");
    expect(empty).toContain("demo fallback değildir");
  });

  it("renders rows and a public-safe detail with before/after, trace, expiry, and dependencies", () => {
    const html = renderToStaticMarkup(createElement(ApprovalQueueReadSurface, {
      ...callbacks, state: ready(item),
    }));
    expect(html).toContain("GCC Lead Kampanyası");
    expect(html).toContain("Bütçe azaltma önerisi");
    expect(html).toContain("1.700");
    expect(html).toContain("1.564");
    expect(html).toContain("Otonomi izi");
    expect(html).toContain("Bağımlılıklar");
    expect(html).toContain("8 Ağu 2026");
    expect(html).toContain("K2");
  });

  it("keeps execute and Meta authority visibly disabled when no trusted decision adapter is supplied", () => {
    const html = renderToStaticMarkup(createElement(ApprovalQueueReadSurface, {
      ...callbacks, state: ready(item),
    }));
    expect(html).toContain("DECISION RECORD · NO META WRITE");
    expect(html).toContain("Tekil insan kararı");
    expect(html).toContain("Execute kapalı");
    expect(html).toContain("Meta write kapalı");
    expect(html).toContain("Uygulama zinciri henüz kapalı");
    expect(html).toContain("Mirror yeniden kontrolü");
    expect(html).toContain("Ayrı execution seremonisi");
    expect(html).toContain("Read-after-write sözleşmesi hazır");
    expect(html).toContain("NO TRANSPORT");
    expect(html).not.toContain(">Onayla<");
    expect(html).not.toContain(">Reddet<");
    expect(html).not.toContain(">Değişiklik iste<");
  });

  it("renders exact-unit decision controls only with explicit before-after confirmation", () => {
    const html = renderToStaticMarkup(createElement(ApprovalQueueReadSurface, {
      ...callbacks,
      state: ready(item),
      decision: {
        busy: false,
        confirmed: false,
        error: null,
        notice: null,
        setConfirmed: vi.fn(),
        decide: vi.fn(),
      },
    }));
    expect(html).toContain("Bu ActionUnit için karar ver");
    expect(html).toContain("1.700");
    expect(html).toContain("1.564");
    expect(html).toContain("type=\"checkbox\"");
    expect(html).toContain(">Onayla<");
    expect(html).toContain(">Reddet<");
    expect(html).toContain(">Değişiklik iste<");
    expect(html).toContain("disabled=\"\"");
    expect(html).toContain("execute veya Meta write yapmadığını");
  });

  it("records exactly one unit through challenge then decision and verifies no execution authority", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ challenge: {
        unitRef: item.unitRef, action: "approve", proof: `presence_${"a".repeat(43)}`,
      } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        decision: { unitRef: item.unitRef, state: "approved" },
        authority: { canExecute: false, canWriteMeta: false },
      }), { status: 200 }));
    await expect(recordApprovalDecision(fetcher as typeof fetch, { unitRef: item.unitRef, kind: "approve" }))
      .resolves.toEqual({ state: "approved" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "POST", credentials: "same-origin",
      headers: { "X-ReklamZeka-Intent": "approval-queue-confirm-human-presence" } });
    expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toEqual({ unitRef: item.unitRef, action: "approve" });
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ headers: { "X-ReklamZeka-Intent": "approval-queue-approve" } });
    expect(JSON.parse(fetcher.mock.calls[1]?.[1]?.body as string)).toEqual({
      unitRef: item.unitRef,
      reasonCode: "human.confirmed",
      humanPresenceProof: `presence_${"a".repeat(43)}`,
    });
  });
});
