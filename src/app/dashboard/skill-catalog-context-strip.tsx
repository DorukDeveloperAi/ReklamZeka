"use client";

export type SkillCatalogContext = Readonly<{ profileLabel: string; skills: readonly Readonly<{ name: string; version: string; freshness?: "current" | "stale" | "unavailable" }>[]; legacy?: boolean }>;
/** Drawer-safe: intentionally contains no form, button, mutation callback, private IDs, hashes, or source body. */
export function SkillCatalogContextStrip({ context, onOpenSetup, setupClassName }: Readonly<{
  context: SkillCatalogContext | null;
  /** Navigation only: profile selection stays an explicit action in the Rules workspace. */
  onOpenSetup?: () => void;
  setupClassName?: string;
}>) {
  if (!context || context.legacy) return <section className={setupClassName} aria-live="polite"><p>Henüz çalışma alanına ait bir skill profili seçilmedi. Yönet → Kurallar alanından kullanıcı çalışma dilini ve kaynaklarını hazırlayın; Agent kural veya policy üretmez.</p>{onOpenSetup ? <button type="button" onClick={onOpenSetup}>Skill çalışma dilini aç</button> : null}</section>;
  return <section aria-label="Aktif skill bağlamı"><strong>{context.profileLabel}</strong><span> · {context.skills.length} skill</span>
    <ul>{context.skills.map((skill) => <li key={`${skill.name}:${skill.version}`}>{skill.name} · {skill.version}{skill.freshness ? ` · ${skill.freshness}` : ""}</li>)}</ul>
    <small>Kalıcılaştırma, policy, onay, yürütme ve Meta write kapalıdır.</small>
  </section>;
}
