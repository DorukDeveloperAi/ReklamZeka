"use client";

import { useState } from "react";
import styles from "./operating-dashboard.module.css";

export type LocalSessionConnectionResult =
  | Readonly<{ status: "connected" }>
  | Readonly<{ status: "invalid_input" | "rejected" | "proof_not_registered" | "not_configured" | "verification_failed" | "unavailable" }>;

type Requester = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Consumes a user-minted, one-time proof without returning, persisting or
 * logging it. The server remains the only authority that can mint the cookie.
 */
export async function connectLocalDashboardSession(input: Readonly<{
  capability: string;
  verify: () => Promise<boolean>;
  request?: Requester;
}>): Promise<LocalSessionConnectionResult> {
  const capability = input.capability.trim();
  if (!capability || capability.length > 4096) return Object.freeze({ status: "invalid_input" });
  const request = input.request ?? fetch;
  try {
    const response = await request("/api/local-session", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${capability}`,
        "X-ReklamZeka-Intent": "bootstrap-local-session",
      },
      credentials: "same-origin",
    });
    if (response.status === 503) return Object.freeze({ status: "not_configured" });
    if (response.status === 409) return Object.freeze({ status: "proof_not_registered" });
    if (!response.ok) return Object.freeze({ status: "rejected" });
    return Object.freeze({ status: await input.verify() ? "connected" : "verification_failed" });
  } catch {
    return Object.freeze({ status: "unavailable" });
  }
}

const ERROR_MESSAGES: Readonly<Record<Exclude<LocalSessionConnectionResult["status"], "connected">, string>> = {
  invalid_input: "Tek kullanımlık proof boş veya kabul edilen uzunlukta değil.",
  rejected: "Proof reddedildi, daha önce kullanıldı veya 90 saniyelik süresi doldu. Terminal çıktısındaki yalnız son capability satırını yapıştırın; yerel server yeni yapılandırmadan sonra açıldıysa önce yeniden başlatın.",
  proof_not_registered: "Bu proof bu yerel serverda bulunamadı. Dashboard’u yapılandırmanın uygulandığı aynı proje kökünden yeniden başlatın; ardından yeni proof üretip 90 saniye içinde yalnız bir kez yapıştırın.",
  not_configured: "Yerel oturum server tarafında yapılandırılmamış. Önce local workspace kurulumunu tamamlayın.",
  verification_failed: "Cookie üretildi ancak kanonik kaynak doğrulanamadı. Uygulamayı http://localhost origin'inde açtığınızdan emin olun.",
  unavailable: "Yerel oturum servisine ulaşılamadı. Uygulama ve bağlantı durumunu kontrol edin.",
};

export function LocalSessionConnector(props: Readonly<{
  onVerify: () => Promise<boolean>;
  title?: string;
  /** Multiple independent read panels may request a session on one screen. */
  idPrefix?: string;
}>) {
  const [capability, setCapability] = useState("");
  const [state, setState] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const inputId = `${props.idPrefix ?? "local-session"}-capability`;
  const safetyId = `${props.idPrefix ?? "local-session"}-safety`;
  return <form className={styles.localSessionConnector} onSubmit={async (event) => {
    event.preventDefault();
    const submitted = capability.trim();
    setCapability("");
    setMessage(null);
    setState("connecting");
    const result = await connectLocalDashboardSession({ capability: submitted, verify: props.onVerify });
    if (result.status === "connected") {
      setState("connected");
      setMessage("Yerel oturum doğrulandı; kanonik kaynaklar yenilendi.");
    } else {
      setState("error");
      setMessage(ERROR_MESSAGES[result.status]);
    }
  }}>
    <div className={styles.localSessionInstructions}>
      <span>YEREL OTURUM · TEK SEFERLİK BAĞLANTI</span>
      <strong>{props.title ?? "Gerçek çalışma alanını bağlayın"}</strong>
      <p>Terminalde aşağıdaki komutu çalıştırın; yalnız son capability satırını 90 saniye içinde buraya yapıştırın. Proof yalnız bu OS kullanıcısı ve localhost için geçerlidir.</p>
      <code>npm run local-session:mint</code>
    </div>
    <div className={styles.localSessionFields}>
      <label htmlFor={inputId}>Tek kullanımlık yerel oturum capability</label>
      <div><input id={inputId} type="password" autoComplete="off" spellCheck={false}
        maxLength={4096} value={capability} disabled={state === "connecting"}
        aria-describedby={safetyId}
        onChange={(event) => setCapability(event.target.value)} />
      <button type="submit" disabled={state === "connecting" || !capability.trim()}>{state === "connecting" ? "Doğrulanıyor…" : "Oturumu bağla"}</button></div>
      <small id={safetyId}>Proof ekranda geri gösterilmez, saklanmaz ve cookie değeri olarak yeniden kullanılmaz.</small>
      {message ? <p className={styles.localSessionFeedback} role={state === "error" ? "alert" : "status"} data-state={state}>{message}</p> : null}
    </div>
  </form>;
}
