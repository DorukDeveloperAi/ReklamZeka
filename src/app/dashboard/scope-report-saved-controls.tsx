"use client";

import { useState } from "react";
import type {
  SavedScopeReportQuery,
  SavedScopeReportRevision,
} from "@/domain/slices/scope-report-saved";
import styles from "./scope-report-panel.module.css";

const REF = /^scope_report_saved_[a-f0-9]{24}$/;
const HASH = /^[a-f0-9]{64}$/;
const COMMAND = /^scope_report_save_[a-f0-9]{64}$/;
const SLICE = /^slice_[a-z0-9][a-z0-9_.:-]{0,190}$/;
const KEY = /^[a-z][a-z0-9_:-]{0,80}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
function exact(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length === keys.length &&
    Object.keys(value as Record<string, unknown>).every((key) =>
      keys.includes(key),
    )
  );
}
function query(value: unknown): value is SavedScopeReportQuery {
  if (
    !exact(value, [
      "slice",
      "start",
      "end",
      "granularity",
      "level",
      "metric",
      "action",
      "sort",
      "direction",
    ])
  )
    return false;
  return (
    typeof value.slice === "string" &&
    SLICE.test(value.slice) &&
    typeof value.start === "string" &&
    DATE.test(value.start) &&
    typeof value.end === "string" &&
    DATE.test(value.end) &&
    value.start <= value.end &&
    ["day", "week", "month"].includes(String(value.granularity)) &&
    (value.level === null ||
      value.level === "campaign" ||
      value.level === "ad_set") &&
    (value.metric === null ||
      (typeof value.metric === "string" && KEY.test(value.metric))) &&
    (value.action === null ||
      (typeof value.action === "string" && KEY.test(value.action))) &&
    ["bucket", "entity", "metric"].includes(String(value.sort)) &&
    ["asc", "desc"].includes(String(value.direction))
  );
}
export function parseSavedScopeReportList(
  value: unknown,
): readonly SavedScopeReportRevision[] | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !("items" in value) ||
    !Array.isArray(value.items)
  )
    return null;
  const items = value.items as unknown[];
  if (
    items.length > 1000 ||
    !items.every(
      (item) =>
        exact(item, [
          "version",
          "workspaceId",
          "reportRef",
          "commandRef",
          "revisionNumber",
          "previousRevisionHash",
          "revisionHash",
          "state",
          "label",
          "query",
          "createdByActorId",
          "createdAt",
          "authority",
        ]) &&
        item.version === "saved-scope-report/1.0.0" &&
        REF.test(String(item.reportRef)) &&
        COMMAND.test(String(item.commandRef)) &&
        HASH.test(String(item.revisionHash)) &&
        Number.isSafeInteger(item.revisionNumber) &&
        (item.revisionNumber as number) >= 1 &&
        ["active", "archived"].includes(String(item.state)) &&
        typeof item.label === "string" &&
        item.label.length >= 1 &&
        item.label.length <= 160 &&
        query(item.query) &&
        exact(item.authority, ["canWriteMeta", "canApprove", "canExecute"]) &&
        item.authority.canWriteMeta === false &&
        item.authority.canApprove === false &&
        item.authority.canExecute === false,
    )
  )
    return null;
  return Object.freeze(items as SavedScopeReportRevision[]);
}
function commandRef() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `scope_report_save_${[...bytes].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function ScopeReportSavedControls(
  input: Readonly<{
    query: SavedScopeReportQuery;
    onLoad(query: SavedScopeReportQuery): void;
  }>,
) {
  const [label, setLabel] = useState("");
  const [items, setItems] = useState<readonly SavedScopeReportRevision[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const list = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/scope-report-saved", {
        credentials: "same-origin",
        headers: { "x-reklamzeka-intent": "scope-report-saved-list" },
      });
      const parsed =
        response.ok &&
        response.headers.get("content-type")?.includes("application/json")
          ? parseSavedScopeReportList(await response.json())
          : null;
      if (!parsed)
        setMessage(
          response.status === 401
            ? "Kayıtlı raporlar için yerel oturumu bağlayın."
            : "Kayıtlı raporlar kullanılamıyor.",
        );
      else setItems(parsed);
    } catch {
      setMessage("Kayıtlı raporlar kullanılamıyor.");
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    const clean = label.trim();
    if (!clean || clean.length > 160) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/scope-report-saved", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-reklamzeka-intent": "scope-report-saved-save",
        },
        body: JSON.stringify({
          commandRef: commandRef(),
          reportRef: null,
          expectedVersion: null,
          label: clean,
          query: input.query,
          state: "active",
        }),
      });
      if (!response.ok)
        setMessage(
          response.status === 401
            ? "Rapor kaydetmek için yerel oturumu bağlayın."
            : response.status === 409
              ? "Kayıt komutu çakıştı; yeniden deneyin."
              : "Rapor kaydedilemedi.",
        );
      else {
        setLabel("");
        setMessage("Rapor sorgusu kanonik revizyon olarak kaydedildi.");
        await list();
      }
    } catch {
      setMessage("Rapor kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className={styles.saved}
      aria-labelledby="scope-report-saved-title"
    >
      <h3 id="scope-report-saved-title">Kayıtlı rapor sorguları</h3>
      <div className={styles.savedActions}>
        <label>
          Rapor adı
          <input
            value={label}
            maxLength={160}
            disabled={busy}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={busy || !label.trim()}
          onClick={() => void save()}
        >
          Bu sorguyu kaydet
        </button>
        <button type="button" disabled={busy} onClick={() => void list()}>
          Kayıtlıları getir
        </button>
      </div>
      {message ? (
        <p role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item.reportRef}>
              <button
                type="button"
                disabled={busy || item.state !== "active"}
                onClick={() => input.onLoad(item.query)}
              >
                {item.label}
              </button>
              <span>
                r{item.revisionNumber} · {item.state}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
