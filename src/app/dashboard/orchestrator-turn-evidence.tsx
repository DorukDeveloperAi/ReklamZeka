"use client";

export type OrchestratorReadOnlyEvidenceSummary = Readonly<{
  state: "bound" | "legacy_not_recorded" | "unavailable_not_bound" | "missing_or_invalid";
  performance: Readonly<{ state: "ready" | "partial" | "unavailable"; accountCount: number; campaignCount: number }> | null;
  timeline: Readonly<{ state: "ready" | "unavailable"; eventCount: number; latestOccurredAt: string | null }> | null;
}>;

export type OrchestratorSkillRunSummary = Readonly<{
  state: "bound" | "legacy_not_recorded" | "unavailable_not_bound" | "missing_or_invalid";
  receipt: Readonly<{
    receiptRef: string;
    receiptHash: string;
    intent: "read" | "explain" | "compare" | "question";
    selectedSkills: ReadonlyArray<Readonly<{ name: string; version: string; outputContract: string }>>;
    evidenceAvailability: "available" | "partial" | "unavailable";
    outputContract: "evidence-integrity-facts/1.0.0";
    authority: Readonly<{ canPersist: false; canCreateRule: false; canDraftPolicy: false; canAlterScope: false;
      canPublish: false; canApprove: false; canExecute: false; canWriteMeta: false }>;
  }> | null;
}>;

export type OrchestratorInterviewKitSummary = Readonly<{
  state: "bound" | "legacy_not_recorded" | "unavailable_not_bound" | "missing_or_invalid";
  kits: ReadonlyArray<Readonly<{
    name: string;
    revision: number;
    source: Readonly<{ title: string; url: string; version: number; reviewBy: string }>;
  }>>;
}>;

/** Small, identifier-free turn evidence surface. The parent Agent drawer owns placement and styling. */
export function OrchestratorTurnReadOnlyEvidence({ evidence }: Readonly<{ evidence: OrchestratorReadOnlyEvidenceSummary }>) {
  if (evidence.state === "legacy_not_recorded") return <p>Bu eski turn için operasyon kanıt özeti kaydedilmemiş.</p>;
  if (evidence.state === "unavailable_not_bound") return <p>Bu turn sırasında operasyon kanıt özeti kullanılamıyordu.</p>;
  if (evidence.state !== "bound" || !evidence.performance || !evidence.timeline) return <p>Turn kanıt özeti güvenle okunamadı.</p>;
  return <dl aria-label="Dondurulmuş salt-okur operasyon kanıtı">
    <div><dt>Performans kapsamı</dt><dd>{evidence.performance.state} · {evidence.performance.accountCount} hesap · {evidence.performance.campaignCount} kampanya</dd></div>
    <div><dt>Operasyon izi</dt><dd>{evidence.timeline.state} · {evidence.timeline.eventCount} olay{evidence.timeline.latestOccurredAt ? ` · son kayıt ${new Date(evidence.timeline.latestOccurredAt).toLocaleString("tr-TR")}` : ""}</dd></div>
  </dl>;
}

/** Turn-bound skill receipt: only selected released skills, never the whole catalog. */
export function OrchestratorTurnSkillRunEvidence({ evidence }: Readonly<{ evidence: OrchestratorSkillRunSummary }>) {
  if (evidence.state === "legacy_not_recorded") return <p>Bu eski turn için kullanılan skill makbuzu kaydedilmemiş.</p>;
  if (evidence.state === "unavailable_not_bound") return <p>Bu turn sırasında SkillRun makbuzu bağlanamadı.</p>;
  if (evidence.state !== "bound" || !evidence.receipt) return <p>SkillRun makbuzu güvenle okunamadı.</p>;
  return <dl aria-label="Seçili beceri makbuzu">
    <div><dt>Seçili beceriler</dt><dd>{evidence.receipt.selectedSkills.map((skill) => `${skill.name} · ${skill.version}`).join("; ")}</dd></div>
    <div><dt>İnceleme kapsamı</dt><dd>{evidence.receipt.intent} · kanıt {evidence.receipt.evidenceAvailability}</dd></div>
    <div><dt>Çıktı sınırı</dt><dd>{evidence.receipt.outputContract}</dd></div>
    <div><dt>Yetki</dt><dd>Salt-okunur · kayıt, policy, onay, uygulama ve Meta yazma kapalı</dd></div>
  </dl>;
}

/** User-authored interview kits are distinct from the model's transient questions. */
export function OrchestratorTurnInterviewKitEvidence({ evidence }: Readonly<{ evidence: OrchestratorInterviewKitSummary }>) {
  if (evidence.state === "legacy_not_recorded") return <p>Bu eski turn için kullanıcı soru seti snapshot’ı kaydedilmemiş.</p>;
  if (evidence.state === "unavailable_not_bound") return <p>Bu turn sırasında kullanıcı soru seti bağlanamadı.</p>;
  if (evidence.state !== "bound") return <p>Kullanıcı soru seti kanıtı güvenle okunamadı.</p>;
  if (!evidence.kits.length) return <p>Bu turn için sayfa/niyetle eşleşen kullanıcı soru seti yoktu.</p>;
  return <dl aria-label="Bu turn için kullanılan kullanıcı soru setleri">
    {evidence.kits.map((kit) => <div key={`${kit.name}-${kit.revision}`}><dt>{kit.name} · revizyon {kit.revision}</dt><dd><a href={kit.source.url} target="_blank" rel="noreferrer">{kit.source.title}</a> · kaynak revizyonu {kit.source.version} · gözden geçirme tarihi {new Date(kit.source.reviewBy).toLocaleDateString("tr-TR")}</dd></div>)}
  </dl>;
}
