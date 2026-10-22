# aide — bu projenin ajan toolkit envanteri

> **ÇEKİRDEK envanter.** Bu dosya her oturumun her isteğine girer; yalnız davranışı değiştiren
> bilgiyi taşır. Ayrıntı `Detay:` işaretçisindedir ve gerekince okunur.
> Kanon kaynağı `/Users/ybg/dev/agent-ide/packages/kit/`; `~/.claude` ve `<proje>/.claude` onun kopyasıdır.

## Dağıtım ve kurulum

### 1. Kit dağıtımı — `aide sync`
Toolkit dosyaları merkezî kit'ten gelir ve `.claude/aide-manifest.json` ile damgalanır.
Kalıcı bir değişikliği `/Users/ybg/dev/agent-ide/packages/kit/templates/` altına yaz; kopyada yapılan değişiklik kaybolabilir.
`aide sync --project <yol>` · `--kuru` (yazmadan rapor) · `--yerel <rel>` (yerel kopya kazanır) ·
`--benimse <rel>` (takipsiz dosyayı izlemeye al; koruma değildir) · `--disla <yol>` (projeyi dağıtım dışı bırak).
Üç-yol birleştirme (K5): yerel kopya saptıysa ve şablon kurulumdan beri değiştiyse şablon iner, eski
hâl `~/.config/agent-ide/sync-yedek/` altına gider; şablon değişmediyse yerel kopya kalır.
Detay: `/Users/ybg/dev/agent-ide/docs/kit.md` · `/Users/ybg/dev/agent-ide/docs/sync.md`

### 2. Kurulum — `aide kurulum`
`aide sync` dosyayı dağıtır; `aide kurulum` onu Claude Code'a bağlar (hook kaydı · model zinciri · PATH).
İkisi de gerekir: kaydı olmayan bir hook hiç koşmaz ve bunun belirtisi yoktur.
`aide kurulum [--kuru]` · `aide kurulum --hepsi` (kayıtlı bütün projeler) · `aide kurulum doctor`.
Kurulum yalnız ekler, idempotenttir ve yedek alır; bozuk bir `settings.json` dosyasını ezmez.
Detay: `/Users/ybg/dev/agent-ide/docs/kurulum-katmani.md`

### 3. Otomatik dağıtım — `kit-bootstrap` hook'u
SessionStart'ta koşar ve oturumu bekletmez. Projede iskelet yoksa iskeleti hemen kurar.
İskelet varsa ve son tazeleme 24 saatten eskiyse `aide sync`'i arka planda başlatır; ev hedefi (`~`) dahil.
Hata oturumu durdurmaz; `KURULAMADI:` satırı ve `~/.claude/hooks/kit-bootstrap.err.jsonl` kaydı bırakır.
Detay: `~/.claude/hooks/kit-bootstrap.mjs` (baş yorumu)

### 4. Sağlık ölçümü — `/aide-saglik` · `/aide-durum`
Tek salt-okur ölçüm bütün `~/dev`'i kapsar: bekleyen kit dosyası, kanona işlenmemiş yerel değişiklik,
hook kaydı, vendor eşleşmesi ve registry dışı proje. 0 token harcar ve hiçbir şeyi düzeltmez.
Son ölçüm 6 saatten tazeyse yeniden ölçmez; `/aide-durum` bu kapıyı `--zorla` ile deler.
Çıkış kodu: 0 = tam · 1 = eksik · 2 = ölçüm koşamadı. Önerilen onarım `onar:` satırındadır.
Detay: `~/.claude/skills/aide-saglik/SKILL.md`

## Oturum araçları

### 5. `/eszamanli` — aynı repoda eşzamanlı oturum protokolü
Uzun ya da yıkıcı bir yazımdan önce kaynağı claim'le, bitince bırak. Başkasının canlı kilidine
yapılan yazımı `claim-guard` hook'u reddeder. `C=~/.claude/skills/eszamanli/scripts/claim.mjs`:
`node $C status | claim --res <k> --intent "…" | release --res <k> | wait --res <k>`
Reddedilince işi parçala: serbest parçayı şimdi yap, bloke parça için `wait`'i `run_in_background` ile koş;
oturum kapanacaksa `devret --res <k> --gorev "…"` ile devir işareti bırak. Limit uyarısında `limit-devir` koş.
`release` sıradaki bekleyene bildiri bırakır; bildiri durmuş bir oturumu uyandırmaz.
Canlılık pid ile ölçülür; kilidi elle silme.
Detay: `~/.claude/skills/eszamanli/SKILL.md` · `/Users/ybg/dev/agent-ide/docs/claim-anahtarlari.md`

### 6. Plan katmanı — `/plan-kur` · `/plan-organizatoru` · oturum defteri
`/plan-kur` roadmap'i `plans/<slug>/v<N>/` altına yazar; aşamalar `/goal` ile koşulur.
`/plan-organizatoru` planı ağaca yerleştirir. `plans/INDEX.*` ve `plans/TODO.md` dosyalarını elle yazma;
tek yazarları `agac.mjs --durum|--gate|--todo|--kunye` betiğidir.
Her plan künye taşır ve kaynak oturumunu beyan eder (`> Oturum: ot:<YYYY-MM-DD>/<slug>`).
Oturum defteri: `oturum.mjs tohumla|bu|durum|devir|acilis|global` (betikler `~/.claude/skills/plan-organizatoru/scripts/` altında).
(`/planla-kos` 2026-10-22'de arşive gitti.) Detay: `/Users/ybg/dev/agent-ide/docs/plan-katmani.md`

### 7. `/workflow` — paralel ve çok adımlı işin orkestrasyonu
İki kanon şablon sunar: uygula-doğrula (adversaryal doğrulamalı pipeline) ve fan-out-topla
(şemalı paralel işçiler). Şema kapısı `scripts/dogrula.mjs` deterministiktir.
Skill kendisi model doğurmaz; workflow'u koşan oturum doğurur.
Detay: `/Users/ybg/dev/agent-ide/docs/workflow-katmani.md`

### 8. `/soft-resume` · `/devam` — kesilmiş işi sürdürme
`/soft-resume` kapalı ya da başka hesaba ait bir oturumu `claude --resume` olmadan sürdürür.
Transcript, hedef ve plan ağacını `topla.mjs` ile toplar ve bir brif dosyasına damıtır.
`/devam` önce işin hâlâ geçerli olup olmadığını ölçer (`gecerlilik.mjs`), sonra `/soft-resume`'u kullanır.
Açık sekmelerin yedeği: `kasa.mjs yaz|list|baslat`; `baslat` `cd <cwd> && claude --resume <id>` satırını basar.
Detay: `~/.claude/skills/soft-resume/SKILL.md` · `~/.claude/skills/devam/SKILL.md`

### 9. `/learnings` — derslerin ham defteri
Yol boyunca doğan dersleri kaydeder ve biriktirir; sisteme hiçbir şey işlemez.
`learnings.mjs ekle --tur <tür> --metin "…" --neden "…"`; gerekçesiz kayıt kabul edilmez.
Depo `docs/learnings/defter.jsonl` (kanon); `LEARNINGS.md` türevdir ve elle düzenlenmez.
Detay: `~/.claude/skills/learnings/SKILL.md`

## Politika ve sözleşmeler

### 10. Vendor katmanı — Codex
Kanon ikinci bir ajan ürününe (Codex) deterministik olarak projekte edilir. Şalter varsayılan kapalıdır.
Codex pilotu yalnız `vendors.codex.projeler` listesindeki projelere iner; pilotta ev hook kaydı ve model pini yazılmaz.
`aide vendor durum | ac <ad> [--pilot <proje>] | kapat <ad> | doctor`.
Detay: `/Users/ybg/dev/agent-ide/docs/vendor-katmani.md`

### 11. Model politikası
Tek kaynak `~/.config/agent-ide/config.json → models`; türev dosyaları elle düzenleme.
Ayar: `aide model sec <tier> --model <id> --effort <e>` · denetim: `aide model doctor`.
Detay: `~/.claude/docs/model-policy.md`

### 12. Commit sözleşmesi
İŞ commit'ini insan ya da Claude yazar ve sözleşmeye uyar; checkpoint (`cp(...)`) commit'ini motor yazar.
Şüphede commit İŞ sayılır. Detay: `.claude/aide/docs/commit-sozlesmesi.md`

## Terimler ve tavan
- Terim kanonu `.claude/aide/docs/terimler.md` dosyasıdır.
- Bu dosya çekirdektir: yeni yetenek 2-6 satır öz ve tek `Detay:` işaretçisi taşır.
  Tavan kuralı: `.claude/aide/docs/claude-md-sozlesmesi.md`.
