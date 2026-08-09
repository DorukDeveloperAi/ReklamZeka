"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./instruction-policy-studio.module.css";

type PolicyStatus = "draft" | "published" | "paused" | "archived";
type PolicyType = "hard_constraint" | "target" | "preference" | "exception" | "prohibition" | "approval" | "schedule";
type ClosedPolicyAuthority = Readonly<{ canExecute: false; canWriteMeta: false; canApprove: false;
  canSchedule: false; canCallTool: false; canAccessNetwork: false; canQuerySql: false }>;
type StudioAuthority = Readonly<{ canRead: true; canDraft: boolean; canPublish: boolean; canPause: boolean;
  canArchive: boolean; canApprove: false; canExecute: false; canWriteMeta: false; canSchedule: false; canCallTool: false }>;
type Policy = Readonly<Record<string, unknown> & { policyRef: string; policyVersion: number; policyType: PolicyType;
  status: PolicyStatus; reasonCode: string; priority: number; canonicalHash: string; authority: ClosedPolicyAuthority;
  source: Readonly<Record<string, unknown> & { rawProvenanceRef: string; rawTextHash: string }>; clause: unknown }>;
type Revision = Readonly<{ policy: Policy; rawProvenance: Readonly<{ provenanceRef: string; rawText: string;
  rawTextHash: string; capturedByActorRef: string; capturedAt: string }>; recordedAt: string }>;
type PolicyDiff = Readonly<{ policyRef: string; fromVersion: number; toVersion: number; changedPaths: readonly string[] }>;
export type InstructionPolicyStudioSnapshot = Readonly<{ contractVersion: "instruction-policy-lifecycle/1.0.0";
  registryHash: string; current: readonly Revision[]; history: readonly Revision[]; diffs: readonly PolicyDiff[];
  authority: StudioAuthority }>;
export type InstructionPolicyMutation =
  | Readonly<{ operation: "create_draft"; expectedRegistryHash: string; rawText: string; policy: unknown }>
  | Readonly<{ operation: "revise_draft"; expectedRegistryHash: string; expectedVersion: number;
      expectedPolicyHash: string; rawText: string; policy: unknown }>
  | Readonly<{ operation: "publish" | "pause" | "archive"; expectedRegistryHash: string; policyRef: string;
      expectedVersion: number; expectedPolicyHash: string; reasonCode: string }>;

const HASH = /^[a-f0-9]{64}$/;
const POLICY_TYPES: readonly PolicyType[] = ["hard_constraint", "target", "preference", "exception", "prohibition", "approval", "schedule"];
const STATUSES: readonly PolicyStatus[] = ["draft", "published", "paused", "archived"];
const POLICY_INPUT_KEYS = ["dslVersion", "workspaceRef", "policyRef", "policyVersion", "previousVersionHash", "policyType",
  "owner", "status", "reasonCode", "priority", "effectiveDates", "scope", "source", "clause"] as const;
const POLICY_ARTIFACT_KEYS = [...POLICY_INPUT_KEYS, "authority", "canonicalHash"] as const;
const STUDIO_AUTHORITY_KEYS = ["canRead", "canDraft", "canPublish", "canPause", "canArchive", "canApprove",
  "canExecute", "canWriteMeta", "canSchedule", "canCallTool"] as const;
const POLICY_AUTHORITY_KEYS = ["canExecute", "canWriteMeta", "canApprove", "canSchedule", "canCallTool",
  "canAccessNetwork", "canQuerySql"] as const;

class PolicyStudioError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "PolicyStudioError"; }
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return object(value) && Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function closedAuthority(value: unknown, keys: readonly string[]): boolean {
  return exact(value, keys) && keys.every((key) => value[key] === false);
}

function isPolicy(value: unknown): value is Policy {
  if (!exact(value, POLICY_ARTIFACT_KEYS) || typeof value.policyRef !== "string"
    || !Number.isSafeInteger(value.policyVersion) || Number(value.policyVersion) < 1
    || !POLICY_TYPES.includes(value.policyType as PolicyType) || !STATUSES.includes(value.status as PolicyStatus)
    || typeof value.reasonCode !== "string" || !Number.isSafeInteger(value.priority)
    || typeof value.canonicalHash !== "string" || !HASH.test(value.canonicalHash)
    || !closedAuthority(value.authority, POLICY_AUTHORITY_KEYS) || !object(value.source)
    || typeof value.source.rawProvenanceRef !== "string" || typeof value.source.rawTextHash !== "string"
    || !HASH.test(value.source.rawTextHash)) return false;
  return value.dslVersion === "strict-instruction-policy/1.0.0";
}

function isRevision(value: unknown): value is Revision {
  return exact(value, ["policy", "rawProvenance", "recordedAt"]) && isPolicy(value.policy)
    && exact(value.rawProvenance, ["provenanceRef", "rawText", "rawTextHash", "capturedByActorRef", "capturedAt"])
    && typeof value.rawProvenance.provenanceRef === "string" && typeof value.rawProvenance.rawText === "string"
    && value.rawProvenance.rawText.length > 0 && value.rawProvenance.rawText.length <= 16_000
    && value.rawProvenance.rawTextHash === value.policy.source.rawTextHash
    && typeof value.rawProvenance.capturedByActorRef === "string" && typeof value.rawProvenance.capturedAt === "string"
    && typeof value.recordedAt === "string";
}

function isDiff(value: unknown): value is PolicyDiff {
  return exact(value, ["policyRef", "fromVersion", "toVersion", "changedPaths"])
    && typeof value.policyRef === "string" && Number.isSafeInteger(value.fromVersion)
    && Number.isSafeInteger(value.toVersion) && Array.isArray(value.changedPaths)
    && value.changedPaths.every((path) => typeof path === "string");
}

function isStudioAuthority(value: unknown): value is StudioAuthority {
  return exact(value, STUDIO_AUTHORITY_KEYS) && value.canRead === true
    && ["canDraft", "canPublish", "canPause", "canArchive"].every((key) => typeof value[key] === "boolean")
    && ["canApprove", "canExecute", "canWriteMeta", "canSchedule", "canCallTool"].every((key) => value[key] === false);
}

export function parseInstructionPolicyStudioSnapshot(value: unknown): InstructionPolicyStudioSnapshot {
  if (!exact(value, ["contractVersion", "registryHash", "current", "history", "diffs", "authority"])
    || value.contractVersion !== "instruction-policy-lifecycle/1.0.0" || typeof value.registryHash !== "string"
    || !HASH.test(value.registryHash) || !Array.isArray(value.current) || !value.current.every(isRevision)
    || !Array.isArray(value.history) || !value.history.every(isRevision) || !Array.isArray(value.diffs)
    || !value.diffs.every(isDiff) || !isStudioAuthority(value.authority)) {
    throw new PolicyStudioError("unsafe_response", "Talimat politikası kaynağı güvenli sözleşmeyi döndürmedi.");
  }
  return value as unknown as InstructionPolicyStudioSnapshot;
}

function editablePolicy(policy: Policy): Record<string, unknown> {
  return Object.fromEntries(POLICY_INPUT_KEYS.map((key) => [key, policy[key]]));
}

function parseEditablePolicy(value: string): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(value) as unknown; } catch { throw new PolicyStudioError("invalid_json", "Normalize DSL geçerli JSON olmalı."); }
  if (!exact(parsed, POLICY_INPUT_KEYS)) {
    throw new PolicyStudioError("unsafe_policy", "Normalize DSL yalnız strict policy alanlarını içermeli; authority alanı kabul edilmez.");
  }
  return parsed;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function provenanceRef(): string {
  const bytes = new Uint8Array(16); globalThis.crypto.getRandomValues(bytes);
  return `provenance_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function buildInstructionPolicyMutation(input: Readonly<{ operation: "create_draft" | "revise_draft" | "publish" | "pause" | "archive";
  snapshot: InstructionPolicyStudioSnapshot; selected: Revision | null; rawText?: string; policy?: unknown;
  reasonCode?: string }>): InstructionPolicyMutation | null {
  const { operation, snapshot, selected } = input;
  if (operation === "create_draft") return snapshot.authority.canDraft && typeof input.rawText === "string"
    && input.rawText.trim() && input.policy ? { operation, expectedRegistryHash: snapshot.registryHash,
      rawText: input.rawText, policy: input.policy } : null;
  if (operation === "revise_draft") return snapshot.authority.canDraft && selected?.policy.status === "draft"
    && typeof input.rawText === "string" && input.rawText.trim() && input.policy ? { operation,
      expectedRegistryHash: snapshot.registryHash, expectedVersion: selected.policy.policyVersion,
      expectedPolicyHash: selected.policy.canonicalHash, rawText: input.rawText, policy: input.policy } : null;
  const allowed = operation === "publish" ? snapshot.authority.canPublish && (selected?.policy.status === "draft" || selected?.policy.status === "paused")
    : operation === "pause" ? snapshot.authority.canPause && selected?.policy.status === "published"
      : snapshot.authority.canArchive && selected?.policy.status !== "archived";
  return allowed && selected && typeof input.reasonCode === "string" && /^[a-z][a-z0-9_]{1,63}$/.test(input.reasonCode)
    ? { operation, expectedRegistryHash: snapshot.registryHash, policyRef: selected.policy.policyRef,
      expectedVersion: selected.policy.policyVersion, expectedPolicyHash: selected.policy.canonicalHash,
      reasonCode: input.reasonCode } : null;
}

export async function runInstructionPolicyMutation(command: InstructionPolicyMutation,
  request: typeof fetch = fetch): Promise<void> {
  const response = await request("/api/instruction-policies", { method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": "instruction-policy-mutate" },
    body: JSON.stringify({ command }) });
  let payload: unknown = null;
  try { payload = await response.json(); } catch { /* public fallback below */ }
  if (!response.ok) {
    const message = object(payload) && object(payload.error) && typeof payload.error.message === "string"
      ? payload.error.message : "Talimat politikası işlemi tamamlanamadı.";
    throw new PolicyStudioError(response.status === 409 ? "conflict" : "request_failed", message);
  }
  if (!object(payload) || payload.canApprove !== false || payload.canExecute !== false || payload.canWriteMeta !== false
    || !isStudioAuthority(payload.authority)) throw new PolicyStudioError("unsafe_response", "Mutation yanıtı güvenli authority sınırını korumadı.");
}

export async function loadInstructionPolicyStudioSnapshot(request: typeof fetch = fetch): Promise<InstructionPolicyStudioSnapshot> {
  const response = await request("/api/instruction-policies", { cache: "no-store", credentials: "same-origin",
    headers: { "X-ReklamZeka-Intent": "instruction-policy-read" } });
  let payload: unknown = null;
  try { payload = await response.json(); } catch { /* public fallback below */ }
  if (!response.ok) {
    const message = object(payload) && object(payload.error) && typeof payload.error.message === "string"
      ? payload.error.message : "Talimat politikası kaynağı kullanılamıyor.";
    throw new PolicyStudioError(String(response.status), message);
  }
  return parseInstructionPolicyStudioSnapshot(payload);
}

function formatDate(value: string): string {
  const date = new Date(value); if (!Number.isFinite(date.getTime())) return "Zaman bilgisi yok";
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short",
    timeZone: "Europe/Istanbul" }).format(date);
}

function policyLabel(value: PolicyType): string {
  return value.replaceAll("_", " ");
}

export function InstructionPolicyStudioView(props: Readonly<{ snapshot: InstructionPolicyStudioSnapshot;
  onReload(): Promise<void> }>) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | PolicyStatus>("all");
  const [type, setType] = useState<"all" | PolicyType>("all");
  const [selectedRef, setSelectedRef] = useState(props.snapshot.current[0]?.policy.policyRef ?? "");
  const [creating, setCreating] = useState(false);
  const selected = props.snapshot.current.find((entry) => entry.policy.policyRef === selectedRef) ?? null;
  const [rawText, setRawText] = useState(selected?.rawProvenance.rawText ?? "");
  const [normalized, setNormalized] = useState(selected ? JSON.stringify(editablePolicy(selected.policy), null, 2) : "{}");
  const [reasonCode, setReasonCode] = useState("owner_reviewed");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const filtered = useMemo(() => props.snapshot.current.filter((entry) => {
    const haystack = `${entry.policy.policyRef} ${entry.policy.policyType} ${entry.policy.reasonCode} ${entry.rawProvenance.rawText} ${JSON.stringify(entry.policy.clause)}`.toLowerCase();
    return (status === "all" || entry.policy.status === status) && (type === "all" || entry.policy.policyType === type)
      && haystack.includes(query.trim().toLowerCase());
  }), [props.snapshot.current, query, status, type]);

  const select = useCallback((revision: Revision) => {
    setSelectedRef(revision.policy.policyRef); setCreating(false); setRawText(revision.rawProvenance.rawText);
    setNormalized(JSON.stringify(editablePolicy(revision.policy), null, 2)); setMessage(null);
  }, []);

  useEffect(() => {
    if (!creating && !selected && props.snapshot.current[0]) select(props.snapshot.current[0]);
  }, [creating, props.snapshot.current, select, selected]);

  useEffect(() => {
    if (!creating && selected) {
      setRawText(selected.rawProvenance.rawText);
      setNormalized(JSON.stringify(editablePolicy(selected.policy), null, 2));
    }
  }, [creating, selected?.policy.canonicalHash]);

  function beginCreate() {
    setCreating(true); setSelectedRef(""); setRawText(""); setNormalized("{}"); setMessage(null);
  }

  async function mutate(operation: InstructionPolicyMutation["operation"]) {
    if (saving) return;
    setSaving(true); setMessage(null);
    try {
      let policy: unknown;
      if (operation === "create_draft" || operation === "revise_draft") {
        const parsed = parseEditablePolicy(normalized);
        const source = object(parsed.source) ? parsed.source : {};
        policy = { ...parsed, ...(operation === "revise_draft" && selected ? {
          policyRef: selected.policy.policyRef, policyVersion: selected.policy.policyVersion + 1,
          previousVersionHash: selected.policy.canonicalHash, status: "draft",
        } : {}), source: { ...source, rawProvenanceRef: source.rawProvenanceRef === selected?.policy.source.rawProvenanceRef
          ? provenanceRef() : source.rawProvenanceRef, rawTextHash: await sha256(rawText) } };
      }
      const command = buildInstructionPolicyMutation({ operation, snapshot: props.snapshot, selected,
        rawText, policy, reasonCode });
      if (!command) throw new PolicyStudioError("forbidden", "Bu rol veya lifecycle durumu işleme izin vermiyor.");
      await runInstructionPolicyMutation(command); await props.onReload();
      setMessage(operation === "create_draft" ? "Politika taslağı oluşturuldu."
        : operation === "revise_draft" ? "Taslak yeni sürümle kaydedildi."
          : operation === "publish" ? "Politika yayınlandı ve context geçersizleştirildi."
            : operation === "pause" ? "Politika duraklatıldı." : "Politika arşivlendi.");
      if (operation === "create_draft") setCreating(false);
    } catch (reason) {
      setMessage(reason instanceof PolicyStudioError && reason.code === "conflict"
        ? "Politika siz çalışırken değişti; listeyi yenileyip tekrar değerlendirin."
        : reason instanceof Error ? reason.message : "Talimat politikası işlemi tamamlanamadı.");
    } finally { setSaving(false); }
  }

  const history = selected ? props.snapshot.history.filter((entry) => entry.policy.policyRef === selected.policy.policyRef) : [];
  const diffs = selected ? props.snapshot.diffs.filter((entry) => entry.policyRef === selected.policy.policyRef) : [];

  return <div className={styles.studio}>
    <section className={styles.hero}><div><span className={styles.kicker}>STRICT POLICY STUDIO</span>
      <h1>Ham talimat ile normalize politika aynı izde.</h1><p>Taslak, yayın, duraklatma ve arşiv append-only sürümler üretir. Bu yüzey hiçbir eylemi onaylamaz veya çalıştırmaz.</p></div>
      <div className={styles.closedAuthority}><strong>Authority kapalı</strong><span>approve · execute · schedule · tool · network · Meta write: yok</span></div></section>
    <section className={`${styles.surface} ${styles.filters}`} aria-label="Politika filtreleri">
      <input aria-label="Politikalarda ara" placeholder="Ref, tip, gerekçe veya ham metin ara" value={query} onChange={(event) => setQuery(event.target.value)} />
      <select aria-label="Duruma göre filtrele" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
        <option value="all">Tüm durumlar</option>{STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}</select>
      <select aria-label="Tipe göre filtrele" value={type} onChange={(event) => setType(event.target.value as typeof type)}>
        <option value="all">Tüm tipler</option>{POLICY_TYPES.map((item) => <option key={item} value={item}>{policyLabel(item)}</option>)}</select>
      <button type="button" disabled={!props.snapshot.authority.canDraft} onClick={beginCreate}>+ Yeni taslak</button>
    </section>
    <div className={styles.workspace}>
      <section className={`${styles.surface} ${styles.index}`} aria-label="Güncel politikalar">
        <div className={styles.sectionHeader}><strong>Güncel registry</strong><small>{filtered.length} politika</small></div>
        {!filtered.length ? <p>Filtreyle eşleşen politika yok.</p> : filtered.map((entry) => <button type="button"
          key={entry.policy.policyRef} data-active={!creating && entry.policy.policyRef === selectedRef} onClick={() => select(entry)}>
          <strong>{entry.policy.policyRef}</strong><span className={styles.badges}><span className={styles.badge}
            data-status={entry.policy.status}>{entry.policy.status}</span><span className={styles.badge}>{policyLabel(entry.policy.policyType)}</span></span>
          <small>v{entry.policy.policyVersion} · öncelik {entry.policy.priority}</small></button>)}
      </section>
      <section className={`${styles.surface} ${styles.editor}`} aria-label="Politika editörü">
        {creating || selected ? <><header className={styles.row}><div><span className={styles.kicker}>{creating ? "YENİ TASLAK" : "POLİTİKA DETAYI"}</span>
          <h2>{creating ? "Strict DSL taslağı" : selected!.policy.policyRef}</h2><p>{creating ? "Ham kaynağı ve strict normalize JSON'u birlikte girin." : `v${selected!.policy.policyVersion} · ${formatDate(selected!.recordedAt)}`}</p></div>
          {!creating ? <span className={styles.badge} data-status={selected!.policy.status}>{selected!.policy.status}</span> : null}</header>
          {message ? <p role="status">{message}</p> : null}
          <div className={styles.split}><label>Ham talimat / provenance<textarea maxLength={16_000} value={rawText}
            disabled={saving || !props.snapshot.authority.canDraft || !creating && selected?.policy.status !== "draft"}
            onChange={(event) => setRawText(event.target.value)} /></label>
            <label>Normalize strict DSL JSON<textarea data-code="true" value={normalized}
              disabled={saving || !props.snapshot.authority.canDraft || !creating && selected?.policy.status !== "draft"}
              onChange={(event) => setNormalized(event.target.value)} /></label></div>
          <div className={styles.impact}><strong>Dependency impact: henüz hesaplanmadı.</strong><p>Bir dependency reader sonucu bağlanmadığı için etkilenen analiz, bütçe veya aksiyon sayısı gösterilmez; yayın kararı için sayı uydurulmaz.</p></div>
          <label>Lifecycle gerekçe kodu<input value={reasonCode} pattern="[a-z][a-z0-9_]{1,63}" maxLength={64}
            disabled={saving || creating} onChange={(event) => setReasonCode(event.target.value)} /></label>
          <div className={styles.actions}><span className={styles.meta}>OCC: registry hash + sürüm + policy hash</span>
            {creating ? <button className={styles.primary} type="button" disabled={saving || !props.snapshot.authority.canDraft}
              onClick={() => void mutate("create_draft")}>Taslak oluştur</button> : <>
              {selected!.policy.status === "draft" ? <button type="button" disabled={saving || !props.snapshot.authority.canDraft}
                onClick={() => void mutate("revise_draft")}>Yeni taslak sürümü kaydet</button> : null}
              {(selected!.policy.status === "draft" || selected!.policy.status === "paused") ? <button className={styles.primary}
                type="button" disabled={saving || !props.snapshot.authority.canPublish} onClick={() => void mutate("publish")}>Yayınla</button> : null}
              {selected!.policy.status === "published" ? <button type="button" disabled={saving || !props.snapshot.authority.canPause}
                onClick={() => void mutate("pause")}>Duraklat</button> : null}
              {selected!.policy.status !== "archived" ? <button className={styles.danger} type="button"
                disabled={saving || !props.snapshot.authority.canArchive} onClick={() => void mutate("archive")}>Arşivle</button> : null}</>}
          </div>
          {!creating ? <><section><div className={styles.sectionHeader}><h3>Ham ve normalize sürüm geçmişi</h3><span>{history.length} sürüm</span></div>
            <div className={styles.history}>{history.map((entry) => <article className={styles.historyItem} key={`${entry.policy.policyRef}:${entry.policy.policyVersion}`}>
              <div className={styles.row}><strong>v{entry.policy.policyVersion} · {entry.policy.status}</strong><small>{formatDate(entry.recordedAt)}</small></div>
              <p>{entry.rawProvenance.rawText}</p><code>{JSON.stringify(entry.policy.clause)}</code></article>)}</div></section>
            <section><div className={styles.sectionHeader}><h3>Semantic alan farkları</h3><span>{diffs.length} geçiş</span></div>
              <div className={styles.history}>{diffs.length ? diffs.map((diff) => <article className={styles.historyItem}
                key={`${diff.policyRef}:${diff.fromVersion}:${diff.toVersion}`}><strong>v{diff.fromVersion} → v{diff.toVersion}</strong>
                <p>{diff.changedPaths.length ? diff.changedPaths.join(" · ") : "Normalize alan değişikliği yok"}</p></article>)
                : <p>Bu politika için henüz sürüm farkı yok.</p>}</div></section></> : null}</> : <p>Henüz strict policy yok. Yetkili bir kullanıcı ilk taslağı oluşturabilir.</p>}
      </section>
    </div>
  </div>;
}

export function InstructionPolicyStudioPanel() {
  const [snapshot, setSnapshot] = useState<InstructionPolicyStudioSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    setLoading(true); setError(null);
    try { setSnapshot(await loadInstructionPolicyStudioSnapshot()); }
    catch (reason) { setSnapshot(null); setError(reason instanceof Error ? reason.message : "Talimat politikası kaynağı kullanılamıyor."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  if (loading) return <section className={styles.empty} aria-live="polite">Strict policy registry yükleniyor…</section>;
  if (error || !snapshot) return <section className={styles.error} role="alert"><strong>Strict policy Studio kullanılamıyor.</strong>
    <p>{error ?? "Talimat politikası kaynağı güvenli biçimde bağlanamadı."}</p><p>Dependency impact: henüz hesaplanmadı.</p>
    <button className={styles.retry} type="button" onClick={() => void reload()}>Tekrar dene</button></section>;
  return <InstructionPolicyStudioView snapshot={snapshot} onReload={reload} />;
}
