"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import styles from "./skill-catalog-panel.module.css";
import { InterviewKitPanel } from "./interview-kit-panel";

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
type Source = Readonly<{ optionId: string; title: string; url: string; freshness: "fresh" }>;
type Playbook = Readonly<{
  kind: "playbook";
  ref: string;
  revision: number;
  state: "active";
  title: string;
  body: string;
  sourceOptionId: string;
  url?: string | null;
  freshness?: "current" | "stale" | "not_scheduled";
}>;
type Catalog = Readonly<{
  activeProfile: Readonly<{ kind: "profile"; revision: number; state: "active" }> | null;
  skills: readonly Skill[];
  playbooks: readonly Playbook[];
  sources: readonly Source[];
  authority: Authority;
}>;
type LoadState = "loading" | "ready" | "session_required" | "unavailable";
type Mutation = "profile" | "create" | "revise" | "tombstone" | null;

const SOURCE_OPTION = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLOSED_AUTHORITY_FIELDS = ["canPersist", "canCreateRule", "canDraftPolicy", "canAlterScope", "canPublish", "canApprove", "canExecute", "canWriteMeta"] as const;
const PRIVATE_IDENTIFIER = /\b(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-f0-9]{64})\b/i;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function publicPlaybookText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= maximum && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
    && !PRIVATE_IDENTIFIER.test(value);
}

function catalogFromResponse(value: unknown): Catalog | null {
  if (!record(value) || value.contractVersion !== "skill-catalog-ui/1.0.0"
    || !Array.isArray(value.skills) || !Array.isArray(value.playbooks) || !Array.isArray(value.sources) || !record(value.authority)) return null;
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
    if (!record(item) || item.kind !== "playbook" || typeof item.ref !== "string" || !/^playbook_[a-z0-9][a-z0-9_-]{0,86}$/.test(item.ref) || typeof item.revision !== "number"
      || !Number.isSafeInteger(item.revision) || item.revision < 1 || item.state !== "active" || !publicPlaybookText(item.title, 240)
      || !publicPlaybookText(item.body, 16_000) || !SOURCE_OPTION.test(item.sourceOptionId as string)
      || !(item.url === undefined || item.url === null || typeof item.url === "string")
      || !(item.freshness === undefined || item.freshness === "current" || item.freshness === "stale" || item.freshness === "not_scheduled")) return null;
    return Object.freeze({ kind: "playbook" as const, ref: item.ref, revision: item.revision, state: "active" as const,
      title: item.title as string, body: item.body as string, sourceOptionId: item.sourceOptionId as string, url: item.url as string | null | undefined,
      freshness: item.freshness as Playbook["freshness"] });
  });
  const sources = value.sources.map((item) => {
    if (!record(item) || !SOURCE_OPTION.test(item.optionId as string) || !publicPlaybookText(item.title, 300)
      || !publicPlaybookText(item.url, 2_000) || item.freshness !== "fresh") return null;
    try { if (new URL(item.url as string).protocol !== "https:") return null; } catch { return null; }
    return Object.freeze({ optionId: item.optionId as string, title: item.title as string, url: item.url as string, freshness: "fresh" as const });
  });
  if (skills.some((item) => item === null) || playbooks.some((item) => item === null) || sources.some((item) => item === null)) return null;
  return Object.freeze({
    activeProfile: activeProfile === null ? null : Object.freeze({ kind: "profile", revision: activeProfile.revision as number, state: "active" }),
    skills: Object.freeze(skills as Skill[]),
    playbooks: Object.freeze(playbooks as Playbook[]),
    sources: Object.freeze(sources as Source[]),
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
  const [sourceOptionId, setSourceOptionId] = useState("");
  const [pendingTombstone, setPendingTombstone] = useState<Playbook | null>(null);
  const [editingPlaybook, setEditingPlaybook] = useState<Playbook | null>(null);
  const [revisionTitle, setRevisionTitle] = useState("");
  const [revisionBody, setRevisionBody] = useState("");
  const [pendingRevision, setPendingRevision] = useState<Readonly<{ playbookRef: string; expectedRevision: number; title: string; body: string; sourceOptionId: string }> | null>(null);

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
      setSourceOptionId((current) => next.sources.some((source) => source.optionId === current) ? current : next.sources[0]?.optionId ?? "");
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

  const mutate = useCallback(async (intent: "skill-profile-select" | "skill-playbook-create" | "skill-playbook-revise" | "skill-playbook-tombstone", payload: Record<string, unknown>, kind: Exclude<Mutation, null>) => {
    setMutation(kind);
    setMessage(null);
    try {
      const response = await fetch("/api/skill-catalog", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-ReklamZeka-Intent": intent }, body: JSON.stringify(payload) });
      const result: unknown = await response.json();
      if (!response.ok) throw new Error(responseMessage(result, "İşlem tamamlanamadı."));
      const refreshed = await reload();
      if (!refreshed) throw new Error("İşlem kaydedildi ancak katalog yeniden doğrulanamadı.");
      setMessage(kind === "profile" ? "Temel skill profili seçildi." : kind === "create" ? "Playbook kaydedildi." : kind === "revise" ? "Yeni playbook revizyonu kaydedildi." : "Playbook kaldırıldı.");
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
    if (!catalog?.authority.canCreatePlaybookRevision || !title.trim() || !body.trim() || !SOURCE_OPTION.test(sourceOptionId)) return;
    const saved = await mutate("skill-playbook-create", { title: title.trim(), body: body.trim(), sourceOptionId }, "create");
    if (saved) {
      setTitle("");
      setBody("");
      setSourceOptionId(catalog.sources[0]?.optionId ?? "");
    }
  }

  async function tombstonePlaybook() {
    if (!pendingTombstone || !catalog?.authority.canTombstonePlaybook) return;
    const saved = await mutate("skill-playbook-tombstone", { playbookRef: pendingTombstone.ref }, "tombstone");
    if (saved) setPendingTombstone(null);
  }

  function startRevision(playbook: Playbook) {
    setEditingPlaybook(playbook);
    setRevisionTitle(playbook.title);
    setRevisionBody(playbook.body);
    setSourceOptionId(playbook.sourceOptionId);
    setPendingRevision(null);
  }

  function prepareRevision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingPlaybook || !catalog?.authority.canCreatePlaybookRevision || !revisionTitle.trim() || !revisionBody.trim()) return;
    setPendingRevision({ playbookRef: editingPlaybook.ref, expectedRevision: editingPlaybook.revision,
      title: revisionTitle.trim(), body: revisionBody.trim(), sourceOptionId });
  }

  async function saveRevision() {
    if (!pendingRevision || !catalog?.authority.canCreatePlaybookRevision) return;
    const saved = await mutate("skill-playbook-revise", { ...pendingRevision, confirmed: true }, "revise");
    if (saved) { setPendingRevision(null); setEditingPlaybook(null); setRevisionTitle(""); setRevisionBody(""); }
  }

  if (state === "loading" && !catalog) return <section className={styles.panel} aria-busy="true"><h2>Agent çalışma dili</h2><p>Yayınlanmış skill ve kaynaklar doğrulanıyor…</p></section>;
  if (state === "session_required") return null;
  if (state === "unavailable" || !catalog) return <section className={styles.panel} role="alert"><h2>Agent çalışma dili kullanılamıyor</h2><p>{message ?? "Katalog kaynağı doğrulanamadı."}</p><button type="button" onClick={() => void reload()}>Tekrar dene</button></section>;

  const canCreate = catalog.authority.canCreatePlaybookRevision && mutation === null;
  return <><section className={styles.panel} aria-labelledby="skill-catalog-title">
    <header className={styles.header}><div><span>YÖNETİM · AGENT ÇALIŞMA DİLİ</span><h2 id="skill-catalog-title">Agent çalışma dili</h2><p>Skill seçimi yayınlanmış ve salt-okurdur. Playbook ile soru seti metnini yalnız siz açıkça yazıp kaydedersiniz.</p></div><button type="button" onClick={() => void reload()} disabled={mutation !== null}>Yenile</button></header>

    <section className={styles.usage} aria-label="Çalışma dili kullanım özeti"><div><strong>Skill’ler</strong><small>Her turn’de sunucu seçer; sürüm, test ve yetki sınırı sabittir.</small></div><div><strong>Playbook’lar</strong><small>Yalnız bağlı resmî kaynakla Agent bağlamına girer; makbuzda kaynak tazeliği görünür.</small></div><div><strong>Soru setleri</strong><small>Agent’ın soracağı denetim sorularıdır; kural veya policy metni değildir.</small></div></section>

    <section className={styles.profile} aria-label="Skill profili">
      <div><strong>{catalog.activeProfile ? `Etkin profil · revizyon ${catalog.activeProfile.revision}` : "Profil seçilmedi"}</strong><small>Temel profil dokuz yayınlanmış skill içerir; kaynak, kanıt ve sınırlamalar görünür kalır.</small></div>
      <button type="button" disabled={!catalog.authority.canSelectProfile || Boolean(catalog.activeProfile) || mutation !== null || corePack.length !== 9} onClick={() => void selectProfile()}>{catalog.activeProfile ? "Etkin" : mutation === "profile" ? "Kaydediliyor…" : "Temel profili seç"}</button>
    </section>

    <section className={styles.skills} aria-label="Temel skilller"><h3>Temel skilller</h3><ul>{catalog.skills.map((skill) => <li key={skill.ref}><strong>{skill.name}</strong><span>sürüm {skill.version}</span><small>Yalnız okuma ve açıklama</small></li>)}</ul></section>

    <form className={styles.form} onSubmit={(event) => void createPlaybook(event)}>
      <h3>Playbook ekle</h3><p>Metni siz yazarsınız. Resmî kaynak, Agent bağlamında hangi playbook’un kullanılacağını ve tazeliğini açıklar; sunucu doğrulamadan kayıt oluşturulmaz.</p>
      <label><span>Başlık</span><input value={title} maxLength={240} disabled={!canCreate} onChange={(event) => setTitle(event.target.value)} /></label>
      <label><span>Playbook metni</span><textarea value={body} maxLength={16_000} disabled={!canCreate} onChange={(event) => setBody(event.target.value)} /></label>
      <label><span>Resmî kaynak</span><select value={sourceOptionId} disabled={!canCreate || !catalog.sources.length} onChange={(event) => setSourceOptionId(event.target.value)}><option value="">Kaynak seçin</option>{catalog.sources.map((source) => <option key={source.optionId} value={source.optionId}>{source.title} · güncel</option>)}</select></label>
      {catalog.sources.length ? <small id="skill-catalog-source-note">Seçili resmî kaynak yalnız bu playbook’un Agent bağlamını ve turn makbuzundaki tazeliği belirler.</small> : <p id="skill-catalog-source-note" className={styles.permission}>Playbook kaydetmek için önce <a href="?view=manage&amp;manageArea=rules&amp;rulesArea=guidance">Yönet → Rehberler</a> alanında güncel resmî kaynak hazırlayın.</p>}
      <button type="submit" disabled={!canCreate || !title.trim() || !body.trim() || !SOURCE_OPTION.test(sourceOptionId)}>{mutation === "create" ? "Kaydediliyor…" : "Playbook’u kaydet"}</button>
      {!catalog.authority.canCreatePlaybookRevision ? <p className={styles.permission}>Bu rol playbook kaydı oluşturamaz.</p> : null}
    </form>

    <section className={styles.playbooks} aria-label="Etkin playbooklar"><h3>Etkin playbooklar</h3>{catalog.playbooks.length ? <ul>{catalog.playbooks.map((playbook) => <li key={playbook.ref}><div><strong>{playbook.title}</strong><small>revizyon {playbook.revision}{playbook.freshness ? ` · ${playbook.freshness}` : ""}</small>{playbook.url ? <a href={playbook.url} target="_blank" rel="noreferrer">Kaynağı aç</a> : null}</div><div className={styles.playbookActions}><button type="button" disabled={!catalog.authority.canCreatePlaybookRevision || mutation !== null} onClick={() => startRevision(playbook)}>Revizyon oluştur</button><button type="button" disabled={!catalog.authority.canTombstonePlaybook || mutation !== null} onClick={() => setPendingTombstone(playbook)}>Kaldır</button></div></li>)}</ul> : <p>Etkin playbook yok.</p>}</section>

    {editingPlaybook ? <form className={styles.form} onSubmit={prepareRevision} aria-label="Playbook revizyonu">
      <h3>Playbook revizyonu</h3><p>Mevcut metni siz düzenlersiniz. Yeni kayıt aynı playbook zincirine append-only olarak eklenir.</p>
      <label><span>Başlık</span><input value={revisionTitle} maxLength={240} disabled={!canCreate} onChange={(event) => setRevisionTitle(event.target.value)} /></label>
      <label><span>Playbook metni</span><textarea value={revisionBody} maxLength={16_000} disabled={!canCreate} onChange={(event) => setRevisionBody(event.target.value)} /></label>
      <label><span>Resmî kaynak</span><select value={sourceOptionId} disabled={!canCreate || !catalog.sources.length} onChange={(event) => setSourceOptionId(event.target.value)}>{catalog.sources.map((source) => <option key={source.optionId} value={source.optionId}>{source.title} · güncel</option>)}</select></label>
      <small>Kaynak, güncel playbook ile aynı kalmalıdır; sunucu revision head ve güvenli kaynak eşleşmesini yeniden doğrular.</small>
      <div className={styles.playbookActions}><button type="button" disabled={mutation !== null} onClick={() => { setEditingPlaybook(null); setPendingRevision(null); }}>Vazgeç</button><button type="submit" disabled={!canCreate || !revisionTitle.trim() || !revisionBody.trim()}>Yeni revizyonu kaydet</button></div>
    </form> : null}

    {pendingTombstone ? <section className={styles.confirmation} role="alertdialog" aria-labelledby="skill-catalog-confirm-title" aria-describedby="skill-catalog-confirm-copy"><h3 id="skill-catalog-confirm-title">Playbook’u kaldır?</h3><p id="skill-catalog-confirm-copy">{pendingTombstone.title ?? "Bu playbook"} artık etkin listede görünmez. Bu işlem açık kullanıcı onayı gerektirir.</p><div><button type="button" onClick={() => setPendingTombstone(null)} disabled={mutation === "tombstone"}>Vazgeç</button><button type="button" onClick={() => void tombstonePlaybook()} disabled={mutation === "tombstone"}>{mutation === "tombstone" ? "Kaldırılıyor…" : "Kaldırmayı onayla"}</button></div></section> : null}
    {pendingRevision ? <section className={styles.confirmation} role="alertdialog" aria-labelledby="skill-catalog-revision-confirm-title" aria-describedby="skill-catalog-revision-confirm-copy"><h3 id="skill-catalog-revision-confirm-title">Yeni revizyonu kaydet?</h3><p id="skill-catalog-revision-confirm-copy">Mevcut kayıt değişmez; düzenlediğiniz metin yeni, immutable bir revizyon olarak eklenecek.</p><div><button type="button" onClick={() => setPendingRevision(null)} disabled={mutation === "revise"}>Vazgeç</button><button type="button" onClick={() => void saveRevision()} disabled={mutation === "revise"}>{mutation === "revise" ? "Kaydediliyor…" : "Kaydetmeyi onayla"}</button></div></section> : null}
    {message ? <p className={styles.feedback} role="status">{message}</p> : null}
  </section><InterviewKitPanel /></>;
}
