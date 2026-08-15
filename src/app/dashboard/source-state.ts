import type { PublicSource } from "@/domain/source/public-source";

type SourceTone = "good" | "warning" | "neutral" | "danger";

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Read the API's existing provenance envelope; this module never defines a parallel payload contract. */
export function publicSourceFromPayload(payload: unknown): PublicSource | null {
  if (!record(payload) || !record(payload.source)) return null;
  const source = payload.source;
  if (source.contractVersion !== "public-source/1.0.0"
    || !["canonical_meta_mirror", "canonical_performance", "derived_trust", "graph_capability", "internal_ledger", "historical"].includes(String(source.kind))
    || !["ready", "partial", "stale", "empty", "unavailable", "demo"].includes(String(source.state))
    || !(source.observedAt === null || typeof source.observedAt === "string")
    || !(source.freshnessAt === null || typeof source.freshnessAt === "string")
    || !(source.freshnessThresholdMinutes === null || Number.isSafeInteger(source.freshnessThresholdMinutes))
    || !Array.isArray(source.reasonCodes) || source.reasonCodes.some((code) => typeof code !== "string")) return null;
  return source as unknown as PublicSource;
}

/** Presentation only: transport/session state and PublicSource remain distinct. */
export function sourceStatePresentation(source: PublicSource | null, sessionRequired = false): Readonly<{
  label: string;
  detail: string;
  tone: SourceTone;
  retryable: boolean;
}> {
  if (sessionRequired) return Object.freeze({
    label: "Yerel oturum gerekli",
    detail: "Bu çalışma alanında veri gösterilmez. Yerel oturum bağlandıktan sonra sayfayı yenileyin.",
    tone: "warning",
    retryable: false,
  });
  if (!source) return Object.freeze({
    label: "Kaynak doğrulanamadı",
    detail: "Kaynak doğrulanamadı; veri gösterilmiyor.",
    tone: "danger",
    retryable: true,
  });
  if (source.kind === "graph_capability" && source.state === "unavailable") return Object.freeze({
    label: "Canlı Graph envanteri kapalı",
    detail: "Canlı Graph envanteri bu sürümde kapalıdır. Kanonik DB aynası kullanılmaya devam eder.",
    tone: "neutral",
    retryable: false,
  });
  if (source.state === "ready") return Object.freeze({ label: "Kanonik kaynak güncel", detail: "Salt-okunur doğrulanmış kaynak.", tone: "good", retryable: true });
  if (source.state === "partial") return Object.freeze({ label: "Kanonik kaynak kısmi", detail: "Bazı kararlar için yeterli değil; eksik veri gösterilmez.", tone: "warning", retryable: true });
  if (source.state === "stale") return Object.freeze({ label: "Kanonik kaynak gecikmiş", detail: "Son doğrulama eskidi; karar üretimi kapalıdır.", tone: "warning", retryable: true });
  if (source.state === "empty") return Object.freeze({ label: "Gösterilebilir kayıt yok", detail: "Bağlı kaynakta gösterilebilir kayıt yok.", tone: "neutral", retryable: true });
  if (source.state === "demo") return Object.freeze({ label: "Tarihsel kanıt", detail: "Canlı karar için kullanılmaz.", tone: "warning", retryable: false });
  return Object.freeze({ label: "Kaynak doğrulanamadı", detail: "Kaynak doğrulanamadı; veri gösterilmiyor.", tone: "danger", retryable: true });
}

export const SOURCE_AUTHORITY_COPY = "Salt-okunur. Meta’da hiçbir değişiklik yapılamaz.";
