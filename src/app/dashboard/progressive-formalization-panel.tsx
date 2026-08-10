"use client";

import { useCallback, useEffect, useState } from "react";

import type { ProgressiveFormalizationCommand, ProgressiveFormalizationPreview,
  ProgressiveFormalizationState } from "@/application/progressive-formalization-service";
import { replayProgressiveFormalization } from "@/domain/guidance/progressive-formalization";
import styles from "./progressive-formalization.module.css";

const HASH = /^[a-f0-9]{64}$/; const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
type Snapshot = ProgressiveFormalizationState & Readonly<{ contractVersion: "progressive-formalization-studio/1.0.0";
  authority: Readonly<{ canRead: true; canCapture: boolean; canScope: boolean; canReview: boolean;
    canPromote: boolean; canQualify: boolean; canApprove: false; canExecute: false; canWriteMeta: false;
    canSchedule: false; canCallTool: false }> }>;

class FormalizationUiError extends Error {}
function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!object(value) || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new FormalizationUiError("Formalization yanıtı güvenli sözleşmeyle eşleşmiyor.");
  }
}
function authority(value: unknown, actor = false): void {
  const keys = actor ? ["canRead", "canCapture", "canScope", "canReview", "canPromote", "canQualify",
    "canApprove", "canExecute", "canWriteMeta", "canSchedule", "canCallTool"]
    : ["canApprove", "canExecute", "canWriteMeta", "canSchedule", "canCallTool"];
  exact(value, keys);
  if (keys.some((key) => typeof value[key] !== "boolean") || value.canApprove !== false || value.canExecute !== false
    || value.canWriteMeta !== false || value.canSchedule !== false || value.canCallTool !== false
    || actor && value.canRead !== true) throw new FormalizationUiError("Formalization authority sınırı açılamaz.");
}

export function parseProgressiveFormalizationSnapshot(value: unknown): Snapshot {
  exact(value, ["contractVersion", "registryHash", "flows", "authority"]); authority(value.authority, true);
  if (value.contractVersion !== "progressive-formalization-studio/1.0.0" || typeof value.registryHash !== "string"
    || !HASH.test(value.registryHash) || !Array.isArray(value.flows) || value.flows.length > 1_000) {
    throw new FormalizationUiError("Formalization yanıtı güvenli sözleşmeyle eşleşmiyor.");
  }
  for (const flow of value.flows) {
    exact(flow, ["formalizationRef", "level", "headHash", "revisions"]);
    if (typeof flow.formalizationRef !== "string" || !/^formalization_/.test(flow.formalizationRef)
      || typeof flow.headHash !== "string" || !HASH.test(flow.headHash) || !Array.isArray(flow.revisions)) {
      throw new FormalizationUiError("Formalization history güvenli değil.");
    }
    const replayed = replayProgressiveFormalization(flow.revisions as never);
    if (replayed.level !== flow.level || replayed.headHash !== flow.headHash) throw new FormalizationUiError("Formalization history doğrulanamadı.");
  }
  return value as unknown as Snapshot;
}

export function parseProgressiveFormalizationPreview(value: unknown): ProgressiveFormalizationPreview {
  exact(value, ["contractVersion", "target", "formalizationRef", "headHash", "previewHash", "disposition",
    "blockers", "normalizedDraft", "g4Payload", "evidence", "authority", "actorAuthority"]);
  authority(value.authority); authority(value.actorAuthority, true);
  exact(value.evidence, ["persistedGuidance", "persistedPolicy", "productionAuthoritySourceBound", "historicalRunsEvaluated"]);
  if (value.contractVersion !== "progressive-formalization-studio/1.0.0" || !["G3", "G4"].includes(String(value.target))
    || typeof value.formalizationRef !== "string" || !REF.test(value.formalizationRef)
    || typeof value.headHash !== "string" || !HASH.test(value.headHash)
    || typeof value.previewHash !== "string" || !HASH.test(value.previewHash)
    || !["ready", "blocked"].includes(String(value.disposition)) || !Array.isArray(value.blockers)
    || value.blockers.length > 32 || value.blockers.some((item) => typeof item !== "string" || !/^[a-z0-9_]{2,96}$/.test(item))
    || typeof value.evidence.persistedGuidance !== "boolean" || typeof value.evidence.persistedPolicy !== "boolean"
    || typeof value.evidence.productionAuthoritySourceBound !== "boolean"
    || !Number.isSafeInteger(value.evidence.historicalRunsEvaluated)
    || Number(value.evidence.historicalRunsEvaluated) < 0 || Number(value.evidence.historicalRunsEvaluated) > 1000
    || value.disposition === "ready" && value.blockers.length !== 0
    || value.disposition === "ready" && (value.evidence.persistedGuidance !== true || value.evidence.persistedPolicy !== true
      || value.evidence.productionAuthoritySourceBound !== true)
    || value.target === "G3" && value.disposition === "ready" && !object(value.normalizedDraft)
    || value.target === "G4" && value.disposition === "ready" && !object(value.g4Payload)) {
    throw new FormalizationUiError("Formalization preview güvenli sözleşmeyle eşleşmiyor.");
  }
  return value as unknown as ProgressiveFormalizationPreview;
}

async function payload(response: Response): Promise<unknown> { try { return await response.json(); } catch { return null; } }
function responseError(value: unknown, fallback: string): Error {
  return new FormalizationUiError(object(value) && object(value.error) && typeof value.error.message === "string"
    ? value.error.message : fallback);
}
export async function loadProgressiveFormalization(request: typeof fetch = fetch): Promise<Snapshot> {
  const response = await request("/api/progressive-formalization", { cache: "no-store", credentials: "same-origin",
    headers: { "X-ReklamZeka-Intent": "progressive-formalization-read" } });
  const value = await payload(response); if (!response.ok) throw responseError(value, "Formalization kaynağı kullanılamıyor.");
  return parseProgressiveFormalizationSnapshot(value);
}
export async function loadProgressiveFormalizationPreview(input: Readonly<{ formalizationRef: string; target: "G3" | "G4";
  policyRef?: string }>, request: typeof fetch = fetch): Promise<ProgressiveFormalizationPreview> {
  const query = new URLSearchParams({ formalizationRef: input.formalizationRef, target: input.target });
  if (input.target === "G3") query.set("policyRef", input.policyRef ?? "");
  const response = await request(`/api/progressive-formalization?${query}`, { cache: "no-store", credentials: "same-origin",
    headers: { "X-ReklamZeka-Intent": "progressive-formalization-preview" } });
  const value = await payload(response); if (!response.ok) throw responseError(value, "Formalization preview kullanılamıyor.");
  return parseProgressiveFormalizationPreview(value);
}
export async function runProgressiveFormalizationCommand(command: ProgressiveFormalizationCommand,
  request: typeof fetch = fetch): Promise<void> {
  const response = await request("/api/progressive-formalization", { method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": "progressive-formalization-mutate" },
    body: JSON.stringify({ command }) }); const value = await payload(response);
  if (!response.ok) throw responseError(value, "Formalization geçişi tamamlanamadı.");
  if (!object(value) || value.auditAppended !== true || !object(value.authority)) {
    throw new FormalizationUiError("Formalization mutation yanıtı doğrulanamadı.");
  }
  authority(value.authority, true);
}

export function ProgressiveFormalizationPanel() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null); const [selectedRef, setSelectedRef] = useState("");
  const [sourceRef, setSourceRef] = useState(""); const [cardRefs, setCardRefs] = useState("");
  const [setRef, setSetRef] = useState(""); const [policyRef, setPolicyRef] = useState("");
  const [confirmationRef, setConfirmationRef] = useState(""); const [confirmed, setConfirmed] = useState(false);
  const [preview, setPreview] = useState<ProgressiveFormalizationPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => { setBusy(true); try { const next = await loadProgressiveFormalization();
    setSnapshot(next); setSelectedRef((current) => current || next.flows[0]?.formalizationRef || ""); setMessage(null);
    setConfirmed(false); setConfirmationRef(""); setPreview(null);
  } catch (reason) { setSnapshot(null); setMessage(reason instanceof Error ? reason.message : "Formalization kullanılamıyor."); }
  finally { setBusy(false); } }, []);
  useEffect(() => { void reload(); }, [reload]);
  const selected = snapshot?.flows.find((flow) => flow.formalizationRef === selectedRef) ?? null;

  async function mutate(operation: ProgressiveFormalizationCommand["operation"]) {
    if (!snapshot || busy) return; setBusy(true); setMessage(null);
    try {
      let command: ProgressiveFormalizationCommand;
      if (operation === "capture_g0") command = { operation, expectedRegistryHash: snapshot.registryHash, rawProvenanceRef: sourceRef };
      else if (!selected) throw new FormalizationUiError("Önce bir formalization zinciri seçin.");
      else if (operation === "scope_g1") command = { operation, expectedRegistryHash: snapshot.registryHash,
        formalizationRef: selected.formalizationRef, expectedHeadHash: selected.headHash,
        guidanceCardRefs: cardRefs.split(",").map((item) => item.trim()).filter(Boolean) };
      else if (operation === "review_g2") command = { operation, expectedRegistryHash: snapshot.registryHash,
        formalizationRef: selected.formalizationRef, expectedHeadHash: selected.headHash, guidanceSetRef: setRef,
        ownerConfirmation: { confirmed: true, confirmationRef } };
      else if (operation === "promote_g3") {
        if (!preview || preview.target !== "G3" || preview.disposition !== "ready") throw new FormalizationUiError("Ready G3 preview gerekli.");
        command = { operation, expectedRegistryHash: snapshot.registryHash, formalizationRef: selected.formalizationRef,
          expectedHeadHash: selected.headHash, policyRef, expectedPreviewHash: preview.previewHash,
          ownerConfirmation: { confirmed: true, confirmationRef } };
      } else {
        if (!preview || preview.target !== "G4" || preview.disposition !== "ready") throw new FormalizationUiError("Ready G4 preview gerekli.");
        command = { operation, expectedRegistryHash: snapshot.registryHash, formalizationRef: selected.formalizationRef,
          expectedHeadHash: selected.headHash, expectedPreviewHash: preview.previewHash,
          ownerConfirmation: { confirmed: true, confirmationRef } };
      }
      await runProgressiveFormalizationCommand(command); setConfirmed(false); setConfirmationRef(""); setPreview(null); await reload();
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Formalization geçişi tamamlanamadı."); }
    finally { setBusy(false); }
  }
  async function prepare(target: "G3" | "G4") { if (!selected) return; setBusy(true); try {
    setPreview(await loadProgressiveFormalizationPreview({ formalizationRef: selected.formalizationRef, target, policyRef }));
  } catch (reason) { setPreview(null); setMessage(reason instanceof Error ? reason.message : "Preview kullanılamıyor."); }
  finally { setBusy(false); } }

  if (!snapshot) return <section className={styles.panel} aria-live="polite"><strong>PROGRESSIVE FORMALIZATION</strong>
    <p>{message ?? "G0→G4 registry yükleniyor…"}</p><button type="button" onClick={() => void reload()}>Tekrar dene</button></section>;
  return <section className={styles.panel} aria-label="Progressive formalization">
    <header><div><span>G0 → G4 · APPEND-ONLY</span><h2>Guidance’ı typed policy’ye kanıtla yükselt.</h2></div>
      <small>G4 action/tool/Meta authority vermez.</small></header>
    {message ? <p role="status">{message}</p> : null}
    <div className={styles.grid}><div className={styles.list}><button type="button" data-active={!selectedRef} onClick={() => setSelectedRef("")}>Yeni G0</button>
      {snapshot.flows.map((flow) => <button type="button" key={flow.formalizationRef} data-active={flow.formalizationRef === selectedRef}
        onClick={() => { setSelectedRef(flow.formalizationRef); setPreview(null); }}><strong>{flow.formalizationRef}</strong><span>{flow.level}</span></button>)}</div>
      <div className={styles.form}>{!selected ? <><label>Guidance source key<input value={sourceRef} onChange={(event) => setSourceRef(event.target.value)} /></label>
        <button type="button" disabled={busy || !snapshot.authority.canCapture} onClick={() => void mutate("capture_g0")}>G0 yakala</button></>
        : <><p><strong>{selected.level}</strong> · head {selected.headHash.slice(0, 12)}…</p>
          {selected.level === "G0" ? <><label>Published guidance card ref’leri (virgülle)<textarea value={cardRefs} onChange={(event) => setCardRefs(event.target.value)} /></label>
            <button type="button" disabled={busy || !snapshot.authority.canScope} onClick={() => void mutate("scope_g1")}>G1 kapsamla</button></> : null}
          {selected.level === "G1" ? <><label>Reviewed guidance set ref<input value={setRef} onChange={(event) => setSetRef(event.target.value)} /></label></> : null}
          {selected.level === "G2" ? <><label>Strict policy draft ref<input value={policyRef} onChange={(event) => setPolicyRef(event.target.value)} /></label>
            <button type="button" disabled={busy} onClick={() => void prepare("G3")}>G3 semantic/replay/impact preview</button></> : null}
          {selected.level === "G3" ? <button type="button" disabled={busy} onClick={() => void prepare("G4")}>G4 risk/cap/approval/valve preview</button> : null}
          {preview ? <div className={styles.preview} data-ready={preview.disposition === "ready"}><strong>{preview.target} · {preview.disposition}</strong>
            <p>{preview.blockers.length ? preview.blockers.join(" · ") : "Persisted kanıt tam."}</p><small>Historical run: {preview.evidence.historicalRunsEvaluated} · production authority bound: {String(preview.evidence.productionAuthoritySourceBound)}</small></div> : null}
          {(selected.level === "G1" || selected.level === "G2" || selected.level === "G3") ? <><label className={styles.confirm}><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />Owner/admin explicit confirmation</label>
            <label>Confirmation ref<input value={confirmationRef} onChange={(event) => setConfirmationRef(event.target.value)} /></label>
            <button type="button" disabled={busy || !confirmed || (selected.level === "G1" ? !snapshot.authority.canReview
              : selected.level === "G2" ? !snapshot.authority.canPromote || preview?.disposition !== "ready"
                : !snapshot.authority.canQualify || preview?.disposition !== "ready")}
              onClick={() => void mutate(selected.level === "G1" ? "review_g2" : selected.level === "G2" ? "promote_g3" : "qualify_g4")}>
              {selected.level === "G1" ? "G2 reviewed kaydet" : selected.level === "G2" ? "G3 typed revision kaydet" : "G4 eligibility kaydet"}</button></> : null}</>}</div></div>
  </section>;
}
