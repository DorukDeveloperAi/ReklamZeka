import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  OperatingDashboard,
  metaBootstrapPreflightFromResponse,
  metaReadMirrorErrorState,
  metaReadMirrorFromResponse,
  portfolioCapabilityFromResponse,
  resolveMetaAccountFocus,
  todayCanonicalSummary,
} from "@/app/dashboard/operating-dashboard";
import type { MetaInventorySnapshot } from "@/connectors/meta/types";
import type { MetaReadMirrorProjection } from "@/domain/meta/read-mirror-projection";

const model = {
  periodDays: 7, spend: "₺0", conversions: 0, cpa: "₺0", roas: "0",
  freshnessHours: 0, freshnessLabel: "şimdi", currency: "TRY", timezone: "Europe/Istanbul",
  attribution: "7d_click_1d_view",
};

function inventory(): MetaInventorySnapshot {
  return {
    connection: { status: "valid", graphApiVersion: "v24.0", accessMode: "read_only", expiresAt: null, dataAccessExpiresAt: null, grantedScopes: [], securityStatus: "standard" },
    summary: { adAccounts: 4, pages: 1, linkedInstagramAccounts: 1, campaigns: 32, adSets: 0, ads: 0, accountsWithCampaigns: 4 },
    capabilities: [], accounts: [], pages: [], errors: [], refreshedAt: "2026-08-11T09:30:00.000Z", nextAutomaticRefreshAt: "2026-08-11T09:45:00.000Z",
    audit: { eventId: "audit_inventory", action: "connection.inventory_refreshed", occurredAt: "2026-08-11T09:30:00.000Z", writeOperations: 0 },
  };
}

function canonicalMirror(): MetaReadMirrorProjection {
  const projection = {
    version: "meta-read-mirror-projection/1.0.0", sourceState: "ready",
    observedAt: "2026-08-13T12:00:00.000Z", latestCanonicalObservationAt: "2026-08-13T11:59:00.000Z",
    freshnessAgeMinutes: 1, freshnessThresholdMinutes: 1440, reasonCodes: [],
    summary: { connections: 1, accounts: 4, campaigns: 32, adSets: 80, ads: 120, creatives: 75, posts: 40 },
    authority: { actionAuthority: "none", canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false },
    connections: [{ connectionRef: "connection_aaaaaaaaaaaaaaaaaaaaaaaa", name: "Meta", status: "active", accessMode: "read_only",
      accounts: [{ accountRef: "account_bbbbbbbbbbbbbbbbbbbbbbbb", name: "Hesap", currency: "TRY", timezone: "Europe/Istanbul",
        freshness: { inventoryStatus: "completed", creativeStatus: "completed", insightStatus: "completed", insightObservedAt: "2026-08-13T11:59:00.000Z", insightCanonicalRowCount: 7, latestObservedAt: "2026-08-13T11:59:00.000Z" }, campaigns: [] }] }],
  };
  const parsed = metaReadMirrorFromResponse(projection);
  if (!parsed) throw new Error("test mirror must satisfy the canonical contract");
  return parsed;
}

describe("Today inventory summary", () => {
  it("accepts only the secret-free, zero-network Meta bootstrap preflight contract", () => {
    const preflight = { schemaVersion: 1, phase: "preflight", accessMode: "read_only", readiness: "blocked",
      blocker: "rotation_required", securityStatus: "temporary_exposed", secretBindingConfigured: true,
      doctorExecuted: false, bootstrapExecuted: false, networkCalls: 0, writeOperations: 0,
      message: "Bağlantı kapalı", nextStep: "Tokenı döndürün" } as const;
    expect(metaBootstrapPreflightFromResponse(preflight)).toEqual(preflight);
    expect(metaBootstrapPreflightFromResponse({ ...preflight, networkCalls: 1 })).toBeNull();
    expect(metaBootstrapPreflightFromResponse({ ...preflight, bootstrapExecuted: true })).toBeNull();
  });

  it("accepts only a canonical mirror with zero action authority", () => {
    const projection = {
      version: "meta-read-mirror-projection/1.0.0", sourceState: "empty",
      observedAt: "2026-08-13T12:00:00.000Z", latestCanonicalObservationAt: "2026-08-13T11:59:00.000Z",
      freshnessAgeMinutes: 1, freshnessThresholdMinutes: 1440, reasonCodes: ["canonical_hierarchy_empty"],
      summary: { connections: 1, accounts: 1, campaigns: 0, adSets: 0, ads: 0, creatives: 0, posts: 0 },
      authority: { actionAuthority: "none", canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false },
      connections: [{ connectionRef: "connection_aaaaaaaaaaaaaaaaaaaaaaaa", name: "Meta", status: "active", accessMode: "read_only",
        accounts: [{ accountRef: "account_bbbbbbbbbbbbbbbbbbbbbbbb", name: "Hesap", currency: "TRY", timezone: "Europe/Istanbul",
          freshness: { inventoryStatus: "completed", creativeStatus: "completed", insightStatus: "completed", insightObservedAt: "2026-08-13T11:59:00.000Z", insightCanonicalRowCount: 0, latestObservedAt: "2026-08-13T11:59:00.000Z" }, campaigns: [] }] }],
    };
    expect(metaReadMirrorFromResponse(projection)).toEqual(projection);
    expect(metaReadMirrorFromResponse({ ...projection, authority: { ...projection.authority, canWriteMeta: true } })).toBeNull();
    expect(metaReadMirrorFromResponse({ ...projection, connections: [{ ...projection.connections[0], accessMode: "write" }] })).toBeNull();
  });

  it("distinguishes an authenticated-session boundary from an unavailable mirror", () => {
    expect(metaReadMirrorErrorState(401, { error: { code: "local_session_required", message: "Oturum gerekli" } })).toBe("session_required");
    expect(metaReadMirrorErrorState(403, { error: { code: "forbidden", message: "Oturum gerekli" } })).toBe("session_required");
    expect(metaReadMirrorErrorState(503, { error: { code: "source_unavailable", message: "Yok" } })).toBe("unavailable");
  });

  it("derives Today counts only from the validated canonical mirror", () => {
    expect(todayCanonicalSummary(canonicalMirror())).toEqual({
      state: "ready", accounts: 4, campaigns: 32, adSets: 80, ads: 120, observedAt: "2026-08-13T12:00:00.000Z",
    });
  });

  it("fails closed instead of turning an absent mirror into live counts", () => {
    expect(todayCanonicalSummary(null)).toEqual({ state: "unavailable", accounts: null, campaigns: null, adSets: null, ads: null, observedAt: null });
  });

  it("keeps account focus within the current read-only inventory snapshot", () => {
    const accounts = [
      { id: "act_a", name: "A", currency: "TRY", timezone: "Europe/Istanbul", status: "ACTIVE", campaignCount: 1, adSetCount: 1, adCount: 1, campaignExamples: [], adCopyExamples: [], insightAccess: { verified: true, timeframe: "7d", dateStart: null, dateStop: null }, businessName: null },
      { id: "act_b", name: "B", currency: "USD", timezone: "UTC", status: "ACTIVE", campaignCount: 2, adSetCount: 2, adCount: 2, campaignExamples: [], adCopyExamples: [], insightAccess: { verified: false, timeframe: "7d", dateStart: null, dateStop: null }, businessName: null },
    ] as const;
    expect(resolveMetaAccountFocus(accounts, "act_b")).toBe("act_b");
    expect(resolveMetaAccountFocus(accounts, "act_missing")).toBe("act_a");
    expect(resolveMetaAccountFocus([], "act_a")).toBe("");
  });

  it("renders an honest loading state without demo decisions, brands or portfolio rows", () => {
    const html = renderToStaticMarkup(createElement(OperatingDashboard, { model }));
    expect(html).toContain("ANA SAYFA · GENEL BAKIŞ");
    expect(html).toContain("Kanonik ayna okunuyor");
    expect(html).toContain("Kampanya sayısı kullanılamıyor");
    expect(html).toContain("Eksik veri sıfır veya örnek değer olarak gösterilmez.");
    expect(html).toContain("Canlı outcome metriği olmadan CPA gösterilmez.");
    expect(html).not.toContain("Örnek karar biçimleri");
    expect(html).not.toContain("Planlama senaryoları");
    expect(html).not.toContain("Demo Marka");
    expect(html).not.toContain("₺128.000");
    expect(html).not.toContain("32 aktif kampanya");
  });

  it("keeps the account-group portfolio surface unavailable until its authenticated source is verified", () => {
    const html = renderToStaticMarkup(createElement(OperatingDashboard, { model, initialView: "meta" }));
    expect(html).toContain("KANONİK DB AYNASI · SALT-OKUNUR");
    expect(html).toContain("Campaign → ad set → ad → creative/post");
    expect(html).toContain("Yetki: none · publish kapalı · approve kapalı · execute kapalı · Meta write kapalı");
    expect(html).toContain("PORTFÖY KAPSAMI");
    expect(html).toContain("Portföy kapsamı kaynağı henüz güvenli biçimde bağlanmadı.");
    expect(html).toContain("Bu görünümden bütçe, yayın, onay veya Meta yazma yapılamaz.");
  });

  it("accepts only the public-safe portfolio capability contract", () => {
    expect(portfolioCapabilityFromResponse({ version: "meta-portfolio-capability/1.0.0", connections: [], accounts: [] })).toEqual({ connections: [], accounts: [] });
    expect(portfolioCapabilityFromResponse({ version: "meta-portfolio-capability/1.0.0", connections: [], accounts: [{ accountRef: "ad_account_aaaaaaaaaaaaaaaaaaaaaaaa", connectionRef: "meta_connection_bbbbbbbbbbbbbbbbbbbbbbbb", name: "X", currency: "TRY", timezone: "Europe/Istanbul", spendCapMinor: null, groupRefs: [], readReadiness: "ready", reasonCodes: [], capabilities: { canRead: true, canPlan: true, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: true } }] })).toBeNull();
  });
});
