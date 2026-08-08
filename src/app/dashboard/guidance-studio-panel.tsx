"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./operating-dashboard.module.css";

type GuidanceFacet = "global" | "account" | "objective" | "internal_category" | "entity" | "topic";
type GuidanceEntityType = null | "campaign" | "ad_set" | "ad" | "creative" | "post";
type GuidanceStrength = "must" | "should" | "consider" | "avoid" | "question";
type GuidanceStatus = "draft" | "published" | "archived";

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
  scope: GuidanceScope;
  updatedAt: string | null;
}>;

type GuidanceCategory = Readonly<{ ref: string; label: string; dimension: string }>;
type GuidanceAuthority = Readonly<{
  canDraft: boolean;
  canPublish: boolean;
  canArchive: boolean;
  canWriteMeta: false;
}>;
type GuidanceStudioSnapshot = Readonly<{
  contractVersion: string;
  items: readonly GuidanceItem[];
  categories: readonly GuidanceCategory[];
  authority: GuidanceAuthority;
  registryHash: string;
}>;

type Draft = Readonly<{
  title: string;
  body: string;
  strength: GuidanceStrength;
  topic: string;
  scope: GuidanceScope;
}>;

const EMPTY_DRAFT: Draft = Object.freeze({
  title: "",
  body: "",
  strength: "should",
  topic: "",
  scope: Object.freeze({ facet: "global", value: null, entityType: null, mode: "default", priority: 50 }),
});
const FACETS: readonly Readonly<{ value: GuidanceFacet; label: string }>[] = Object.freeze([
  { value: "global", label: "Tüm çalışma alanı" },
  { value: "account", label: "Reklam hesabı" },
  { value: "objective", label: "Meta objective" },
  { value: "internal_category", label: "İç kategori" },
  { value: "entity", label: "Tek varlık" },
  { value: "topic", label: "Konu" },
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
  return ["global", "account", "objective", "internal_category", "entity", "topic"].includes(String(value.facet))
    && (value.value === null || typeof value.value === "string")
    && (value.entityType === null || ENTITY_TYPES.includes(value.entityType as Exclude<GuidanceEntityType, null>))
    && (value.mode === "default" || value.mode === "exception")
    && typeof value.priority === "number" && Number.isInteger(value.priority)
    && value.priority >= 0 && value.priority <= 100;
}

function isItem(value: unknown): value is GuidanceItem {
  if (!isObject(value)) return false;
  return typeof value.cardRef === "string" && Number.isInteger(value.version) && Number(value.version) > 0
    && typeof value.title === "string" && typeof value.body === "string" && typeof value.topic === "string"
    && ["must", "should", "consider", "avoid", "question"].includes(String(value.strength))
    && ["draft", "published", "archived"].includes(String(value.status))
    && (value.updatedAt === null || typeof value.updatedAt === "string") && isScope(value.scope);
}

function parseSnapshot(value: unknown): GuidanceStudioSnapshot {
  if (!isObject(value) || typeof value.contractVersion !== "string" || !Array.isArray(value.items)
    || !value.items.every(isItem) || !Array.isArray(value.categories)
    || !value.categories.every((category) => isObject(category) && typeof category.ref === "string"
      && typeof category.label === "string" && typeof category.dimension === "string")
    || !isObject(value.authority) || typeof value.authority.canDraft !== "boolean"
    || typeof value.authority.canPublish !== "boolean" || typeof value.authority.canArchive !== "boolean"
    || value.authority.canWriteMeta !== false || typeof value.registryHash !== "string") {
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
  return { title: item.title, body: item.body, strength: item.strength, topic: item.topic, scope: { ...item.scope } };
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

export function GuidanceStudioPanel() {
  const [snapshot, setSnapshot] = useState<GuidanceStudioSnapshot | null>(null);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const selectedRefRef = useRef<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [baseline, setBaseline] = useState<Draft>(EMPTY_DRAFT);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = snapshot?.items.find((item) => item.cardRef === selectedRef) ?? null;
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [baseline, draft]);
  const valid = Boolean(draft.title.trim() && draft.body.trim() && draft.topic.trim()
    && (draft.scope.facet === "global" || draft.scope.value?.trim())
    && (draft.scope.facet !== "entity" || draft.scope.entityType));

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
    try {
      const response = await fetch("/api/guidance-studio", {
        cache: "no-store", credentials: "same-origin", headers: { "X-ReklamZeka-Intent": "guidance-studio-read" },
      });
      const payload = await responsePayload(response);
      if (!response.ok) throw errorFromResponse(response, payload);
      const next = parseSnapshot(payload);
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

  function updateScope(patch: Partial<GuidanceScope>) {
    setDraft((current) => ({ ...current, scope: { ...current.scope, ...patch } }));
  }

  function changeFacet(facet: GuidanceFacet) {
    const categoryRef = snapshot?.categories[0]?.ref ?? null;
    updateScope({
      facet,
      value: facet === "global" ? null : facet === "internal_category" ? categoryRef : "",
      entityType: facet === "entity" ? "campaign" : null,
    });
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
          scope: draft.scope, expectedRegistryHash: snapshot.registryHash }
      : { cardRef: selected!.cardRef, expectedVersion: selected!.version, expectedRegistryHash: snapshot.registryHash,
          operation, ...(operation === "revise" ? { title: draft.title.trim(), body: draft.body.trim(),
            strength: draft.strength, topic: draft.topic.trim(), scope: draft.scope } : {}) };
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
  if (error && !snapshot) return <section className={`${styles.panel} ${styles.guidanceState}`} role="alert"><strong>BAĞLANTI KURULAMADI</strong><h2>Talimat kaynağı kullanılamıyor</h2><p>{error}</p><button type="button" onClick={() => void refresh()}>Yeniden dene</button></section>;
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
            <span><strong>{item.title}</strong><small>{labelForScope(item.scope, snapshot.categories)} · v{item.version}</small></span><Status tone={statusTone(item.status)}>{statusLabel(item.status)}</Status>
          </button>)}
        </div>
      </section>

      {(creating || selected) ? <section className={styles.guidanceEditor} aria-label={creating ? "Yeni talimat" : `${selected?.title} düzenleyici`}>
        <header><div><Status tone={creating ? "guidance" : statusTone(selected!.status)}>{creating ? "Yeni taslak" : statusLabel(selected!.status)}</Status><h2>{creating ? "Yeni talimat" : selected!.title}</h2><p>{creating ? "Önce taslak olarak kaydedilir" : `Sürüm ${selected!.version} · ${formatUpdatedAt(selected!.updatedAt)}`}</p></div><span>guidance_only</span></header>
        <div className={styles.guidanceFields}>
          <label>Başlık<input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} disabled={editorLocked} maxLength={160} /></label>
          <label>Konu<input value={draft.topic} onChange={(event) => setDraft((current) => ({ ...current, topic: event.target.value }))} disabled={editorLocked} placeholder="budget_allocation" maxLength={80} /></label>
          <label className={styles.guidanceBodyField}>Talimat metni<textarea value={draft.body} onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))} disabled={editorLocked} maxLength={6000} placeholder="Bu kapsamda karar verirken..." /></label>
          <label>Karar ağırlığı<select value={draft.strength} onChange={(event) => setDraft((current) => ({ ...current, strength: event.target.value as GuidanceStrength }))} disabled={editorLocked}>{STRENGTHS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label>Kapsam türü<select value={draft.scope.facet} onChange={(event) => changeFacet(event.target.value as GuidanceFacet)} disabled={editorLocked}>{FACETS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          {draft.scope.facet === "internal_category" ? <label>İç kategori<select value={draft.scope.value ?? ""} onChange={(event) => updateScope({ value: event.target.value })} disabled={editorLocked || !snapshot.categories.length}><option value="" disabled>Kategori seçin</option>{snapshot.categories.map((category) => <option key={category.ref} value={category.ref}>{category.dimension} · {category.label}</option>)}</select></label>
            : draft.scope.facet !== "global" ? <label>Kapsam değeri<input value={draft.scope.value ?? ""} onChange={(event) => updateScope({ value: event.target.value })} disabled={editorLocked} placeholder={draft.scope.facet === "entity" ? "Kampanya veya varlık referansı" : "Eşleşecek değer"} /></label> : null}
          {draft.scope.facet === "entity" ? <label>Varlık seviyesi<select value={draft.scope.entityType ?? "campaign"} onChange={(event) => updateScope({ entityType: event.target.value as Exclude<GuidanceEntityType, null> })} disabled={editorLocked}>{ENTITY_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label> : null}
          <label>Eşleşme modu<select value={draft.scope.mode} onChange={(event) => updateScope({ mode: event.target.value as GuidanceScope["mode"] })} disabled={editorLocked}><option value="default">Varsayılan</option><option value="exception">İstisna</option></select></label>
          <label>Öncelik · {draft.scope.priority}<input type="range" min="0" max="100" value={draft.scope.priority} onChange={(event) => updateScope({ priority: Number(event.target.value) })} disabled={editorLocked} /></label>
        </div>
        <div className={styles.guidanceFacts}><div><span>Otorite</span><strong>Yalnız analitik guidance</strong></div><div><span>Kapsam</span><strong>{labelForScope(draft.scope, snapshot.categories)}</strong></div><div><span>Kayıt</span><strong>{dirty ? "Kaydedilmemiş değişiklik" : "Sunucuyla eşleşiyor"}</strong></div></div>
        <footer>
          {!creating && selected?.status !== "archived" ? <button className={styles.guidanceDangerButton} type="button" onClick={() => void mutate("archive")} disabled={saving || !authority.canArchive}>Arşivle</button> : <span />}
          <div><span>{saving ? "İşlem sürüyor…" : selected?.status === "published" ? "Yayındaki talimat salt okunurdur; değiştirmek için arşivleyip yeni talimat oluşturun." : selected?.status === "archived" ? "Arşivli talimat yeni analiz bağlamlarında uygulanmaz." : "Taslak yayınlanana kadar uygulanmaz."}</span>
            {!creating && selected?.status === "draft" ? <button className={styles.secondaryButton} type="button" onClick={() => void mutate("publish")} disabled={saving || dirty || !authority.canPublish}>Yayınla</button> : null}
            {creating || selected?.status === "draft" ? <button className={styles.primaryButton} type="button" onClick={() => void mutate(creating ? "create" : "revise")} disabled={saving || !authority.canDraft || !valid || !dirty}>{saving ? "Kaydediliyor" : creating ? "Taslağı oluştur" : "Yeni taslak sürüm kaydet"}</button> : null}
          </div>
        </footer>
      </section> : null}
    </div>}
  </>;
}
