# Terimler — aide sözlüğü

> Bu sistemde çok sayıda özel terim var ve çoğu Türkçe uydurma. Bir terimi iki farklı
> anlamda kullanmak, iki farklı sistem kurmakla aynı şeydir. Bu dosya **kanondur**: yeni bir
> belge, komut ya da ajan yazarken terim buradan alınır, yenisi icat edilmez.
>
> **Birinci kural:** otomatik olan HER ŞEY hangi sınıfta olduğunu SÖYLER — `deterministik`
> mi `agentic` mi. Bu ayrım gizlenirse kullanıcı neyin token yaktığını, neyin öngörülebilir
> olduğunu bilemez.
>
> Tarihçe: 2026-10-22'de aide, Agent IDE'den ajan toolkit'ine dönüştü. Arşive giden
> sistemlerin terimleri (BOOT · MAESTRO · filing · AIDE S · kapatıcı · koşucu · şalter ·
> kadran · valf · deadman · kırık · park) bu sözlükten çıkarıldı.

## Sınıf 0 — en temel ayrım: ne LLM doğurur, ne doğurmaz

| terim | anlamı | LLM? | maliyet |
|---|---|---|---|
| **motor** | deterministik kod. Aynı girdi → aynı çıktı. Karar vermez, kural uygular. | **hayır** | ~0 |
| **kapı** (gate) | geçer/geçmez ölçen ve **durduran** denetim. `exit 1` verir. | hayır | ~0 |
| **bekçi** (watchdog) | periyodik ölçüm. **Bulgu = alarm, `exit 0`.** | hayır | ~0 |
| **doctor** | salt-okunur teşhis; eksenlere ayrılmış, her sapmada `onar:` satırı verir. | hayır | ~0 |
| **ajan** (agent) | LLM. Hüküm/analiz üretir. **Yalnız sapmada ya da elle** doğar. | **evet** | token |
| **yüzey** (surface) | kullanıcıya bakan sunum katı — CLI çıktısı · statusline. Veri üretmez, ölçülmüş veriyi ÇİZER. | hayır | ~0 |
| **defter** (ledger) | olay/kayıt deposu — jsonl akışı ya da state dosyası (örn. hedef defteri · claim kayıtları · learnings). Kayıt tutar, karar VERMEZ. | hayır | ~0 |

**Kural:** bir işi motor yapabiliyorsa ajan yapmaz. Ajan, motorun *bilemediği* yerde doğar.

**Çapraz-atıf:** bu tablo bir işin **ne doğurduğunu** söyler; **nerede yaşadığını** Sınıf 1
söyler (taşıyıcı). İki eksen bağımsızdır, o yüzden taşıyıcı bu tabloya sütun olarak eklenmez.

## Sınıf 1 — otomasyonun taşıyıcısı

| terim | anlamı |
|---|---|
| **taşıyıcı** (carrier) | bir otomasyonun NEREDE YAŞADIĞI. Onu kimin çalıştırdığını ve neyin durdurabileceğini belirler. Sınıfı (motor/ajan) belirlemez. |
| **session-yerleşik** | tek canlı taşıyıcı: Claude Code'un kendi yüzeylerine gömülü taban (`CLAUDE.md` talimatı · hook · skill · command · memory). Bir Claude oturumu açıksa çalışır. Onu açan ya da kapatan, Claude Code'un **hook/skill kaydıdır** (`settings.json`). `kit-bootstrap` hook'unun otomatik dağıtımı da bu taşıyıcıdadır. |
| **elle CLI** | kullanıcının ya da ajanın bilerek çağırdığı `aide` komutu (`aide sync` · `aide kurulum` …). Kendiliğinden koşmaz; bu yüzden ayrı bir taşıyıcı sayılmaz, çağrının kendisidir. |
| **seviye 0** | otonomi merdiveninin EN ALT basamağı: session-yerleşik taşıyıcıya gömülü, human-driven development sırasında bile koşan taban. Doktrin: **üst katman (aide) bu tabanı DENETLER, ONARIR, İKAME ETMEZ.** Talimat bacağı ana loop context'inden ödenir, bu yüzden `CLAUDE.md` bütçesine tabidir. |

Session-yerleşik taşıyıcının ölçeni **`aide kurulum doctor`**'dur. Komut dosya VARLIĞINI ve
Claude Code KAYDINI ayrı ölçer, çünkü **kaydı olmayan hook ölü metindir**.

**Taşıyıcı yetki AÇMAZ.** Taşıyıcı yalnız *"nerede yaşar"* sorusunu yanıtlar; bir işin ne
yapmaya izinli olduğunu belirlemez.

**Muafiyet (ilanlı):** aide-DIŞI tetikleyiciler (`crontab` · launchd · dış CI) burada
sınıflandırılmaz. Onları aide'ın taşıyıcısı saymak, kapatma anahtarını aide'da sanma yanılgısı
üretirdi.

## Sınıf 2 — bilginin sınıfları (ne taşınır)

| terim | anlamı | handover'da |
|---|---|---|
| **BİLGİ** | karar · beceri · yapılandırma. Kaybı geri alınamaz. | **taşınır** |
| **DURUM** | makineye/orana bağlı (pid · cache · session · log). | taşınmaz |
| **TÜREV** | kaynağından yeniden üretilir (örn. plan INDEX'i ← plan ağacı). | taşınmaz |
| **SIR** | kimlik bilgisi (`.env` · token · anahtar). | **asla** |
| **KİT** | alet (skill · agent · hook · belge) — kit şablonundan kurulur. | taşınır, ama kit'le |
| **TALİMAT** | modelin DAVRANIŞINI değiştiren emir — `CLAUDE.md`'nin tek meşru içeriği. | taşınır |

**TALİMAT ≠ BİLGİ, ve ayrım pahalıdır.** `CLAUDE.md` ve `@` ile çektiği her belge o
projedeki **her isteğe** girer; BİLGİ oraya konduğunda bedeli her oturumda yeniden ödenir.
Ayıran tek soru: *"bu satır silinseydi model YANLIŞ DAVRANIR mıydı, yoksa yalnızca
BİLGİSİZ mi kalırdı?"* Yanlış davranırsa TALİMATTIR ve `CLAUDE.md`'de yaşar. Bilgisiz
kalırsa BİLGİDİR; kendi dosyasında yaşar ve `CLAUDE.md`'ye tek satır **atıf** düşer.
Sözleşme: `.claude/aide/docs/claude-md-sozlesmesi.md`.

## Sınıf 3 — kanon ve vendor  ⭐ *en çok karıştırılan yer*

Tek yön vardır: **kanon** → **çalışan kopya**. `aide sync` (ya da arka planda `kit-bootstrap`)
kanonu her projeye ve `~/.claude`'a dağıtır. Çalışan kopyada yapılan düzeltme kanona
kendiliğinden geri AKMAZ; kanona elle işlenir.

| terim | anlamı |
|---|---|
| **kanon** | tek doğru kaynak. Alet için `agent-ide/packages/kit/` (`kit.json` · `templates/` · `hooks-registry.json`). |
| **çalışan kopya** | kanondan kurulan, ajanın günlük kullandığı hâl (`~/.claude` ve `<proje>/.claude/`). Elle düzenlenirse sapma doğar. |
| **yerel sapma** (preserved-drift) | çalışan kopyada kanona işlenmemiş yerel emek. Şablon değişmediyse `aide sync` onu korur ve raporlar; şablon da değiştiyse şablon kazanır, eski hâl yedeğe gider. Ölçeni `/aide-saglik`. |
| **vendor** | aide'ın kanonunu TÜKETEN ajan ürünü (`claude` · `codex`). Kapalı küme. `claude` her zaman açıktır; ek her vendor `config.json → vendors.<v>.enabled` ile açılır ve **varsayılanı KAPALI**dır. |
| **projeksiyon** | kanonun bir vendor ÇERÇEVESİNE deterministik çevirisi (0 token). Üç katman: **yol** (`vendorRel`) · **içerik** (projektör) · **kayıt** (hook emitter). Gövde aynen geçer, değişen yalnız çerçevedir. Detay: agent-ide `docs/vendor-katmani.md`. |

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
| **nabız** (pulse) | ham olay akışı: her `TodoWrite`'ı `goal-tracker` hook'u `~/.claude/kaptan/goals/` veri dizinine yazar (dizin adı tarihseldir). Görev listesi elle tutulmaz, oturum hedef defterinden **türetilir**. |
| **DURUM bloğu** | tur sonunda basılan prompt sözleşmesi: *şu an ne koşuyor · neyi/kimi bekliyorum · SENDEN ne isteniyor*. Kanon `~/.claude/CLAUDE.md`. Yazan modeldir, ama olguları (sahip · sıra · kuyruk) deterministik komutlardan **ölçer**, hatırlamaz. |
| **claim / kilit** | paylaşılan kaynağı yazmadan önce alınan hak (`eszamanli`). Canlılık **pid** ile ölçülür, süreyle değil. |
| **bayatlık** | kilidin tazeliği — canlılıktan AYRI eksen. Kilidi SİLMEZ, **devir hakkı** doğurur. |
| **devir işareti** | devredilen İŞİN kalıcı kaydı (`claims/<repo>/devir/`). **Kuyruk işareti** (ömürlü) ve **devir notu** (oturum) ile aynı şey DEĞİLDİR. |
| **limit devri** | askıdaki sahibin KENDİ kilitlerini bırakması (üçüncü taraf biçemez). |
| **stop dalı** | `goal-tracker.mjs stop` — açık iş bırakıp erken duran oturumu BİR KEZ geri çeviren motor (0 token · session-yerleşik). Açık işin TEK kaynağı hedef defteridir (todo + `/goal`); **şüphe SERBEST BIRAKMA yönünedir.** Kademe `kaptan/stop-dali.json → kapsam`; kullanıcı kesmesi yapısal olarak MUAFTIR. |
| **soft-resume** (yumuşak devam) | kapalı/başka-hesap oturumunun transcript'inden damıtılan brifle TAZE oturumda devam (hard `--resume`'un taşınabilir karşılığı). Toplama motor, damıtma ajan. **Damıtan hep DEVRALANdır**: kapatan taraf agentic iş yapmaz. |
| **learning (öğrenim)** | yol boyunca karşılaşılan, önden talimat olarak düşünülmemiş DERS. `/learnings` defterinde HAM biriktirilir (`prensip`·`yatkinlik`·`tuzak`·`kural-adayi`·`kesif`); sisteme işlenmesi AYRI ve ELLE bir süreçtir. **Bayatlamaz.** |

## Sınıf 6 — plan katmanı  → kanon zincir DIŞINDA

Plan katmanının TAM sözlüğü **`docs/plan-katmani.md` § 4e**'dedir. Sayı ve liste orada yaşar,
burada TEKRARLANMAZ, çünkü ikinci kopya yalanlaşır (ölçüldü: 21 terimlik özet, §4e 27'ye
çıkınca bayatladı). Yeni bir plan-katmanı terimi ORAYA eklenir; yazım sözleşmesi md.6 oraya
da uygulanır.

## Yazım sözleşmesi

Yeni bir otomatik yüzey (komut · adım · iş · hook) eklerken:

1. **Sınıfını söyle:** çıktısında ya da belgesinde `deterministik` mi `agentic` mi geçsin.
2. **Maliyetini söyle:** 0 token mu, ajan mı doğuruyor.
3. **Taşıyıcını söyle:** session-yerleşik mi (hangi hook/skill kaydı onu çalıştırıyor), yoksa
   yalnız elle CLI ile mi koşuyor. Söylenmemiş taşıyıcı, "kapattım ama hâlâ koşuyor"
   (ya da tersi) şaşkınlığının tek kaynağıdır.
4. **Sapmasında `onar:` ver:** çaresi olmayan alarm, alarmı köreltir.
5. **Muafiyetini ilan et:** ölçmediğin şeyi yazılı olarak muaf tut.
6. **Terimi buradan al.** Yeni terim gerekiyorsa önce bu dosyaya ekle.
