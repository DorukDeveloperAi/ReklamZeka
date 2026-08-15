"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { canonicalPerformancePanelProjection, canonicalPerformanceSourceState, type CanonicalPerformancePanelProjection } from "./canonical-performance-panel";
import { parseDeliveryHealthAlertList, type DeliveryHealthAlertList } from "./delivery-health-alert-panel";
import styles from "./operating-dashboard.module.css";

type LoadState = "loading" | "ready" | "session_required" | "unavailable";

function amount(value: Readonly<{ valueDecimal: string; currency?: string }> | null, currency: string | null): string {
  if (!value) return "—";
  const numeric = Number(value.valueDecimal);
  if (!Number.isFinite(numeric)) return "—";
  const unit = value.currency ?? currency;
  return unit ? new Intl.NumberFormat("tr-TR", { style: "currency", currency: unit, maximumFractionDigits: 2 }).format(numeric / 100) : value.valueDecimal;
}

function reason(codes: readonly string[]): string {
  return codes.length ? codes.join(" · ") : "Kapsam yeterli kanonik performans kaynağı bekleniyor.";
}

function performanceState(state: LoadState, projection: CanonicalPerformancePanelProjection | null): string {
  if (state === "loading") return "Kanonik performans okunuyor";
  if (state === "session_required") return "Yerel oturum gerekli";
  const sourceState = canonicalPerformanceSourceState(projection);
  return sourceState === "unavailable" ? "Kanonik performans kullanılamıyor"
    : sourceState === "empty" ? "Kanonik performans boş"
      : sourceState === "partial" ? "Kanonik performans kısmi" : "Kanonik performans hazır";
}

/**
 * The home page deliberately keeps account windows separate. A mixed-currency
 * or partial source must never be promoted into an invented portfolio total.
 */
export function HomePortfolioOverview({ onOpenPortfolio }: Readonly<{ onOpenPortfolio(): void }>) {
  const [performanceStateValue, setPerformanceStateValue] = useState<LoadState>("loading");
  const [performance, setPerformance] = useState<CanonicalPerformancePanelProjection | null>(null);
  const [alertsState, setAlertsState] = useState<LoadState>("loading");
  const [alerts, setAlerts] = useState<DeliveryHealthAlertList | null>(null);

  const refresh = useCallback(async () => {
    setPerformanceStateValue("loading");
    setAlertsState("loading");
    const [performanceResult, alertsResult] = await Promise.allSettled([
      fetch("/api/meta/canonical-performance", { cache: "no-store", credentials: "same-origin" }),
      fetch("/api/delivery-health-alerts", { cache: "no-store", credentials: "same-origin", headers: { "X-ReklamZeka-Intent": "delivery-health-alert-read" } }),
    ]);
    if (performanceResult.status === "fulfilled") {
      const response = performanceResult.value;
      try {
        const parsed = response.ok ? canonicalPerformancePanelProjection(await response.json()) : null;
        setPerformance(parsed);
        setPerformanceStateValue(parsed ? "ready" : response.status === 401 || response.status === 403 ? "session_required" : "unavailable");
      } catch { setPerformance(null); setPerformanceStateValue("unavailable"); }
    } else { setPerformance(null); setPerformanceStateValue("unavailable"); }
    if (alertsResult.status === "fulfilled") {
      const response = alertsResult.value;
      try {
        const parsed = response.ok ? parseDeliveryHealthAlertList(await response.json()) : null;
        setAlerts(parsed);
        setAlertsState(parsed ? "ready" : response.status === 401 || response.status === 403 ? "session_required" : "unavailable");
      } catch { setAlerts(null); setAlertsState("unavailable"); }
    } else { setAlerts(null); setAlertsState("unavailable"); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const windows = useMemo(() => performance?.accounts.map((account) => ({ account, window: account.windows.find((item) => item.days === 7) ?? null })) ?? [], [performance]);
  const openAlerts = alerts?.items.filter((item) => item.status !== "resolved") ?? [];
  const readyWindows = windows.filter((item) => item.window?.state === "ready");

  return <div className={styles.dashboardColumns}>
    <section className={styles.panel} aria-labelledby="home-performance-title">
      <header className={styles.panelHeader}><div><span className={styles.kicker}>PERFORMANS · HESAP BAZINDA</span><h2 id="home-performance-title">Son 7 gün</h2></div><span className={styles.statusPill} data-tone={canonicalPerformanceSourceState(performance) === "ready" ? "good" : "warning"}>{performanceState(performanceStateValue, performance)}</span></header>
      {performanceStateValue === "ready" && readyWindows.length ? <div className={styles.decisionList}>{readyWindows.map(({ account, window }) => <article className={styles.decisionRow} key={account.accountRef}>
        <div className={styles.decisionIndex}>7G</div><div className={styles.decisionBody}><div><span>{account.name}</span><span>{window!.observedDays}/7 gün · {window!.attribution ?? "Attribution bilinmiyor"}</span></div><h3>{amount(window!.spend, window!.currency)} harcama · {window!.outcome?.valueDecimal ?? "—"} exact lead · {amount(window!.cpa, window!.currency)} CPA</h3><p>Hesaplar ayrı gösterilir; portföy toplamı hesaplanmaz.</p></div><div className={styles.decisionAction}><button type="button" onClick={onOpenPortfolio}>Portföyü aç</button></div>
      </article>)}</div> : <p className={styles.metaAccountEmpty}>{performanceStateValue === "loading" ? "Kanonik performans kaynağı doğrulanıyor; metrik gösterilmiyor." : performanceStateValue === "session_required" ? "Performans için yerel oturum gerekli; metrik gösterilmez. Oturum bağlandıktan sonra Portföy / Slice çalışma masasında ilgili kapsamı açın." : canonicalPerformanceSourceState(performance) === "empty" ? "Doğrulanmış kanonik okumada hesap yok; portföy toplamı veya örnek metrik gösterilmez." : "Gösterilebilir 7 günlük hesap performansı yok. Kısmi veya kullanılamayan pencereler toplam metrik üretmez."}</p>}
      {performanceStateValue === "ready" && windows.some((item) => item.window?.state !== "ready") ? <p className={styles.metaAccountEmpty}>Kısmi hesap pencereleri: {windows.filter((item) => item.window?.state !== "ready").map((item) => `${item.account.name} (${reason(item.window?.reasonCodes ?? performance?.source.reasonCodes ?? [])})`).join(" · ")}</p> : null}
      {performanceStateValue !== "ready" || !readyWindows.length ? <p className={styles.metaAccountEmpty}>Canlı outcome metriği olmadan CPA gösterilmez.</p> : null}
    </section>
    <section className={styles.panel} aria-labelledby="home-next-steps-title">
      <header className={styles.panelHeader}><div><span className={styles.kicker}>AÇIK RİSK / SONRAKİ ADIM</span><h2 id="home-next-steps-title">İnceleme girişleri</h2></div><span className={styles.statusPill} data-tone={alertsState === "ready" && openAlerts.length ? "warning" : "neutral"}>{alertsState === "ready" ? `${openAlerts.length} açık kayıt` : alertsState === "loading" ? "Okunuyor" : alertsState === "session_required" ? "Oturum gerekli" : "Kullanılamıyor"}</span></header>
      {alertsState === "ready" && openAlerts.length ? <div className={styles.decisionList}>{openAlerts.slice(0, 3).map((alert) => <article className={styles.decisionRow} key={alert.alertRef}>
        <div className={styles.decisionIndex}>!</div><div className={styles.decisionBody}><div><span>{alert.evidence.level === "confirmed" ? "Doğrulanmış Meta sinyali" : "Şüpheli teslimat kesintisi"}</span></div><h3>{alert.evidence.officialState ?? "İnsan incelemesi gerekli"}</h3><p>{alert.recommendationDisposition === "hold_recommendations" ? "Öneriler beklemede; kanıtı seçili kapsamda inceleyin." : "Kanıtı seçili kapsamda inceleyin."}</p></div><div className={styles.decisionAction}><button type="button" onClick={onOpenPortfolio}>Portföyü aç</button></div>
      </article>)}</div> : <p className={styles.metaAccountEmpty}>{alertsState === "loading" ? "Açık risk kayıtları doğrulanıyor." : alertsState === "ready" ? "Doğrulanmış açık risk kaydı yok." : alertsState === "session_required" ? "Risk kayıtlarını görmek için yerel oturum gerekli; risk kaydı gösterilmez. Oturum bağlandıktan sonra Portföy / Slice çalışma masasında inceleyin." : "Risk kaynağı kullanılamıyor; risksiz olduğu çıkarımı yapılmaz."}</p>}
      <footer className={styles.metaAccountEmpty}>Bu yüzey yalnız okumadır; alarm, kural, policy veya Meta aksiyonu üretmez.</footer>
    </section>
  </div>;
}
