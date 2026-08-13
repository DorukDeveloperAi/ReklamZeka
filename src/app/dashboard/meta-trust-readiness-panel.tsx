"use client";

import { useCallback, useEffect, useState } from "react";

type Stream = Readonly<{
  stream: "hierarchy" | "insights" | "content" | "assets";
  status: "ready" | "degraded" | "not_ready";
  reasonCodes: readonly string[];
  freshnessAgeHours: number | null;
  coverageRatios: Readonly<{ entity: number | null; metric: number | null; content: number | null }>;
}>;
type TrustAccount = Readonly<{
  accountRef: string;
  status: "ready" | "degraded" | "not_ready";
  reasonCodes: readonly string[];
  streams: readonly Stream[];
}>;
type Report = Readonly<{
  connectionRef: string;
  report: Readonly<{
    thresholdVersion: string;
    status: "ready" | "degraded" | "not_ready";
    reasonCodes: readonly string[];
    accounts: readonly TrustAccount[];
  }>;
}>;

function reportFrom(value: unknown): readonly Report[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.version !== "meta-trust-readiness-read/1.0.0" || !Array.isArray(record.reports)
    || !record.authority || typeof record.authority !== "object") return null;
  const authority = record.authority as Record<string, unknown>;
  if (authority.actionAuthority !== "none" || authority.canPublish !== false || authority.canApprove !== false
    || authority.canExecute !== false || authority.canWriteMeta !== false) return null;
  const reports: Report[] = [];
  for (const candidate of record.reports) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const entry = candidate as Record<string, unknown>; const report = entry.report;
    if (typeof entry.connectionRef !== "string" || !/^connection_[a-f0-9]{24}$/.test(entry.connectionRef)
      || !report || typeof report !== "object" || Array.isArray(report)) return null;
    const body = report as Record<string, unknown>;
    if (typeof body.thresholdVersion !== "string" || !["ready", "degraded", "not_ready"].includes(body.status as string)
      || !Array.isArray(body.reasonCodes) || !Array.isArray(body.accounts)
      || body.reasonCodes.some((item) => typeof item !== "string")) return null;
    const accounts: TrustAccount[] = [];
    for (const account of body.accounts) {
      if (!account || typeof account !== "object" || Array.isArray(account)) return null;
      const item = account as Record<string, unknown>;
      if (typeof item.accountRef !== "string" || !/^acct_[a-f0-9]{12}$/.test(item.accountRef)
        || !["ready", "degraded", "not_ready"].includes(item.status as string)
        || !Array.isArray(item.reasonCodes) || !Array.isArray(item.streams)
        || item.reasonCodes.some((code) => typeof code !== "string")) return null;
      const streams: Stream[] = [];
      for (const stream of item.streams) {
        if (!stream || typeof stream !== "object" || Array.isArray(stream)) return null;
        const s = stream as Record<string, unknown>; const ratios = s.coverageRatios;
        if (!["hierarchy", "insights", "content", "assets"].includes(s.stream as string)
          || !["ready", "degraded", "not_ready"].includes(s.status as string)
          || !Array.isArray(s.reasonCodes) || s.reasonCodes.some((code) => typeof code !== "string")
          || !(s.freshnessAgeHours === null || typeof s.freshnessAgeHours === "number" && s.freshnessAgeHours >= 0)
          || !ratios || typeof ratios !== "object" || Array.isArray(ratios)) return null;
        const r = ratios as Record<string, unknown>;
        if (["entity", "metric", "content"].some((key) => !(r[key] === null || typeof r[key] === "number" && r[key] >= 0 && r[key] <= 1))) return null;
        streams.push({ stream: s.stream as Stream["stream"], status: s.status as Stream["status"], reasonCodes: s.reasonCodes as string[], freshnessAgeHours: s.freshnessAgeHours as number | null, coverageRatios: r as Stream["coverageRatios"] });
      }
      accounts.push({ accountRef: item.accountRef, status: item.status as "ready" | "degraded" | "not_ready", reasonCodes: item.reasonCodes as string[], streams });
    }
    reports.push({ connectionRef: entry.connectionRef, report: { thresholdVersion: body.thresholdVersion, status: body.status as "ready" | "degraded" | "not_ready", reasonCodes: body.reasonCodes as string[], accounts } });
  }
  return reports;
}

export function MetaTrustReadinessPanel() {
  const [state, setState] = useState<"loading" | "ready" | "session_required" | "unavailable">("loading");
  const [reports, setReports] = useState<readonly Report[]>([]);
  const refresh = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch("/api/meta/trust-readiness", { cache: "no-store", credentials: "same-origin" });
      const body: unknown = await response.json(); const parsed = response.ok ? reportFrom(body) : null;
      if (parsed) { setReports(parsed); setState("ready"); }
      else { setReports([]); setState(response.status === 401 ? "session_required" : "unavailable"); }
    } catch { setReports([]); setState("unavailable"); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return <section aria-label="Meta veri kalitesi" style={{ marginTop: 16 }}>
    <header><div><span>CANONICAL TRUST / READINESS</span><h2>Veri kalitesi ve kapsam</h2></div><button onClick={() => void refresh()} disabled={state === "loading"}>Yenile</button></header>
    {state === "loading" ? <p>Veri kalitesi kanıtı okunuyor…</p> : state === "session_required" ? <p>Detaylı veri kalitesi raporu için yerel dashboard oturumu gerekli.</p> : state === "unavailable" ? <p>Veri kalitesi raporu güvenli biçimde okunamadı; hiyerarşi yerine tahmin üretilmedi.</p> : reports.length === 0 ? <p>Aktif bağlantı için değerlendirilebilir canonical hesap bulunamadı.</p> : reports.map(({ connectionRef, report }) => <article key={connectionRef}><strong>{report.status}</strong><small> · Eşik: {report.thresholdVersion}</small>{report.reasonCodes.length ? <p>{report.reasonCodes.join(" · ")}</p> : null}{report.accounts.map((account) => <details key={account.accountRef}><summary>{account.accountRef} · {account.status}</summary>{account.reasonCodes.length ? <p>{account.reasonCodes.join(" · ")}</p> : null}<ul>{account.streams.map((stream) => <li key={stream.stream}><strong>{stream.stream}: {stream.status}</strong> · entity {stream.coverageRatios.entity === null ? "bilinmiyor" : `%${Math.round(stream.coverageRatios.entity * 100)}`} · freshness {stream.freshnessAgeHours === null ? "bilinmiyor" : `${stream.freshnessAgeHours}s`} {stream.reasonCodes.length ? `· ${stream.reasonCodes.join(", ")}` : ""}</li>)}</ul></details>)}</article>)}
    <footer>Salt-okunur canonical kanıt · publish/approve/execute/Meta write kapalı</footer>
  </section>;
}
