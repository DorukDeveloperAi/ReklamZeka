"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApprovalPolicyDraftRequest, GuardrailPolicyDraftRequest,
  PolicyBundleStudioResult } from "@/application/policy-bundle-studio-service";
import styles from "./operating-dashboard.module.css";

type LoadState = { status: "loading" } | { status: "error" | "unavailable"; message: string }
  | { status: "ready"; result: PolicyBundleStudioResult };
type ApprovalForm = { policyRef: string; requesterRoles: string[]; approverRoles: string[]; grantConsumerRoles: string[];
  separationOfDuties: boolean; evidenceHours: string; proposalHours: string; grantMinutes: string;
  effectiveFrom: string; expiresAt: string };
type GuardrailForm = { policyRef: string; accountRef: string; adSetRef: string; internalCategoryRefs: string[];
  denyAction: boolean; denyClauseRef: string; effectiveFrom: string; expiresAt: string; sourceGuidanceRefs: string };

const emptyApproval: ApprovalForm = { policyRef: "", requesterRoles: [], approverRoles: [], grantConsumerRoles: [],
  separationOfDuties: false, evidenceHours: "", proposalHours: "", grantMinutes: "", effectiveFrom: "", expiresAt: "" };
const emptyGuardrail: GuardrailForm = { policyRef: "", accountRef: "", adSetRef: "", internalCategoryRefs: [],
  denyAction: false, denyClauseRef: "", effectiveFrom: "", expiresAt: "", sourceGuidanceRefs: "" };
const statusLabel = { missing: "Eksik", draft: "Taslak", published: "Yayınlanmış", disabled: "Devre dışı",
  inactive: "Etkin değil", ambiguous: "Çakışmalı", published_approval_only: "Approval only",
  evaluated_per_proposal: "Öneri anında", evaluated_per_selection: "Seçim anında" } as const;

function iso(value: string): string { return new Date(value).toISOString(); }
function positiveSeconds(value: string, multiplier: number): number {
  const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * multiplier) : 0;
}
function resultIsSafe(value: unknown): value is PolicyBundleStudioResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Partial<PolicyBundleStudioResult>;
  return result.contractVersion === "policy-bundle-studio/1.1.0" && Array.isArray(result.approvalPolicies)
    && Array.isArray(result.guardrails) && Boolean(result.scopeCatalog) && Boolean(result.readiness)
    && Boolean(result.authority) && result.authority?.canPublish === false && result.authority.canDisable === false
    && result.authority.canApproveAction === false && result.authority.canGrant === false
    && result.authority.canExecute === false && result.authority.canWriteMeta === false;
}
function toggle(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function createApprovalPolicyDraftBody(form: ApprovalForm): ApprovalPolicyDraftRequest {
  return { kind: "approval_policy", policyRef: form.policyRef,
    requesterRoles: form.requesterRoles as ApprovalPolicyDraftRequest["requesterRoles"],
    approverRoles: form.approverRoles as ApprovalPolicyDraftRequest["approverRoles"],
    grantConsumerRoles: form.grantConsumerRoles as ApprovalPolicyDraftRequest["grantConsumerRoles"],
    separationOfDuties: form.separationOfDuties,
    maximumProtectionEvidenceAgeSeconds: positiveSeconds(form.evidenceHours, 3_600),
    maximumProposalLifetimeSeconds: positiveSeconds(form.proposalHours, 3_600),
    maximumGrantLifetimeSeconds: positiveSeconds(form.grantMinutes, 60), effectiveFrom: iso(form.effectiveFrom),
    expiresAt: form.expiresAt ? iso(form.expiresAt) : null };
}
export function createGuardrailPolicyDraftBody(form: GuardrailForm, result: PolicyBundleStudioResult): GuardrailPolicyDraftRequest {
  const selected = result.scopeCatalog.adSets.find((item) => item.ref === form.adSetRef);
  if (!selected || selected.accountRef !== form.accountRef) throw new Error("Seçilen reklam seti güncel hesap kataloğunda değil.");
  return { kind: "guardrail_policy", policyRef: form.policyRef, accountRef: form.accountRef,
    campaignRef: selected.campaignRef, adSetRef: selected.ref, internalCategoryRefs: form.internalCategoryRefs,
    denyAction: form.denyAction, denyClauseRef: form.denyAction ? form.denyClauseRef : null,
    effectiveFrom: iso(form.effectiveFrom), expiresAt: form.expiresAt ? iso(form.expiresAt) : null,
    sourceGuidanceRefs: form.sourceGuidanceRefs.split(",").map((item) => item.trim()).filter(Boolean) };
}
async function saveDraft(body: ApprovalPolicyDraftRequest | GuardrailPolicyDraftRequest): Promise<void> {
  const response = await fetch("/api/policy-bundles", { method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": "policy-bundle-create-draft" },
    body: JSON.stringify(body) });
  const payload = await response.json() as { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? "Taslak kaydedilemedi.");
}

function RoleChoices({ legend, roles, selected, onToggle }: Readonly<{ legend: string; roles: readonly string[];
  selected: readonly string[]; onToggle(role: string): void }>) {
  return <fieldset><legend>{legend}</legend>{roles.map((role) => <label key={role}><input type="checkbox"
    checked={selected.includes(role)} onChange={() => onToggle(role)} />{role}</label>)}</fieldset>;
}

export function PolicyBundleStudioSurface({ result, onReload }: Readonly<{
  result: PolicyBundleStudioResult; onReload(): Promise<void> | void;
}>) {
  const [approval, setApproval] = useState(emptyApproval); const [guardrail, setGuardrail] = useState(emptyGuardrail);
  const [saving, setSaving] = useState<"approval" | "guardrail" | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const adSets = useMemo(() => result.scopeCatalog.adSets.filter((item) => item.accountRef === guardrail.accountRef),
    [result.scopeCatalog.adSets, guardrail.accountRef]);
  const selectedAdSet = adSets.find((item) => item.ref === guardrail.adSetRef);
  const approvalValid = Boolean(approval.policyRef && approval.requesterRoles.length && approval.approverRoles.length
    && approval.grantConsumerRoles.length && positiveSeconds(approval.evidenceHours, 3_600)
    && positiveSeconds(approval.proposalHours, 3_600) && positiveSeconds(approval.grantMinutes, 60) && approval.effectiveFrom);
  const guardrailValid = Boolean(guardrail.policyRef && guardrail.accountRef && guardrail.adSetRef && guardrail.effectiveFrom
    && (!guardrail.denyAction || guardrail.denyClauseRef));
  const persist = async (kind: "approval" | "guardrail") => { setSaving(kind); setNotice(null); try {
    await saveDraft(kind === "approval" ? createApprovalPolicyDraftBody(approval)
      : createGuardrailPolicyDraftBody(guardrail, result));
    if (kind === "approval") setApproval(emptyApproval); else setGuardrail(emptyGuardrail);
    setNotice("Değiştirilemez taslak oluşturuldu. Henüz etkin değil ve hiçbir eyleme yetki vermiyor.");
    await onReload();
  } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Taslak kaydedilemedi."); }
  finally { setSaving(null); } };
  const readiness = result.readiness;
  return <div className={styles.policyBundleStack}>
    <section className={`${styles.panel} ${styles.policyReadiness}`}>
      <header className={styles.panelHeader}><div><span className={styles.kicker}>K4 POLICY GATE</span><h2>{readiness.policyBundleReady ? "Politika kapısı hazır" : "Politika kapısı hazır değil"}</h2></div><span data-ready={readiness.policyBundleReady}>{readiness.policyBundleReady ? "POLICY READY" : "NOT READY"}</span></header>
      <div>{[["ApprovalPolicy", readiness.approvalPolicy], ["Guardrail", readiness.guardrail], ["Workspace autonomy", readiness.workspaceAutonomy], ["Authentic evidence", readiness.authenticEvidence], ["Compatibility", readiness.compatibility]].map(([label, value]) => <article key={label}><span>{label}</span><strong>{statusLabel[value as keyof typeof statusLabel]}</strong><small>{value}</small></article>)}</div>
      <p>Taslaklar çalışma motoruna dahil edilmez. Bu stüdyo yalnız politika kapısını ölçer; tam proposal readiness, authentic evidence ve beş compatibility boyutu gerçek seçim hash’iyle preflight anında doğrulandıktan sonra oluşur.</p>
    </section>
    <div className={styles.policyBundleGrid}>
      <section className={`${styles.panel} ${styles.policyDraftForm}`}><header><span className={styles.kicker}>APPROVAL POLICY · K4</span><h2>Onay yaşam döngüsü taslağı</h2><p>Alanlar bilinçli olarak boş. Değerleri kritik analitik görüşmede birlikte belirleyeceğiz.</p></header>
        <div className={styles.policyFields}><label>Policy ref<input value={approval.policyRef} placeholder="approval_policy_…" onChange={(e) => setApproval({ ...approval, policyRef: e.target.value })} /></label>
          <RoleChoices legend="Öneri isteyebilen roller" roles={["owner", "admin", "analyst"]} selected={approval.requesterRoles} onToggle={(role) => setApproval({ ...approval, requesterRoles: toggle(approval.requesterRoles, role) })} />
          <RoleChoices legend="K4 onaylayabilen roller" roles={["owner", "admin"]} selected={approval.approverRoles} onToggle={(role) => setApproval({ ...approval, approverRoles: toggle(approval.approverRoles, role) })} />
          <RoleChoices legend="Grant tüketebilen roller" roles={["owner", "admin"]} selected={approval.grantConsumerRoles} onToggle={(role) => setApproval({ ...approval, grantConsumerRoles: toggle(approval.grantConsumerRoles, role) })} />
          <label>Kanıt azami yaşı · saat<input type="number" min="0.01" step="0.01" value={approval.evidenceHours} onChange={(e) => setApproval({ ...approval, evidenceHours: e.target.value })} /></label>
          <label>Öneri yaşam süresi · saat<input type="number" min="0.01" step="0.01" value={approval.proposalHours} onChange={(e) => setApproval({ ...approval, proposalHours: e.target.value })} /></label>
          <label>Grant yaşam süresi · dakika<input type="number" min="1" value={approval.grantMinutes} onChange={(e) => setApproval({ ...approval, grantMinutes: e.target.value })} /></label>
          <label>Etkinlik başlangıcı<input type="datetime-local" value={approval.effectiveFrom} onChange={(e) => setApproval({ ...approval, effectiveFrom: e.target.value })} /></label>
          <label>Opsiyonel bitiş<input type="datetime-local" value={approval.expiresAt} onChange={(e) => setApproval({ ...approval, expiresAt: e.target.value })} /></label>
          <label className={styles.policyCheckbox}><input type="checkbox" checked={approval.separationOfDuties} onChange={(e) => setApproval({ ...approval, separationOfDuties: e.target.checked })} />İsteyen ve onaylayan ayrı olsun</label></div>
        <aside>Görüşme ipucu: süreler için örnek değerler tartışılabilir; hiçbir öneri forma otomatik yazılmaz.</aside>
        <footer><small>Kaydetme immutable revision üretir; öncesinde alanları kontrol edin.</small><button disabled={!result.authority.canDraft || !approvalValid || saving !== null} onClick={() => void persist("approval")}>{saving === "approval" ? "Kaydediliyor…" : "Approval taslağı ekle"}</button></footer></section>
      <section className={`${styles.panel} ${styles.policyDraftForm}`}><header><span className={styles.kicker}>GUARDRAIL · EXACT SCOPE</span><h2>Kampanya kapsamı taslağı</h2><p>Hesap, kampanya ve reklam seti zinciri yalnız sunucu kataloğundan seçilir.</p></header>
        <div className={styles.policyFields}><label>Policy ref<input value={guardrail.policyRef} placeholder="guardrail_existing_post_…" onChange={(e) => setGuardrail({ ...guardrail, policyRef: e.target.value })} /></label>
          <label>Reklam hesabı<select value={guardrail.accountRef} onChange={(e) => setGuardrail({ ...guardrail, accountRef: e.target.value, adSetRef: "" })}><option value="">Seçin</option>{result.scopeCatalog.accounts.map((item) => <option key={item.ref} value={item.ref}>{item.label}</option>)}</select></label>
          <label>Reklam seti<select value={guardrail.adSetRef} disabled={!guardrail.accountRef} onChange={(e) => setGuardrail({ ...guardrail, adSetRef: e.target.value })}><option value="">Seçin</option>{adSets.map((item) => <option key={item.ref} value={item.ref}>{item.label}</option>)}</select></label>
          <label>Kampanya ref<input value={selectedAdSet?.campaignRef ?? ""} readOnly placeholder="Reklam setinden türetilir" /></label>
          <fieldset><legend>Internal kategoriler</legend>{result.scopeCatalog.internalCategories.length ? result.scopeCatalog.internalCategories.map((item) => <label key={item.ref}><input type="checkbox" checked={guardrail.internalCategoryRefs.includes(item.ref)} onChange={() => setGuardrail({ ...guardrail, internalCategoryRefs: toggle(guardrail.internalCategoryRefs, item.ref) })} />{item.label}</label>) : <small>Katalogda kategori yok</small>}</fieldset>
          <label>Etkinlik başlangıcı<input type="datetime-local" value={guardrail.effectiveFrom} onChange={(e) => setGuardrail({ ...guardrail, effectiveFrom: e.target.value })} /></label>
          <label>Opsiyonel bitiş<input type="datetime-local" value={guardrail.expiresAt} onChange={(e) => setGuardrail({ ...guardrail, expiresAt: e.target.value })} /></label>
          <label>Guidance refs<input value={guardrail.sourceGuidanceRefs} placeholder="guidance_…, guidance_…" onChange={(e) => setGuardrail({ ...guardrail, sourceGuidanceRefs: e.target.value })} /></label>
          <label className={styles.policyCheckbox}><input type="checkbox" checked={guardrail.denyAction} onChange={(e) => setGuardrail({ ...guardrail, denyAction: e.target.checked, denyClauseRef: "" })} />Bu kapsamda eylemi engelle</label>
          {guardrail.denyAction ? <label>Deny clause ref<input value={guardrail.denyClauseRef} onChange={(e) => setGuardrail({ ...guardrail, denyClauseRef: e.target.value })} /></label> : null}</div>
        <footer><small>Geo hedefleme bu sürümde serbest metinle alınmaz; katalog gelene kadar kapalıdır.</small><button disabled={!result.authority.canDraft || !guardrailValid || saving !== null} onClick={() => void persist("guardrail")}>{saving === "guardrail" ? "Kaydediliyor…" : "Guardrail taslağı ekle"}</button></footer></section>
    </div>
    {notice ? <p className={styles.policyNotice} role="status">{notice}</p> : null}
    <section className={`${styles.panel} ${styles.policyRevisionFeed}`}><header className={styles.panelHeader}><div><span className={styles.kicker}>PUBLIC-SAFE REVISION FEED</span><h2>{result.approvalPolicies.length + result.guardrails.length} sürüm</h2></div><span>Actor ve hash yok</span></header>
      {result.approvalPolicies.length + result.guardrails.length === 0 ? <p>Henüz K4 politika taslağı yok.</p> : <div>{[...result.approvalPolicies, ...result.guardrails].map((item) => <article key={`${item.kind}:${item.policyRef}:${item.revision}`}><strong>{item.policyRef} · r{item.revision}</strong><span>{item.kind === "approval_policy" ? "ApprovalPolicy" : "Guardrail"}</span><em data-state={item.state}>{item.state}</em></article>)}</div>}
    </section>
  </div>;
}

export function PolicyBundleStudioPanel() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const load = useCallback(async () => { setState({ status: "loading" }); try {
    const response = await fetch("/api/policy-bundles", { cache: "no-store", credentials: "same-origin",
      headers: { "X-ReklamZeka-Intent": "policy-bundle-read" } });
    const payload: unknown = await response.json();
    if (!response.ok || !resultIsSafe(payload)) { const error = payload as { error?: { message?: string } };
      setState({ status: response.status === 503 ? "unavailable" : "error", message: error.error?.message ?? "K4 Policy Bundle okunamadı." }); return; }
    setState({ status: "ready", result: payload });
  } catch { setState({ status: "error", message: "K4 Policy Bundle bağlantısı kurulamadı." }); } }, []);
  useEffect(() => { void load(); }, [load]);
  if (state.status === "loading") return <section className={`${styles.panel} ${styles.autonomyStudioState}`} role="status">K4 politika kaynakları yükleniyor…</section>;
  if (state.status !== "ready") return <section className={`${styles.panel} ${styles.autonomyStudioState}`} role="alert"><strong>{state.status === "unavailable" ? "Kaynak henüz bağlı değil" : "K4 Policy Bundle okunamadı"}</strong><p>{state.message}</p><button onClick={() => void load()}>Tekrar dene</button></section>;
  return <PolicyBundleStudioSurface result={state.result} onReload={load} />;
}
