# Terimler — aide sözlüğü

<!-- kanit-damga kaynak: ~/dev/agent-ide/packages/core/src/bilgi.ts, ~/dev/agent-ide/packages/core/src/bilgi-sinif.ts, ~/dev/agent-ide/packages/core/src/boot.ts, ~/dev/agent-ide/packages/core/src/pencere.ts sha: 1e4528f007f62764 -->

> Bu sistemde çok sayıda özel terim var ve çoğu Türkçe uydurma. Bir terimi iki farklı
> anlamda kullanmak, iki farklı sistem kurmakla aynı şeydir. Bu dosya **kanondur**: yeni bir
> belge/komut/ajan yazarken terim buradan alınır, yenisi icat edilmez.
>
> **Birinci kural:** otomatik olan HER ŞEY hangi sınıfta olduğunu SÖYLER — `deterministik`
> mi `agentic` mi. Bu ayrım gizlenirse kullanıcı neyin token yaktığını, neyin öngörülebilir
> olduğunu bilemez.

## Sınıf 0 — en temel ayrım: ne LLM doğurur, ne doğurmaz

| terim | anlamı | LLM? | maliyet |
|---|---|---|---|
| **motor** | deterministik kod. Aynı girdi → aynı çıktı. Karar vermez, kural uygular. | **hayır** | ~0 |
| **kapı** (gate) | geçer/geçmez ölçen ve **durduran** denetim. `exit 1` verir. | hayır | ~0 |
| **bekçi** (watchdog) | periyodik ölçüm. **Bulgu = alarm, `exit 0`** — kendi bulgusuyla park olmaz. | hayır | ~0 |
| **doctor** | salt-okunur teşhis; eksenlere ayrılmış, her sapmada `onar:` satırı verir. | hayır | ~0 |
| **kapatıcı** (closer) | işini bitirmiş bir ajanın penceresini **kanıtla** kapatan motor. Kanıt yoksa oturum YAŞAR. | hayır | ~0 |
| **ajan** (agent) | LLM. Hüküm/analiz üretir. **Yalnız sapmada ya da elle** doğar. | **evet** | token |
| **koşucu** (runner) | uzun ufuklu, kendi başına ilerleyen ajan oturumu. | evet | token |
| **yüzey** (surface/UI) | kullanıcıya bakan render/sunum katı — CLI çıktısı · pano · webview · TUI paneli. Veri üretmez, projeksiyonu ÇİZER. Sınıf 3'teki filing-"yüzey (surface) = taşınan kalem" AYRI terimdir — bağlam ayrımı İLANLI. | hayır | ~0 |
| **defter** (ledger) | olay/kayıt deposu — jsonl akışları · not deposu · state dosyaları (örn. alerts.jsonl · rota defteri). Kayıt tutar, karar VERMEZ. | hayır | ~0 |

**Kural:** bir işi motor yapabiliyorsa ajan yapmaz. Ajan, motorun *bilemediği* yerde doğar.

**Çapraz-atıf:** bu tablo bir işin **ne doğurduğunu** söyler; **nerede yaşadığını** Sınıf 1
söyler (taşıyıcı). İki eksen bağımsızdır — motor da ajan da üç taşıyıcının herhangi birinde
durabilir, o yüzden taşıyıcı bu tabloya sütun olarak eklenmez.

## Sınıf 1 — otomasyonun taşıyıcıları (üç kova)

| terim | anlamı | şalteri | LLM doğurur mu |
|---|---|---|---|
| **session-yerleşik** (*seviye 0*) | Claude Code'un KENDİ yüzeylerine gömülü taban (`CLAUDE.md` talimatı · hook · skill · memory · command). Bir Claude oturumu açıksa çalışır; **`aide sistem` de `aide boot` da onu DURDURMAZ**. Şalteri Claude Code'un kendi **hook/skill KAYDI**dır (`settings.json`). | Claude Code kaydı (`aide kurulum`) | taşıdığına göre — hook'un kendisi deterministik, taşıdığı talimat ajanı yönlendirir |
| **BOOT** (*boot-taşınan*) | sistemin AYAKTA OLMASININ ön koşulu. Deterministik, tmux'suz. Sistem kapalıyken **de** koşar. | `aide boot` | asla |
| **MAESTRO** (*maestro-taşınan*) | zamanlı/koşullu iş kuyruğu. tmux'a dokunur, ajan doğurabilir. | `aide sistem` | olabilir |

`BOOT ⟺ (a) sistemin ayakta olması ona bağlı ∧ (b) deterministik ∧ (c) tmux gerektirmez`.
Üçünden biri düşerse iş MAESTRO'dur. Ölçen komut: `aide boot sinif`.

**K1'in kapsamı DARdır (ilanlı):** bu yüklem yalnız **boot ↔ maestro** ayrımını ölçer;
session-yerleşik kovanın ölçeni ayrıdır — **`aide kurulum doctor`** (dosya VARLIĞI ile Claude
Code KAYDINI ayrı ölçer, çünkü **kaydı olmayan hook ölü metindir**).

| terim | anlamı |
|---|---|
| **taşıyıcı** (carrier) | bir otomasyonun NEREDE YAŞADIĞI: `session-yerleşik` · `boot-taşınan` · `maestro-taşınan`. Şalterini, hayatta kalma koşulunu ve kimin durdurabileceğini belirler. Sınıfı (motor/ajan) belirlemez. |
| **seviye 0** | otonomi merdiveninin EN ALT basamağı: session-yerleşik taşıyıcıya gömülü, human-driven development sırasında bile koşan baseline. Doktrin: **üst katman (aide) bu tabanı DENETLER, ONARIR, İKAME ETMEZ.** Talimat bacağı ana loop context'inden ödenir → `CLAUDE.md` bütçesine tabidir. |

**Taşıyıcı ekseni ORTOGONALDİR ve KADRAN DEĞİLDİR** — *"nerede yaşar"* sorusu, sınıfın
*"ne doğurur"*undan ve şalterin *"ne zaman susar"*ından bağımsızdır. Taşıyıcı **yetki AÇMAZ**;
yetki tek yerden gelir: **kadran** (`gozlem|yesil|tam`) ve 🔴 valf. Kanıt:
`docs/kesifler/2026-07-27-dogmamis-dort-tasarim/01-otonomi-kontrol-v2.md` § R4.

**Muafiyet (ilanlı):** aide-DIŞI taşıyıcılar (`crontab` · launchd `KeepAlive` · dış CI) bu üç
kovaya girmez ve burada sınıflandırılmaz — şalteri aide'da sanma yanılgısı üretirdi.

## Sınıf 2 — bilginin sınıfları (ne taşınır)

| terim | anlamı | handover'da |
|---|---|---|
| **BİLGİ** | karar · beceri · yapılandırma. Kaybı geri alınamaz. | **taşınır** |
| **DURUM** | makineye/orana bağlı (pid · cache · session · log). | taşınmaz |
| **TÜREV** | kaynağından yeniden üretilir (`model.json` ← goals). | taşınmaz |
| **SIR** | kimlik bilgisi (`.env` · token · anahtar). | **asla** |
| **KİT** | alet (skill · agent · hook · kılavuz) — kit şablonundan kurulur. | taşınır, ama kit'le |
| **TALİMAT** | modelin DAVRANIŞINI değiştiren emir — `CLAUDE.md`'nin tek meşru içeriği. | taşınır |

Ölçen komut: `aide filing kapsam` — **sınıfsız yol kalırsa `exit 1`**.

**TALİMAT ≠ BİLGİ, ve ayrım pahalıdır.** `CLAUDE.md` ve `@` ile çektiği her belge o
projedeki **her isteğe** girer; BİLGİ oraya konduğunda bedeli her oturumda yeniden ödenir.
Ayıran tek soru: *"bu satır silinseydi model YANLIŞ DAVRANIR mıydı, yoksa yalnızca
BİLGİSİZ mi kalırdı?"* — yanlış davranırsa TALİMAT (`CLAUDE.md`'de yaşar), bilgisiz
kalırsa BİLGİ (kendi dosyasında yaşar, `CLAUDE.md`'ye tek satır **atıf** düşer).
Sözleşme: `.claude/aide/docs/claude-md-sozlesmesi.md` · ölçen kapı: `aide claudemd`.

## Sınıf 3 — İKİ YER, İKİ YÖN  ⭐ *en çok karıştırılan yer*

Yalnız **iki yer** vardır: **çalışan kopya** `~/.claude` (hesaba bağlı, hesap değişince GİDER)
ve **kanon** `<proje>/.claude/filing/` (git'te, KALIR). İki yön: `aide filing yaz` çalışandan
klasöre, `aide filing donan` klasörden çalışana. Detay: `docs/filing-katmani.md`.

| terim | anlamı |
|---|---|
| **filing** | projenin kendi Claude bilgisinin klasördeki dosyalanmış hâli (`<proje>/.claude/filing/`, git-izli). **Tek doğru kaynak.** |
| **kanon** | genel ilke: tek doğru kaynak. Filing'de klasör, alette `packages/kit/`. |
| **çalışan kopya** | Claude'un günlük kullandığı hâl (`~/.claude`). Hesaba bağlı — değişince gider. |
| **`filing yaz`** | çalışan kopya **──▶ KLASÖR**. Tam ayna: silme de yansır, sır elenir. YIKICI. |
| **`filing donan`** | **KLASÖR ──▶** çalışan kopya. Yeni hesap buradan donanır. **Asla ezmez, asla silmez.** |
| **yüzey** (surface) | taşınan bir kalem (`memory`, `pm-persona`, `plan-mode` …). **Sayı yazılmaz** — tek ölçüsü `bilgi.ts → YUZEYLER` (2026-08-10: 19 girdi = 17 ⊕ 2 şaltere-tabi codex). (Sınıf 0'daki render-katı "yüzey"den AYRIDIR.) |
| **vendor** | aide'ın kanonunu TÜKETEN ajan ürünü (`claude` · `codex`). Kapalı küme. `claude` şaltersizdir — taşıyıcının kendisidir; ek her vendor `config.json → vendors.<v>.enabled` ile açılır ve **varsayılanı KAPALI**dır. |
| **projeksiyon** | kanonun bir vendor ÇERÇEVESİNE deterministik çevirisi (0 token). Üç katman: **yol** (`vendorRel`) · **içerik** (projektör) · **kayıt** (hook emitter). Gövde passthrough, değişen yalnız çerçeve. Detay: `docs/vendor-katmani.md` |
| **ayrık kanon** | her kanon dosyasının TEK sahip yüzeyi olması kuralı — `filing yaz` tam ayna olduğu için iki vendor aynı dizine aynalasa biri ötekini silerdi (vendor yüzeyleri `filing/vendor/<v>/` altına rezerve). |
| **ayna** (mirror) | hedefi kaynağın birebir kopyası yapmak — **yokluk da kopyalanır** (silme yansır). |
| **çakışma** | iki yanda da (son mutabakattan beri) değişmiş dosya. Otomatik çözülmez; raporlanır, insan karar verir. Ölçütü **taban defteri** verir. |
| **taban defteri** | son başarılı `yaz`/`donan` anında iki ucun eşit olduğu dosyaların hash kaydı (`~/.claude/filing-taban/` — DURUM). Üçlü karşılaştırmayı mümkün kılar; **taban yoksa motor temkinliye düşer** (fark = çakışma). |
| **devir** | pencere kapanırken yapılan `filing yaz`. |
| **transition blok** | devir bitmeden yeni pencerenin **hiçbir şey yazamaması**. |

**Hafıza kuralı:** *yaz* = dışarı (klasöre dosyala), *donan* = içeri (klasörden kuşan).
Fiiller kasten farklı: `yaz` yıkıcıdır (ayna), `donan` asla yıkmaz.

**`aide` sistemin adıdır, `filing` bu katmanın adı.** Karıştırma: `aide sync`/`aide boot`
sistemin işleri; `aide filing …` projenin kendi bilgisiyle ilgilenir. (Eski adlar —
`bilgi topla`/`kanon yaz` → `filing yaz` · `bilgi kur`/`kanon al` → `filing donan` — çalışır
ama yeni adı söyler.)

## Sınıf 4 — denetim ve hüküm

| terim | anlamı |
|---|---|
| **sapma** (drift) | olması gereken ile olan arasındaki fark. Her sapmanın bir `onar:` satırı olmalı. |
| **hüküm** (verdict) | bir denetimin sonucu (`TAM` · `EKSİK` · `STUCK`). **Hüküm ≠ eylem**: hükmü yazan, eylemi yapmaz. |
| **kanıt** (evidence) | hükmün altındaki ölçüm çıktısı. Kanıtsız hüküm, tahmindir. |
| **damga** (stamp) | belgenin anlattığı kodun içerik hash'i. Kaynak değişince belge "doğrulanmamış" olur. |
| **kör nokta** | ölçülmeyen alan. **İlan edilmemiş kör nokta = yalanlaşan iddia.** |
| **muafiyet** | bilinçli kapsam dışı. Sessiz kırpma yasak: muafiyet İLAN edilir ve gerekçelenir. |
| **parmak izi** (fingerprint) | "değişti mi?" sorusunun ucuz cevabı. Eşitse adım hiç koşmaz (0 maliyet). |
| **imza** (signature) | bir işi kimliklendiren komut deseni; çift-koşum bununla yakalanır. |

## Sınıf 5 — akış ve kontrol

| terim | anlamı |
|---|---|
| **nabız** (pulse) | ham olay akışı (her `TodoWrite` → `kaptan/goals`). Görev listesi elle tutulmaz, nabızdan **türetilir**. |
| **DURUM bloğu** | tur sonunda basılan prompt sözleşmesi: *şu an ne koşuyor · neyi/kimi bekliyorum · SENDEN ne isteniyor*. Kanon `~/.claude/CLAUDE.md`. Yazan modeldir, ama olguları (sahip · sıra · job state) deterministik komutlardan **ölçer**, hatırlamaz. **DURUM logu ile ilgisi yoktur.** |
| **DURUM logu** | `docs/DURUM.md` — `aide durum` motorunun ürettiği TÜREV belge (künye · iş commit'leri · plan durumu). Deterministik, 0 token; elle düzenlenmesi sapmadır. |
| **şalter** (switch) | bir katmanı bütünüyle açıp kapatan tek anahtar. `aide sistem` · `aide boot`. |
| **valf** (valve) | geri alınamaz eylemin önündeki onay kademesi. 🔴 kırmızı işi **yalnız insan** onaylar. |
| **kadran** (dial) | otonomi seviyesi: `gozlem` (gör, dokunma) · `yesil` (güvenli işi yap) · `tam`. |
| **claim / kilit** | paylaşılan kaynağı yazmadan önce alınan hak. Canlılık **pid** ile ölçülür, süreyle değil. |
| **bayatlık** | kilidin tazeliği — canlılıktan AYRI eksen. Kilidi SİLMEZ, **devir hakkı** doğurur. |
| **devir işareti** | devredilen İŞİN kalıcı kaydı (`claims/<repo>/devir/`) — **kuyruk işareti** (ömürlü) ve **devir notu** (oturum) ile aynı şey DEĞİL. |
| **limit devri** | askıdaki sahibin KENDİ kilitlerini bırakması (üçüncü taraf biçemez). |
| **park** | bir işin arıza sebebiyle durdurulması. Bekçi **kendi bulgusuyla park olmaz**. |
| **deadman** | ateş tavanı aşılınca devreye giren global durdurucu. |
| **kırık** (zombi) | **açık ama işlevsiz** koşum; ölümün aksine GÖRÜNMEZ (pencere duruyor, kayıt "koşuyor" diyor, iş ilerlemiyor). Ölü DEĞİL, biten DEĞİL. Sınıfları `kimlik`·`limit`·`yanitsiz`·`kanitsiz`; envanter `aide kirik` (motor · 0 token). Detay: `docs/kirik-kosum.md`. |
| **soft-resume** (yumuşak devam) | kapalı/başka-hesap session'ının transcript'inden damıtılan brifle TAZE oturumda devam (hard `--resume`'un taşınabilir karşılığı). Toplama motor, damıtma ajan — **damıtan hep DEVRALANdır**: kapatan taraf agentic iş yapmaz. |
| **stop dalı** | `goal-tracker.mjs stop` — açık iş bırakıp erken duran oturumu BİR KEZ geri çeviren motor (0 token · session-yerleşik). Açık işin TEK kaynağı hedef defteri (todo + `/goal`); **şüphe SERBEST BIRAKMA yönünedir.** Kademe `kaptan/stop-dali.json → kapsam`; kullanıcı kesmesi MUAF (yapısal). Detay: `docs/seviye-0.md`. |
| **yedek yüklemi** | daemonun ne zaman devrede olduğunun TEK ölçütü olan kapalı yüklem: `YEDEK_DEVREDE ⟺ saat-güdümlü∧olay-karşılıksız ∨ rol-oturumu-yok ∨ oturum-kırık`. Kanonu `docs/otonomi-merdiveni.md` §4.1 (İŞARETÇİ — kopyalanmaz); kod-içi hâli `yedek-yuklemi.ts`, yüzeyi `aide otomasyon durum` yedek ekseni (BİLGİ — kök hükme sızmaz). Sınıf: yüklem/motor · 0 token. |
| **ilanlı bekleme** | "yedek GEREKLİ ∧ daemon kapalı" hâlinin ALARM DEĞİL KAYIT olarak basılması (K-OO1 sıra kararının görünür izi) — `onar:` satırı TAŞIMAZ: çare metronomu açmak değil, kararın kendisidir. Kalıcı kırmızı yerine ilan: alarm körelmesinin panzehiri. |

## Sınıf 5b — AIDE S  → kanon zincir DIŞINDA

AIDE S'in (karargâh · harita · koşum · hakem · triaj) TAM sözlüğü **`docs/aide-l.md`**'dedir
(Mod 1) ve **`docs/aide-l-zamanlama.md`**'de (zamanlama katmanı). Sınıf 6 emsali: **burada liste
YOK, çünkü ikinci kopya yalanlaşır.**

Zincirde yalnız DAVRANIŞ DEĞİŞTİREN üç kural kalır — gerisi işaretçiye iner:

| terim | tek cümle |
|---|---|
| **karargâh** | vizyon+plan masası. Anayasası `KURALLAR.md`⊕`ilkeler.md`⊕`KUZEY.md`; onu DEĞİŞTİREMEZ. Çelişen girdiyi REDDETMEZ, BEKLETİR. |
| **hüküm zinciri** | H1 plan kalitesi (giriş) · H2/H3 iş (toggle'lı) · H4 tamamlandı (çıkış). **H1 ve H4 kapatılamaz**; H2/H3 kapalıysa teslim `öz-onay:<kademe>` damgası taşır. |
| **⊤ (beyansız)** | `dokunur:` beyanı olmayan iş. **Yapı değil POLİTİKA**: harita onu kendi kanalına koyar, temkin dağıtımda uygulanır. |

Yeni bir AIDE S terimi ORAYA eklenir (yazım sözleşmesi md.6 oraya da uygulanır).

## Sınıf 6 — plan katmanı  → kanon zincir DIŞINDA

Plan katmanının TAM sözlüğü **`docs/plan-katmani.md` § 4e**'dedir (taşıma anında 21 terimdi;
bugün daha fazla — sayı ve liste **§ 4e'de yaşar, burada TEKRARLANMAZ**).

**Burada liste YOK, çünkü ikinci kopya yalanlaşır** (ölçüldü: 21 terimlik özet, §4e 27'ye
çıkınca bayatladı). **Sayı SÖZLEŞME değil ÖZETtir**; tek ölçüsü §4e'nin kendisidir:
`awk '/^## 4e\./{f=1} f&&/^## /&&!/^## 4e\./{f=0} f' docs/plan-katmani.md | grep -cE '^\| \*\*'`

Terim kanonu kuralı KIRILMADI, YERİ değişti: yeni bir plan-katmanı terimi ORAYA eklenir
(yazım sözleşmesi md.6 oraya da uygulanır). **Zincirde çekirdek kalır, ayrıntı işaretçiye iner**
(K3 doktrini; taşıma 2026-07-30, seviye-0-otonomi v1 aşama-10, kullanıcı kararı K10-1 —
ölçülen bedel 4.959 B ≈ ~1.550 token/istek).

## Yazım sözleşmesi

Yeni bir otomatik yüzey (komut · adım · iş · hook) eklerken:

1. **Sınıfını söyle:** çıktısında ya da belgesinde `deterministik` mi `agentic` mi geçsin.
2. **Maliyetini söyle:** 0 token mu, ajan mı doğuruyor.
3. **Taşıyıcını söyle:** `session-yerleşik` mi `boot-taşınan` mı `maestro-taşınan` mı —
   yani hangi şalter onu susturur. Söylenmemiş taşıyıcı, "kapattım ama hâlâ koşuyor"
   (ya da tersi) şaşkınlığının tek kaynağıdır.
4. **Sapmasında `onar:` ver:** çaresi olmayan alarm, alarmı köreltir.
5. **Muafiyetini ilan et:** ölçmediğin şeyi yazılı olarak muaf tut.
6. **Terimi buradan al.** Yeni terim gerekiyorsa önce bu dosyaya ekle.

