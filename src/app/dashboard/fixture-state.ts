import { DEMO_METRICS } from "./demo-data";
import type { CanonicalDailyMetric } from "@/domain/ads/canonical";

export const DASHBOARD_STATES = ["ready", "connecting", "syncing", "empty", "partial", "delayed", "error"] as const;
export type DashboardState = (typeof DASHBOARD_STATES)[number];

export type DashboardStateView = Readonly<{
  state: DashboardState;
  label: string;
  title: string;
  description: string;
  tone: "success" | "info" | "warning" | "danger";
  liveRole: "status" | "alert";
  action?: Readonly<{ label: string; href: string }>;
  metrics: readonly CanonicalDailyMetric[];
  showPerformance: boolean;
}>;

function withUpdatedAt(updatedAt: string): readonly CanonicalDailyMetric[] {
  return DEMO_METRICS.map((metric) => ({ ...metric, sourceUpdatedAt: updatedAt }));
}

export function dashboardStateView(state: DashboardState): DashboardStateView {
  switch (state) {
    case "connecting":
      return {
        state, label: "Bağlantı", title: "İlk veri kaynağınızı bağlayın",
        description: "Meta Ads veya Google Ads hesabını salt-okunur bağlayın; isterseniz doğrulanmış CSV yükleyin.",
        tone: "info", liveRole: "status", action: { label: "Bağlantı seçeneklerini gör", href: "?state=syncing" },
        metrics: [], showPerformance: false,
      };
    case "syncing":
      return {
        state, label: "İlk senkronizasyon", title: "Veriler güvenli biçimde alınıyor",
        description: "Kaynak satırları doğrulanıyor ve kanonik metriklere dönüştürülüyor. Bu ekran otomatik güncellenecek.",
        tone: "info", liveRole: "status", metrics: [], showPerformance: false,
      };
    case "empty":
      return {
        state, label: "Boş sonuç", title: "Seçili dönemde performans verisi yok",
        description: "Bağlantı çalışıyor; tarih aralığını genişletin veya platformdaki kampanya yayın durumunu kontrol edin.",
        tone: "warning", liveRole: "status", action: { label: "30 güne geç", href: "?period=30&state=ready" },
        metrics: [], showPerformance: false,
      };
    case "partial":
      return {
        state, label: "Kısmi veri", title: "Google Ads verisi henüz tamamlanmadı",
        description: "Toplamlar yalnız alınan Meta Ads satırlarını içeriyor. Eksik kaynak tamamlanana kadar karar vermeyin.",
        tone: "warning", liveRole: "alert", metrics: [DEMO_METRICS[0]!, DEMO_METRICS[2]!], showPerformance: true,
      };
    case "delayed":
      return {
        state, label: "Gecikmiş veri", title: "Son senkronizasyon beklenenden eski",
        description: "Gösterilen metrikler 52 saat önce güncellendi. Connector kotası ve senkronizasyon kuyruğu kontrol edilmeli.",
        tone: "warning", liveRole: "alert", metrics: withUpdatedAt("2026-08-04T08:00:00.000Z"), showPerformance: true,
      };
    case "error":
      return {
        state, label: "Senkronizasyon hatası", title: "Google Ads bağlantısı yenilenmeli",
        description: "Son başarılı snapshot gösteriliyor. Kimlik bilgisi hatası nedeniyle yeni veri alınamadı; sır hiçbir yanıta eklenmedi.",
        tone: "danger", liveRole: "alert", action: { label: "Bağlantıyı yeniden doğrula", href: "?state=syncing" },
        metrics: withUpdatedAt("2026-08-02T08:00:00.000Z"), showPerformance: true,
      };
    case "ready":
      return {
        state, label: "Hazır", title: "Tüm kaynaklar güncel",
        description: "Meta Ads ve Google Ads verisi kanonik metriklerle karşılaştırmaya hazır.",
        tone: "success", liveRole: "status", metrics: DEMO_METRICS, showPerformance: true,
      };
  }
}

export function parseDashboardState(value: string | null | undefined): DashboardState {
  return DASHBOARD_STATES.includes(value as DashboardState) ? value as DashboardState : "ready";
}
