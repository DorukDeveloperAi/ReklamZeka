"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import styles from "./skill-catalog-panel.module.css";

type Authority = Readonly<{
  canSelectProfile: boolean;
  canCreatePlaybookRevision: boolean;
  canTombstonePlaybook: boolean;
}>;
type Skill = Readonly<{
  ref: string;
  name: string;
  version: string;
  lifecycle: "released";
  citationRequired: true;
  negativeCapabilities: readonly string[];
}>;
type Playbook = Readonly<{
  kind: "playbook";
  ref: string;
  revision: number;
  state: "active";
  title?: string;
  url?: string | null;
  freshness?: "current" | "stale" | "not_scheduled";
}>;
type Catalog = Readonly<{
  activeProfile: Readonly<{ kind: "profile"; revision: number; state: "active" }> | null;
  skills: readonly Skill[];
  playbooks: readonly Playbook[];
  authority: Authority;
}>;
type LoadState = "loading" | "ready" | "session_required" | "unavailable";
type Mutation = "profile" | "create" | "tombstone" | null;

const SOURCE_REF = /^source_[a-z0-9_.:-]+$/;
const CLOSED_AUTHORITY_FIELDS = ["canPersist", "canCreateRule", "canDraftPolicy", "canAlterScope", "canPublish", "canApprove", "canExecute", "canWriteMeta"] as const;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function catalogFromResponse(value: unknown): Catalog | null {
  if (!record(value) || value.contractVersion !== "skill-catalog-ui/1.0.0"
    || !Array.isArray(value.skills) || !Array.isArray(value.playbooks) || !record(value.authority)) return null;
  const authority = value.authority;
  if (!["canSelectProfile", "canCreatePlaybookRevision", "canTombstonePlaybook"].every((key) => typeof authority[key] === "boolean")
    || CLOSED_AUTHORITY_FIELDS.some((key) => authority[key] !== false)) return null;
  const activeProfile = value.activeProfile;
  if (activeProfile !== null && (!record(activeProfile) || activeProfile.kind !== "profile"
    || typeof activeProfile.revision !== "number" || !Number.isSafeInteger(activeProfile.revision)
    || activeProfile.revision < 1 || activeProfile.state !== "active")) return null;
  const skills = value.skills.map((item) => {
    if (!record(item) || typeof item.ref !== "string" || typeof item.name !== "string" || typeof item.version !== "string"
      || item.lifecycle !== "released" || item.citationRequired !== true || !Array.isArray(item.negativeCapabilities)
      || item.negativeCapabilities.some((capability) => typeof capability !== "string")) return null;
    return Object.freeze({ ref: item.ref, name: item.name, version: item.version, lifecycle: "released" as const,
      citationRequired: true as const, negativeCapabilities: Object.freeze([...item.negativeCapabilities] as string[]) });
  });
  const playbooks = value.playbooks.map((item) => {
    if (!record(item) || item.kind !== "playbook" || typeof item.ref !== "string" || typeof item.revision !== "number"
      || !Number.isSafeInteger(item.revision) || item.revision < 1 || item.state !== "active" || !(item.title === undefined || typeof item.title === "string")
      || !(item.url === undefined || item.url === null || typeof item.url === "string")
      || !(item.freshness === undefined || item.freshness === "current" || item.freshness === "stale" || item.freshness === "not_scheduled")) return null;
    return Object.freeze({ kind: "playbook" as const, ref: item.ref, revision: item.revision, state: "active" as const,
      title: item.title as string | undefined, url: item.url as string | null | undefined,
      freshness: item.freshness as Playbook["freshness"] });
  });
  if (skills.some((item) => item === null) || playbooks.some((item) => item === null)) return null;
  return Object.freeze({
    activeProfile: activeProfile === null ? null : Object.freeze({ kind: "profile", revision: activeProfile.revision as number, state: "active" }),
    skills: Object.freeze(skills as Skill[]),
    playbooks: Object.freeze(playbooks as Playbook[]),
    authority: Object.freeze({
      canSelectProfile: authority.canSelectProfile as boolean,
      canCreatePlaybookRevision: authority.canCreatePlaybookRevision as boolean,
      canTombstonePlaybook: authority.canTombstonePlaybook as boolean,
    }),
  });
}

function responseMessage(payload: unknown, fallback: string) {
  return record(payload) && record(payload.error) && typeof payload.error.message === "string" ? payload.error.message : fallback;
}

/** Rules-only authoring surface. The Agent receives only a separate GET-safe context strip. */
export function SkillCatalogPanel({ onSessionRequiredChange }: Readonly<{
  onSessionRequiredChange?(required: boolean): void;
}>) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [mutation, setMutation] = useState<Mutation>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sourceRef, setSourceRef] = useState("");
  const [pendingTombstone, setPendingTombstone] = useState<Playbook | null>(null);

  const reload = useCallback(async () => {
    setState("loading");
    setMessage(null);
    try {
      const response = await fetch("/api/skill-catalog", { cache: "no-store", credentials: "same-origin",
        headers: { "X-ReklamZeka-Intent": "skill-catalog-read" } });
      const payload: unknown = await response.json();
      if (response.status === 401 && record(payload) && record(payload.error) && payload.error.code === "local_session_required") {
        setCatalog(null);
        setState("session_required");
        onSessionRequiredChange?.(true);
        return false;
      }
      const next = response.ok ? catalogFromResponse(payload) : null;
      if (!next) {
        setCatalog(null);
        setState("unavailable");
        setMessage(responseMessage(payload, "Skill kataloğu güvenli biçimde okunamadı."));
        return false;
      }
      setCatalog(next);
      setState("ready");
      onSessionRequiredChange?.(false);
      return true;
    } catch {
      setCatalog(null);
      setState("unavailable");
      setMessage("Skill kataloğu şu anda kullanılamıyor.");
      return false;
    }
  }, [onSessionRequiredChange]);

  useEffect(() => { void reload(); }, [reload]);

  const corePack = useMemo(() => catalog?.skills.map(({ ref, version }) => ({ ref, version })) ?? [], [catalog]);

  const mutate = useCallback(async (intent: "skill-profile-select" | "skill-playbook-create" | "skill-playbook-tombstone", payload: Record<string, unknown>, kind: Exclude<Mutation, null>) => {
    setMutation(kind);
    setMessage(null);
    try {
      const response = await fetch("/api/skill-catalog", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": intent }, body: JSON.stringify(payload) });
      const result: unknown = await response.json();
      if (!response.ok) throw new Error(responseMessage(result, "İşlem tamamlanamadı."));
      const refreshed = await reload();
      if (!refreshed) throw new Error("İşlem kaydedildi ancak katalog yeniden doğrulanamadı.");
      setMessage(kind === "profile" ? "Temel skill profili seçildi." : kind === "create" ? "Playbook kaydedildi." : "Playbook kaldırıldı.");
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "İşlem tamamlanamadı.");
      return false;
    } finally {
      setMutation(null);
    }
  }, [reload]);

  async function selectProfile() {
    if (!catalog?.authority.canSelectProfile || catalog.activeProfile || corePack.length !== 9) return;
    await mutate("skill-profile-select", { corePack }, "profile");
  }

  async function createPlaybook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!catalog?.authority.canCreatePlaybookRevision || !title.trim() || !body.trim() || !SOURCE_REF.test(sourceRef.trim())) return;
    const saved = await mutate("skill-playbook-create", { title: title.trim(), body: body.trim(), sourceRef: sourceRef.trim() }, "create");
    if (saved) {
      setTitle("");
      setBody("");
      setSourceRef("");
    }
  }

  async function tombstonePlaybook() {
    if (!pendingTombstone || !catalog?.authority.canTombstonePlaybook) return;
    const saved = await mutate("skill-playbook-tombstone", { playbookRef: pendingTombstone.ref }, "tombstone");
    if (saved) setPendingTombstone(null);
  }

  if (state === "loading" && !catalog) return <section className={styles.panel} aria-busy="true"><h2>Skill profili ve playbooklar</h2><p>Yayınlanmış kaynaklar doğrulanıyor…</p></section>;
  if (state === "session_required") return null;
  if (state === "unavailable" || !catalog) return <section className={styles.panel} role="alert"><h2>Skill profili ve playbooklar kullanılamıyor</h2><p>{message ?? "Katalog kaynağı doğrulanamadı."}</p><button type="button" onClick={() => void reload()}>Tekrar dene</button></section>;

  const canCreate = catalog.authority.canCreatePlaybookRevision && mutation === null;
  return <section className={styles.panel} aria-labelledby="skill-catalog-title">
    <header className={styles.header}><div><span>YÖNETİM · KURALLAR</span><h2 id="skill-catalog-title">Skill profili ve playbooklar</h2><p>Profil ve playbook kayıtları yalnız siz açıkça seçtiğinizde veya kaydettiğinizde değişir.</p></div><button type="button" onClick={() => void reload()} disabled={mutation !== null}>Yenile</button></header>

    <section className={styles.profile} aria-label="Skill profili">
      <div><strong>{catalog.activeProfile ? `Etkin profil · revizyon ${catalog.activeProfile.revision}` : "Profil seçilmedi"}</strong><small>Temel profil dokuz yayınlanmış skill içerir; kaynak, kanıt ve sınırlamalar görünür kalır.</small></div>
      <button type="button" disabled={!catalog.authority.canSelectProfile || Boolean(catalog.activeProfile) || mutation !== null || corePack.length !== 9} onClick={() => void selectProfile()}>{catalog.activeProfile ? "Etkin" : mutation === "profile" ? "Kaydediliyor…" : "Temel profili seç"}</button>
    </section>

    <section className={styles.skills} aria-label="Temel skilller"><h3>Temel skilller</h3><ul>{catalog.skills.map((skill) => <li key={skill.ref}><strong>{skill.name}</strong><span>sürüm {skill.version}</span><small>Yalnız okuma ve açıklama</small></li>)}</ul></section>

    <form className={styles.form} onSubmit={(event) => void createPlaybook(event)}>
      <h3>Playbook ekle</h3><p>Metni siz yazarsınız. Yayınlanmış kaynak referansı sunucuda doğrulanmadan kayıt oluşturulmaz.</p>
      <label><span>Başlık</span><input value={title} maxLength={240} disabled={!canCreate} onChange={(event) => setTitle(event.target.value)} /></label>
      <label><span>Playbook metni</span><textarea value={body} maxLength={16_000} disabled={!canCreate} onChange={(event) => setBody(event.target.value)} /></label>
      <label><span>Yayınlanmış kaynak referansı</span><input value={sourceRef} placeholder="source_…" pattern="source_[a-z0-9_.:-]+" aria-describedby="skill-catalog-source-note" disabled={!canCreate} onChange={(event) => setSourceRef(event.target.value)} /></label>
      <small id="skill-catalog-source-note">Yalnız mevcut GuidanceSource referansı kabul edilir; seçenek listesi oluşturulmaz.</small>
      <button type="submit" disabled={!canCreate || !title.trim() || !body.trim() || !SOURCE_REF.test(sourceRef.trim())}>{mutation === "create" ? "Kaydediliyor…" : "Playbook’u kaydet"}</button>
      {!catalog.authority.canCreatePlaybookRevision ? <p className={styles.permission}>Bu rol playbook kaydı oluşturamaz.</p> : null}
    </form>

    <section className={styles.playbooks} aria-label="Etkin playbooklar"><h3>Etkin playbooklar</h3>{catalog.playbooks.length ? <ul>{catalog.playbooks.map((playbook) => <li key={playbook.ref}><div><strong>{playbook.title ?? "Başlıksız playbook"}</strong><small>revizyon {playbook.revision}{playbook.freshness ? ` · ${playbook.freshness}` : ""}</small>{playbook.url ? <a href={playbook.url} target="_blank" rel="noreferrer">Kaynağı aç</a> : null}</div><button type="button" disabled={!catalog.authority.canTombstonePlaybook || mutation !== null} onClick={() => setPendingTombstone(playbook)}>Kaldır</button></li>)}</ul> : <p>Etkin playbook yok.</p>}</section>

    {pendingTombstone ? <section className={styles.confirmation} role="alertdialog" aria-labelledby="skill-catalog-confirm-title" aria-describedby="skill-catalog-confirm-copy"><h3 id="skill-catalog-confirm-title">Playbook’u kaldır?</h3><p id="skill-catalog-confirm-copy">{pendingTombstone.title ?? "Bu playbook"} artık etkin listede görünmez. Bu işlem açık kullanıcı onayı gerektirir.</p><div><button type="button" onClick={() => setPendingTombstone(null)} disabled={mutation === "tombstone"}>Vazgeç</button><button type="button" onClick={() => void tombstonePlaybook()} disabled={mutation === "tombstone"}>{mutation === "tombstone" ? "Kaldırılıyor…" : "Kaldırmayı onayla"}</button></div></section> : null}
    {message ? <p className={styles.feedback} role="status">{message}</p> : null}
  </section>;
}
