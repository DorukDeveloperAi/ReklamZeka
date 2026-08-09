"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./operating-dashboard.module.css";

type GuidanceFacet = "global" | "account_group" | "account" | "objective" | "funnel" | "optimization"
  | "internal_category" | "lifecycle" | "entity" | "promotion_template" | "topic";
type GuidanceEntityType = null | "campaign" | "ad_set" | "ad" | "creative" | "post";
type GuidanceStrength = "must" | "should" | "consider" | "avoid" | "question";
type GuidanceStatus = "draft" | "published" | "archived";
type GuidanceSourceType = "owner_statement" | "official_meta_guidance" | "business_strategy"
  | "observed_result" | "experiment_outcome" | "operating_note";

type GuidanceScope = Readonly<{
  facet: GuidanceFacet;
  value: string | null;
  entityType: GuidanceEntityType;
  mode: "default" | "exception";
  priority: number;
}>;

type GuidanceItem = Readonly<{
  cardRef: string;
  version: number;
  title: string;
  body: string;
  strength: GuidanceStrength;
  topic: string;
  status: GuidanceStatus;
  sources: readonly Readonly<{ type: GuidanceSourceType; ref: string; url: string | null; capturedAt: string | null;
    reviewedAt: string | null; reviewBy: string | null }>[];
  scopes: readonly GuidanceScope[];
  updatedAt: string | null;
}>;
type GuidanceSetItem = Readonly<{
  setRef: string;
  version: number;
  name: string;
  reviewStatus: "draft" | "reviewed" | "archived";
  orderedCards: readonly Readonly<{
    cardRef: string;
    title: string;
    version: number;
    status: GuidanceStatus;
  }>[];
}>;

type GuidanceCategory = Readonly<{ ref: string; label: string; dimension: string }>;
type GuidanceAuthority = Readonly<{
  canDraft: boolean;
  canPublish: boolean;
  canReview: boolean;
  canArchive: boolean;
  canWriteMeta: false;
  canAuthorizeAction: false;
  canEnforcePolicy: false;
}>;
type GuidanceStudioSnapshot = Readonly<{
  contractVersion: string;
  items: readonly GuidanceItem[];
  sets: readonly GuidanceSetItem[];
  categories: readonly GuidanceCategory[];
  authority: GuidanceAuthority;
  registryHash: string;
}>;

type Draft = Readonly<{
  title: string;
  body: string;
  strength: GuidanceStrength;
  topic: string;
  scopes: readonly GuidanceScope[];
  source: Readonly<{ type: GuidanceSourceType; ref: string; url: string; capturedAt: string; reviewBy: string }>;
}>;

const EMPTY_DRAFT: Draft = Object.freeze({
  title: "",
  body: "",
  strength: "should",
  topic: "",
  scopes: Object.freeze([Object.freeze({ facet: "global", value: null, entityType: null, mode: "default", priority: 50 })]),
  source: Object.freeze({ type: "owner_statement", ref: "owner_statement_manual", url: "", capturedAt: "", reviewBy: "" }),
});
const FACETS: readonly Readonly<{ value: GuidanceFacet; label: string }>[] = Object.freeze([
  { value: "global", label: "Tüm çalışma alanı" },
  { value: "account_group", label: "Hesap grubu" },
  { value: "account", label: "Reklam hesabı" },
  { value: "objective", label: "Meta objective" },
  { value: "funnel", label: "Funnel aşaması" },
  { value: "optimization", label: "Optimizasyon olayı" },
  { value: "internal_category", label: "İç kategori" },
  { value: "lifecycle", label: "Yaşam döngüsü" },
  { value: "entity", label: "Tek varlık" },
  { value: "promotion_template", label: "Promotion template" },
  { value: "topic", label: "Konu" },
]);
const SOURCE_TYPES: readonly Readonly<{ value: GuidanceSourceType; label: string }>[] = Object.freeze([
  { value: "owner_statement", label: "Owner anlatımı" },
  { value: "official_meta_guidance", label: "Resmî Meta kaynağı" },
  { value: "business_strategy", label: "İş stratejisi" },
  { value: "observed_result", label: "Gözlemlenen sonuç" },
  { value: "experiment_outcome", label: "Deney sonucu" },
  { value: "operating_note", label: "Operasyon notu" },
]);
const STRENGTHS: readonly Readonly<{ value: GuidanceStrength; label: string }>[] = Object.freeze([
  { value: "must", label: "Mutlaka dikkate al" },
  { value: "should", label: "Öncelikle dikkate al" },
  { value: "consider", label: "Değerlendir" },
  { value: "avoid", label: "Kaçın" },
  { value: "question", label: "Soru olarak gündeme al" },
]);
const ENTITY_TYPES: readonly Exclude<GuidanceEntityType, null>[] = Object.freeze(["campaign", "ad_set", "ad", "creative", "post"]);

class GuidanceStudioRequestError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = "GuidanceStudioRequestError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isScope(value: unknown): value is GuidanceScope {
  if (!isObject(value)) return false;
  return ["global", "account_group", "account", "objective", "funnel", "optimization", "internal_category",
    "lifecycle", "entity", "promotion_template", "topic"].includes(String(value.facet))
    && (value.value === null || typeof value.value === "string")
    && (value.entityType === null || ENTITY_TYPES.includes(value.entityType as Exclude<GuidanceEntityType, null>))
    && (value.mode === "default" || value.mode === "exception")
    && typeof value.priority === "number" && Number.isInteger(value.priority)
    && value.priority >= 0 && value.priority <= 100;
}

function isItem(value: unknown): value is GuidanceItem {
  if (!isObject(value)) return false;
  const sources = value.sources;
  return typeof value.cardRef === "string" && Number.isInteger(value.version) && Number(value.version) > 0
    && typeof value.title === "string" && typeof value.body === "string" && typeof value.topic === "string"
    && ["must", "should", "consider", "avoid", "question"].includes(String(value.strength))
    && ["draft", "published", "archived"].includes(String(value.status))
    && Array.isArray(sources) && sources.length >= 1 && sources.every((source) => isObject(source)
      && SOURCE_TYPES.some((entry) => entry.value === source.type)
      && typeof source.ref === "string" && (source.url === null || typeof source.url === "string")
      && (source.capturedAt === null || typeof source.capturedAt === "string")
      && (source.reviewedAt === null || typeof source.reviewedAt === "string")
      && (source.reviewBy === null || typeof source.reviewBy === "string"))
    && (value.updatedAt === null || typeof value.updatedAt === "string") && Array.isArray(value.scopes)
    && value.scopes.length >= 1 && value.scopes.length <= 12 && value.scopes.every(isScope);
}

function isSetItem(value: unknown): value is GuidanceSetItem {
  if (!isObject(value) || typeof value.setRef !== "string" || !Number.isInteger(value.version)
    || Number(value.version) < 1 || typeof value.name !== "string"
    || !["draft", "reviewed", "archived"].includes(String(value.reviewStatus))
    || !Array.isArray(value.orderedCards) || value.orderedCards.length < 1 || value.orderedCards.length > 50) return false;
  return value.orderedCards.every((card) => isObject(card) && typeof card.cardRef === "string"
    && typeof card.title === "string" && Number.isInteger(card.version) && Number(card.version) > 0
    && ["draft", "published", "archived"].includes(String(card.status)));
}

export function parseGuidanceStudioSnapshot(value: unknown): GuidanceStudioSnapshot {
  if (!isObject(value) || typeof value.contractVersion !== "string" || !Array.isArray(value.items)
    || !value.items.every(isItem) || !Array.isArray(value.sets) || !value.sets.every(isSetItem)
    || !Array.isArray(value.categories)
    || !value.categories.every((category) => isObject(category) && typeof category.ref === "string"
      && typeof category.label === "string" && typeof category.dimension === "string")
    || !isObject(value.authority) || typeof value.authority.canDraft !== "boolean"
    || typeof value.authority.canPublish !== "boolean" || typeof value.authority.canReview !== "boolean"
    || typeof value.authority.canArchive !== "boolean"
    || value.authority.canWriteMeta !== false || value.authority.canAuthorizeAction !== false
    || value.authority.canEnforcePolicy !== false || typeof value.registryHash !== "string") {
    throw new GuidanceStudioRequestError("unsafe_response", "Talimat kaynağı beklenen güvenli sözleşmeyi döndürmedi.", 503);
  }
  return value as unknown as GuidanceStudioSnapshot;
}

async function responsePayload(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

function errorFromResponse(response: Response, payload: unknown): GuidanceStudioRequestError {
  const error = isObject(payload) && isObject(payload.error) ? payload.error : null;
  const code = error && typeof error.code === "string" ? error.code : response.status === 409 ? "conflict" : "request_failed";
  const message = error && typeof error.message === "string" ? error.message : "Talimat işlemi tamamlanamadı.";
  return new GuidanceStudioRequestError(code, message, response.status);
}

function draftFromItem(item: GuidanceItem): Draft {
  const source = item.sources[0]!;
  return { title: item.title, body: item.body, strength: item.strength, topic: item.topic,
    scopes: item.scopes.map((scope) => ({ ...scope })), source: { type: source.type, ref: source.ref,
      url: source.url ?? "", capturedAt: source.capturedAt?.slice(0, 16) ?? "",
      reviewBy: source.reviewBy?.slice(0, 16) ?? "" } };
}

function labelForScope(scope: GuidanceScope, categories: readonly GuidanceCategory[]): string {
  if (scope.facet === "global") return "Tüm çalışma alanı";
  if (scope.facet === "internal_category") {
    const category = categories.find((candidate) => candidate.ref === scope.value);
    return category ? `${category.dimension} · ${category.label}` : "İç kategori · artık erişilemiyor";
  }
  const facet = FACETS.find((candidate) => candidate.value === scope.facet)?.label ?? scope.facet;
  return `${facet} · ${scope.entityType ? `${scope.entityType} · ` : ""}${scope.value ?? "—"}`;
}

function labelForScopes(scopes: readonly GuidanceScope[], categories: readonly GuidanceCategory[]): string {
  return scopes.map((scope) => labelForScope(scope, categories)).join(" + ");
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return "Zaman bilgisi yok";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Zaman bilgisi yok";
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(date);
}

function statusLabel(status: GuidanceStatus): string {
  return status === "published" ? "Yayında" : status === "archived" ? "Arşivli" : "Taslak";
}

function statusTone(status: GuidanceStatus): string {
  return status === "published" ? "good" : status === "archived" ? "neutral" : "guidance";
}

function Status({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) {
  return <span className={styles.statusPill} data-tone={tone}>{children}</span>;
}

type GuidanceSetDraft = Readonly<{ name: string; orderedCardRefs: readonly string[] }>;
const EMPTY_SET_DRAFT: GuidanceSetDraft = Object.freeze({ name: "", orderedCardRefs: Object.freeze([]) });

export function moveGuidanceSetCard(refs: readonly string[], cardRef: string, offset: -1 | 1): readonly string[] {
  const index = refs.indexOf(cardRef);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= refs.length) return refs;
  const next = [...refs];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return Object.freeze(next);
}

function setDraftFromItem(item: GuidanceSetItem): GuidanceSetDraft {
  return { name: item.name, orderedCardRefs: item.orderedCards.map((card) => card.cardRef) };
}

function setStatusLabel(status: GuidanceSetItem["reviewStatus"]): string {
  return status === "reviewed" ? "İncelendi" : status === "archived" ? "Arşivli" : "Taslak";
}

export function GuidanceSetStudio(props: Readonly<{
  snapshot: GuidanceStudioSnapshot;
  onRefresh(): Promise<void>;
}>) {
  const initial = props.snapshot.sets[0] ?? null;
  const [selectedRef, setSelectedRef] = useState<string | null>(initial?.setRef ?? null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<GuidanceSetDraft>(initial ? setDraftFromItem(initial) : EMPTY_SET_DRAFT);
  const [baseline, setBaseline] = useState<GuidanceSetDraft>(initial ? setDraftFromItem(initial) : EMPTY_SET_DRAFT);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const selected = props.snapshot.sets.find((item) => item.setRef === selectedRef) ?? null;
  const publishedCards = props.snapshot.items.filter((item) => item.status === "published");
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const editable = creating || selected?.reviewStatus === "draft";
  const valid = Boolean(draft.name.trim() && draft.orderedCardRefs.length > 0
    && draft.orderedCardRefs.every((ref) => publishedCards.some((card) => card.cardRef === ref)));

  const select = useCallback((item: GuidanceSetItem) => {
    const next = setDraftFromItem(item);
    setSelectedRef(item.setRef); setCreating(false); setDraft(next); setBaseline(next); setMessage(null);
  }, []);

  useEffect(() => {
    if (!creating && selectedRef === null && props.snapshot.sets[0]) select(props.snapshot.sets[0]);
  }, [creating, props.snapshot.sets, select, selectedRef]);

  function beginCreate() {
    setSelectedRef(null); setCreating(true); setDraft(EMPTY_SET_DRAFT); setBaseline(EMPTY_SET_DRAFT); setMessage(null);
  }

  function toggleCard(cardRef: string) {
    if (!editable) return;
    setDraft((current) => ({ ...current, orderedCardRefs: current.orderedCardRefs.includes(cardRef)
      ? current.orderedCardRefs.filter((ref) => ref !== cardRef) : [...current.orderedCardRefs, cardRef] }));
  }

  async function mutate(operation: "create" | "revise" | "review" | "archive") {
    if (saving || !props.snapshot || operation !== "review" && operation !== "archive" && !valid
      || operation !== "create" && !selected) return;
    setSaving(true); setMessage(null);
    const creatingSet = operation === "create";
    const body = creatingSet
      ? { name: draft.name.trim(), orderedCardRefs: draft.orderedCardRefs,
          expectedRegistryHash: props.snapshot.registryHash }
      : { setRef: selected!.setRef, expectedVersion: selected!.version,
          expectedRegistryHash: props.snapshot.registryHash, operation,
          ...(operation === "revise" ? { name: draft.name.trim(), orderedCardRefs: draft.orderedCardRefs } : {}) };
    try {
      const response = await fetch("/api/guidance-studio", { method: creatingSet ? "POST" : "PATCH",
        credentials: "same-origin", headers: { "Content-Type": "application/json",
          "X-ReklamZeka-Intent": `guidance-set-${operation}` }, body: JSON.stringify(body) });
      const payload = await responsePayload(response);
      if (!response.ok) throw errorFromResponse(response, payload);
      const nextSet = isObject(payload) && isSetItem(payload.set) ? payload.set : null;
      if (!nextSet) throw new GuidanceStudioRequestError("unsafe_response", "Guidance set yanıtı doğrulanamadı.", 503);
      select(nextSet);
      await props.onRefresh();
      setMessage(operation === "create" ? "Guidance set taslağı oluşturuldu."
        : operation === "revise" ? "Guidance set yeni sürümle güncellendi."
          : operation === "review" ? "Guidance set incelendi ve analiz bağlamı geçersizleştirildi."
            : "Guidance set arşivlendi.");
    } catch (reason) {
      setMessage(reason instanceof GuidanceStudioRequestError && reason.status === 409
        ? "Set siz düzenlerken değişti; listeyi yenileyip tekrar değerlendirin."
        : reason instanceof Error ? reason.message : "Guidance set işlemi tamamlanamadı.");
    } finally { setSaving(false); }
  }

  return <section className={`${styles.panel} ${styles.guidanceState}`} aria-label="Guidance setleri">
    <header className={styles.panelHeader}><div><span className={styles.kicker}>SIRALI GUIDANCE SETLERİ</span><h2>İnceleme setleri</h2><p>Yalnız yayınlanmış kartlar seçilebilir; sıra analiz gündemine taşınır.</p></div>
      <button type="button" onClick={beginCreate} disabled={!props.snapshot.authority.canDraft || !publishedCards.length}>+ Set oluştur</button></header>
    {message ? <p role="status">{message}</p> : null}
    {!props.snapshot.sets.length && !creating ? <p>Henüz guidance set yok. Önce en az bir kart yayınlayın.</p> : <div className={styles.guidanceWorkspace}>
      <div className={styles.guidanceIndex}>
        {creating ? <button type="button" data-active="true" onClick={beginCreate}><span><strong>Yeni set</strong><small>Henüz kaydedilmedi</small></span><Status tone="guidance">Taslak</Status></button> : null}
        {props.snapshot.sets.map((item) => <button type="button" key={item.setRef}
          data-active={!creating && selectedRef === item.setRef} onClick={() => select(item)}><span><strong>{item.name}</strong>
            <small>{item.orderedCards.length} kart · v{item.version}</small></span>
          <Status tone={item.reviewStatus === "reviewed" ? "good" : "neutral"}>{setStatusLabel(item.reviewStatus)}</Status></button>)}
      </div>
      {(creating || selected) ? <div className={styles.guidanceEditor}>
        <header><div><Status tone={selected?.reviewStatus === "reviewed" ? "good" : "guidance"}>{creating ? "Yeni taslak" : setStatusLabel(selected!.reviewStatus)}</Status>
          <h2>{creating ? "Yeni guidance set" : selected!.name}</h2><p>{creating ? "Yayınlanmış kartlardan sıralı set" : `Sürüm ${selected!.version}`}</p></div><span>guidance_only</span></header>
        <div className={styles.guidanceFields}><label>Set adı<input value={draft.name} maxLength={160}
          disabled={saving || !editable} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
          <fieldset disabled={saving || !editable}><legend>Yayınlanmış kartlar</legend>{publishedCards.map((card) => <label key={card.cardRef}>
            <input type="checkbox" checked={draft.orderedCardRefs.includes(card.cardRef)} onChange={() => toggleCard(card.cardRef)} /> {card.title} · v{card.version}</label>)}</fieldset>
          <div><strong>Uygulama sırası</strong>{draft.orderedCardRefs.map((ref, index) => { const card = publishedCards.find((item) => item.cardRef === ref);
            return <div key={ref}><span>{index + 1}. {card?.title ?? "Artık yayınlanmıyor"}</span>
              {editable ? <><button type="button" disabled={saving || index === 0} onClick={() => setDraft((current) => ({ ...current,
                orderedCardRefs: moveGuidanceSetCard(current.orderedCardRefs, ref, -1) }))}>Yukarı</button>
                <button type="button" disabled={saving || index === draft.orderedCardRefs.length - 1} onClick={() => setDraft((current) => ({ ...current,
                  orderedCardRefs: moveGuidanceSetCard(current.orderedCardRefs, ref, 1) }))}>Aşağı</button>
                <button type="button" disabled={saving} onClick={() => setDraft((current) => ({ ...current,
                  orderedCardRefs: current.orderedCardRefs.filter((candidate) => candidate !== ref) }))}>Çıkar</button></> : null}</div>; })}</div>
        </div>
        <footer>{!creating && selected?.reviewStatus !== "archived" ? <button className={styles.guidanceDangerButton}
          type="button" disabled={saving || !props.snapshot.authority.canArchive} onClick={() => void mutate("archive")}>Arşivle</button> : <span />}
          <div><span>Set action, approval veya Meta write yetkisi taşımaz.</span>
            {!creating && selected?.reviewStatus === "draft" ? <button className={styles.secondaryButton} type="button"
              disabled={saving || dirty || !props.snapshot.authority.canReview} onClick={() => void mutate("review")}>İncelendi olarak işaretle</button> : null}
            {creating || selected?.reviewStatus === "draft" ? <button className={styles.primaryButton} type="button"
              disabled={saving || !props.snapshot.authority.canDraft || !dirty || !valid}
              onClick={() => void mutate(creating ? "create" : "revise")}>{saving ? "Kaydediliyor" : creating ? "Set taslağı oluştur" : "Yeni set sürümü kaydet"}</button> : null}</div></footer>
      </div> : null}
    </div>}
  </section>;
}

export function GuidanceStudioPanel(props: Readonly<{ onOpenSession?: () => void }> = {}) {
  const [snapshot, setSnapshot] = useState<GuidanceStudioSnapshot | null>(null);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const selectedRefRef = useRef<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [baseline, setBaseline] = useState<Draft>(EMPTY_DRAFT);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionRequired, setSessionRequired] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = snapshot?.items.find((item) => item.cardRef === selectedRef) ?? null;
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [baseline, draft]);
  const valid = Boolean(draft.title.trim() && draft.body.trim() && draft.topic.trim() && draft.source.ref.trim() && draft.scopes.length
    && draft.scopes.every((scope) => (scope.facet === "global" || scope.value?.trim())
      && (scope.facet !== "entity" || scope.entityType))
    && (draft.scopes.length === 1 || draft.scopes.every((scope) => scope.facet !== "global"))
    && (draft.source.type !== "official_meta_guidance"
      || /^https:\/\//i.test(draft.source.url) && draft.source.capturedAt && draft.source.reviewBy));

  const selectItem = useCallback((item: GuidanceItem) => {
    const next = draftFromItem(item);
    selectedRefRef.current = item.cardRef;
    setSelectedRef(item.cardRef);
    setDraft(next);
    setBaseline(next);
    setCreating(false);
    setConflict(null);
    setNotice(null);
  }, []);

  const refresh = useCallback(async (options: Readonly<{ preserveDraft?: boolean; preferredRef?: string | null }> = {}) => {
    setLoading(true);
    setError(null);
    setSessionRequired(false);
    try {
      const response = await fetch("/api/guidance-studio", {
        cache: "no-store", credentials: "same-origin", headers: { "X-ReklamZeka-Intent": "guidance-studio-read" },
      });
      const payload = await responsePayload(response);
      if (!response.ok) throw errorFromResponse(response, payload);
      const next = parseGuidanceStudioSnapshot(payload);
      setSnapshot(next);
      const preferred = options.preferredRef ?? selectedRefRef.current;
      const nextSelected = next.items.find((item) => item.cardRef === preferred) ?? next.items[0] ?? null;
      if (!options.preserveDraft) {
        if (nextSelected) selectItem(nextSelected);
        else {
          selectedRefRef.current = null;
          setSelectedRef(null); setDraft(EMPTY_DRAFT); setBaseline(EMPTY_DRAFT); setCreating(false);
        }
      } else if (nextSelected) {
        selectedRefRef.current = nextSelected.cardRef;
        setSelectedRef(nextSelected.cardRef);
      }
    } catch (reason) {
      setSessionRequired(reason instanceof GuidanceStudioRequestError && reason.code === "local_session_required");
      setError(reason instanceof Error ? reason.message : "Talimat kaynağı kullanılamıyor.");
    } finally {
      setLoading(false);
    }
  }, [selectItem]);

  useEffect(() => { void refresh(); }, [refresh]);

  function beginCreate() {
    selectedRefRef.current = null;
    setSelectedRef(null);
    setDraft(EMPTY_DRAFT);
    setBaseline(EMPTY_DRAFT);
    setCreating(true);
    setConflict(null);
    setNotice(null);
  }

  function updateScope(index: number, patch: Partial<GuidanceScope>) {
    setDraft((current) => ({ ...current,
      scopes: current.scopes.map((scope, candidate) => candidate === index ? { ...scope, ...patch } : scope) }));
  }

  function changeFacet(index: number, facet: GuidanceFacet) {
    const categoryRef = snapshot?.categories[0]?.ref ?? null;
    updateScope(index, {
      facet,
      value: facet === "global" ? null : facet === "internal_category" ? categoryRef : "",
      entityType: facet === "entity" ? "campaign" : null,
    });
  }

  function addScope() {
    if (draft.scopes.length >= 12 || !creating) return;
    const base: GuidanceScope = { facet: "account", value: "", entityType: null, mode: "default", priority: 50 };
    setDraft((current) => ({ ...current, scopes: current.scopes[0]?.facet === "global" ? [base] : [...current.scopes, base] }));
  }

  function removeScope(index: number) {
    if (!creating || draft.scopes.length <= 1) return;
    setDraft((current) => ({ ...current, scopes: current.scopes.filter((_, candidate) => candidate !== index) }));
  }

  async function mutate(operation: "create" | "revise" | "publish" | "archive") {
    if (!snapshot || saving || operation !== "archive" && operation !== "publish" && !valid) return;
    if (operation !== "create" && !selected) return;
    setSaving(true);
    setError(null);
    setConflict(null);
    setNotice(null);
    const isCreate = operation === "create";
    const body = isCreate
      ? { title: draft.title.trim(), body: draft.body.trim(), strength: draft.strength, topic: draft.topic.trim(),
          scopes: draft.scopes, source: { type: draft.source.type, ref: draft.source.ref.trim(),
            url: draft.source.url.trim() || null,
            capturedAt: draft.source.capturedAt ? new Date(draft.source.capturedAt).toISOString() : null,
            reviewBy: draft.source.reviewBy ? new Date(draft.source.reviewBy).toISOString() : null },
          expectedRegistryHash: snapshot.registryHash }
      : { cardRef: selected!.cardRef, expectedVersion: selected!.version, expectedRegistryHash: snapshot.registryHash,
          operation, ...(operation === "revise" ? { title: draft.title.trim(), body: draft.body.trim(),
            strength: draft.strength, topic: draft.topic.trim(), scopes: draft.scopes } : {}) };
    try {
      const response = await fetch("/api/guidance-studio", {
        method: isCreate ? "POST" : "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": `guidance-studio-${operation}` },
        body: JSON.stringify(body),
      });
      const payload = await responsePayload(response);
      if (!response.ok) throw errorFromResponse(response, payload);
      const responseItem = isObject(payload) && isItem(payload.item) ? payload.item : null;
      const preferredRef = responseItem?.cardRef ?? selected?.cardRef ?? null;
      await refresh({ preferredRef });
      setNotice(operation === "create" ? "Talimat taslağı kaydedildi. Yayınlanana kadar analiz bağlamını değiştirmez."
        : operation === "revise" ? "Yeni taslak sürüm kaydedildi."
          : operation === "publish" ? "Talimat yayınlandı ve uygun analiz bağlamlarında kullanılabilir."
            : "Talimat arşivlendi; yeni analiz bağlamlarında uygulanmaz.");
    } catch (reason) {
      if (reason instanceof GuidanceStudioRequestError
        && (reason.status === 409 || ["conflict", "optimistic_conflict", "version_conflict"].includes(reason.code))) {
        setConflict("Bu talimat siz düzenlerken başka bir sürümle değişti. Metniniz korunuyor; güncel sürümü yükleyip yeniden değerlendirin.");
      } else {
        setError(reason instanceof Error ? reason.message : "Talimat işlemi tamamlanamadı.");
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading && !snapshot) return <section className={`${styles.panel} ${styles.guidanceState}`} aria-busy="true"><strong>TALİMAT STUDIO</strong><h2>Talimatlar yükleniyor</h2><p>Kalıcı guidance registry ve iç kategori kataloğu okunuyor.</p></section>;
  if (error && !snapshot) return <section className={`${styles.panel} ${styles.guidanceState}`} role="alert"><strong>{sessionRequired ? "YEREL OTURUM GEREKLİ" : "BAĞLANTI KURULAMADI"}</strong><h2>{sessionRequired ? "Dashboard oturumunu bağlayın" : "Talimat kaynağı kullanılamıyor"}</h2><p>{error}</p>{sessionRequired && props.onOpenSession ? <button type="button" onClick={props.onOpenSession}>Decision Room’da oturumu bağla</button> : <button type="button" onClick={() => void refresh()}>Yeniden dene</button>}</section>;
  if (!snapshot) return <section className={`${styles.panel} ${styles.guidanceState}`} role="alert"><strong>KAYNAK HAZIR DEĞİL</strong><h2>Talimat kaynağı doğrulanamadı</h2><p>Kalıcı registry yanıtı alınamadı.</p><button type="button" onClick={() => void refresh()}>Yeniden dene</button></section>;

  const authority = snapshot.authority;
  const editorLocked = saving || Boolean(selected && selected.status !== "draft");
  return <>
    <section className={styles.pageHero}>
      <div><span className={styles.kicker}>GUIDANCE STUDIO</span><h1>İşletme yaklaşımınız görünür, düzenlenebilir ve sürümlü.</h1><p>Talimatlar yalnız guidance olarak saklanır. Yayınlama analiz bağlamını etkileyebilir; hiçbir talimat Meta yazma yetkisi üretmez.</p></div>
      <div className={styles.guidanceHeroActions}><Status tone="good">Meta write kapalı</Status><button className={styles.primaryButton} type="button" onClick={beginCreate} disabled={!authority.canDraft}>+ Yeni talimat</button></div>
    </section>

    {conflict ? <section className={styles.guidanceConflict} role="alert"><div><strong>Sürüm çakışması</strong><p>{conflict}</p></div><button type="button" onClick={() => void refresh({ preserveDraft: true })}>Güncel sürümü yükle</button></section> : null}
    {error ? <section className={styles.guidanceInlineError} role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)}>Kapat</button></section> : null}
    {notice ? <section className={styles.guidanceNotice} role="status"><span>✓</span><p>{notice}</p><button type="button" onClick={() => setNotice(null)} aria-label="Bildirimi kapat">×</button></section> : null}

    {!snapshot.items.length && !creating ? <section className={`${styles.panel} ${styles.guidanceState}`}>
      <strong>HENÜZ TALİMAT YOK</strong><h2>İlk işletme talimatınızı oluşturun</h2><p>Özgün yaklaşımınızı düz metinle yazın, kapsamını seçin ve önce taslak olarak kaydedin.</p>
      <button type="button" onClick={beginCreate} disabled={!authority.canDraft}>+ Yeni talimat</button>
    </section> : <div className={styles.guidanceWorkspace}>
      <section className={`${styles.panel} ${styles.guidanceIndex}`}>
        <header className={styles.panelHeader}><div><span className={styles.kicker}>{snapshot?.items.length ?? 0} KALICI KAYIT</span><h2>Talimatlar</h2></div><button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? "Yükleniyor" : "Yenile"}</button></header>
        <div>
          {creating ? <button type="button" data-active="true" onClick={beginCreate}><span><strong>Yeni talimat</strong><small>Henüz kaydedilmedi</small></span><Status tone="guidance">Taslak</Status></button> : null}
          {snapshot?.items.map((item) => <button type="button" key={item.cardRef} data-active={!creating && selectedRef === item.cardRef} onClick={() => selectItem(item)}>
            <span><strong>{item.title}</strong><small>{labelForScopes(item.scopes, snapshot.categories)} · v{item.version}</small></span><Status tone={statusTone(item.status)}>{statusLabel(item.status)}</Status>
          </button>)}
        </div>
      </section>

      {(creating || selected) ? <section className={styles.guidanceEditor} aria-label={creating ? "Yeni talimat" : `${selected?.title} düzenleyici`}>
        <header><div><Status tone={creating ? "guidance" : statusTone(selected!.status)}>{creating ? "Yeni taslak" : statusLabel(selected!.status)}</Status><h2>{creating ? "Yeni talimat" : selected!.title}</h2><p>{creating ? "Önce taslak olarak kaydedilir" : `Sürüm ${selected!.version} · ${formatUpdatedAt(selected!.updatedAt)}`}</p></div><span>guidance_only</span></header>
        <div className={styles.guidanceFields}>
          <label>Başlık<input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} disabled={editorLocked} maxLength={160} /></label>
          <label>Konu<input value={draft.topic} onChange={(event) => setDraft((current) => ({ ...current, topic: event.target.value }))} disabled={editorLocked} placeholder="budget_allocation" maxLength={80} /></label>
          <label className={styles.guidanceBodyField}>Talimat metni<textarea value={draft.body} onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))} disabled={editorLocked} maxLength={6000} placeholder="Bu kapsamda karar verirken..." /></label>
          <label>Kaynak türü<select value={draft.source.type} onChange={(event) => setDraft((current) => ({ ...current,
            source: { ...current.source, type: event.target.value as GuidanceSourceType } }))} disabled={!creating || editorLocked}>{SOURCE_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label>Kaynak referansı<input value={draft.source.ref} onChange={(event) => setDraft((current) => ({ ...current,
            source: { ...current.source, ref: event.target.value } }))} disabled={!creating || editorLocked} placeholder="source_document_ref" /></label>
          {draft.source.type === "official_meta_guidance" ? <>
            <label>Resmî HTTPS URL<input type="url" value={draft.source.url} onChange={(event) => setDraft((current) => ({ ...current,
              source: { ...current.source, url: event.target.value } }))} disabled={!creating || editorLocked} /></label>
            <label>Yakalanma zamanı<input type="datetime-local" value={draft.source.capturedAt} onChange={(event) => setDraft((current) => ({ ...current,
              source: { ...current.source, capturedAt: event.target.value } }))} disabled={!creating || editorLocked} /></label>
            <label>Yeniden inceleme tarihi<input type="datetime-local" value={draft.source.reviewBy} onChange={(event) => setDraft((current) => ({ ...current,
              source: { ...current.source, reviewBy: event.target.value } }))} disabled={!creating || editorLocked} /></label>
          </> : null}
          <label>Karar ağırlığı<select value={draft.strength} onChange={(event) => setDraft((current) => ({ ...current, strength: event.target.value as GuidanceStrength }))} disabled={editorLocked}>{STRENGTHS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          {draft.scopes.map((scope, index) => <div className={styles.guidanceScopeGroup} key={`${index}-${scope.facet}`}>
            <div><strong>Kapsam {index + 1}</strong>{creating && draft.scopes.length > 1 ? <button type="button" onClick={() => removeScope(index)}>Kaldır</button> : null}</div>
            <label>Kapsam türü<select value={scope.facet} onChange={(event) => changeFacet(index, event.target.value as GuidanceFacet)} disabled={editorLocked}>{FACETS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            {scope.facet === "internal_category" ? <label>İç kategori<select value={scope.value ?? ""} onChange={(event) => updateScope(index, { value: event.target.value })} disabled={editorLocked || !snapshot.categories.length}><option value="" disabled>Kategori seçin</option>{snapshot.categories.map((category) => <option key={category.ref} value={category.ref}>{category.dimension} · {category.label}</option>)}</select></label>
              : scope.facet !== "global" ? <label>Kapsam değeri<input value={scope.value ?? ""} onChange={(event) => updateScope(index, { value: event.target.value })} disabled={editorLocked} placeholder={scope.facet === "entity" ? "Kampanya veya varlık referansı" : "Eşleşecek değer"} /></label> : null}
            {scope.facet === "entity" ? <label>Varlık seviyesi<select value={scope.entityType ?? "campaign"} onChange={(event) => updateScope(index, { entityType: event.target.value as Exclude<GuidanceEntityType, null> })} disabled={editorLocked}>{ENTITY_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label> : null}
            <label>Eşleşme modu<select value={scope.mode} onChange={(event) => updateScope(index, { mode: event.target.value as GuidanceScope["mode"] })} disabled={editorLocked}><option value="default">Varsayılan</option><option value="exception">İstisna</option></select></label>
            <label>Öncelik · {scope.priority}<input type="range" min="0" max="100" value={scope.priority} onChange={(event) => updateScope(index, { priority: Number(event.target.value) })} disabled={editorLocked} /></label>
          </div>)}
          {creating && draft.scopes.length < 12 ? <button className={styles.secondaryButton} type="button" onClick={addScope}>+ Kapsam ekle</button> : null}
        </div>
        <div className={styles.guidanceFacts}><div><span>Otorite</span><strong>Yalnız analitik guidance</strong></div><div><span>Kapsam</span><strong>{labelForScopes(draft.scopes, snapshot.categories)}</strong></div><div><span>Kaynaklar</span><strong>{selected ? selected.sources.map((source) => `${source.type} · ${source.ref}`).join(" + ") : `${draft.source.type} · ${draft.source.ref}`}</strong></div><div><span>Kayıt</span><strong>{dirty ? "Kaydedilmemiş değişiklik" : "Sunucuyla eşleşiyor"}</strong></div></div>
        <footer>
          {!creating && selected?.status !== "archived" ? <button className={styles.guidanceDangerButton} type="button" onClick={() => void mutate("archive")} disabled={saving || !authority.canArchive}>Arşivle</button> : <span />}
          <div><span>{saving ? "İşlem sürüyor…" : selected?.status === "published" ? "Yayındaki talimat salt okunurdur; değiştirmek için arşivleyip yeni talimat oluşturun." : selected?.status === "archived" ? "Arşivli talimat yeni analiz bağlamlarında uygulanmaz." : "Taslak yayınlanana kadar uygulanmaz."}</span>
            {!creating && selected?.status === "draft" ? <button className={styles.secondaryButton} type="button" onClick={() => void mutate("publish")} disabled={saving || dirty || !authority.canPublish}>Yayınla</button> : null}
            {creating || selected?.status === "draft" ? <button className={styles.primaryButton} type="button" onClick={() => void mutate(creating ? "create" : "revise")} disabled={saving || !authority.canDraft || !valid || !dirty}>{saving ? "Kaydediliyor" : creating ? "Taslağı oluştur" : "Yeni taslak sürüm kaydet"}</button> : null}
          </div>
        </footer>
      </section> : null}
    </div>}
    <GuidanceSetStudio snapshot={snapshot} onRefresh={() => refresh({ preserveDraft: true })} />
  </>;
}
