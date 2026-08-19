"use client";

import { FormEvent, useState } from "react";
import styles from "./budget-ceiling-policy-panel.module.css";
import { LocalSessionConnector } from "./local-session-connector";

const LAYERS = ["market", "organization_campaign", "geo_targeting_platform", "campaign_ad_set"] as const;
type Layer = (typeof LAYERS)[number];
export type BudgetCeilingPublicationCommand = Readonly<{ limitRef: string; revision: number; previousPolicyHash: string | null;
  poolRef: string; parentLimitRef: string | null; layer: Layer; targetScopeRef: string; market: "yerli" | "yabanci";
  currency: string; ceilingDecimal: string; effectiveFrom: string; effectiveTo: string; state: "published" | "disabled" }>;
type PublicationResult = Readonly<{ limitRef: string; revision: number; policyHash: string; persistence: "inserted" | "unchanged" }>;
class BudgetCeilingPublicationError extends Error { constructor(readonly code: string, message: string) { super(message); } }
const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const AMOUNT = /^(0|[1-9]\d{0,29})(?:\.\d{1,12})?$/;

function iso(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || !value) throw new Error("Tarih alanlarını doldurun.");
  const date = new Date(value); if (!Number.isFinite(date.valueOf())) throw new Error("Tarih geçersiz.");
  return date.toISOString();
}
function text(data: FormData, key: string): string { const value = data.get(key); return typeof value === "string" ? value.trim() : ""; }
export function budgetCeilingCommandFromForm(data: FormData): BudgetCeilingPublicationCommand {
  const layer = text(data, "layer") as Layer, revision = Number(text(data, "revision"));
  const previous = text(data, "previousPolicyHash"), parent = text(data, "parentLimitRef");
  const command = { limitRef: text(data, "limitRef"), revision, previousPolicyHash: previous || null,
    poolRef: text(data, "poolRef"), parentLimitRef: parent || null, layer, targetScopeRef: text(data, "targetScopeRef"),
    market: text(data, "market") as "yerli" | "yabanci", currency: text(data, "currency").toUpperCase(),
    ceilingDecimal: text(data, "ceilingDecimal"), effectiveFrom: iso(data.get("effectiveFrom")),
    effectiveTo: iso(data.get("effectiveTo")), state: text(data, "state") as "published" | "disabled" };
  if (!LAYERS.includes(layer) || !Number.isSafeInteger(revision) || revision < 1 || revision > 1_000_000
    || !REF.test(command.limitRef) || !command.limitRef.startsWith("limit_") || !REF.test(command.poolRef)
    || !command.poolRef.startsWith("budget_pool_") || !REF.test(command.targetScopeRef)
    || (revision === 1 ? command.previousPolicyHash !== null : !command.previousPolicyHash || !HASH.test(command.previousPolicyHash))
    || (layer === "market" ? command.parentLimitRef !== null : !command.parentLimitRef || !command.parentLimitRef.startsWith("limit_") || !REF.test(command.parentLimitRef))
    || !["yerli", "yabanci"].includes(command.market) || !/^[A-Z]{3}$/.test(command.currency)
    || !AMOUNT.test(command.ceilingDecimal) || command.ceilingDecimal === "0" || !["published", "disabled"].includes(command.state)
    || command.effectiveTo <= command.effectiveFrom) throw new Error("Politika alanları kanonik sözleşmeyle eşleşmiyor.");
  return Object.freeze(command);
}

function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
export async function publishBudgetCeilingPolicy(command: BudgetCeilingPublicationCommand): Promise<PublicationResult> {
  const response = await fetch("/api/budget-ceiling-policies", { method: "POST", cache: "no-store", credentials: "same-origin",
    headers: { "content-type": "application/json", "x-reklamzeka-intent": "budget-ceiling-policy-publish" }, body: JSON.stringify({ command }) });
  const payload = await response.json() as unknown;
  if (!response.ok) { const error = object(payload) && object(payload.error) ? payload.error : null;
    throw new BudgetCeilingPublicationError(error && typeof error.code === "string" ? error.code : "unavailable",
      error && typeof error.message === "string" ? error.message : "Tavan politikası yayımlanamadı."); }
  if (!object(payload) || payload.contractVersion !== "budget-ceiling-policy-http/1.0.0" || !object(payload.item)
    || typeof payload.item.limitRef !== "string" || !REF.test(payload.item.limitRef)
    || !Number.isSafeInteger(payload.item.revision) || typeof payload.item.policyHash !== "string" || !HASH.test(payload.item.policyHash)
    || (payload.persistence !== "inserted" && payload.persistence !== "unchanged") || payload.auditAppended !== true
    || !object(payload.authority) || payload.authority.canApprove !== false || payload.authority.canExecute !== false || payload.authority.canWriteMeta !== false)
    throw new Error("Sunucu yanıtı kanonik yayın sözleşmesiyle eşleşmiyor.");
  return Object.freeze({ limitRef: payload.item.limitRef, revision: payload.item.revision as number,
    policyHash: payload.item.policyHash, persistence: payload.persistence });
}

export function BudgetCeilingPolicyPanel() {
  const [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PublicationResult | null>(null);
  const [sessionRequired, setSessionRequired] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null); setResult(null);
    try { setResult(await publishBudgetCeilingPolicy(budgetCeilingCommandFromForm(new FormData(event.currentTarget)))); setSessionRequired(false); }
    catch (reason) { setSessionRequired(reason instanceof BudgetCeilingPublicationError && reason.code === "local_session_required");
      setError(reason instanceof Error ? reason.message : "Tavan politikası yayımlanamadı."); }
    finally { setSaving(false); }
  }
  return <section className={styles.panel} aria-labelledby="budget-ceiling-title"><header className={styles.header}><div><h2 id="budget-ceiling-title">Dört katmanlı bütçe tavanı yayımla</h2><p>Market → Kurum Kampanyası → geo/platform → kampanya/reklam seti zincirindeki tek bir insan-yazarlı immutable sürümü yayımlar.</p></div><span className={styles.badge}>CONSTRAINT ONLY</span></header>
    <p className={styles.notice}>Bu form ActionUnit onaylamaz, otomasyon açmaz, execute etmez ve Meta’ya yazmaz. İlk sürümde önceki hash boş; sonraki sürümde son kanonik hash zorunludur.</p>
    <form className={styles.form} onSubmit={(event) => void submit(event)} aria-busy={saving}><div className={styles.grid}>
      <label>Katman<select name="layer" defaultValue="market"><option value="market">Market</option><option value="organization_campaign">Kurum Kampanyası</option><option value="geo_targeting_platform">Geo / platform</option><option value="campaign_ad_set">Kampanya / reklam seti</option></select></label>
      <label>Durum<select name="state" defaultValue="published"><option value="published">Yayınlanmış</option><option value="disabled">Devre dışı</option></select></label>
      <label>Pazar<select name="market" defaultValue="yerli"><option value="yerli">Yerli</option><option value="yabanci">Yabancı</option></select></label>
      <label>Limit ref<input name="limitRef" required placeholder="limit_market_main" /></label>
      <label>Sürüm<input name="revision" required inputMode="numeric" defaultValue="1" /></label>
      <label>Önceki policy hash<input name="previousPolicyHash" maxLength={64} autoComplete="off" placeholder="İlk sürümde boş" /></label>
      <label>Havuz ref<input name="poolRef" required placeholder="budget_pool_main" /></label>
      <label>Üst limit ref<input name="parentLimitRef" placeholder="Market katmanında boş" /></label>
      <label>Hedef public ref<input name="targetScopeRef" required placeholder="ad_set_public_…" /></label>
      <label>Para birimi<input name="currency" required maxLength={3} defaultValue="TRY" /></label>
      <label>Tavan tutarı<input name="ceilingDecimal" required inputMode="decimal" placeholder="700" /></label>
      <label>Başlangıç<input name="effectiveFrom" required type="datetime-local" /></label>
      <label>Bitiş<input name="effectiveTo" required type="datetime-local" /></label>
    </div><div className={styles.actions}><button type="submit" disabled={saving}>{saving ? "Yayımlanıyor…" : "Immutable tavan sürümünü yayımla"}</button><span className={styles.status}>Owner/admin · insan-yazarlı · audit kayıtlı</span></div></form>
    {error ? <p className={`${styles.status} ${styles.error}`} role="alert">{error}</p> : null}
    {sessionRequired ? <LocalSessionConnector idPrefix="budget-ceiling-session" title="Bütçe tavanı yayın oturumunu bağlayın"
      onVerify={async () => { setSessionRequired(false); setError(null); return true; }} /> : null}
    {result ? <p className={`${styles.status} ${styles.success}`} role="status">{result.limitRef} · r{result.revision} · {result.persistence === "inserted" ? "yayımlandı" : "değişmeden tekrarlandı"} · hash {result.policyHash}</p> : null}
  </section>;
}
