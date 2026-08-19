"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { LocalSessionConnector } from "./local-session-connector";
import styles from "./budget-pool-hierarchy-panel.module.css";

type Layer = "market" | "service_family" | "targeting" | "entity" | "named";
type Market = "domestic" | "international";
type Node = Readonly<{ poolRef: string; parentPoolRef: string | null; layer: Layer; market: Market; currency: string; hardCapDecimal: string; effectiveFrom: string; effectiveTo: string }>;
type Snapshot = Readonly<{ contractVersion: "budget-pool-hierarchy-http/1.0.0"; item: Readonly<{ revision: number; hierarchyHash: string; nodes: readonly Node[]; authority: Readonly<{ recommendationOnly: true; canPublish: false; canApprove: false; canExecute: false; canWriteMeta: false; canEnableAutomation: false }> }> | null; authority: Readonly<{ canRead: true; canSaveDraft: boolean }> }>;

const emptyNodes = Object.freeze([] satisfies readonly Node[]);
const amount = /^(0|[1-9]\d{0,29})(?:\.\d{1,12})?$/;
const layerLabels: Readonly<Record<Layer, string>> = Object.freeze({ market: "Pazar", service_family: "Hizmet / aile", targeting: "Geo / hedefleme / platform", entity: "Kampanya / ad set", named: "Özel alt havuz" });
const mainChildLayers: Readonly<Record<Exclude<Layer, "named">, readonly Exclude<Layer, "market" | "named">[]>> = Object.freeze({
  market: ["service_family"], service_family: ["targeting"], targeting: ["entity"], entity: [],
});

function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function validNode(value: unknown): value is Node {
  return object(value) && typeof value.poolRef === "string" && (value.parentPoolRef === null || typeof value.parentPoolRef === "string")
    && ["market", "service_family", "targeting", "entity", "named"].includes(String(value.layer))
    && ["domestic", "international"].includes(String(value.market)) && typeof value.currency === "string"
    && typeof value.hardCapDecimal === "string" && typeof value.effectiveFrom === "string" && typeof value.effectiveTo === "string";
}

export function parseBudgetPoolHierarchySnapshot(value: unknown): Snapshot {
  if (!object(value) || value.contractVersion !== "budget-pool-hierarchy-http/1.0.0" || !object(value.authority)
    || value.authority.canRead !== true || typeof value.authority.canSaveDraft !== "boolean"
    || !(value.item === null || object(value.item) && Number.isInteger(value.item.revision) && typeof value.item.hierarchyHash === "string"
      && Array.isArray(value.item.nodes) && value.item.nodes.every(validNode) && object(value.item.authority)
      && value.item.authority.recommendationOnly === true && value.item.authority.canExecute === false && value.item.authority.canWriteMeta === false)) {
    throw new Error("Bütçe havuzu güvenli sözleşmeyi döndürmedi.");
  }
  return value as unknown as Snapshot;
}

function decimal(value: string) {
  const matched = amount.exec(value);
  return matched && value !== "0" ? BigInt(`${matched[1]}${(matched[2] ?? "").padEnd(12, "0")}`) : null;
}
function isIsoWindow(node: Node) {
  const from = new Date(node.effectiveFrom); const to = new Date(node.effectiveTo);
  return /^\d{4}-\d{2}-\d{2}T.*Z$/.test(node.effectiveFrom) && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(node.effectiveTo)
    && Number.isFinite(from.valueOf()) && Number.isFinite(to.valueOf()) && from.toISOString() === node.effectiveFrom
    && to.toISOString() === node.effectiveTo && node.effectiveTo > node.effectiveFrom;
}

/** Client-side guidance only. The immutable server revision remains authoritative. */
export function validateBudgetPoolDraft(nodes: readonly Node[]): string | null {
  if (nodes.length < 2) return "Yerli ve yabancı pazar köklerinin ikisi de gerekir.";
  const refs = new Set<string>(); const index = new Map<string, Node>();
  for (const node of nodes) {
    if (!/^budget_pool_[a-z0-9][a-z0-9_.:-]{0,119}$/.test(node.poolRef) || refs.has(node.poolRef)
      || !/^[A-Z]{3}$/.test(node.currency) || decimal(node.hardCapDecimal) === null || !isIsoWindow(node)) return "Bir havuzun tavanı, para birimi veya tarih aralığı geçerli değil.";
    refs.add(node.poolRef); index.set(node.poolRef, node);
  }
  const roots = nodes.filter((node) => node.parentPoolRef === null);
  if (roots.length !== 2 || roots.some((node) => node.layer !== "market") || new Set(roots.map((node) => node.market)).size !== 2) return "Yerli ve yabancı kökler ayrı pazar havuzları olmalı.";
  for (const node of nodes) {
    if (node.parentPoolRef === null) continue;
    const parent = index.get(node.parentPoolRef);
    if (!parent) return "Alt havuzun seçili üst havuzu bulunamadı.";
    if (node.market !== parent.market || node.currency !== parent.currency) return "Alt havuz, üst havuzunun pazar ve para biriminde kalmalı.";
    if (decimal(node.hardCapDecimal)! > decimal(parent.hardCapDecimal)!) return "Alt havuzun tavanı üst havuzun tavanını aşamaz.";
    if (node.effectiveFrom < parent.effectiveFrom || node.effectiveTo > parent.effectiveTo) return "Alt havuzun tarih aralığı üst havuzun aralığında kalmalı.";
  }
  return null;
}

function request(method: "GET" | "POST", body?: unknown) {
  return fetch("/api/budget-pool-hierarchy", { method, credentials: "same-origin", headers: { "x-reklamzeka-intent": method === "GET" ? "budget-pool-hierarchy-read" : "budget-pool-hierarchy-save", ...(method === "POST" ? { "content-type": "application/json" } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function defaultWindow() {
  const from = new Date(); const to = new Date(from.valueOf()); to.setUTCDate(to.getUTCDate() + 30);
  return Object.freeze({ effectiveFrom: from.toISOString(), effectiveTo: to.toISOString() });
}
function hiddenRef() { return `budget_pool_${crypto.randomUUID().replaceAll("-", "")}`; }
function createRoot(market: Market): Node { return Object.freeze({ poolRef: hiddenRef(), parentPoolRef: null, layer: "market", market, currency: "TRY", hardCapDecimal: "", ...defaultWindow() }); }
function createChild(parent: Node, layer: Exclude<Layer, "market">): Node { return Object.freeze({ poolRef: hiddenRef(), parentPoolRef: parent.poolRef, layer, market: parent.market, currency: parent.currency, hardCapDecimal: "", effectiveFrom: parent.effectiveFrom, effectiveTo: parent.effectiveTo }); }
function localDate(value: string) { return value.slice(0, 16); }
function utcDate(value: string) { const parsed = new Date(value); return Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : value; }
function marketLabel(market: Market) { return market === "domestic" ? "Yerli" : "Yabancı"; }

export function BudgetPoolHierarchyPanel() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [nodes, setNodes] = useState<readonly Node[]>(emptyNodes);
  const [state, setState] = useState<"loading" | "ready" | "session_required" | "unavailable">("loading");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setState("loading"); setMessage("");
    try {
      const response = await request("GET");
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as unknown;
        const code = object(payload) && object(payload.error) && payload.error.code === "local_session_required";
        setState(code ? "session_required" : "unavailable");
        setNodes(emptyNodes);
        setMessage(code
          ? "Bütçe havuzu kayıtlarını görmek veya taslak kaydetmek için yerel oturum gerekli."
          : "Kayıt defteri şu anda kaynak nedeniyle okunamıyor. Hiçbir varsayılan havuz kaydedilmedi.");
        return false;
      }
      const next = parseBudgetPoolHierarchySnapshot(await response.json());
      setSnapshot(next); setNodes(next.item?.nodes ?? emptyNodes); setState("ready");
      return true;
    } catch {
      setState("unavailable"); setNodes(emptyNodes);
      setMessage("Kayıt defteri şu anda oturum veya kaynak nedeniyle okunamıyor. Hiçbir varsayılan havuz kaydedilmedi.");
      return false;
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const roots = useMemo(() => ({ domestic: nodes.find((node) => node.parentPoolRef === null && node.market === "domestic") ?? null, international: nodes.find((node) => node.parentPoolRef === null && node.market === "international") ?? null }), [nodes]);
  const nodeByRef = useMemo(() => new Map(nodes.map((node) => [node.poolRef, node])), [nodes]);
  const children = useCallback((parentRef: string) => nodes.filter((node) => node.parentPoolRef === parentRef), [nodes]);
  const update = useCallback((poolRef: string, patch: Partial<Pick<Node, "currency" | "hardCapDecimal" | "effectiveFrom" | "effectiveTo">>) => setNodes((current) => current.map((node) => node.poolRef === poolRef ? Object.freeze({ ...node, ...patch }) : node)), []);
  const addRoot = useCallback((market: Market) => setNodes((current) => current.some((node) => node.parentPoolRef === null && node.market === market) ? current : [...current, createRoot(market)]), []);
  const addChild = useCallback((parent: Node, layer: Exclude<Layer, "market">) => setNodes((current) => [...current, createChild(parent, layer)]), []);
  const draftError = useMemo(() => validateBudgetPoolDraft(nodes), [nodes]);
  const canSave = state === "ready" && Boolean(snapshot?.authority.canSaveDraft) && !saving && !draftError;

  const save = useCallback(async () => {
    const guidanceError = validateBudgetPoolDraft(nodes);
    if (guidanceError) { setMessage(guidanceError); return; }
    const current = snapshot?.item; setSaving(true); setMessage("");
    try {
      const response = await request("POST", { command: { revision: (current?.revision ?? 0) + 1, previousHierarchyHash: current?.hierarchyHash ?? "GENESIS", idempotencyKey: `budget-pools.r${(current?.revision ?? 0) + 1}`, nodes } });
      if (!response.ok) throw new Error("save");
      await load(); setMessage("Havuz taslağı immutable revizyon olarak kaydedildi; uygulama yetkisi hâlâ kapalı.");
    } catch { setMessage("Kayıt reddedildi. Pazar, tavan ve zaman penceresi sınırlarını kontrol edin."); }
    finally { setSaving(false); }
  }, [load, nodes, snapshot]);

  const renderNode = (node: Node, ordinal: number): ReactNode => {
    const childNodes = children(node.poolRef); const mainLayers = node.layer === "named" ? [] : mainChildLayers[node.layer as Exclude<Layer, "named">] ?? [];
    return <li className={styles.node} key={node.poolRef}>
      <div className={styles.nodeHeader}><div><strong>{node.parentPoolRef === null ? `${marketLabel(node.market)} pazar kökü` : `${layerLabels[node.layer]} ${ordinal + 1}`}</strong><span>{node.parentPoolRef === null ? "Pazar tavanı" : `Üst tavan: ${nodeByRef.get(node.parentPoolRef)?.hardCapDecimal ?? "—"} ${node.currency}`}</span></div><span className={styles.market}>{marketLabel(node.market)}</span></div>
      <div className={styles.fields}>
        <label>Tavan<input aria-label={`${layerLabels[node.layer]} tavanı`} inputMode="decimal" value={node.hardCapDecimal} onChange={(event) => update(node.poolRef, { hardCapDecimal: event.target.value })} disabled={!snapshot?.authority.canSaveDraft || saving} /></label>
        <label>Para birimi<input aria-label={`${layerLabels[node.layer]} para birimi`} value={node.currency} onChange={(event) => update(node.poolRef, { currency: event.target.value.toUpperCase() })} readOnly={node.parentPoolRef !== null || childNodes.length > 0} aria-readonly={node.parentPoolRef !== null || childNodes.length > 0} disabled={!snapshot?.authority.canSaveDraft || saving} /></label>
        <label>Başlangıç<input aria-label={`${layerLabels[node.layer]} başlangıcı`} type="datetime-local" value={localDate(node.effectiveFrom)} onChange={(event) => update(node.poolRef, { effectiveFrom: utcDate(event.target.value) })} disabled={!snapshot?.authority.canSaveDraft || saving} /></label>
        <label>Bitiş<input aria-label={`${layerLabels[node.layer]} bitişi`} type="datetime-local" value={localDate(node.effectiveTo)} onChange={(event) => update(node.poolRef, { effectiveTo: utcDate(event.target.value) })} disabled={!snapshot?.authority.canSaveDraft || saving} /></label>
      </div>
      {mainLayers.map((layer) => <button className={styles.add} type="button" key={layer} onClick={() => addChild(node, layer)} disabled={!snapshot?.authority.canSaveDraft || saving}>{layerLabels[layer]} ekle</button>)}
      {node.layer !== "named" && <details className={styles.named}><summary>Özel alt havuz</summary><button className={styles.add} type="button" onClick={() => addChild(node, "named")} disabled={!snapshot?.authority.canSaveDraft || saving}>Özel alt havuz ekle</button></details>}
      {childNodes.length > 0 && <ol className={styles.tree}>{childNodes.map((child, index) => renderNode(child, index))}</ol>}
    </li>;
  };

  return <section className={styles.panel} aria-label="Bütçe havuzu çalışma alanı">
    <div className={styles.header}><div><h2 className={styles.title}>Bütçe Havuzları</h2><p className={styles.hint}>Pazar → hizmet/aile → hedefleme → kampanya/ad set akışını yönetin. Bu ekran yalnız öneri taslağı kaydeder; Meta bütçesi değiştirmez.</p></div><span className={styles.badge}>Recommendation-only</span></div>
    <p className={styles.notice}>Yerli ve yabancı kökler ayrıdır. Alt havuzlar üst tavanı ve tarih aralığını aşamaz; kesin kontrol immutable revizyon kaydedilirken sunucuda yapılır.</p>
    {state === "session_required" ? <section className={styles.sessionRequired} role="alert"><strong>YEREL OTURUM GEREKLİ</strong><p>{message}</p><LocalSessionConnector title="Bütçe havuzu çalışma alanını bağlayın" onVerify={load} /></section> : null}
    {state === "unavailable" ? <section className={styles.sessionRequired} role="alert"><strong>KAYNAK KULLANILAMIYOR</strong><p>{message}</p><button type="button" onClick={() => void load()}>Tekrar dene</button></section> : null}
    {state === "ready" ? <div className={styles.roots}>{(["domestic", "international"] as const).map((market) => {
      const root = roots[market];
      return <section className={styles.marketColumn} key={market} aria-label={`${marketLabel(market)} havuzları`}><h3>{marketLabel(market)}</h3>{root ? <ol className={styles.tree}>{renderNode(root, 0)}</ol> : <div className={styles.empty}><p>Henüz pazar kökü yok.</p><button type="button" onClick={() => addRoot(market)} disabled={!snapshot?.authority.canSaveDraft || saving}>{marketLabel(market)} kökü ekle</button></div>}</section>;
    })}</div> : null}
    {state === "ready" ? <div className={styles.actions}><button type="button" onClick={() => void save()} disabled={!canSave}>{saving ? "Kaydediliyor…" : "Yeni taslak revizyonu kaydet"}</button><button type="button" onClick={() => void load()} disabled={saving}>Yenile</button><span className={draftError || message.includes("reddedildi") ? styles.error : styles.status}>{message || draftError || "Approval, execute ve Meta write kapalı."}</span></div> : state === "loading" ? <p className={styles.status} role="status">Bütçe havuzu kayıtları doğrulanıyor…</p> : null}
  </section>;
}
