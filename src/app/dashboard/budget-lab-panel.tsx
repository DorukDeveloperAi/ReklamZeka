"use client";

import { useCallback, useEffect, useState } from "react";
import type { BudgetLabDetailResult, BudgetLabListResult, BudgetLabSummary } from "@/application/budget-lab-read-service";
import type { PublicBudgetProposal } from "@/connectors/budget/budget-proposal-drizzle-repository";
import styles from "./operating-dashboard.module.css";

type State =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "session_required" | "unavailable" | "error"; message: string }>
  | Readonly<{ status: "ready"; result: BudgetLabListResult; selected: PublicBudgetProposal | null }>;
type Envelope<T> = Readonly<{ result: T }>;
type ErrorEnvelope = Readonly<{ error?: Readonly<{ code?: string; message?: string }> }>;

function timestamp(value: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(value));
}

function money(minor: number, currency: string) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency, maximumFractionDigits: 2 }).format(minor / 100);
}

export function BudgetLabReadSurface(props: Readonly<{
  state: State;
  onRetry(): void;
  onSelect(item: BudgetLabSummary): void;
  onOpenSession?: () => void;
}>) {
  const ready = props.state.status === "ready" ? props.state : null;
  return <>
    <section className={styles.pageHero}><div><span className={styles.kicker}>BUDGET LAB · VERIFIED READ MODEL</span><h1>Deterministik bütçe önerilerini, izleri ve sınırlarıyla okuyun.</h1><p>Her öneri dondurulmuş kampanya bağlamından gelir. Bu yüzey senaryo üretmez, taslak kaydetmez, onaylamaz, execute etmez ve Meta’ya yazmaz.</p></div><span className={styles.readOnlyBadge}>READ ONLY · AUTHORITY NONE</span></section>
    {props.state.status === "loading" ? <section className={`${styles.panel} ${styles.budgetLabState}`} role="status"><span className={styles.liveDot} /><h2>Bütçe önerileri doğrulanıyor</h2><p>Tenant kapsamı, proposal bütünlüğü ve alternatif sırası sunucuda kontrol edilir.</p></section> : null}
    {props.state.status === "session_required" ? <section className={`${styles.panel} ${styles.budgetLabState}`} role="alert"><strong>YEREL OTURUM GEREKLİ</strong><h2>Dashboard oturumunu bağlayın</h2><p>{props.state.message}</p>{props.onOpenSession ? <button onClick={props.onOpenSession}>Decision Room’da oturumu bağla</button> : <button onClick={props.onRetry}>Tekrar dene</button>}</section> : null}
    {props.state.status === "unavailable" ? <section className={`${styles.panel} ${styles.budgetLabState}`} role="alert"><strong>Kaynak henüz bağlı değil</strong><h2>{props.state.message}</h2><p>Demo bütçe kayıtları canlı sonuç gibi gösterilmez. Güvenli yerel oturum ve gerçek repository bağlandığında bu görünüm açılır.</p><button onClick={props.onRetry}>Tekrar kontrol et</button></section> : null}
    {props.state.status === "error" ? <section className={`${styles.panel} ${styles.budgetLabState}`} role="alert"><strong>Budget Lab okunamadı</strong><h2>{props.state.message}</h2><p>Kapsam dışı, bozuk veya güvenli projection sınırını aşan kayıtlar kısmen gösterilmez.</p><button onClick={props.onRetry}>Tekrar dene</button></section> : null}
    {ready && ready.result.items.length === 0 ? <section className={`${styles.panel} ${styles.budgetLabState}`}><strong>Kaynak bağlı · öneri yok</strong><h2>Bu çalışma alanında henüz deterministik bütçe önerisi bulunmuyor.</h2><p>Bu gerçek tenant-bound boş yanıttır; fixture veya demo fallback değildir.</p></section> : null}
    {ready && ready.result.items.length > 0 ? <div className={styles.budgetLabWorkspace}>
      <section className={`${styles.panel} ${styles.budgetLabIndex}`}><header className={styles.panelHeader}><div><span className={styles.kicker}>PROPOSAL LEDGER</span><h2>{ready.result.items.length} öneri</h2></div><span>Public-safe</span></header><div>{ready.result.items.map((item) => <button key={item.proposalRef} data-active={ready.selected?.proposalRef === item.proposalRef} onClick={() => props.onSelect(item)}><span><strong>{item.seriesRef} · r{item.revision}</strong><small>{timestamp(item.createdAt)} · {item.composedCount} hazır · {item.suppressedCount} bastırılmış</small></span><i>{item.mappingStatus}</i></button>)}</div></section>
      <BudgetProposalDetail item={ready.selected} />
    </div> : null}
  </>;
}

function BudgetProposalDetail({ item }: Readonly<{ item: PublicBudgetProposal | null }>) {
  if (!item) return <section className={`${styles.panel} ${styles.budgetLabState}`}><strong>Öneri seçin</strong><h2>Önce/sonra, mapping ve deterministik trace özeti burada açılır.</h2><p>Teknik UUID, tam hash, Meta kimliği, token ve ham payload bu yüzeye çıkmaz.</p></section>;
  return <section className={`${styles.panel} ${styles.budgetLabDetail}`}>
    <header><div><span className={styles.kicker}>REVISION {item.revision} · {timestamp(item.createdAt)}</span><h2>{item.seriesRef}</h2><p>{item.scope.accountRef} · {item.scope.campaignRef} · {item.scope.contextRef}</p></div><span className={styles.readOnlyBadge}>NO APPROVAL · NO EXECUTE</span></header>
    <div className={styles.budgetLabFacts}><div><span>Mapping</span><strong>{item.mapping?.status ?? "İstenmedi"}</strong><small>{item.mapping?.selected?.metricRef ?? item.mapping?.suppressionReasons.join(" · ") ?? "Keep/conservative"}</small></div><div><span>Alternatif</span><strong>{item.alternatives.length}</strong><small>En fazla üç açıklanabilir senaryo</small></div><div><span>Yetki</span><strong>none</strong><small>{item.writeOperations} write operation</small></div></div>
    <div className={styles.budgetAlternativeList}>{item.alternatives.map((alternative) => alternative.status === "suppressed"
      ? <article key={alternative.scenarioRef}><header><strong>{alternative.scenarioRef}</strong><span>SUPPRESSED</span></header><p>{alternative.reason} · {alternative.mappingSuppressionReasons.join(" · ")}</p></article>
      : <article key={alternative.scenarioRef}><header><strong>{alternative.scenarioRef}</strong><span>{alternative.result.status.toUpperCase()}</span></header><div className={styles.budgetBeforeAfter}><div><span>Önce</span><strong>{money(alternative.result.before.totalAllocationMinor, alternative.result.currency)}</strong></div><span>→</span><div><span>Sonra</span><strong>{money(alternative.result.after.totalAllocationMinor, alternative.result.currency)}</strong></div></div><dl><div><dt>Karar nedeni</dt><dd>{alternative.result.reason}</dd></div><div><dt>Constraint</dt><dd>{alternative.result.traceSummary.constraintStatus} · {alternative.result.traceSummary.constraintReason}</dd></div><div><dt>Pacing</dt><dd>{alternative.result.traceSummary.pacingStatus}{alternative.result.traceSummary.pacingSuppressionReasons.length ? ` · ${alternative.result.traceSummary.pacingSuppressionReasons.join(" · ")}` : ""}</dd></div><div><dt>Trace</dt><dd>{alternative.result.traceSummary.stepCount} adım · {alternative.result.traceSummary.stages.join(" → ") || "sonuç"}</dd></div></dl><div className={styles.budgetAllocationRows}>{alternative.result.after.allocations.map((allocation, index) => <p key={allocation.ref}><span>Tahsis {index + 1}</span><strong>{money(alternative.result.before.allocations[index]?.amountMinor ?? 0, alternative.result.currency)} → {money(allocation.amountMinor, alternative.result.currency)}</strong><small>{allocation.deltaMinor >= 0 ? "+" : ""}{money(allocation.deltaMinor, alternative.result.currency)}</small></p>)}</div></article>)}</div>
  </section>;
}

export function BudgetLabPanel(props: Readonly<{ onOpenSession?: () => void }> = {}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/budget-lab?view=list&limit=50", { cache: "no-store" });
      const payload = await response.json() as Envelope<BudgetLabListResult> | ErrorEnvelope;
      if (!response.ok) {
        const remoteError = "error" in payload ? payload.error : undefined;
        setState({ status: remoteError?.code === "local_session_required" ? "session_required" : response.status === 503 ? "unavailable" : "error", message: remoteError?.message ?? "Budget Lab yanıtı alınamadı." });
        return;
      }
      if (!("result" in payload) || payload.result.view !== "list") throw new Error("invalid_contract");
      setState({ status: "ready", result: payload.result, selected: null });
    } catch { setState({ status: "error", message: "Budget Lab bağlantısı şu anda kullanılamıyor." }); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const select = useCallback(async (summary: BudgetLabSummary) => {
    try {
      const query = new URLSearchParams({ view: "detail", seriesRef: summary.seriesRef, revision: String(summary.revision) });
      const response = await fetch(`/api/budget-lab?${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error("detail_failed");
      const payload = await response.json() as Envelope<BudgetLabDetailResult>;
      if (payload.result.view !== "detail" || payload.result.item.proposalRef !== summary.proposalRef) throw new Error("invalid_contract");
      setState((current) => current.status === "ready" ? { ...current, selected: payload.result.item } : current);
    } catch { setState({ status: "error", message: "Bütçe önerisi güvenli biçimde okunamadı." }); }
  }, []);
  return <BudgetLabReadSurface state={state} onRetry={() => void load()} onSelect={(item) => void select(item)} onOpenSession={props.onOpenSession} />;
}
