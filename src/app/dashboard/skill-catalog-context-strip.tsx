"use client";

export type SkillCatalogContext = Readonly<{ profileLabel: string; skills: readonly Readonly<{ name: string; version: string; freshness?: "current" | "stale" | "unavailable" }>[]; legacy?: boolean }>;
/** Drawer-safe: intentionally contains no form, button, mutation callback, private IDs, hashes, or source body. */
export function SkillCatalogContextStrip({ context }: Readonly<{ context: SkillCatalogContext | null }>) {
  if (!context) return <p aria-live="polite">Skill snapshot not recorded.</p>;
  if (context.legacy) return <p aria-live="polite">Skill snapshot not recorded.</p>;
  return <section aria-label="Aktif skill bağlamı"><strong>{context.profileLabel}</strong><span> · {context.skills.length} skill</span>
    <ul>{context.skills.map((skill) => <li key={`${skill.name}:${skill.version}`}>{skill.name} · {skill.version}{skill.freshness ? ` · ${skill.freshness}` : ""}</li>)}</ul>
    <small>Kalıcılaştırma, policy, onay, yürütme ve Meta write kapalıdır.</small>
  </section>;
}
