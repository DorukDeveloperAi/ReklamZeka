import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ApprovalQueueReadSurface, recordApprovalDecision } from "@/app/dashboard/approval-queue-panel";
import type { ApprovalQueueDetailRecord, ApprovalQueueRecord } from "@/application/approval-queue-read-service";

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
      contractVersion: "approval-queue-read-model/1.4.0" as const,
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
  it("re-reads a routed ActionUnit only after it is found in the tenant/campaign-scoped list", () => {
    const source = readFileSync("src/app/dashboard/approval-queue-panel.tsx", "utf8");
    expect(source).toContain("selectedUnitRef?: string | null");
    expect(source).toContain("state.result.items.find((item) => item.unitRef === selectedUnitRef)");
    expect(source).toContain("seçili çalışma alanı veya kampanya kapsamında bulunamadı");
    expect(source).toContain("void select(summary)");
  });

  it("renders hash-verified source labels and ordered human decision history without execution controls", () => {
    const detail: ApprovalQueueDetailRecord = { ...item, sourceEvidence: [
      { kind: "budget_proposal", label: "Yabancı FTR bütçe tavanı", integrity: "hash_verified" },
      { kind: "slice_rule", label: "Yabancı FTR slice kuralı", integrity: "hash_verified" },
    ], decisionHistory: [
      { decision: "proposed", occurredAt: item.createdAt, reasonCode: null },
      { decision: "changes_requested", occurredAt: "2026-08-07T10:00:00.000Z", reasonCode: "human.changes_requested" },
    ] };
    const html = renderToStaticMarkup(createElement(ApprovalQueueReadSurface, { ...callbacks, state: ready(detail) }));
    expect(html).toContain("Doğrulanmış kaynak kanıtı");
    expect(html).toContain("Yabancı FTR bütçe tavanı");
    expect(html).toContain("hash doğrulandı");
    expect(html).toContain("İnsan karar geçmişi");
    expect(html).toContain("changes requested");
    expect(html).not.toContain("Meta write etkin");
  });

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
    expect(unavailable).toContain("örnek onay kaydı gösterilmez");
    expect(error).toContain("Onay kuyruğu okunamadı");
    expect(empty).toContain("Kaynak bağlı · kuyruk boş");
    expect(empty).toContain("örnek kayıt eklenmedi");
  });

  it("offers the shared session connector in the approval context", () => {
    const html = renderToStaticMarkup(createElement(ApprovalQueueReadSurface, {
      ...callbacks, onConnect: vi.fn(async () => false), state: { status: "session_required", message: "Oturumu bağlayın." },
    }));
    expect(html).toContain("YEREL OTURUM GEREKLİ");
    expect(html).toContain("Onay çalışma alanını bağlayın");
    expect(html).toContain("npm run local-session:mint");
    expect(html).not.toContain("Decision Room’da oturumu bağla");
    expect(html).not.toContain("Kaynak henüz bağlı değil");
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
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('tabindex="-1"');
  });

  it("keeps the authority boundary concise when no trusted decision adapter is supplied", () => {
    const html = renderToStaticMarkup(createElement(ApprovalQueueReadSurface, {
      ...callbacks, state: ready(item),
    }));
    expect(html).toContain("İNSAN KARARI · META WRITE YOK");
    expect(html).toContain("Onay yalnız karar kaydıdır");
    expect(html).not.toContain("Uygulama zinciri henüz kapalı");
    expect(html).not.toContain("Mirror yeniden kontrolü");
    expect(html).not.toContain("NO TRANSPORT");
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
    expect(html).toContain("Bu eylem satırı için karar ver");
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
