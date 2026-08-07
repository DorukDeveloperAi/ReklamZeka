"use client";

import { useState } from "react";

type CreatedShare = Readonly<{
  token: string;
  shareId: string;
  reportUrl: string;
  csvUrl: string;
  expiresAt: string;
  access: "read_only";
}>;

export function DemoShareControls() {
  const [share, setShare] = useState<CreatedShare | null>(null);
  const [status, setStatus] = useState<"idle" | "creating" | "ready" | "revoking" | "revoked" | "error">("idle");
  const [message, setMessage] = useState("");

  async function createShare() {
    setStatus("creating");
    setMessage("");
    try {
      const response = await fetch("/api/reports/demo-share", { method: "POST" });
      const body = await response.json() as CreatedShare | { message?: string };
      if (!response.ok) throw new Error("message" in body ? body.message : "Rapor bağlantısı oluşturulamadı.");
      setShare(body as CreatedShare);
      setStatus("ready");
      setMessage("İmzalı rapor bağlantısı oluşturuldu.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Rapor bağlantısı oluşturulamadı.");
    }
  }

  async function revokeShare() {
    if (!share) return;
    setStatus("revoking");
    setMessage("");
    try {
      const response = await fetch("/api/reports/demo-share", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: share.token }),
      });
      if (!response.ok) throw new Error("Rapor bağlantısı iptal edilemedi.");
      setStatus("revoked");
      setMessage("Rapor bağlantısı iptal edildi; yeniden erişim reddedilecek.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Rapor bağlantısı iptal edilemedi.");
    }
  }

  return <section className="share-controls" aria-labelledby="share-controls-title">
    <h2 id="share-controls-title">İmzalı demo paylaşım kontrolü</h2>
    <p>Sunucu, ortam anahtarıyla 24 saatlik HMAC imzalı URL üretir. Token istemci depolamasına yazılmaz.</p>
    {status === "idle" || status === "error" || status === "revoked" ? <button type="button" onClick={createShare}>24 saatlik bağlantı oluştur</button> : null}
    {status === "creating" ? <button type="button" disabled>Bağlantı oluşturuluyor…</button> : null}
    {share && (status === "ready" || status === "revoking") ? <div className="share-result">
      <span>{share.access} · {new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(new Date(share.expiresAt))} son kullanım</span>
      <nav aria-label="Oluşturulan rapor işlemleri"><a href={share.reportUrl}>İmzalı raporu aç</a><a href={share.csvUrl}>CSV indir</a><button type="button" className="danger-button" onClick={revokeShare} disabled={status === "revoking"}>{status === "revoking" ? "İptal ediliyor…" : "Bağlantıyı iptal et"}</button></nav>
    </div> : null}
    {message ? <p className="share-message" role={status === "error" ? "alert" : "status"}>{message}</p> : null}
  </section>;
}
