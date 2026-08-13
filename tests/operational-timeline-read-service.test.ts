import { describe, expect, it } from "vitest";
import { OperationalTimelineReadError, OperationalTimelineReadService } from "@/application/operational-timeline-read-service";

const principal = { actor: { userId: "11111111-1111-4111-8111-111111111111" }, workspaceId: "22222222-2222-4222-8222-222222222222", workspaceRef: "workspace_demo", readerRef: "reader_demo" } as const;
const memberships = [{ workspaceId: principal.workspaceId, userId: principal.actor.userId, role: "viewer" as const }];
describe("operational timeline read service", () => {
  it("returns only a timestamped, authority-closed cross-ledger projection", async () => {
    const service = new OperationalTimelineReadService({ list: async () => [{ kind: "delivery_alert" as const,
      occurredAt: "2026-08-13T12:00:00.000Z", title: "Şüpheli teslimat kesintisi", detail: "Alarm durumu: açık" }] }, memberships);
    await expect(service.list(principal)).resolves.toMatchObject({ contractVersion: "operational-timeline/1.0.0",
      authority: { readOnly: true, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false, canEnableAutomation: false } });
  });
  it("rejects private identifiers rather than leaking them through the timeline", async () => {
    const service = new OperationalTimelineReadService({ list: async () => [{ kind: "slice_rule_draft" as const,
      occurredAt: "2026-08-13T12:00:00.000Z", title: "Kural", detail: "11111111-1111-4111-8111-111111111111" }] }, memberships);
    await expect(service.list(principal)).rejects.toBeInstanceOf(OperationalTimelineReadError);
  });
  it("admits a public-safe persisted budget proposal trace but keeps every authority closed", async () => {
    const service = new OperationalTimelineReadService({ list: async () => [{ kind: "budget_proposal" as const,
      occurredAt: "2026-08-13T12:00:00.000Z", title: "Bütçe önerisi taslağı kaydedildi",
      detail: "Revizyon 2 · 3 senaryo · uygulama yetkisi yok" }] }, memberships);
    await expect(service.list(principal)).resolves.toMatchObject({ items: [expect.objectContaining({ kind: "budget_proposal" })],
      authority: { canApprove: false, canExecute: false, canWriteMeta: false } });
  });
  it("keeps an exact rule-linked proposal as a public-safe timeline description", async () => {
    const service = new OperationalTimelineReadService({ list: async () => [{ kind: "budget_proposal" as const,
      occurredAt: "2026-08-13T12:00:00.000Z", title: "Bütçe önerisi taslağı kaydedildi",
      detail: "Revizyon 2 · 3 senaryo · exact kural kaynağı bağlı · uygulama yetkisi yok" }] }, memberships);
    await expect(service.list(principal)).resolves.toMatchObject({ items: [expect.objectContaining({
      detail: expect.stringContaining("kural kaynağı bağlı"),
    })] });
  });
});
