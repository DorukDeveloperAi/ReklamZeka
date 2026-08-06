#!/usr/bin/env node
// soft-resume KANIT harness'ı — topla.mjs'in sözleşmelerini sentetik fixture'larla ölçer.
// Deterministik, 0 token. Her iddia ölçülür; ölçülmeyen iddia yalanlaşır.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TOPLA = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "topla.mjs");
let gecti = 0, dustu = 0;
function kanit(ad, kosul) {
  if (kosul) { gecti++; console.log(`  ✓ ${ad}`); }
  else { dustu++; console.log(`  ✗ ${ad}`); }
}

// ── fixture: sahte EV — iki depo (.claude + .claude-hesap2) ──────────────────
const EV = mkdtempSync(join(tmpdir(), "soft-resume-proof-"));
const SLUG = "-tmp-proje";
const ID1 = "aaaaaaaa-1111-1111-1111-111111111111"; // ana depo
const ID2 = "bbbbbbbb-2222-2222-2222-222222222222"; // hesap2 deposu (sır içerir)
const satir = (o) => JSON.stringify(o) + "\n";
const userMsg = (t, ts) => satir({ type: "user", timestamp: ts, cwd: "/tmp/proje", message: { content: t } });
const asstMsg = (t) => satir({ type: "assistant", message: { content: [{ type: "text", text: t }] } });
const todoMsg = (todos) => satir({ type: "assistant", message: { content: [{ type: "tool_use", name: "TodoWrite", input: { todos } }] } });

for (const depo of [".claude", ".claude-hesap2"]) mkdirSync(join(EV, depo, "projects", SLUG), { recursive: true });
writeFileSync(join(EV, ".claude", "projects", SLUG, `${ID1}.jsonl`),
  userMsg("X özelliğini yaz", "2026-07-23T10:00:00Z") +
  asstMsg("başlıyorum") +
  todoMsg([{ content: "modül A", status: "completed" }, { content: "modül B", status: "pending" }]) +
  userMsg("<system-reminder>enjeksiyon</system-reminder>", "2026-07-23T10:01:00Z") +
  userMsg("devam", "2026-07-23T10:02:00Z") +
  userMsg("B modülünde şu hatayı da düzelt", "2026-07-23T10:03:00Z"));
writeFileSync(join(EV, ".claude-hesap2", "projects", SLUG, `${ID2}.jsonl`),
  userMsg("gizli iş: anahtar sk-ant-" + "a".repeat(30) + " ile bağlan", "2026-07-23T09:00:00Z") +
  asstMsg("tamam"));
// hesap2 kaptan hedefi (goal deposu = session'ın deposu kuralı)
mkdirSync(join(EV, ".claude-hesap2", "kaptan", "goals", SLUG), { recursive: true });
writeFileSync(join(EV, ".claude-hesap2", "kaptan", "goals", SLUG, `${ID2}.json`),
  JSON.stringify({ title: "gizli proje", todos: [{ content: "kalan iş", status: "pending" }] }));

const kos = (args) => spawnSync("node", [TOPLA, ...args], { encoding: "utf8", env: { ...process.env, HOME: EV, CLAUDE_CONFIG_DIR: "" } });

console.log("— liste: depo-çoklu keşif —");
{
  const r = kos(["--liste"]);
  const j = JSON.parse(r.stdout || "[]");
  kanit("iki depo da taranır", new Set(j.map((x) => x.depo)).size === 2);
  kanit("her iki session listede", j.some((x) => x.sessionId === ID1) && j.some((x) => x.sessionId === ID2));
}

console.log("— session: demet sözleşmeleri —");
{
  const r = kos(["--session", ID1]);
  const j = JSON.parse(r.stdout || "{}");
  kanit("ilk istek = amaç", j.amac?.ilkIstek === "X özelliğini yaz");
  kanit("BOS_ISTEK ('devam') son istek OLMAZ", j.neredeKaldi?.sonIstek === "B modülünde şu hatayı da düzelt");
  kanit("system-reminder kuyruğa girmez", !JSON.stringify(j.neredeKaldi?.kuyruk).includes("enjeksiyon"));
  kanit("son TodoWrite yakalanır", j.neredeKaldi?.sonTodolar?.some((t) => t.content === "modül B" && t.status === "pending"));
  kanit("ana depoda hardResume üretilir", typeof j.meta?.hardResume === "string" && j.meta.hardResume.includes(ID1));
}
{
  const r = kos(["--session", ID2]);
  const j = JSON.parse(r.stdout || "{}");
  kanit("başka depodan bulunur", j.meta?.depo?.endsWith(".claude-hesap2"));
  kanit("sır ELENİR (sk-ant token)", !r.stdout.includes("sk-ant-") && r.stdout.includes("sır içerdiği için çıkarıldı"));
  kanit("başka depoda hardResume ÖNERİLMEZ", j.meta?.hardResume === null);
  kanit("başka-depo uyarısı ilan edilir", j.uyarilar?.some((u) => u.includes("BAŞKA depoda")));
  kanit("kaptan hedefi SESSION'IN deposundan", j.kaptanHedefi?.title === "gizli proje");
}

console.log("— aktif depo kıyası (CLAUDE_CONFIG_DIR onurlandırılır) —");
{
  // hesap2'den bakarken ~/.claude session'ı BAŞKA depodur — hard resume önerilmez.
  // (Gerçek veriyle yakalanan hata, 2026-07-23: kıyas sabit ~/.claude'a yapılıyordu.)
  const r = spawnSync("node", [TOPLA, "--session", ID1], {
    encoding: "utf8", env: { ...process.env, HOME: EV, CLAUDE_CONFIG_DIR: join(EV, ".claude-hesap2") },
  });
  const j = JSON.parse(r.stdout || "{}");
  kanit("aktif=hesap2 iken ~/.claude session'ına hardResume ÖNERİLMEZ", j.meta?.hardResume === null);
  kanit("aktif=hesap2 iken ~/.claude 'başka depo' uyarısı alır", j.uyarilar?.some((u) => u.includes("BAŞKA depoda")));
}

console.log("— bulunamadı + dev transcript —");
{
  const r = kos(["--session", "yok-boyle-bir-id"]);
  kanit("bulunamayan id → exit 1 + net mesaj", r.status === 1 && r.stderr.includes("BULUNAMADI"));
}
{
  // ~5MB transcript: kuyruk tavanı (64KB) aşılmamalı
  let dev = userMsg("dev iş", "2026-07-23T08:00:00Z");
  for (let i = 0; i < 5000; i++) dev += asstMsg("uzun çıktı ".repeat(80) + i);
  const ID3 = "cccccccc-3333-3333-3333-333333333333";
  writeFileSync(join(EV, ".claude", "projects", SLUG, `${ID3}.jsonl`), dev);
  const r = kos(["--session", ID3]);
  const j = JSON.parse(r.stdout || "{}");
  kanit("dev transcript'te kuyruk tavanı tutar", r.status === 0 && JSON.stringify(j.neredeKaldi?.kuyruk).length <= 70 * 1024);
}

console.log("— harness'ın sesi: etiket SOYULUR, hook metni ELENİR —");
{
  // Gerçek veriyle yakalanan iki sapma (2026-08-03): (1) VSCode ilk isteği `<ide_opened_file>`
  // bloğuyla geldiği için mesaj komple atılıyor, `amac` NULL çıkıyordu; (2) `Stop hook feedback`
  // metni kullanıcı isteği sayılıp hem `amac` hem `sonIstek` alanını dolduruyordu.
  const ID4 = "dddddddd-4444-4444-4444-444444444444";
  writeFileSync(join(EV, ".claude", "projects", SLUG, `${ID4}.jsonl`),
    userMsg("<ide_opened_file>The user opened X</ide_opened_file> gerçek ilk istek", "2026-08-01T10:00:00Z") +
    asstMsg("tamam") +
    userMsg("Stop hook feedback:\n1 açık madde: devam et", "2026-08-01T10:01:00Z") +
    userMsg("son gerçek istek", "2026-08-01T10:02:00Z"));
  const j = JSON.parse(kos(["--session", ID4]).stdout || "{}");
  kanit("IDE etiketi SOYULUR, kullanıcının cümlesi KORUNUR", j.amac?.ilkIstek === "gerçek ilk istek");
  kanit("hook metni son istek OLMAZ", j.neredeKaldi?.sonIstek === "son gerçek istek");
  kanit("hook metni kuyruğa da girmez", !JSON.stringify(j.neredeKaldi?.kuyruk).includes("Stop hook feedback"));
}

console.log("— compact özet: HASAT, üretim değil —");
{
  const compactMsg = (t, ts) => satir({ type: "user", timestamp: ts, isCompactSummary: true, message: { content: t } });
  const ID5 = "eeeeeeee-5555-5555-5555-555555555555";
  const govde = ["ÖZET-BAŞ", "orta satır", "anahtar: sk-ant-" + "b".repeat(30), "ÖZET-SON"].join("\n");
  writeFileSync(join(EV, ".claude", "projects", SLUG, `${ID5}.jsonl`),
    userMsg("ilk istek", "2026-08-01T09:00:00Z") + compactMsg(govde, "2026-08-01T09:30:00Z") +
    userMsg("compact sonrası istek", "2026-08-01T09:40:00Z"));
  const j = JSON.parse(kos(["--session", ID5]).stdout || "{}");
  kanit("compact özet hasat edilir", j.compact?.metin?.includes("ÖZET-BAŞ") && j.compact?.metin?.includes("ÖZET-SON"));
  kanit("compact özet zaman damgasını taşır", j.compact?.ts === "2026-08-01T09:30:00Z");
  kanit("compact özet amaç/son istek alanını ZEHİRLEMEZ",
    j.amac?.ilkIstek === "ilk istek" && j.neredeKaldi?.sonIstek === "compact sonrası istek");
  kanit("compact özet kuyruğa girmez", !JSON.stringify(j.neredeKaldi?.kuyruk).includes("ÖZET-BAŞ"));
  kanit("sır SATIR granülünde elenir (komşu satırlar yaşar)",
    !j.compact?.metin?.includes("sk-ant-") && j.compact?.sirElenenSatir === 1 && j.compact?.metin?.includes("orta satır"));
  const k = JSON.parse(kos(["--session", ID5, "--ozet-tavan", "12"]).stdout || "{}");
  kanit("tavan aşılınca BAŞTAN kırpılır (değerli uç SON'dur)",
    k.compact?.kirpildi === true && k.compact?.metin?.includes("ÖZET-SON") && k.compact?.metin?.includes("kırpıldı"));
}

console.log("— yalın mod: proje tarafı ölçülmez ve bu İLAN edilir —");
{
  const j = JSON.parse(kos(["--session", ID1, "--yalin"]).stdout || "{}");
  kanit("yalın: plan/DEVRALIS/git null", j.planlar === null && j.devralis === null && j.git === null);
  kanit("yalın: bayrak + uyarı ilan edilir", j.yalin === true && j.uyarilar?.some((u) => u.includes("YALIN")));
  const t = JSON.parse(kos(["--session", ID1]).stdout || "{}");
  kanit("yalın DEĞİLKEN session tarafı aynen durur", t.yalin === false && t.amac?.ilkIstek === j.amac?.ilkIstek);
}

// ── KASA fixture: plans/ taşıyan sahte proje + canlı session kaydı ───────────
console.log("— kasa: açık sekmenin yeniden başlatılabilir yedeği —");
{
  const KASA = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "kasa.mjs");
  const DEPO = join(EV, ".claude");
  const PROJE = join(EV, "proje");
  mkdirSync(join(PROJE, "plans"), { recursive: true });
  mkdirSync(join(DEPO, "hooks"), { recursive: true });
  mkdirSync(join(DEPO, "session-status"), { recursive: true });
  // claims-lib TEK canlılık kaynağıdır; kanıt onu KOPYALAR, taklit ETMEZ (ikinci ölçüt icat
  // edilseydi kanıt geçer, gerçek kurulum düşerdi). Kanon → kurulu kopya sırasıyla aranır.
  const libKaynagi = [
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "hooks", "claims-lib.mjs"),
    join(process.env.HOME_GERCEK || process.env.HOME || "", ".claude", "hooks", "claims-lib.mjs"),
  ].find((p) => { try { readFileSync(p); return true; } catch { return false; } });
  if (!libKaynagi) {
    kanit("claims-lib bulunamadı — kasa kanıtı KOŞULAMADI (ilan edildi)", false);
  } else {
    writeFileSync(join(DEPO, "hooks", "claims-lib.mjs"), readFileSync(libKaynagi));
    const KID = "ffffffff-6666-6666-6666-666666666666";
    const KISA = KID.slice(0, 8);
    const GUNCEL = 1_785_700_000_000;
    // procStart YOK: claims-lib canlılığı pid ile ölçer, damga verilmediğinde pid yeterlidir —
    // kanıt sürecinin KENDİ pid'i "canlı session" yerine geçer (gerçek ölçüt, sahte değil).
    writeFileSync(join(DEPO, "session-status", `${KID}.json`), JSON.stringify({
      sessionId: KID, cwd: PROJE, dirName: "proje", state: "generating",
      updated: GUNCEL, title: "<ide_opened_file>etiket</ide_opened_file> kasa oturumu", pid: process.pid,
    }));
    const trSatir = (o) => JSON.stringify({ ...o, cwd: PROJE }) + "\n";
    writeFileSync(join(DEPO, "projects", SLUG, `${KID}.jsonl`),
      trSatir({ type: "user", timestamp: "2026-08-01T11:00:00Z", message: { content: "kasa işini yap" } }) +
      trSatir({ type: "assistant", message: { content: [{ type: "tool_use", name: "TodoWrite", input: { todos: [
        { content: "adım A", status: "completed" }, { content: "adım B", status: "in_progress" }] } }] } }));

    const kasaKos = (args) => spawnSync("node", [KASA, ...args, "--proje", PROJE],
      { encoding: "utf8", env: { ...process.env, HOME: EV, CLAUDE_CONFIG_DIR: DEPO } });

    const r1 = kasaKos(["yaz"]);
    const oku = (p) => { try { return readFileSync(join(PROJE, "plans", "oturumlar", "kasa", p), "utf8"); } catch { return null; } };
    const kayit = oku(`${KISA}.json`);
    const brif = oku(`${KISA}.md`);
    kanit("canlı sekme kasaya yazılır (json + md + index)", !!kayit && !!brif && !!oku("KASA.md"));
    const kj = kayit ? JSON.parse(kayit) : {};
    kanit("başlık harness etiketinden arındırılır", kj.baslik === "kasa oturumu");
    kanit("zaman damgası ÖLÇÜLEN andır (new Date() değil)", kj.sonAktivite === new Date(GUNCEL).toISOString());
    kanit("İLK İŞ = yürüyen todo (deterministik)", kj.ilkIs === "adım B");
    kanit("brif YENİDEN BAŞLAT komutunu taşır", !!brif?.includes("YENİDEN BAŞLAT") && !!brif?.includes(KID));
    kanit("brif soft yolu her koşulda taşır (hesap değişse de açılır)", !!brif?.includes("OTURUM KASASI devralması"));
    kanit("compact yoksa UYDURULMAZ, ilan edilir",
      !!brif?.includes("_YOK —") && kj.olculemedi?.some((x) => x.includes("compact")));

    const r2 = kasaKos(["yaz"]);
    kanit("idempotent: değişmemiş oturum yeniden yazılmaz", r2.stdout.includes("0 yazıldı") && r1.stdout.includes("1 yazıldı"));

    const lj = JSON.parse(kasaKos(["list", "--json"]).stdout || "[]");
    kanit("list canlılığı ÖLÇER", lj.length === 1 && lj[0].canli === true && lj[0].kisa === KISA);

    const b1 = kasaKos(["baslat", KISA]);
    kanit("CANLI oturumu başlatmak REDDEDİLİR (ikiz koruması)", b1.status === 1 && b1.stderr.includes("İKİZ"));
    const b2 = kasaKos(["baslat", KISA, "--zorla"]);
    kanit("--zorla ile başlatma komutu basılır", b2.status === 0 && b2.stdout.includes(`--resume ${KID}`));

    const u = kasaKos(["unut", KISA]);
    kanit("unut: kayıt + brif silinir, index tazelenir", u.status === 0 && !oku(`${KISA}.json`) && !oku(`${KISA}.md`));
  }
}

rmSync(EV, { recursive: true, force: true });
console.log(`\n${gecti}/${gecti + dustu} kanıt geçti`);
process.exit(dustu ? 1 : 0);
