"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  PracticeLabDetail,
  PracticeLabDetailResult,
  PracticeLabDraftResult,
  PracticeLabListResult,
  PracticeLabSummary,
} from "@/application/practice-lab-read-service";
import styles from "./operating-dashboard.module.css";

type State =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "unavailable" | "error"; message: string }>
  | Readonly<{ status: "ready"; result: PracticeLabListResult; selected: PracticeLabDetail | null; draft: PracticeLabDraftResult["draft"] | null }>;

type Envelope<T> = Readonly<{ result: T }>;
type ErrorEnvelope = Readonly<{ error?: Readonly<{ message?: string }> }>;

function timestamp(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul",
  }).format(new Date(value));
}

function stateLabel(item: PracticeLabSummary) {
  if (item.state === "standardization_reviewed") return "Standardization review";
  if (item.state === "trial") return "Trial";
  if (item.state === "validated") return "Validated";
  if (item.state === "conditional") return "Conditional";
  if (item.state === "rejected") return "Rejected";
  if (item.state === "retired") return "Retired";
  if (item.state === "reviewed") return "Reviewed";
  return "Candidate";
}

export function PracticeLabReadSurface(props: Readonly<{
  state: State;
  onRetry(): void;
  onSelect(practiceRef: string): void;
  onPrepareDraft(practiceRef: string): void;
}>) {
  const ready = props.state.status === "ready" ? props.state : null;
  return <>
    <section className={styles.pageHero}>
      <div><span className={styles.kicker}>PRACTICE LAB · READ / EPHEMERAL DRAFT</span><h1>Şahsi yaklaşımınız, kanıtı ve yaşam döngüsüyle görünür.</h1><p>Owner anlatımı ve resmi Meta kaynakları birlikte okunur. Agent yalnız geçici görüşme taslağı hazırlayabilir; guidance, policy, otomasyon veya eylem üretemez.</p></div>
      <span className={styles.readOnlyBadge}>ADVISORY ONLY · NO PERSIST</span>
    </section>

    {props.state.status === "loading" ? <section className={`${styles.panel} ${styles.practiceLabState}`} role="status"><span className={styles.liveDot} /><h2>Practice zincirleri doğrulanıyor</h2><p>Tenant kapsamı ve append-only lifecycle bütünlüğü sunucuda kontrol edilir.</p></section> : null}
    {props.state.status === "unavailable" ? <section className={`${styles.panel} ${styles.practiceLabState}`} role="alert"><strong>Kaynak henüz bağlı değil</strong><h2>{props.state.message}</h2><p>Demo practice gösterilmez. Aynı güvenli yerel oturum Decision Room ve Practice Lab okumalarını çalışma alanına bağlar.</p><button onClick={props.onRetry}>Tekrar kontrol et</button></section> : null}
    {props.state.status === "error" ? <section className={`${styles.panel} ${styles.practiceLabState}`} role="alert"><strong>Practice Lab okunamadı</strong><h2>{props.state.message}</h2><p>Güvensiz veya kapsam dışı kayıtlar kısmen gösterilmez; yüzey fail-closed davranır.</p><button onClick={props.onRetry}>Tekrar dene</button></section> : null}
    {ready && ready.result.items.length === 0 ? <section className={`${styles.panel} ${styles.practiceLabState}`}><strong>Kaynak bağlı · practice yok</strong><h2>Bu çalışma alanında henüz advised practice bulunmuyor.</h2><p>Bu gerçek, tenant-bound boş yanıttır; fixture veya demo fallback değildir.</p></section> : null}
    {ready && ready.result.items.length > 0 ? <div className={styles.practiceLabWorkspace}>
      <section className={`${styles.panel} ${styles.practiceLabIndex}`}>
        <header className={styles.panelHeader}><div><span className={styles.kicker}>ADVISED PRACTICES</span><h2>{ready.result.items.length} kayıt</h2></div><span>Public-safe projection</span></header>
        <div>{ready.result.items.map((item) => <button key={item.practiceRef} data-active={ready.selected?.practiceRef === item.practiceRef} onClick={() => props.onSelect(item.practiceRef)}><span><strong>{item.problem}</strong><small>{item.scope.internalCategories.join(" · ") || item.scope.objectives.join(" · ") || "Global kapsam"}</small></span><i>{stateLabel(item)}</i></button>)}</div>
      </section>
      <PracticeDetail detail={ready.selected} draft={ready.draft} onPrepareDraft={props.onPrepareDraft} />
    </div> : null}
  </>;
}

function PracticeDetail(props: Readonly<{
  detail: PracticeLabDetail | null;
  draft: PracticeLabDraftResult["draft"] | null;
  onPrepareDraft(practiceRef: string): void;
}>) {
  if (!props.detail) return <section className={`${styles.panel} ${styles.practiceLabState}`}><strong>Practice seçin</strong><h2>Tanım, kapsam, kaynak incelemesi ve lifecycle burada açılır.</h2><p>Teknik kimlikler, hash zinciri, owner/source/evidence referansları ve ham payload bu yüzeye çıkmaz.</p></section>;
  const item = props.detail;
  return <section className={`${styles.panel} ${styles.practiceLabDetail}`}>
    <header><div><span className={styles.kicker}>{stateLabel(item)} · v{item.version}</span><h2>{item.problem}</h2><p>Güven {Math.round(item.confidence * 100)}% · Son hareket {timestamp(item.updatedAt)}</p></div><button onClick={() => props.onPrepareDraft(item.practiceRef)}>Agent taslak bağlamı</button></header>
    <div className={styles.practiceLabFacts}><div><span>Kapsam</span><strong>{item.scope.kind === "global" ? "Global" : "Sınırlandırılmış"}</strong><small>{item.scope.internalCategories.join(" · ") || item.scope.objectives.join(" · ") || "Genel"}</small></div><div><span>Kaynak</span><strong>Owner + {item.sources.officialMetaSourceCount} resmi Meta</strong><small>{item.sources.evidenceCount} evidence · {item.sources.alignment}</small></div><div><span>Outcome</span><strong>{item.outcomeStatus ?? "Henüz yok"}</strong><small>Standardization: {item.standardizationReviewStatus}</small></div></div>
    <div className={styles.practiceLabNarrative}><article><span>Gerekçe</span><p>{item.rationale}</p></article><article><span>Karar temposu</span><p>{item.cadence}</p></article></div>
    <section><span className={styles.kicker}>ORDERED PRACTICE</span><ol>{item.steps.map((step) => <li key={step}>{step}</li>)}</ol></section>
    <section><span className={styles.kicker}>LIFECYCLE</span><div className={styles.practiceTimeline}>{item.timeline.map((event) => <article key={event.sequence}><span>{event.sequence}</span><div><strong>{event.eventType.replaceAll("_", " ")}</strong><p>{event.note}</p><small>{timestamp(event.occurredAt)} · evidence {event.evidenceCount}</small></div></article>)}</div></section>
    {props.draft?.practice.practiceRef === item.practiceRef ? <section className={styles.practiceDraft}><span className={styles.kicker}>EPHEMERAL · UNPERSISTED</span><h3>Agent görüşme taslağı</h3>{props.draft.collaborationQuestions.map((question) => <p key={question}>{question}</p>)}<small>İnsan incelemesi zorunlu · hiçbir policy/automation/action üretilmedi.</small></section> : null}
  </section>;
}

export function PracticeLabPanel() {
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/practice-lab?view=list&limit=50", { cache: "no-store" });
      const payload = await response.json() as Envelope<PracticeLabListResult> | ErrorEnvelope;
      if (!response.ok) {
        const message = "error" in payload ? payload.error?.message : undefined;
        setState({ status: response.status === 503 ? "unavailable" : "error", message: message ?? "Practice Lab yanıtı alınamadı." });
        return;
      }
      if (!("result" in payload) || payload.result.view !== "list") throw new Error("invalid_contract");
      setState({ status: "ready", result: payload.result, selected: null, draft: null });
    } catch {
      setState({ status: "error", message: "Practice Lab bağlantısı şu anda kullanılamıyor." });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const select = useCallback(async (practiceRef: string) => {
    try {
      const response = await fetch(`/api/practice-lab?view=detail&practiceRef=${encodeURIComponent(practiceRef)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("detail_failed");
      const payload = await response.json() as Envelope<PracticeLabDetailResult>;
      if (payload.result.view !== "detail") throw new Error("invalid_contract");
      setState((current) => current.status === "ready" ? { ...current, selected: payload.result.item, draft: null } : current);
    } catch {
      setState({ status: "error", message: "Practice detayı güvenli biçimde okunamadı." });
    }
  }, []);

  const prepareDraft = useCallback(async (practiceRef: string) => {
    try {
      const response = await fetch(`/api/practice-lab?view=draft&practiceRef=${encodeURIComponent(practiceRef)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("draft_failed");
      const payload = await response.json() as Envelope<PracticeLabDraftResult>;
      if (payload.result.view !== "draft") throw new Error("invalid_contract");
      setState((current) => current.status === "ready" ? { ...current, draft: payload.result.draft } : current);
    } catch {
      setState({ status: "error", message: "Geçici agent taslak bağlamı hazırlanamadı." });
    }
  }, []);

  return <PracticeLabReadSurface state={state} onRetry={() => void load()} onSelect={(ref) => void select(ref)} onPrepareDraft={(ref) => void prepareDraft(ref)} />;
}
