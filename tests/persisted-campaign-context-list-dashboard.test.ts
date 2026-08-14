import { describe, expect, it } from "vitest";
import { isLocalSessionRequiredResponse, persistedCampaignContextsFromResponse } from "@/app/dashboard/operating-dashboard";

describe("persisted campaign context dashboard list", () => {
  const response = { contractVersion: "campaign-context-list-read-model/1.0.0", view: "list", items: [{ campaignRef: "ref_abcdef012345", label: "Persisted campaign · abcdef", objective: "lead_generation", capturedAt: "2026-08-10T12:00:00.000Z", sourceState: "frozen_valid" }], writeOperations: 0 };

  it("accepts only the tiny read-only persisted context selector model", () => {
    expect(persistedCampaignContextsFromResponse(response)).toEqual(response.items);
  });

  it("fails closed for a write bit, raw field, or malformed alias", () => {
    expect(persistedCampaignContextsFromResponse({ ...response, writeOperations: 1 })).toBeNull();
    expect(persistedCampaignContextsFromResponse({ ...response, rawCampaignId: "secret" })).toBeNull();
    expect(persistedCampaignContextsFromResponse({ ...response, items: [{ ...response.items[0], campaignRef: "campaign_primary" }] })).toBeNull();
  });

  it("recognizes only the minimal session-required envelope for an explicit dashboard handoff", () => {
    expect(isLocalSessionRequiredResponse({ error: { code: "local_session_required", message: "Oturumu bağlayın." } })).toBe(true);
    expect(isLocalSessionRequiredResponse({ error: { code: "source_not_configured", message: "no" } })).toBe(false);
    expect(isLocalSessionRequiredResponse({ error: { code: "local_session_required", message: "x", raw: "no" } })).toBe(false);
  });
});
