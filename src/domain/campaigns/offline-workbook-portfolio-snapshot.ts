/**
 * Read-only operating snapshot transcribed from the user-supplied workbook.
 * It is deliberately not a Meta mirror, database projection, or KPI source:
 * the dashboard must show its capture boundary alongside every use.
 */
export const OFFLINE_WORKBOOK_PORTFOLIO_SNAPSHOT_VERSION = "offline-workbook-portfolio/1.0.0" as const;

export const offlineWorkbookPortfolioSnapshot = Object.freeze({
  version: OFFLINE_WORKBOOK_PORTFOLIO_SNAPSHOT_VERSION,
  source: "kampanya_butce_harcama_takip_kesinti_analizli.xlsx",
  capturedAt: "2026-08-10T10:53:54.803Z",
  period: "Temmuz 2026 + Ağustos 2026 (10 Ağustos günü tamamlanmamış)",
  currency: "TRY",
  totals: Object.freeze({ campaigns: 27, spend: 2_462_571.36, leads: 3_407 }),
  markets: Object.freeze([
    Object.freeze({ market: "Yerli", campaigns: 22, spend: 1_153_738.55, leads: 2_125, formLeads: 2_125, whatsappLeads: 0 }),
    Object.freeze({ market: "Yabancı", campaigns: 5, spend: 1_308_832.81, leads: 1_282, formLeads: 501, whatsappLeads: 781 }),
  ]),
  lanes: Object.freeze([
    Object.freeze({ label: "AR · WhatsApp · FTR", market: "Yabancı", language: "AR", route: "whatsapp", service: "Fizik tedavi / rehabilitasyon", leads: 717 }),
    Object.freeze({ label: "RU · Form · FTR", market: "Yabancı", language: "RU", route: "lead_form", service: "Fizik tedavi / rehabilitasyon", leads: 392 }),
    Object.freeze({ label: "TR · Form · Doğum", market: "Yerli", language: "TR", route: "lead_form", service: "Doğum kampanyası", leads: 613 }),
  ]),
  interruptionRule: "Ani harcama çöküşü önce teslimat kesintisi olarak doğrulanır; o pencerede performans hükmü verilmez.",
});
