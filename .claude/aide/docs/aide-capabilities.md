# aide — bu projenin agentic altyapı envanteri

> **ÇEKİRDEK envanter.** Her oturumun HER isteğine girer; yalnız *davranışı değiştiren*i taşır —
> ayrıntı `Detay:` işaretçilerinde, **gerekince okunur.** Kurulum `aide sync` (§11).
> Kod kanoniktir: `/Users/ybg/dev/agent-ide/docs/`.

## Bu projede kullanılabilir yetenekler

### 1. `/zamanla` — zamanlı/tekrarlı/koşullu iş kuyruğu
Maestro (metronom) kuyruğuna iş yazar; **Enter'a basmaz**, enjeksiyonu daemon yapar.
Tetikler `at`·`every`·`after`·`when`·`manual`; payload `text`·`agent`·`shell`.
`bun /Users/ybg/dev/agent-ide/packages/maestro/bin/zamanla.mjs add --text '/x' --at 09:00|list|cancel`
Detay: `/Users/ybg/dev/agent-ide/docs/maestro.md`·`/Users/ybg/dev/agent-ide/docs/enjeksiyon.md`

### 2. `aide agent run <ref>` — agent koşum chokepoint'i
Tanımlı agent'ı (`~/.claude/agents/`·`.claude/agents/`) yeni tmux penceresinde koşturur;
instance↔session eşlemesi kayda geçer. `aide agent run global:kaptan --task "…"`·`list`·`ps`
Detay: `/Users/ybg/dev/agent-ide/docs/agent-runtime.md`

### 3. `aide` dashboard — oturum/agent/otomasyon
Terminalde `aide`: Oturumlar·Ajanlar·Otomasyon·Yapılandır.
Detay: `/Users/ybg/dev/agent-ide/docs/tui-paneller.md`

### 4. Kit dağıtımı — `aide sync`
Aide dosyaları (`.claude/aide-manifest.json` damgalı) merkezi kit'ten gelir:
`aide sync --project <hedef>` · paket `aide feature <anahtar> on|off`. `~/dev` altındaki
her proje **otomatik keşfedilir** (`--auto`). Detay: `/Users/ybg/dev/agent-ide/docs/sync.md`

## Tamamlayıcı katmanlar

### 5. `/kaptan` — görev modeli + projeler-arası router
Her `TodoWrite` hook'la yakalanır (**NABIZ**) → `~/.claude/kaptan/goals/`; görev listesi
oradan **TÜRETİLİR, elle tutulmaz**. Pano `aide kaptan`; detay `~/.claude/skills/kaptan/`

### 6. `/pm` — kaptan'ın üstündeki otonom proje yöneticisi
Üst-hedef koyar, görevleri kendi kararıyla dağıtır, mutabakatla doğrular; geri-alınamaz
adımlar üç kademeli valfe bağlı ve **🔴 kırmızı işi YALNIZ İNSAN onaylar** (`aide zamanla
onay-list` → `run-now <id>`). Detay: `/Users/ybg/dev/agent-ide/docs/pm-otonom.md`

### 7. Belge bekçisi — belge yalanlaşmasın diye
`~/.claude/docs/_kanit.mjs` her gün **0 token**la doğrular: ölü yol/iş id'si · kit sapması ·
gecikmiş/park iş · kurulu ama **referanssız** belge. Kapsam **türetilir** (`_kapsam.mjs`);
tazelik mtime DEĞİL **içerik damgası** (`_damga.mjs`).

### 8. `/eszamanli` — session çakışma protokolü
Uzun/yıkıcı bir **yazımdan önce** kaynağı claim'le, bitince bırak; başkasının canlı kilidine
yazımı `claim-guard` REDDEDER. `C=~/.claude/skills/eszamanli/scripts/claim.mjs` →
`node $C status|claim|release --res <k>`

- **DENY yiyince BEKLEME, İŞİ PARÇALA:** bloke adımlar B, kalanı A; A'yı şimdi yap, B için
  `node $C wait --res <k>` (`run_in_background`) ya da oturum kapanıyorsa `devret --gorev "<B>"`.
- **Limit uyarısında kilidini BIRAK/DEVRET** (`node $C limit-devir`) — askıdaki sahip kuyruğu dondurur.
- **BIRAKAN HABER VERİR (2026-08-09):** `release` (ve SessionEnd), uyanma yolu OLMAYAN sıradaki
  bekleyenlere **bildiri** bırakır; aktif `wait` süreci olana yazılmaz (o kendi uyanır). Okuma
  `ctx` hook'unda, **tek sefer**. Posta kutusu — **ZİL DEĞİL:** durmuş oturumu uyandırmaz.
- **ZİNCİRİN İKİ YÖNÜ:** bitirince İLERİ (sıradakine), kilit aşamasında bloke olunca GERİ
  (kilidi TUTANA) haber gider — ikisi de yalnız YENİ bekleyende, yankı bildirilmez.
- **ROLLER** (`rol kayit|durum|birak --rol <ad>`): kalıcı oturumların kararlı adı — kapalı küme
  (`orkestrator`·`altyapi`·`pm`·`vizyon`·`plan` TEKİL · `worker` ÇOĞUL). `bildir --rol <ad>`
  ile seslenilir; **çoğul/sahipsiz rolde adres ÜRETİLMEZ** (belirsiz adres yasak). Her rol
  sahibi süzülmüş ilerleme beslemesi alır (imleçler ayrı); `kutu` istediğin an TÜKETMEDEN bakar.
  Kaynak: `kit:dagitim` anahtarı altyapı rolünün yazımlarını kapıya bağlar.
- **ORKESTRATÖR** (`orkestrator kayit|durum|birak`): sahadaki koordinatör oturum. Beslemesi
  **`olay.jsonl`'ın projeksiyonudur** (imleç: `orkestrator/imlec.json`) — alindi·birakildi·
  deny·bekleyis·kapanis·kapandi·devir·cevrim **yapısal olarak** akar, elle bağlanmaz; gürültü
  katlanır (tavan 12 satır, >500 olayda yalnız sayaç). Eli: `bildir --hedef <sid> --mesaj "…"`.
  Repo başına **tek slot** (`--devral`), canlılık pid'le, kapsam **repo** (projeler-arası eksen
  `/pm`). PM karar verir, orkestratör **haber alır**. Beslemenin İKİNCİ kanalı commit'lerdir
  (otonomi-merdiveni:16): İŞ satır satır · cp TEK satıra katlanır · imleç `orkestrator/commit-imlec.json`.
- Canlılık **pid**'le ölçülür → kilidi **ELLE SİLME** · kapı **YAZIMI** ölçer, adı anmayı değil.

Detay: `/Users/ybg/dev/agent-ide/docs/claim-anahtarlari.md`

### 9. Plan katmanı — `/plan-kur`·`/plan-organizatoru`·`/planla-kos`
`/plan-kur` roadmap'i yazar (`plans/<slug>/v<N>/`); `/plan-organizatoru` ağaca yerleştirip
`plans/INDEX.*`'ı **TÜRETİR**; `/planla-kos` sıradaki `/goal`'ü tüketip Maestro üzerinden
ateşler. Yüzey (`~/.claude/skills/plan-organizatoru/scripts/`):
`agac.mjs --durum|--gate|--todo|--kunye` · `oturum.mjs tohumla|bu|durum|devir|acilis|global`.

- `plans/INDEX.*` + `plans/TODO.md` **ASLA elle yazılmaz** (tek yazar `agac.mjs`); `proje` slug'ı REZERVE.
- **Her plan künye taşır** (`Kategori·Üst·Kritiklik·Aciliyet·Hacim·Hedef`) ve **kaynak oturumunu beyan
  eder** (`> Oturum: ot:<YYYY-MM-DD>/<slug>`) — eksikse ADVISORY, **biçimi geçersizse gate FAIL**.
- **Terfi asimetriktir:** oturum todo'su projeye kendiliğinden çıkmaz; planlar istisnasız roadmap'e işler.
- **Oturum devri çift uçlu** (SessionEnd `devir` · SessionStart `acilis` — BİLGİ verir, DAYATMAZ);
  üçüncü uç OTURUM KASASI (`soft-resume/scripts/kasa.mjs list|baslat`).

Detay: `/Users/ybg/dev/agent-ide/docs/plan-katmani.md` (künye §4b · TODO §4c · oturum §4d)

### 10. `aide rota` — Rotacı: planı kendi yürüten reconciler
Her tick istenen ↔ fiili durumu karşılaştırır: **fark yoksa 0 token harcayıp çıkar**, fark
varsa KAPALI bir tablodan tek eylem seçer, belirsizlikte seçmez — karar DETERMİNİSTİK KOD.
`aide rota kuru --proje .` (ne yapardı; ateşlemez) · `durum`·`doctor`·`defter`. **Hüküm ≠
eylem** (`hakem` ajanının `Edit`'i YOKTUR) · **fan-out yalnız Rotacı'da** · PM kadranı
Rotacı'nın da TAVANIDIR. Detay: `/Users/ybg/dev/agent-ide/docs/rotaci.md`

### 11. Alet katmanı — kit = taşınabilirlik
Aletler **Claude'a değil PROJEYE** aittir: kanon repodadır (`/Users/ybg/dev/agent-ide/packages/kit/`),
`~/.claude` ve `<proje>/.claude` **projeksiyondur**. **Kanonu ŞABLON taşır** — kalıcı değişikliği
`packages/kit/templates/`'e işle. `aide sync --project ~` · `--kuru` · `--yerel <rel>` (yerel
KAZANIR) · `--yerel-sil` · `--benimse`. K5/Model B: şablon kurulumdan beri DEĞİŞTİYSE kanon iner
(eski hal `sync-yedek/`'e), DURDUYSA yerel kalır · **kapat ≠ sil**. Detay: `/Users/ybg/dev/agent-ide/docs/kit.md`

### 12. Boot katmanı — makine ayaktayken koşan asgari çekirdek
**BOOT** sistemin AYAKTA OLMASININ ön koşuludur — deterministik, tmux'suz, **sistem kapalıyken de
koşar**; şalter AYRI: `aide boot durum|simdi|doctor|sinif|kapat|ac`. **K1:** `BOOT ⟺ (a) sistemin
ayakta olması ona bağlı ∧ (b) deterministik ∧ (c) tmux gerektirmez`; biri düşerse iş MAESTRO'dur.
Manifest **on adım, SIRA SÖZLEŞMEDİR** (`tasima-once → sync-auto → sync-ev → filing-donan →
filing-yaz → oturum-kapat → kilit-nobet → claudemd-bekci → susturulmus-nabiz → tasima-sonra`;
son üçü BEKÇİ — bulgu = ALARM). **Dağıtım İKİ adımdır:** `sync-auto` registry + `~/dev` keşfini,
`sync-ev` **evi** (`~/.claude`) kapsar — ev hiçbir türetilmiş taramanın içinde değildir.
**`aide sistem kapat` boot'u DURDURMAZ** · **borç bırakan her sonuç HATADIR**.
Detay: `/Users/ybg/dev/agent-ide/docs/boot-katmani.md`

### 13. Kurulum + FILING — dosyayı BAĞLAYAN ve bilgiyi TAŞIYAN halkalar
`aide sync` DOSYA dağıtır; **`aide kurulum` onu sisteme BAĞLAR** (hook kayıtları · model
zinciri · PATH) — kayıtsız hook **ölü metindir** ve belirtisi yoktur. **FILING** projenin
kararlarını (hesaba bağlı `~/.claude`'dadırlar) `<proje>/.claude/filing/`'e git-izli
yansıtır: **klasör kanondur, `~/.claude` çalışan kopya.**
`aide kurulum [--kuru]|doctor|--hepsi` · `aide filing durum|<boş>=yaz|donan|kapsam|doktor|teshis`.
**Fiiller kasten farklı:** `yaz` TAM AYNAdır (silme de yansır — YIKICI), `donan` eksiği doldurur ve
**ASLA ezmez/silmez** · **SIRA sözleşmedir** (`filing-donan` ÖNCE) · **sır kapısı `yaz`ın içindedir**
· kurulum ADDITIVE + idempotent + yedekli, bozuk `settings.json` EZİLMEZ.
Detay: `/Users/ybg/dev/agent-ide/docs/kurulum-katmani.md` · `/Users/ybg/dev/agent-ide/docs/filing-katmani.md` ·
`/Users/ybg/dev/agent-ide/docs/vscode-yuzeyi.md` · `/Users/ybg/dev/agent-ide/docs/proje-panosu.md`

### 14. Commit sözleşmesi + DURUM logu — geçmişi araştırılabilir tutar
**İki sınıf:** **İŞ** commit'ini insan/Claude yazar ("neden"i bilir → sözleşmeye tabi);
**CHECKPOINT**'i motor yazar (`cp(<kapsam>): N dosya · +x/-y` — NE olduğunu diffden TÜRETİR,
"neden" uydurmaz). **Şüphede İŞ.** `aide durum [--kuru|goster]` → `docs/DURUM.md` (TÜREV;
elle düzenleme sapmadır). Diffin tekrarı YASAK · kapsam zorunlu · **12 satır tavanı**.
Detay (zincir DIŞI — gerekince oku): `.claude/aide/docs/commit-sozlesmesi.md` ·
`/Users/ybg/dev/agent-ide/docs/durum-logu.md`

### 15. Vendor katmanı — tek kanon, ürüne özel çerçeve
Kanon (`packages/kit/` + `hooks-registry.json` + `.claude/filing/`) ikinci bir ajan ürününe
(**Codex**) **deterministik, 0-token** projekte edilir; artefaktı aynı filing'e geri akar.
**Şalter varsayılan KAPALI** — kapalıyken tek bayt yazılmaz. Üç katman: **yol** (`vendorRel`,
`kit.json` DEĞİŞMEZ) · **içerik** (projektör) · **kayıt** (`settings.json` ⊕ `hooks.json`).
Bir hook ikinci ürüne ancak **açık beyanla** iner; **kayıtsız hook ölü metindir, DOSYASIZ kayıt
ondan da kötüdür** → kapı ikisini birlikte ölçer.
`aide vendor durum|ac|kapat|doctor`. Detay: `/Users/ybg/dev/agent-ide/docs/vendor-katmani.md`

### 16. Seviye 0 — aide KAPALIYKEN de duran taban (envanter + kapı)
Bu tabanı **aide taşımaz, DENETLER · ONARIR · İKAME ETMEZ**. Ne olduğu Seviye 0 maddesinde
(yukarıda); burada **ölçeni** var: `aide seviye0` envanteri her yüzeyin **sınıfını · taşıyıcısını ·
şalterini** ve `[kayıt][dosya]` rozetini basar — **kayıtsız hook ölü metindir ve BELİRTİSİ YOKTUR**
(ölçüldü: bir üçüncü-taraf yazar `settings.json → hooks`tan `Stop`u silince dört seviye-0 kaydı
sessizce öldü). `aide seviye0 --gate` exit 1 verirse çare TEK ve idempotenttir: **`aide kurulum`**.
Detay: `/Users/ybg/dev/agent-ide/docs/seviye-0.md`

## Terimler

Kanon **`.claude/aide/docs/terimler.md`** (zincirde) — birinci kuralı orada.

## Sözleşmeler
- Maestro ile temas YALNIZ `/Users/ybg/dev/agent-ide/jobs/` şeması + `zamanla` CLI üzerinden; meşgul
  pane'e asla enjeksiyon yapılmaz (ateş tavanı aşılırsa deadman global pause).
- `sync` DAĞITIR, `kurulum` BAĞLAR — ikisi de gerekir; kit motoru `settings.json`'a ASLA
  yazmaz, kaydı kurulum katmanı additive birleştirir.
- **Bu dosya ÇEKİRDEKTİR:** yeni yetenek = 2-6 satır öz + tek `Detay:` işaretçisi; ayrıntı
  kendi kanon belgesine gider. Tavan + seviye-0 rezervi (zincir DIŞI — gerekince oku):
  `.claude/aide/docs/claude-md-sozlesmesi.md`.
