---
name: zamanla
description: Herhangi bir chat'ten Maestro kuyruğuna zamanlı/tekrarlı/koşullu iş yazar ("10 dk sonra şunu koştur", "her sabah 9'da /ana-kontrol", "şu iş bitince şunu", "agent X'i 10 dk sonra tetikle"). Skill Enter'a BASAMAZ — yalnız jobs/'a yazar; enjeksiyonu metronom daemon yapar. Kullanıcı "zamanla", "sonra koştur", "kuyruğa al", "şu saatte çalıştır" dediğinde veya /zamanla çağrıldığında kullan.
rol: ajan
---

# /zamanla — Maestro kuyruğuna iş yaz

Kuyruk CLI'ı: `bun /Users/ybg/dev/agent-ide/packages/maestro/bin/zamanla.mjs`

## Kurallar
1. **Asla kendin enjekte etme / Enter'a basma** — yalnız `zamanla add` ile jobs/'a yaz;
   ateşlemeyi metronom daemon yapar (meşgule enjekte etmez, idle bekler).
2. **`dispatched ≠ done`:** `--text`/`--agent` işi ateşlenince yalnız "iletildi" olur
   (`dispatched`), sonucu bilinmez. `--after-ok` zincirine girecek iş üç yoldan biriyle
   done-kanıtı taşımalı: `--shell` (exit-0 = done) · `--done-regex` (pane mührü) ·
   `--agentic --goal` (watcher verdict'i). Kanıtsız text işine `--after-ok` bağlama.
3. **🔴 red-action valfi** (`lib/policy.mjs`): `git push`/`deploy`/`rm -rf`/`publish` gibi
   komut içeren iş otomatik tetikle yazılsa bile MANUAL'e çekilir; onay tek yol
   `aide zamanla run-now <id>`. Park/fail olan işler `jobs/alerts.jsonl`'a düşer.
4. **macOS TCC tuzağı:** `~/Desktop|Documents|Downloads` altına dokunan işi `--shell`
   ile DAĞITMA — daemon'un UI oturumu yok, TCC diyaloğu çıkmaz, süreç sonsuza kilitlenir.
   Bu yollar için canlı session enjeksiyonu ya da `--new-cwd` (görünür tmux) kullan.

## Eksenler (doğal dil → bayrak)

**Payload (biri zorunlu):**
- enjeksiyon: `--text "/ana-kontrol" --session <tmux-oturum> [--socket <ad>]`
- yeni/kapalı oturum: `--text "..." --new-cwd <dir> [--new-name <ad>] [--new-cmd "claude --resume <id>"]`
- headless komut (tmux gerekmez): `--shell "<cmd>" [--cwd <dir>] [--timeout <sn>]`
- agent: `--agent "<proje>:<ad>" [--task "..."] [--cwd <dir>] [--tier plan|kod|inceleme|hizli]`
  (model/effort'u aide `runAgent` çözer — model adı YAZMA, tier ver)
- agentic NL hedef: `--goal "<doğal-dil>" [--agentic]` (decider fire-time'da payload türetir)

**Tetik (biri; hiçbiri verilmezse `manual` — yalnız `run-now` ateşler):**
- `--at +10m|<ISO>` (tek ateş, mutlak mühürlenir) · `--every 30s|1h|24h [--max N] [--hemen]`
  (`--hemen`: soğuk başlangıç yok — ilk ateş tam aralığı beklemez, ilk tick'te koşar;
  sonraki ateşler normal aralığa döner. Ateşle-unut rutinleri için.)
- `--after-ok <jobId>` — SIKI: bağımlı temiz `done` olursa (parked/dispatched SAYMAZ)
- `--after <jobId>` — gevşek (v1): terminal olması yeter (park dahil) — tercih etme
- `--when-file <yol>` · `--when-shell "<cmd>"` (exit-0 = koşul sağlandı)

**Gözetim/koruma:**
- `--done-regex "<re>" [--done-target <pane>]` — pane'de mühür görülünce `done`
- `--on-fail retry|park` — **varsayılan tetiğe bağlı**: tekrarlı iş (`--every`) → `retry`
  (üstel backoff; tekrarlı bakım işi geçici hatada kalıcı ölmemeli), tek-seferlik iş → `park`.
  Bayrak verilirse ezer. `retry` de 5 ardışık hatada auto-park eder → kalıcı arıza görünür kalır.
  · `--no-idle` (idle bekleme)
- `--group <ad> --cap N` (eşzamanlılık) · `--title "..."` (kuyrukta ayırt edici başlık —
  PM işlerinde `pm:<fp>:<amac>` deseni)

## Alt komutlar
`add` · `add-json` · `list` · `cancel <id>` · `run-now <id>` (kırmızı/manual işin insan
onayı) · `remove <id>` (tombstone → `.graveyard.jsonl`)

İşi yazdıktan sonra id + tetik özetini bildir; daemon sağlığı:
`bun /Users/ybg/dev/agent-ide/packages/maestro/bin/metronom.mjs status` · alarmlar: `jobs/alerts.jsonl`
