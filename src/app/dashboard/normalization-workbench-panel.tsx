"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import styles from "./instruction-policy-studio.module.css";

type Strength = "must" | "should" | "consider" | "avoid" | "question";
type ClosedAuthority = Readonly<{ canPublish: false; canPromotePolicy: false; canApprove: false; canExecute: false; canWriteMeta: false }>;
type Selection = Readonly<{ sourceRef: string; cardRef: string; setRef: string }>;
type Preview = Readonly<{ contractVersion: "normalization-workbench/1.0.0"; disposition: "ready" | "needs_input";
  missing: readonly string[]; selectionHash: string | null; capabilities: ClosedAuthority }>;
type GuidanceChoice = Readonly<{ cardRef: string; title: string; sourceRefs: readonly string[] }>;
type GuidanceSetChoice = Readonly<{ setRef: string; name: string; cardRefs: readonly string[] }>;
type GuidanceChoices = Readonly<{ cards: readonly GuidanceChoice[]; sets: readonly GuidanceSetChoice[] }>;
type Snapshot = Readonly<{ contractVersion: "normalization-workbench-service/1.0.0";
  revisions: readonly Readonly<{ normalizationRef: string; revision: number; revisionHash: string; selectionHash: string; capabilities: ClosedAuthority }>[];
  authority: Readonly<{ canRead: true; canDraft: boolean; canPublish: false; canPromotePolicy: false; canApprove: false; canExecute: false; canWriteMeta: false }> }>;

export class NormalizationWorkbenchClientError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "NormalizationWorkbenchClientError"; }
}

const HASH = /^[a-f0-9]{64}$/;
const AUTHORITY_KEYS = ["canPublish", "canPromotePolicy", "canApprove", "canExecute", "canWriteMeta"] as const;
function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return object(value) && Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}
function closed(value: unknown): value is ClosedAuthority { return exact(value, AUTHORITY_KEYS) && AUTHORITY_KEYS.every((key) => value[key] === false); }
function workbenchAuthority(value: unknown): boolean {
  const keys = ["canRead", "canDraft", ...AUTHORITY_KEYS];
  return exact(value, keys) && value.canRead === true && typeof value.canDraft === "boolean"
    && AUTHORITY_KEYS.every((key) => value[key] === false);
}
function readError(value: unknown, fallback: string): string {
  return object(value) && object(value.error) && typeof value.error.message === "string" ? value.error.message : fallback;
}
function guidanceChoices(value: unknown): GuidanceChoices {
  if (!object(value) || !Array.isArray(value.items) || !Array.isArray(value.sets)) {
    throw new NormalizationWorkbenchClientError("unsafe_response", "Guidance seçenekleri güvenli sözleşme döndürmedi.");
  }
  const cards = value.items.map((item) => {
    if (!object(item) || typeof item.cardRef !== "string" || typeof item.title !== "string" || !Array.isArray(item.sources)
      || !item.sources.every((source) => object(source) && typeof source.ref === "string")) {
      throw new NormalizationWorkbenchClientError("unsafe_response", "Guidance kart seçimi güvenli değil.");
    }
    const sourceRefs = Object.freeze(item.sources.map((source) => source.ref as string).sort());
    if (!sourceRefs.length || new Set(sourceRefs).size !== sourceRefs.length) {
      throw new NormalizationWorkbenchClientError("unsafe_response", "Guidance kart kaynak zinciri belirsiz.");
    }
    return Object.freeze({ cardRef: item.cardRef, title: item.title, sourceRefs });
  }).sort((left, right) => left.title.localeCompare(right.title, "tr") || left.cardRef.localeCompare(right.cardRef));
  const sets = value.sets.filter((item) => object(item) && item.reviewStatus === "reviewed").map((item) => {
    if (!object(item) || typeof item.setRef !== "string" || typeof item.name !== "string" || !Array.isArray(item.orderedCards)
      || !item.orderedCards.every((card) => object(card) && typeof card.cardRef === "string")) {
      throw new NormalizationWorkbenchClientError("unsafe_response", "Reviewed set seçimi güvenli değil.");
    }
    const cardRefs = Object.freeze(item.orderedCards.map((card) => card.cardRef as string).sort());
    if (!cardRefs.length || new Set(cardRefs).size !== cardRefs.length) {
      throw new NormalizationWorkbenchClientError("unsafe_response", "Reviewed set kart zinciri belirsiz.");
    }
    return Object.freeze({ setRef: item.setRef, name: item.name, cardRefs });
  }).sort((left, right) => left.name.localeCompare(right.name, "tr") || left.setRef.localeCompare(right.setRef));
  return Object.freeze({ cards: Object.freeze(cards), sets: Object.freeze(sets) });
}

export function parseNormalizationWorkbenchSnapshot(value: unknown): Snapshot {
  if (!exact(value, ["contractVersion", "revisions", "authority"]) || value.contractVersion !== "normalization-workbench-service/1.0.0"
    || !Array.isArray(value.revisions) || !value.revisions.every((entry) => exact(entry, ["normalizationRef", "revision", "revisionHash", "selectionHash", "capabilities"])
      && typeof entry.normalizationRef === "string" && Number.isSafeInteger(Number(entry.revision)) && Number(entry.revision) >= 1
      && typeof entry.revisionHash === "string" && HASH.test(entry.revisionHash) && typeof entry.selectionHash === "string" && HASH.test(entry.selectionHash)
      && closed(entry.capabilities)) || !workbenchAuthority(value.authority)) {
    throw new NormalizationWorkbenchClientError("unsafe_response", "Normalizasyon çalışma alanı güvenli sözleşme döndürmedi.");
  }
  return value as unknown as Snapshot;
}

export function parseNormalizationWorkbenchPreview(value: unknown): Preview {
  if (!exact(value, ["contractVersion", "disposition", "missing", "selection", "selectionHash", "capabilities", "authority"])
    || value.contractVersion !== "normalization-workbench/1.0.0" || !["ready", "needs_input"].includes(String(value.disposition))
    || !Array.isArray(value.missing) || !value.missing.every((item) => typeof item === "string") || !closed(value.capabilities)
    || !workbenchAuthority(value.authority)
    || value.selectionHash !== null && (typeof value.selectionHash !== "string" || !HASH.test(value.selectionHash))) {
    throw new NormalizationWorkbenchClientError("unsafe_response", "Normalizasyon önizlemesi güvenli sözleşme döndürmedi.");
  }
  if (value.disposition === "ready" && value.selectionHash === null || value.disposition === "needs_input" && value.selectionHash !== null) {
    throw new NormalizationWorkbenchClientError("unsafe_response", "Normalizasyon önizlemesi çelişkili.");
  }
  return value as unknown as Preview;
}

export function buildNormalizationAnswers(input: Readonly<{ title: string; body: string; topic: string; strength: Strength;
  assumptions: string; questions: string }>) {
  const lines = (value: string) => value.split("\n").map((item) => item.trim()).filter(Boolean);
  return Object.freeze({ normalizedGuidance: { title: input.title.trim(), body: input.body.trim(), topic: input.topic.trim(), strength: input.strength },
    assumptions: Object.freeze(lines(input.assumptions).map((text, index) => Object.freeze({ assumptionRef: `assumption_${index + 1}`, text }))),
    questions: Object.freeze(lines(input.questions).map((prompt, index) => Object.freeze({ questionRef: `question_${index + 1}`, prompt, required: true }))), });
}

async function requestWorkbench(command: unknown, request: typeof fetch = fetch): Promise<unknown> {
  const response = await request("/api/normalization-workbench", { method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": "normalization-workbench-draft" }, body: JSON.stringify({ command }) });
  let payload: unknown = null; try { payload = await response.json(); } catch { /* error below */ }
  if (!response.ok) throw new NormalizationWorkbenchClientError(String(response.status), readError(payload, "Normalizasyon isteği tamamlanamadı."));
  return payload;
}
async function loadWorkbench(request: typeof fetch = fetch): Promise<Snapshot> {
  const response = await request("/api/normalization-workbench", { cache: "no-store", credentials: "same-origin",
    headers: { "X-ReklamZeka-Intent": "normalization-workbench-read" } });
  let payload: unknown = null; try { payload = await response.json(); } catch { /* error below */ }
  if (!response.ok) throw new NormalizationWorkbenchClientError(String(response.status), readError(payload, "Normalizasyon çalışma alanı kullanılamıyor."));
  return parseNormalizationWorkbenchSnapshot(payload);
}
async function loadGuidanceChoices(request: typeof fetch = fetch): Promise<GuidanceChoices> {
  const response = await request("/api/guidance-studio", { cache: "no-store", credentials: "same-origin",
    headers: { "X-ReklamZeka-Intent": "guidance-studio-read" } });
  let payload: unknown = null; try { payload = await response.json(); } catch { /* error below */ }
  if (!response.ok) throw new NormalizationWorkbenchClientError(String(response.status), readError(payload, "Guidance seçenekleri kullanılamıyor."));
  return guidanceChoices(payload);
}

export function resolveNormalizationSelection(choices: GuidanceChoices, cardRef: string): Selection | null {
  const card = choices.cards.find((item) => item.cardRef === cardRef);
  const set = card ? choices.sets.find((item) => item.cardRefs.includes(card.cardRef)) : null;
  if (!card || !set) return null;
  return Object.freeze({ sourceRef: card.sourceRefs.length === 1 ? card.sourceRefs[0]! : "", cardRef: card.cardRef, setRef: set.setRef });
}

export function NormalizationWorkbenchPanel() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null); const [loading, setLoading] = useState(true);
  const [choices, setChoices] = useState<GuidanceChoices | null>(null);
  const [message, setMessage] = useState<string | null>(null); const [preview, setPreview] = useState<Preview | null>(null);
  const [selection, setSelection] = useState<Selection>({ sourceRef: "", cardRef: "", setRef: "" });
  const [title, setTitle] = useState(""); const [body, setBody] = useState(""); const [topic, setTopic] = useState("");
  const [strength, setStrength] = useState<Strength>("should"); const [assumptions, setAssumptions] = useState("");
  const [questions, setQuestions] = useState(""); const [saving, setSaving] = useState(false);
  const reload = useCallback(async () => { setLoading(true); try {
    const [nextSnapshot, nextChoices] = await Promise.all([loadWorkbench(), loadGuidanceChoices()]);
    setSnapshot(nextSnapshot); setChoices(nextChoices); setMessage(null);
  } catch (reason) { setSnapshot(null); setChoices(null); setMessage(reason instanceof Error ? reason.message : "Normalizasyon çalışma alanı kullanılamıyor."); } finally { setLoading(false); } }, []);
  useEffect(() => { void reload(); }, [reload]);
  const answers = useMemo(() => buildNormalizationAnswers({ title, body, topic, strength, assumptions, questions }),
    [title, body, topic, strength, assumptions, questions]);
  const selectedCard = choices?.cards.find((item) => item.cardRef === selection.cardRef) ?? null;
  const matchingSets = selectedCard ? choices?.sets.filter((item) => item.cardRefs.includes(selectedCard.cardRef)) ?? [] : [];
  const answerable = Boolean(title.trim() && body.trim() && topic.trim());
  async function previewSelection() { setSaving(true); setMessage(null); try {
    setPreview(parseNormalizationWorkbenchPreview(await requestWorkbench({ operation: "preview", selection })));
  } catch (reason) { setPreview(null); setMessage(reason instanceof Error ? reason.message : "Kaynak önizlemesi kullanılamıyor."); } finally { setSaving(false); } }
  async function saveDraft() { if (!preview?.selectionHash || !answerable) return; setSaving(true); setMessage(null); try {
    await requestWorkbench({ operation: "create", expectedSelectionHash: preview.selectionHash, selection, answers });
    setMessage("Bağlayıcı olmayan normalizasyon taslağı kaydedildi."); setPreview(null); await reload();
  } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Taslak kaydedilemedi."); } finally { setSaving(false); } }
  return <section className={`${styles.surface} ${styles.editor}`} aria-label="Talimat normalizasyon çalışma alanı">
    <header className={styles.row}><div><span className={styles.kicker}>DRAFT-ONLY NORMALIZATION</span>
      <h2>Owner talimatını yapılandırılmış taslak olarak değerlendir</h2><p>Ham kaynak Guidance Studio’da korunur. Bu akış publish, G3, approval, action ve Meta write üretmez.</p></div>
      <span className={styles.badge}>authority kapalı</span></header>
    {loading ? <p>Normalizasyon kayıtları yükleniyor…</p> : message && !snapshot ? <p role="alert">{message}</p> : <>
      <div className={styles.split}><label>Guidance kartı<select aria-label="Guidance kartı" value={selection.cardRef} disabled={saving || !choices}
        onChange={(event) => { const resolved = choices ? resolveNormalizationSelection(choices, event.target.value) : null;
          setSelection(resolved ?? { sourceRef: "", cardRef: event.target.value, setRef: "" }); setPreview(null); }}>
        <option value="">Önce bir guidance kartı seçin</option>{choices?.cards.map((card) => <option key={card.cardRef} value={card.cardRef}>{card.title}</option>)}</select></label>
        <label>Owner source<select aria-label="Owner source" value={selection.sourceRef} disabled={saving || !selectedCard}
          onChange={(event) => { setSelection({ ...selection, sourceRef: event.target.value }); setPreview(null); }}><option value="">Kaynak seçin</option>
          {selectedCard?.sourceRefs.map((sourceRef) => <option key={sourceRef} value={sourceRef}>{sourceRef}</option>)}</select></label>
        <label>Reviewed set<select aria-label="Reviewed set" value={selection.setRef} disabled={saving || !selectedCard}
          onChange={(event) => { setSelection({ ...selection, setRef: event.target.value }); setPreview(null); }}><option value="">Reviewed set seçin</option>
          {matchingSets.map((set) => <option key={set.setRef} value={set.setRef}>{set.name}</option>)}</select></label></div>
      <div className={styles.actions}><button type="button" disabled={saving || !selection.sourceRef || !selection.cardRef || !selection.setRef}
        onClick={() => void previewSelection()}>Kaynak zincirini doğrula</button>{preview ? <small>{preview.disposition === "ready"
          ? "Kaynak/kart/set aynı tenant ve güncel immutable sürümlere bağlandı." : `Eksik: ${preview.missing.join(", ") || "zincir çözülemedi"}`}</small> : null}</div>
      <div className={styles.split}><label>Normalize başlık<input aria-label="Normalize başlık" value={title} maxLength={240} disabled={saving}
        onChange={(event) => setTitle(event.target.value)} /></label><label>Topic<input aria-label="Topic" value={topic} maxLength={160} disabled={saving}
          onChange={(event) => setTopic(event.target.value)} /></label><label>Güç<select aria-label="Güç" value={strength} disabled={saving}
            onChange={(event) => setStrength(event.target.value as Strength)}>{(["must", "should", "consider", "avoid", "question"] as const).map((item) => <option key={item}>{item}</option>)}</select></label></div>
      <label>Normalize açıklama<textarea aria-label="Normalize açıklama" value={body} maxLength={16_000} disabled={saving} onChange={(event) => setBody(event.target.value)} /></label>
      <div className={styles.split}><label>Varsayımlar (her satır bir tane)<textarea aria-label="Varsayımlar" value={assumptions} disabled={saving} onChange={(event) => setAssumptions(event.target.value)} /></label>
        <label>Açık sorular (her satır bir tane)<textarea aria-label="Açık sorular" value={questions} disabled={saving} onChange={(event) => setQuestions(event.target.value)} /></label></div>
      {message ? <p role="status">{message}</p> : null}<div className={styles.actions}><span className={styles.meta}>Taslak zinciri: source/card/set hash + OCC selection hash</span>
        <button className={styles.primary} type="button" disabled={saving || !snapshot?.authority.canDraft || !preview?.selectionHash || !answerable}
          onClick={() => void saveDraft()}>Taslağı kaydet</button></div>
      {snapshot?.revisions.length ? <p><small>{snapshot.revisions.length} immutable normalizasyon taslağı kaydedildi.</small></p> : null}
    </>}</section>;
}
