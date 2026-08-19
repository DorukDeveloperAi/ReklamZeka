"use client";

export type SkillCatalogContext = Readonly<{ profileLabel: string; skills: readonly Readonly<{ name: string; version: string; freshness?: "current" | "stale" | "unavailable" }>[]; playbooks: readonly Readonly<{ title: string; revision: number; freshness: "current" | "stale" | "not_scheduled"; url: string | null }>[]; legacy?: boolean }>;
/** Drawer-safe: intentionally contains no form, mutation callback, private IDs, hashes, or source body. */
const freshnessLabel = (freshness: "current" | "stale" | "not_scheduled") => freshness === "current" ? "güncel" : freshness === "stale" ? "eski" : "güncellik planlanmadı";

export function SkillCatalogContextStrip({ context, onOpenSetup, setupClassName }: Readonly<{
  context: SkillCatalogContext | null;
  /** Navigation only: profile selection stays an explicit action in the Rules workspace. */
  onOpenSetup?: () => void;
  setupClassName?: string;
}>) {
  if (!context || context.legacy) return <section className={setupClassName} aria-live="polite"><p>Henüz çalışma alanına ait bir skill profili seçilmedi. Yönet → Kurallar alanından kullanıcı çalışma dilini ve kaynaklarını hazırlayın; Agent kural veya policy üretmez.</p>{onOpenSetup ? <button type="button" onClick={onOpenSetup}>Skill çalışma dilini aç</button> : null}</section>;
  return <section aria-label="Aktif Agent bağlamı"><strong>{context.profileLabel}</strong><span> · {context.skills.length} beceri · {context.playbooks.length} kullanıcı playbook’u</span>
    <details><summary>Bu turda kullanılabilecek çalışma bağlamı</summary>
      <div><strong>Yayınlanmış beceriler</strong><ul>{context.skills.map((skill) => <li key={`${skill.name}:${skill.version}`}>{skill.name} · {skill.version}{skill.freshness ? ` · ${skill.freshness}` : ""}</li>)}</ul></div>
      <div><strong>Kullanıcı yazarlı playbooklar</strong>{context.playbooks.length ? <ul>{context.playbooks.map((playbook) => <li key={`${playbook.title}:${playbook.revision}`}>{playbook.title} · revizyon {playbook.revision} · {freshnessLabel(playbook.freshness)}{playbook.url ? <> · <a href={playbook.url} target="_blank" rel="noreferrer">resmî kaynak</a></> : null}</li>)}</ul> : <small>Bu çalışma alanında etkin kullanıcı playbook’u yok.</small>}</div>
      <small>Seçili beceriler ile kullanıcı soru setleri, her Agent yanıtının “Kanıt makbuzu” bölümünde turn’a sabitlenmiş hâlde gösterilir.</small>
    </details>
    <small>Kalıcılaştırma, policy, onay, yürütme ve Meta write kapalıdır.</small>
  </section>;
}
