"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  ExistingPostPromotionPreflightRequest,
  ExistingPostPromotionPreflightResult,
} from "@/application/existing-post-promotion-preflight-service";
import {
  parseExistingPostPromotionCatalogResult,
  type ExistingPostPromotionCatalog as PromotionPreflightCatalog,
  type PromotionCatalogOption as PromotionPreflightOption,
} from "@/application/existing-post-promotion-catalog";
import styles from "./operating-dashboard.module.css";

export type { PromotionPreflightCatalog, PromotionPreflightOption };

export type PromotionPreflightSurfaceState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "unavailable" | "error"; message: string }>
  | Readonly<{
    status: "ready";
    catalog: PromotionPreflightCatalog;
    selection: Partial<ExistingPostPromotionPreflightRequest>;
    result: ExistingPostPromotionPreflightResult | null;
    evaluating: boolean;
    message: string | null;
  }>;

type SelectionKey = keyof ExistingPostPromotionPreflightRequest;
type MutableSelection = { -readonly [K in SelectionKey]?: ExistingPostPromotionPreflightRequest[K] };
type ErrorEnvelope = Readonly<{ error?: Readonly<{ message?: string }> }>;

const FIELDS: readonly Readonly<{
  key: SelectionKey;
  label: string;
  placeholder: string;
}>[] = [
  { key: "accountRef", label: "Reklam hesabı", placeholder: "Hesap seçin" },
  { key: "adSetRef", label: "Mevcut reklam seti", placeholder: "Reklam seti seçin" },
  { key: "actorRef", label: "Yayın kimliği", placeholder: "Page / Instagram seçin" },
  { key: "postRef", label: "Mevcut gönderi", placeholder: "Yayınlanmış gönderi seçin" },
  { key: "internalCategoryRef", label: "İç kampanya kategorisi", placeholder: "Kategori seçin" },
  { key: "objectiveRef", label: "Amaç", placeholder: "Amaç seçin" },
  { key: "promotionTemplateRef", label: "Yayınlanmış şablon", placeholder: "Şablon seçin" },
  { key: "audiencePresetRef", label: "Zorunlu hedef kitle preset’i", placeholder: "Şablonun preset’ini seçin" },
  { key: "budgetPlanRef", label: "Bütçe planı", placeholder: "Plan seçin" },
  { key: "timeframeRef", label: "Zaman aralığı", placeholder: "Timeframe seçin" },
] as const;

function optionsFor(
  catalog: PromotionPreflightCatalog,
  selection: Partial<ExistingPostPromotionPreflightRequest>,
  key: SelectionKey,
): readonly PromotionPreflightOption[] {
  if (key === "accountRef") return catalog.accounts;
  if (key === "adSetRef") return catalog.adSets.filter((item) => item.accountRef === selection.accountRef);
  if (key === "actorRef") return catalog.actors.filter((item) => item.accountRef === selection.accountRef);
  if (key === "postRef") return catalog.posts.filter((item) => item.actorRef === selection.actorRef);
  if (key === "internalCategoryRef") return catalog.internalCategories;
  if (key === "objectiveRef") return catalog.objectives;
  if (key === "promotionTemplateRef") return catalog.templates.filter((item) =>
    (!selection.accountRef || item.accountRefs.includes(selection.accountRef))
    && (!selection.actorRef || item.actorRefs.includes(selection.actorRef))
    && (!selection.internalCategoryRef || item.internalCategoryRefs.includes(selection.internalCategoryRef))
    && (!selection.objectiveRef || item.objectiveRefs.includes(selection.objectiveRef)));
  if (key === "audiencePresetRef") {
    const template = catalog.templates.find((item) => item.ref === selection.promotionTemplateRef);
    return template ? catalog.audiencePresets.filter((item) => item.ref === template.requiredAudiencePresetRef) : [];
  }
  if (key === "budgetPlanRef") return catalog.budgetPlans;
  return catalog.timeframes;
}

function isComplete(selection: Partial<ExistingPostPromotionPreflightRequest>): selection is ExistingPostPromotionPreflightRequest {
  return FIELDS.every((field) => typeof selection[field.key] === "string" && selection[field.key]!.length > 0);
}

function money(minor: number, currency: string) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency, maximumFractionDigits: 2 }).format(minor / 100);
}

function timestamp(value: string, timezone: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value));
}

export async function requestExistingPostPromotionPreflight(
  fetcher: typeof fetch,
  selection: ExistingPostPromotionPreflightRequest,
): Promise<ExistingPostPromotionPreflightResult> {
  const response = await fetcher("/api/existing-post-promotion-preflight", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-ReklamZeka-Intent": "existing-post-promotion-preflight",
    },
    body: JSON.stringify({ selection }),
  });
  const payload = await response.json() as Readonly<{
    contractVersion?: unknown;
    result?: ExistingPostPromotionPreflightResult;
    authority?: Readonly<{ canPersist?: unknown; canApprove?: unknown; canExecute?: unknown; canWriteMeta?: unknown; canGenerateCreative?: unknown }>;
  }> | ErrorEnvelope;
  if (!response.ok || !("result" in payload) || !payload.result || !("authority" in payload) || !payload.authority) {
    const message = "error" in payload ? payload.error?.message : undefined;
    throw new Error(message ?? "Öne çıkarma ön kontrolü tamamlanamadı.");
  }
  const selectionMatches = Object.entries(selection).every(([key, value]) =>
    payload.result?.selection[key as keyof ExistingPostPromotionPreflightRequest] === value);
  if (payload.contractVersion !== "existing-post-promotion-agent/1.0.0" || !selectionMatches
    || payload.result.authority.ephemeral !== true || payload.result.authority.canPersistProposal !== false
    || payload.result.authority.canApprove !== false || payload.result.authority.canExecute !== false
    || payload.result.authority.canWriteMeta !== false || payload.result.authority.canGenerateCreative !== false
    || payload.authority.canPersist !== false
    || payload.authority.canApprove !== false || payload.authority.canWriteMeta !== false
    || payload.authority.canExecute !== false || payload.authority.canGenerateCreative !== false) {
    throw new Error("Güvenli preflight sözleşmesi doğrulanamadı.");
  }
  return payload.result;
}

export async function requestExistingPostPromotionCatalog(fetcher: typeof fetch): Promise<PromotionPreflightCatalog> {
  const response = await fetcher("/api/existing-post-promotion-preflight", {
    method: "GET", credentials: "same-origin", cache: "no-store",
    headers: { "X-ReklamZeka-Intent": "existing-post-promotion-catalog-read" },
  });
  const payload = await response.json() as unknown;
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload
      ? (payload as ErrorEnvelope).error?.message : undefined;
    throw Object.assign(new Error(message ?? "Öne çıkarma seçim kataloğu alınamadı."), { unavailable: response.status === 503 });
  }
  return parseExistingPostPromotionCatalogResult(payload).catalog;
}

function catalogHasSelections(catalog: PromotionPreflightCatalog) {
  return catalog.accounts.length > 0 && catalog.actors.length > 0 && catalog.posts.length > 0 && catalog.templates.length > 0
    && catalog.audiencePresets.length > 0 && catalog.internalCategories.length > 0 && catalog.objectives.length > 0
    && catalog.adSets.length > 0 && catalog.budgetPlans.length > 0 && catalog.timeframes.length > 0;
}

export function PromotionPreflightSurface(props: Readonly<{
  state: PromotionPreflightSurfaceState;
  onRetry(): void;
  onChange(key: SelectionKey, value: string): void;
  onEvaluate(): void;
}>) {
  const ready = props.state.status === "ready" ? props.state : null;
  const preview = ready?.result?.proposalPreview ?? null;
  return <>
    <section className={styles.pageHero}>
      <div><span className={styles.kicker}>EXISTING POST PROMOTION · K4 PREFLIGHT</span><h1>Mevcut gönderiyi, kilitli şablon ve hedef kitleyle değerlendirin.</h1><p>Yalnız yayınlanmış Page/Instagram gönderileri ve sunucunun sunduğu referanslar kullanılabilir. Bu yüzey kreatif üretmez, hedef kitleyi değiştirmez, taslak kaydetmez, onaylamaz veya Meta’ya yazmaz.</p></div>
      <span className={styles.readOnlyBadge}>EPHEMERAL · APPROVAL REQUIRED</span>
    </section>
    {props.state.status === "loading" ? <section className={`${styles.panel} ${styles.promotionPreflightState}`} role="status"><strong>Kaynak doğrulanıyor</strong><h2>Yayınlanmış şablonlar ve mevcut gönderiler bekleniyor.</h2><p>Serbest ID, ham targeting veya kreatif alanı açılmaz.</p></section> : null}
    {props.state.status === "unavailable" ? <section className={`${styles.panel} ${styles.promotionPreflightState}`} role="alert"><strong>Kaynak henüz bağlı değil</strong><h2>{props.state.message}</h2><p>Güvenilir seçenek kataloğu olmadan gönderi, hesap, şablon veya hedef kitle uydurulmaz. Meta write ve proposal persistence kapalı kalır.</p><button onClick={props.onRetry}>Tekrar kontrol et</button></section> : null}
    {props.state.status === "error" ? <section className={`${styles.panel} ${styles.promotionPreflightState}`} role="alert"><strong>Preflight okunamadı</strong><h2>{props.state.message}</h2><p>Kısmi veya sözleşme dışı yanıtlar formu açmaz.</p><button onClick={props.onRetry}>Tekrar dene</button></section> : null}
    {ready && !catalogHasSelections(ready.catalog) ? <section className={`${styles.panel} ${styles.promotionPreflightState}`}><strong>Kaynak bağlı · katalog boş</strong><h2>Bu çalışma alanında henüz uygun öne çıkarma seçimi bulunmuyor.</h2><p>Yayınlanmış şablon, immutable preset ve mevcut gönderi tamamlanmadan form açılmaz.</p></section> : null}
    {ready && catalogHasSelections(ready.catalog) ? <div className={styles.promotionPreflightWorkspace}>
      <section className={`${styles.panel} ${styles.promotionPreflightForm}`} aria-label="Mevcut gönderi öne çıkarma seçimi">
        <header className={styles.panelHeader}><div><span className={styles.kicker}>GUIDED SELECTION</span><h2>Sunucu tarafından doğrulanan seçimler</h2></div><span>Ref-only</span></header>
        <div className={styles.promotionPreflightFields}>{FIELDS.map((field) => {
          const options = optionsFor(ready.catalog, ready.selection, field.key);
          return <label key={field.key}><span>{field.label}</span><select aria-label={field.label} value={ready.selection[field.key] ?? ""} disabled={ready.evaluating || options.length === 0} onChange={(event) => props.onChange(field.key, event.target.value)}><option value="">{options.length ? field.placeholder : "Uygun seçenek yok"}</option>{options.map((item) => <option key={item.ref} value={item.ref}>{item.label}</option>)}</select></label>;
        })}</div>
        <footer><p>Hedef kitle preset’i şablon tarafından zorunlu tutulur; geo, yaş, dil, ilgi alanı ve hariç tutmalar burada düzenlenemez.</p><button disabled={!isComplete(ready.selection) || ready.evaluating} onClick={props.onEvaluate}>{ready.evaluating ? "Kontrol ediliyor…" : "K4 ön kontrolünü çalıştır"}</button></footer>
        {ready.message ? <p className={styles.promotionPreflightMessage} role="alert">{ready.message}</p> : null}
      </section>
      <section className={`${styles.panel} ${styles.promotionPreflightPreview}`} aria-label="Öne çıkarma ön kontrol sonucu">
        {!ready.result ? <div className={styles.promotionPreflightPlaceholder}><strong>Henüz değerlendirilmedi</strong><h2>Exact before → after özeti burada görünür.</h2><p>Bu özet bir teklif kaydı veya Meta değişikliği değildir.</p></div> : <>
          <header><div><span className={styles.kicker}>COMPATIBILITY & GUIDANCE</span><h2>{ready.result.status === "ready_for_approval_proposal" ? "Onay önerisine hazırlanabilir" : ready.result.status === "blocked" ? "Kurallar nedeniyle engellendi" : "İnsan incelemesi gerekiyor"}</h2></div><span data-status={ready.result.status}>{ready.result.status}</span></header>
          {ready.result.reasons.length ? <div className={styles.promotionPreflightReasons}>{ready.result.reasons.map((item) => <p key={`${item.source}:${item.code}`}><span>{item.source}</span><strong>{item.code}</strong><i data-disposition={item.disposition}>{item.disposition}</i></p>)}</div> : <p className={styles.promotionPreflightClear}>Şablon, preset, Meta uygunluğu ve aktif guidance kontrollerinde engel bulunmadı.</p>}
          {preview ? <div className={styles.promotionBeforeAfter}><div><span>Önce</span><strong>Mevcut gönderi · değişmez</strong><small>{ready.selection.postRef}</small></div><b>→</b><div><span>Sonra</span><strong>K4 reklam önerisi · approval_required</strong><small>{preview.actorType} · {money(preview.budget.amountMinor, preview.budget.currency)} / {preview.budget.kind === "daily" ? "gün" : "dönem"}</small></div></div> : null}
          {preview ? <dl className={styles.promotionPreflightFacts}><div><dt>Şablon</dt><dd>{ready.selection.promotionTemplateRef}</dd></div><div><dt>Immutable preset</dt><dd>{ready.selection.audiencePresetRef}</dd></div><div><dt>Timeframe</dt><dd>{timestamp(preview.timeframe.startAt, preview.timeframe.timezone)}{preview.timeframe.endAt ? ` → ${timestamp(preview.timeframe.endAt, preview.timeframe.timezone)} · ${preview.timeframe.durationDays} gün` : " → sürekli"}</dd></div><div><dt>Risk / durum</dt><dd>{preview.risk} · {preview.disposition}</dd></div></dl> : null}
          <footer><span>Persist: kapalı</span><span>Approval: kapalı</span><span>Execute: kapalı</span><span>Meta write: kapalı</span><span>Creative generation: kapalı</span></footer>
        </>}
      </section>
    </div> : null}
  </>;
}

export function PromotionPreflightPanel() {
  const [state, setState] = useState<PromotionPreflightSurfaceState>({ status: "loading" });
  const selection = state.status === "ready" ? state.selection : {};
  const requiredPreset = useMemo(() => {
    if (state.status !== "ready") return null;
    return state.catalog.templates.find((item) => item.ref === state.selection.promotionTemplateRef)?.requiredAudiencePresetRef ?? null;
  }, [state]);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const catalog = await requestExistingPostPromotionCatalog(fetch);
      setState({ status: "ready", catalog, selection: {}, result: null, evaluating: false, message: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Öne çıkarma seçim kataloğu alınamadı.";
      setState({ status: error && typeof error === "object" && "unavailable" in error ? "unavailable" : "error", message });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const change = useCallback((key: SelectionKey, value: string) => {
    setState((current) => {
      if (current.status !== "ready") return current;
      const next: MutableSelection = { ...current.selection, [key]: value || undefined };
      if (key === "accountRef") { delete next.adSetRef; delete next.actorRef; delete next.postRef; delete next.promotionTemplateRef; delete next.audiencePresetRef; }
      if (key === "actorRef") { delete next.postRef; delete next.promotionTemplateRef; delete next.audiencePresetRef; }
      if (key === "internalCategoryRef" || key === "objectiveRef") { delete next.promotionTemplateRef; delete next.audiencePresetRef; }
      if (key === "promotionTemplateRef") {
        const template = current.catalog.templates.find((item) => item.ref === value);
        next.audiencePresetRef = template?.requiredAudiencePresetRef;
      }
      return { ...current, selection: next, result: null, message: null };
    });
  }, []);

  const evaluate = useCallback(async () => {
    if (state.status !== "ready" || !isComplete(selection) || requiredPreset !== selection.audiencePresetRef) return;
    setState((current) => current.status === "ready" ? { ...current, evaluating: true, message: null } : current);
    try {
      const result = await requestExistingPostPromotionPreflight(fetch, selection);
      setState((current) => current.status === "ready" ? { ...current, evaluating: false, result, message: null } : current);
    } catch (error) {
      setState((current) => current.status === "ready" ? { ...current, evaluating: false, result: null, message: error instanceof Error ? error.message : "Preflight tamamlanamadı." } : current);
    }
  }, [requiredPreset, selection, state.status]);

  return <PromotionPreflightSurface state={state} onRetry={() => void load()} onChange={change} onEvaluate={() => void evaluate()} />;
}
