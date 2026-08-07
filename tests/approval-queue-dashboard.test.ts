import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ApprovalQueueReadSurface } from "@/app/dashboard/approval-queue-panel";
import type { ApprovalQueueRecord } from "@/application/approval-queue-read-service";

const callbacks = { onRetry: vi.fn(), onSelect: vi.fn() };
const item = {
  unitRef: "action_unit_aaaaaaaaaaaaaaaaaaaa",
  bundleRef: "action_bundle_bbbbbbbbbbbbbbbbbbbb",
  status: "awaiting_approval",
  risk: "K2",
  actionType: "budget_decrease",
  accountRef: "account_1111111111111111",
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
      contractVersion: "approval-queue-read-model/1.0.0" as const,
      view: "list" as const,
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

  it("makes every action authority boundary visible and exposes no mutation controls", () => {
    const html = renderToStaticMarkup(createElement(ApprovalQueueReadSurface, {
      ...callbacks, state: ready(item),
    }));
    expect(html).toContain("READ ONLY · NO META WRITE");
    expect(html).toContain("Onay kapalı");
    expect(html).toContain("Execute kapalı");
    expect(html).toContain("Meta write kapalı");
    expect(html).not.toContain(">Onayla<");
    expect(html).not.toContain(">Reddet<");
    expect(html).not.toContain(">Değişiklik iste<");
  });
});
