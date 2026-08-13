"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApprovalPolicyDraftRequest, GuardrailPolicyDraftRequest,
  PolicyBundleStudioResult } from "@/application/policy-bundle-studio-service";
import type { ApprovalPolicyApplicability } from "@/domain/actions/approval-policy-registry";
import styles from "./operating-dashboard.module.css";

type LoadState = { status: "loading" } | { status: "error" | "unavailable"; message: string }
  | { status: "ready"; result: PolicyBundleStudioResult };
type ApprovalForm = { policyRef: string; requesterRoles: string[]; approverRoles: string[]; grantConsumerRoles: string[];
  applicability?: ApprovalPolicyApplicability;
  separationOfDuties: boolean; evidenceHours: string; proposalHours: string; grantMinutes: string;
  effectiveFrom: string; expiresAt: string };
type GuardrailForm = { policyRef: string; accountRef: string; adSetRef: string; internalCategoryRefs: string[];
  denyAction: boolean; denyClauseRef: string; effectiveFrom: string; expiresAt: string; sourceGuidanceRefs: string };

const emptyApproval: ApprovalForm = { policyRef: "", requesterRoles: [], approverRoles: [], grantConsumerRoles: [],
  applicability: { actionType: "existing_post_promotion", risk: "K4" }, separationOfDuties: false,
  evidenceHours: "", proposalHours: "", grantMinutes: "", effectiveFrom: "", expiresAt: "" };
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
    && Boolean(result.authority) && typeof result.authority?.canStartPublicationCeremony === "boolean"
    && result.authority.canPublish === false && result.authority.canDisable === false
    && result.authority.canApproveAction === false && result.authority.canGrant === false
    && result.authority.canExecute === false && result.authority.canWriteMeta === false;
}
function toggle(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}
function publicationAuthorityClosed(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const authority = value as Record<string, unknown>;
  return authority.canPublish === false && authority.canDisable === false && authority.canApproveAction === false
    && authority.canGrant === false && authority.canExecute === false && authority.canWriteMeta === false;
}

export function createApprovalPolicyDraftBody(form: ApprovalForm): ApprovalPolicyDraftRequest {
  return { kind: "approval_policy", policyRef: form.policyRef,
    applicability: form.applicability ?? { actionType: "existing_post_promotion", risk: "K4" },
    requesterRoles: form.requesterRoles as ApprovalPolicyDraftRequest["requesterRoles"],
    approverRoles: form.approverRoles as ApprovalPolicyDraftRequest["approverRoles"],
    grantConsumerRoles: form.grantConsumerRoles as ApprovalPolicyDraftRequest["grantConsumerRoles"],
    separationOfDuties: form.separationOfDuties,
    maximumProtectionEvidenceAgeSeconds: positiveSeconds(form.evidenceHours, 3_600),
    maximumProposalLifetimeSeconds: positiveSeconds(form.proposalHours, 3_600),
    maximumGrantLifetimeSeconds: positiveSeconds(form.grantMinutes, 60), effectiveFrom: iso(form.effectiveFrom),
    expiresAt: form.expiresAt ? iso(form.expiresAt) : null };
}
function applicabilityLabel(value: ApprovalPolicyApplicability): string {
  if (value.actionType === "budget_decrease") return "K2 · bütçe azaltma";
  if (value.actionType === "budget_increase") return "K3 · bütçe artırma";
  return "K4 · mevcut gönderi öne çıkarma";
}
function applicabilityFromValue(value: string): ApprovalPolicyApplicability {
  if (value === "budget_decrease") return { actionType: "budget_decrease", risk: "K2" };
  if (value === "budget_increase") return { actionType: "budget_increase", risk: "K3" };
  return { actionType: "existing_post_promotion", risk: "K4" };
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
export async function runPolicyPublicationCeremony(item: Readonly<{ kind: "approval_policy" | "guardrail_policy";
  policyRef: string; revision: number }>, reasonRef: string, request: typeof fetch = fetch): Promise<void> {
  if (!/^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/.test(reasonRef)) {
    throw new Error("Yayın için yapılandırılmış bir reason ref gerekli.");
  }
  const confirm = await request("/api/policy-bundles", { method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": "policy-bundle-confirm-human-presence" },
    body: JSON.stringify(item) });
  const confirmation: unknown = await confirm.json();
  const challenge = confirmation && typeof confirmation === "object" && "challenge" in confirmation
    ? (confirmation as { challenge?: Record<string, unknown> }).challenge : null;
  const confirmationAuthority = confirmation && typeof confirmation === "object" && "authority" in confirmation
    ? (confirmation as { authority?: unknown }).authority : null;
  if (!confirm.ok || !challenge || challenge.kind !== item.kind || challenge.policyRef !== item.policyRef
    || challenge.revision !== item.revision || typeof challenge.unitRef !== "string"
    || !/^policy_unit_[a-f0-9]{20}$/.test(challenge.unitRef) || typeof challenge.proof !== "string"
    || !/^presence_[A-Za-z0-9_-]{32,160}$/.test(challenge.proof) || typeof challenge.expiresAt !== "string"
    || !Number.isFinite(Date.parse(challenge.expiresAt)) || !publicationAuthorityClosed(confirmationAuthority)) {
    const error = confirmation as { error?: { message?: string } };
    throw new Error(error.error?.message ?? "İnsan-varlığı töreni doğrulanamadı.");
  }
  const intent = item.kind === "approval_policy" ? "policy-bundle-publish-approval-policy"
    : "policy-bundle-publish-guardrail-policy";
  const publish = await request("/api/policy-bundles", { method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": intent },
    body: JSON.stringify({ policyRef: item.policyRef, revision: item.revision, reasonRef,
      humanPresenceProof: challenge.proof }) });
  const result: unknown = await publish.json();
  const published = result && typeof result === "object" && "item" in result
    ? (result as { item?: Record<string, unknown> }).item : null;
  const resultAuthority = result && typeof result === "object" && "authority" in result
    ? (result as { authority?: unknown }).authority : null;
  if (!publish.ok || !published || (result as { contractVersion?: unknown }).contractVersion !== "policy-bundle-publication/1.0.0"
    || published.kind !== item.kind || published.policyRef !== item.policyRef
    || published.draftRevision !== item.revision || published.state !== "published"
    || !publicationAuthorityClosed(resultAuthority)) {
    const error = result as { error?: { message?: string } };
    throw new Error(error.error?.message ?? "Policy yayını doğrulanamadı.");
  }
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
  const [publicationReason, setPublicationReason] = useState(""); const [publishing, setPublishing] = useState<string | null>(null);
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
  const publishDraft = async (item: Readonly<{ kind: "approval_policy" | "guardrail_policy";
    policyRef: string; revision: number }>) => { const key = `${item.kind}:${item.policyRef}:${item.revision}`;
    setPublishing(key); setNotice(null); try { await runPolicyPublicationCeremony(item, publicationReason);
      setNotice("Policy yayınlandı. Bu kayıt tek başına action onayı, execute veya Meta write yetkisi vermez.");
      setPublicationReason(""); await onReload();
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Policy yayınlanamadı."); }
    finally { setPublishing(null); } };
  const readiness = result.readiness;
  const selectedApplicability = approval.applicability ?? { actionType: "existing_post_promotion" as const, risk: "K4" as const };
  return <div className={styles.policyBundleStack}>
    <section className={`${styles.panel} ${styles.policyReadiness}`}>
      <header className={styles.panelHeader}><div><span className={styles.kicker}>K4 POLICY GATE</span><h2>{readiness.policyBundleReady ? "Politika kapısı hazır" : "Politika kapısı hazır değil"}</h2></div><span data-ready={readiness.policyBundleReady}>{readiness.policyBundleReady ? "POLICY READY" : "NOT READY"}</span></header>
      <div>{[["ApprovalPolicy", readiness.approvalPolicy], ["Guardrail", readiness.guardrail], ["Workspace autonomy", readiness.workspaceAutonomy], ["Authentic evidence", readiness.authenticEvidence], ["Compatibility", readiness.compatibility]].map(([label, value]) => <article key={label}><span>{label}</span><strong>{statusLabel[value as keyof typeof statusLabel]}</strong><small>{value}</small></article>)}</div>
      <p>Taslaklar çalışma motoruna dahil edilmez. Bu stüdyo yalnız politika kapısını ölçer; tam proposal readiness, authentic evidence ve beş compatibility boyutu gerçek seçim hash’iyle preflight anında doğrulandıktan sonra oluşur.</p>
    </section>
    <div className={styles.policyBundleGrid}>
      <section className={`${styles.panel} ${styles.policyDraftForm}`}><header><span className={styles.kicker}>APPROVAL POLICY · EXACT K2/K3/K4</span><h2>Onay yaşam döngüsü taslağı</h2><p>Kural türü açıkça seçilir; K2, K3 ve K4 birbirinin yerine geçmez. Alanlar bilinçli olarak boş.</p></header>
        <div className={styles.policyFields}><label>Policy ref<input value={approval.policyRef} placeholder="approval_policy_…" onChange={(e) => setApproval({ ...approval, policyRef: e.target.value })} /></label>
          <label>Onay kapsamı<select aria-label="Onay kapsamı" value={selectedApplicability.actionType} onChange={(e) => setApproval({ ...approval, applicability: applicabilityFromValue(e.target.value) })}><option value="existing_post_promotion">K4 · Mevcut gönderi öne çıkarma</option><option value="budget_decrease">K2 · Bütçe azaltma</option><option value="budget_increase">K3 · Bütçe artırma</option></select></label>
          <RoleChoices legend="Öneri isteyebilen roller" roles={["owner", "admin", "analyst"]} selected={approval.requesterRoles} onToggle={(role) => setApproval({ ...approval, requesterRoles: toggle(approval.requesterRoles, role) })} />
          <RoleChoices legend={`${selectedApplicability.risk} onaylayabilen roller`} roles={["owner", "admin"]} selected={approval.approverRoles} onToggle={(role) => setApproval({ ...approval, approverRoles: toggle(approval.approverRoles, role) })} />
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
      {result.authority.canStartPublicationCeremony && [...result.approvalPolicies, ...result.guardrails].some((item) => item.state === "draft") ? <label className={styles.policyPublicationReason}>Yayın reason ref<input value={publicationReason} placeholder="reason_owner_reviewed_…" onChange={(event) => setPublicationReason(event.target.value)} /><small>Yayın, macOS insan-varlığı diyaloğu ve tek kullanımlık kanıt ister.</small></label> : null}
      {result.approvalPolicies.length + result.guardrails.length === 0 ? <p>Henüz K2/K3/K4 politika taslağı yok.</p> : <div>{[...result.approvalPolicies, ...result.guardrails].map((item) => { const key = `${item.kind}:${item.policyRef}:${item.revision}`; return <article key={key}><strong>{item.policyRef} · r{item.revision}</strong><span>{item.kind === "approval_policy" ? `ApprovalPolicy · ${applicabilityLabel(item.applicability)}` : "Guardrail"}</span><em data-state={item.state}>{item.state}</em>{item.state === "draft" && result.authority.canStartPublicationCeremony ? <button disabled={!publicationReason || publishing !== null} onClick={() => void publishDraft(item)}>{publishing === key ? "Tören sürüyor…" : "İnsan onayıyla yayınla"}</button> : null}</article>; })}</div>}
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
      setState({ status: response.status === 503 ? "unavailable" : "error", message: error.error?.message ?? "Policy Bundle okunamadı." }); return; }
    setState({ status: "ready", result: payload });
  } catch { setState({ status: "error", message: "Policy Bundle bağlantısı kurulamadı." }); } }, []);
  useEffect(() => { void load(); }, [load]);
  if (state.status === "loading") return <section className={`${styles.panel} ${styles.autonomyStudioState}`} role="status">K2/K3/K4 politika kaynakları yükleniyor…</section>;
  if (state.status !== "ready") return <section className={`${styles.panel} ${styles.autonomyStudioState}`} role="alert"><strong>{state.status === "unavailable" ? "Kaynak henüz bağlı değil" : "Policy Bundle okunamadı"}</strong><p>{state.message}</p><button onClick={() => void load()}>Tekrar dene</button></section>;
  return <PolicyBundleStudioSurface result={state.result} onReload={load} />;
}
