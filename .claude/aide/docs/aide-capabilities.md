# aide — bu projenin agentic altyapı envanteri

> **ÇEKİRDEK envanter.** Her oturumun HER isteğine girer; yalnız *davranışı değiştiren*i
> taşır — ayrıntı `Detay:` işaretçilerinde, **gerekince okunur.** Kurulum `aide sync`
> (yerel düzenlemenin akıbeti §11 · `aide sync --kuru` önce gösterir).
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

- **DENY yiyince BEKLEME, İŞİ PARÇALA:** bloke kaynağa dokunan adımlar B, kalanı A;
  A'yı şimdi yap, B için `node $C wait --res <k>` (`run_in_background` — çıkınca kaynak
  SENİNDİR) ya da oturum kapanacaksa `node $C devret --res <k> --gorev "<B>"` (Maestro ölse de
  kalıcı devir işareti taşır).
- **Limit uyarısı alırsan kilidini BIRAK/DEVRET:** `node $C limit-devir` — askıdaki bir sahip
  bütün kuyruğu dondurur.
- Canlılık **pid**'le ölçülür → kilidi **ELLE SİLME** · kapı **YAZIMI** ölçer, adı anmayı
  değil · kilit **yazım penceresinde** alınır, ölçüm süresince değil.

Detay: `/Users/ybg/dev/agent-ide/docs/claim-anahtarlari.md`

### 9. Plan katmanı — `/plan-kur`·`/plan-organizatoru`·`/planla-kos`
`/plan-kur` roadmap'i yazar (`plans/<slug>/v<N>/`); `/plan-organizatoru` ağaca yerleştirip
`plans/INDEX.*`'ı **TÜRETİR**; `/planla-kos` sıradaki `/goal`'ü tüketip Maestro üzerinden
ateşler. Yüzey (`~/.claude/skills/plan-organizatoru/scripts/`):
`agac.mjs --durum|--gate|--todo|--kunye` · `oturum.mjs tohumla|bu|durum|devir|acilis|global`.

- `plans/INDEX.*` ve `plans/TODO.md` **ASLA elle yazılmaz** (tek yazar `agac.mjs`); `proje`
  slug'ı REZERVEDİR (ana plan tektir).
- **Her plan künye taşır** (`Kategori·Üst·Kritiklik·Aciliyet·Hacim·Hedef`; `oncelik` P0–P3
  TÜREVDİR) ve **kaynak oturumunu beyan eder** (`> Oturum: ot:<YYYY-MM-DD>/<slug>`) —
  eksikse ADVISORY, **biçimi/değeri geçersizse gate FAIL**.
- **Terfi asimetriktir:** oturum todo'su proje düzeyine kendiliğinden çıkmaz; planlar
  istisnasız roadmap'e işler.
- **Oturum devri çift uçlu:** SessionEnd `devir` yazar, SessionStart `acilis` sarkık işi
  ≤12 satır enjekte eder — BİLGİ verir, DAYATMAZ. **Üçüncü uç OTURUM KASASI:** o an AÇIK
  sekmelerin fotoğrafı + yeniden başlatma komutu `plans/oturumlar/kasa/`'ya düşer
  (`soft-resume/scripts/kasa.mjs list|baslat` · özet HASATtır, üretilmez).

Detay: `/Users/ybg/dev/agent-ide/docs/plan-katmani.md` (künye §4b · TODO §4c · oturum §4d)

### 10. `aide rota` — Rotacı: planı kendi yürüten reconciler
Her tick istenen ↔ fiili durumu karşılaştırır: **fark yoksa 0 token harcayıp çıkar**, fark
varsa KAPALI bir tablodan tek eylem seçer, belirsizlikte seçmez — karar DETERMİNİSTİK KOD.
`aide rota kuru --proje .` (ne yapardı; ateşlemez) · `durum`·`doctor`·`defter`. **Hüküm ≠
eylem** (`hakem` ajanının `Edit`'i YOKTUR) · **fan-out yalnız Rotacı'da** · PM kadranı
Rotacı'nın da TAVANIDIR. Detay: `/Users/ybg/dev/agent-ide/docs/rotaci.md`

### 11. Alet katmanı — kit = taşınabilirlik
Aletler **Claude'a değil PROJEYE** aittir: kanon repodadır (`/Users/ybg/dev/agent-ide/packages/kit/`),
`~/.claude` ve `<proje>/.claude` **projeksiyondur**. `aide sync --project ~` · `--kuru` ·
`--yerel <rel>` (yerel KAZANIR) · `--yerel-sil` · `--benimse`. **Kanonu ŞABLON taşır** —
kalıcı değişikliği `packages/kit/templates/`'e işle. K5/Model B: şablon kurulumdan beri
DEĞİŞTİYSE kanon iner (eski hal `sync-yedek/`'e), DURDUYSA yerel kalır, takipsize
dokunulmaz · **kapat ≠ sil**. Detay: `/Users/ybg/dev/agent-ide/docs/kit.md`

### 12. Boot katmanı — makine ayaktayken koşan asgari çekirdek
**BOOT** sistemin AYAKTA OLMASININ ön koşuludur — deterministik, tmux'suz, **sistem
kapalıyken de koşar** (MAESTRO işlerini `aide sistem kapat` durdurur).
`aide boot durum|simdi|doctor|sinif|kapat|ac` — şalter AYRI.
**K1:** `BOOT ⟺ (a) sistemin ayakta olması ona bağlı ∧ (b) deterministik ∧ (c) tmux
gerektirmez`; biri düşerse iş MAESTRO'dur. Manifest **sekiz adım, SIRA SÖZLEŞMEDİR**:
`tasima-once → sync-auto → filing-donan → filing-yaz → oturum-kapat → claudemd-bekci →
susturulmus-nabiz → tasima-sonra` (son ikisi BEKÇİ: bulgu = ALARM, park YOK).
**`aide sistem kapat` boot'u DURDURMAZ** · **borç bırakan her sonuç HATADIR** (`aide tasima`:
commit→fetch→merge→push; çakışmayı motor ÇÖZMEZ). Detay: `/Users/ybg/dev/agent-ide/docs/boot-katmani.md`

### 13. Kurulum + FILING — dosyayı BAĞLAYAN ve bilgiyi TAŞIYAN halkalar
`aide sync` DOSYA dağıtır; **`aide kurulum` onu sisteme BAĞLAR** (hook kayıtları · model
zinciri · PATH) — kayıtsız hook **ölü metindir** ve belirtisi yoktur. **FILING** projenin
kararlarını (hesaba bağlı `~/.claude`'dadırlar) `<proje>/.claude/filing/`'e git-izli
yansıtır: **klasör kanondur, `~/.claude` çalışan kopya.**
`aide kurulum [--kuru]|doctor` · `aide filing durum|<boş>=yaz|donan|kapsam|doktor|teshis`
· `aide kurulum --hepsi`. Yeni profil: `/Users/ybg/dev/agent-ide/bin/aide-kurulum`.

**Fiiller kasten farklı:** `yaz` TAM AYNAdır (silme de yansır — YIKICI), `donan` eksiği
doldurur ve **ASLA ezmez/silmez** · **SIRA sözleşmedir** (`filing-donan` ÖNCE) · **sır kapısı
`yaz`ın içindedir** · HAZIR = içerik kanonda **∧** taşıyıcı git · kurulum **ADDITIVE +
idempotent + yedekli**, bozuk `settings.json` EZİLMEZ.

Detay: `/Users/ybg/dev/agent-ide/docs/kurulum-katmani.md` · `/Users/ybg/dev/agent-ide/docs/filing-katmani.md` ·
`/Users/ybg/dev/agent-ide/docs/vscode-yuzeyi.md` · `/Users/ybg/dev/agent-ide/docs/vscode-statusbar-sozlesmesi.md` ·
`/Users/ybg/dev/agent-ide/docs/proje-panosu.md`

### 14. Commit sözleşmesi + DURUM logu — geçmişi araştırılabilir tutar
**İki sınıf:** **İŞ** commit'ini insan/Claude yazar ("neden"i bilir → sözleşmeye tabi);
**CHECKPOINT**'i motor yazar (`cp(<kapsam>): N dosya · +x/-y` — NE olduğunu diffden TÜRETİR,
"neden" uydurmaz). **Şüphede İŞ.** `aide durum [--kuru|goster]` → `docs/DURUM.md` (TÜREV;
elle düzenleme sapmadır). Diffin tekrarı YASAK · kapsam zorunlu · **12 satır tavanı**.
Detay (zincir DIŞI — gerekince oku): `.claude/aide/docs/commit-sozlesmesi.md` ·
`/Users/ybg/dev/agent-ide/docs/durum-logu.md`

### 15. Seviye 0 — aide KAPALIYKEN de duran taban (envanter + kapı)
Bu tabanı **aide taşımaz, DENETLER · ONARIR · İKAME ETMEZ**. Ne olduğu Seviye 0 maddesinde
(yukarıda); burada **ölçeni** var: `aide seviye0` envanteri her yüzeyin **sınıfını ·
taşıyıcısını · şalterini** ve `[kayıt][dosya]` rozetini basar — **kayıtsız hook ölü metindir
ve BELİRTİSİ YOKTUR** (ölçüldü: üçüncü taraf bir yazar `settings.json → hooks`tan `Stop`
anahtarını komple sildi, dört seviye-0 kaydı sessizce öldü). `aide seviye0 --gate` exit 1
verirse çare TEK ve idempotenttir: **`aide kurulum`**. Uçtan uca kanıt `surus` sınıfındadır
(`aide kanit --artefakt-kontrol` tazeliğini ölçer), çünkü ön koşulu makinenin hâlidir.
Detay: `/Users/ybg/dev/agent-ide/docs/seviye-0.md`

## Terimler

Kanon **`.claude/aide/docs/terimler.md`** (zincirde). Birinci kural: **otomatik olan her şey
deterministik mi agentic mi SÖYLER** — motor·kapı·bekçi·doctor = LLM'siz, 0 token;
ajan·koşucu = LLM.

## Sözleşmeler
- Maestro ile temas YALNIZ `/Users/ybg/dev/agent-ide/jobs/` şeması + `zamanla` CLI üzerinden; meşgul
  pane'e asla enjeksiyon yapılmaz (ateş tavanı aşılırsa deadman global pause).
- `sync` DAĞITIR, `kurulum` BAĞLAR — ikisi de gerekir; kit motoru `settings.json`'a ASLA
  yazmaz, kaydı kurulum katmanı additive birleştirir.
- **Bu dosya ÇEKİRDEKTİR:** yeni yetenek = 2-6 satır öz + tek `Detay:` işaretçisi; ayrıntı
  kendi kanon belgesine gider. Tavan + seviye-0 rezervi (zincir DIŞI — gerekince oku):
  `.claude/aide/docs/claude-md-sozlesmesi.md`.
