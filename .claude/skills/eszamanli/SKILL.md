---
name: eszamanli
description: Aynı repoda EŞZAMANLI çalışan birden çok Claude session'ının çakışma protokolü — kapsamlı bir iş sürerken başka session küçük bir değişiklik yapıyorsa, onun bitmesini bekleyip bloke olan parçayı İZOLE eder, geri kalan işleri yapar, kaynak boşalınca uyanıp kaldığı yerden devam eder. Kaynağı (dosya · glob · mantıksal: DB, yayın, saved-design) claim'ler, bitince bırakır; kilitleri, kimin ne tuttuğunu ve bekleyen kuyruğunu gösterir. Kullanıcı "başka session çalışıyor", "çakışma", "kilit", "claim", "aynı anda iki session", "birbirini eziyor" dediğinde; bir yazım ÇAKIŞMA KİLİDİ ile reddedildiğinde; uzun/yıkıcı bir işe başlamadan önce başka canlı session varken; veya /eszamanli çağrıldığında kullan.
rol: ajan
---

# Eşzamanlı session protokolü

<!-- kanit-damga kaynak: packages/kit/templates/hooks/claims-lib.mjs, packages/kit/templates/hooks/claim-guard.mjs, packages/kit/templates/skills/eszamanli/scripts/claim.mjs sha: 553bb79553535bef -->

İki Claude session'ı aynı repoda çalışırken birbirinin yazdığını ezer. Bu protokol
çakışmayı **imkânsız** kılar (sert kapı) ve bloke olan session'ı **durdurmaz** (izole et,
devam et, sonra dön).

## İki katman

| katman | dosya | ne yapar |
|---|---|---|
| **sert kapı** (hook) | `~/.claude/hooks/claim-guard.mjs` | Başkasının canlı claim'ine Edit/Write/NotebookEdit ve eşleşen Bash'i **DENY** eder. Model unutsa da çakışma olmaz. |
| **protokol** (bu skill) | `~/.claude/skills/eszamanli/scripts/claim.mjs` | Claim al/bırak, kim ne tutuyor, boşalınca uyan. |

Kapı ve CLI **aynı kütüphaneyi** (`~/.claude/hooks/claims-lib.mjs`) okur — kapının okuduğu
ile aracın yazdığı tek kaynaktır; iki implementasyon drift üretir.

## Ne zaman claim alınır

Claim **zorunlu değildir** — tek session çalışırken sıfır sürtünme olmalı. Al:

- **Başka canlı session varken** (SessionStart/prompt'ta `[eşzamanlılık]` notu görürsen) ve
  yazacağın kaynak paylaşılıyorsa;
- **Uzun/çok adımlı** bir iş bir kaynağı adım boyunca kımıldatacaksa (kaynak dosya + build +
  state birlikte hareket ediyorsa);
- **Yıkıcı/geri alınamaz** bir şey yapmadan önce (yayın, DB yazımı, checkpoint restore, toplu
  codemod) — burada claim ZORUNLUDUR.

Almadan önce bak: `node ~/.claude/skills/eszamanli/scripts/claim.mjs status`

## Komutlar

```bash
S=~/.claude/skills/eszamanli/scripts/claim.mjs
node $S resources                       # bu repoda tanımlı mantıksal kaynaklar
node $S status                          # kim ne tutuyor + canlı session'lar
node $S claim --res dc-html --intent "Ders 9 onChange düzeltmesi" --breadth broad
node $S release --res dc-html           # İŞ BİTİNCE — unutma
node $S release --all                   # tüm claim'lerini bırak (+ beklediklerinden vazgeç)
node $S wait --res dc-html              # run_in_background: sıra sana gelince kilidi ALIR
node $S free --res dc-html              # KİMLİKSİZ sonda: devralınabilir mi? (exit 0/1)
node $S devret --res dc-html --gorev "…" # parça B'yi DEVRET (Maestro + kalıcı işaret — çift yol)
node $S devir list [--json]             # devralınmayı bekleyen devredilmiş işler
node $S devir al --id <id>              # işi ATOMİK üstlen (tek kazanan; kaybeden koşmaz)
node $S limit-devir [--kuru]            # BEN limitliyim → kilitlerimi devret
node $S gc                              # stale kilitleri biç
```

Kaynak anahtarı üç türden biri: **mantıksal** (`dc-html`, `publish`, `db:media_slot` —
`<repo>/.claude/claims-resources.json`'da tanımlı), **glob** (`scripts/.gorsel/**`),
ya da **yol** (`scripts/_pw.cjs`, `~/.claude/pm/ayar.json`). Yol anahtarı kanonikleştirilir:
`./src/a.ts`, `src/a.ts` ve mutlak yazımı **aynı** kilittir (üç yazım üç ayrı kilit olsaydı
koruma diye bir şey olmazdı).

`release` iki iş görür: sahipsen **bırakır**, sıradaysan **vazgeçersin**. Vazgeçme yolu
şarttır — kuyrukta unutulmuş bir istek sırayı yalanlar.

## BLOKE OLUNCA: PARÇALA — A şimdi, B kaynak devralınınca

Kapı bir yazımı `ÇAKIŞMA KİLİDİ` ile reddettiğinde ya da `claim` `MEŞGUL` dediğinde
(exit 3) iş DURMAZ; **ikiye bölünür**:

1. **PARÇALA.** Bloke kaynağa dokunan adımları **parça B** olarak ayır; geri kalan her şey
   **parça A**'dır. B'yi `TodoWrite` ile `beklemede — <kaynak> (devralınınca)` işaretle
   (madde kaybolmaz; kaptan panosunda da görünür — nabız = TodoWrite hook'u). Bölme çizgisi
   kaynaktır, iş sırası değil: B **kendi başına koşulabilir** olmalı (bağlamını içinde taşır),
   çünkü onu koşacak tur — hatta oturum — bu olmayabilir.
2. **Parça A'yı ŞİMDİ yap.** O kaynağa dokunmayan her şey serbest: başka dosyalar, analiz,
   kanıt yazımı, doküman. Bekleyen kaynak yüzünden serbest işi bekletmek, kilidin kendisinden
   pahalıdır.
3. **Parça B'yi teslim yoluna bağla** — iki yol var, ölçüt "bu oturum işi görecek mi":

   | yol | sıra | oturum | ne zaman |
   |---|---|---|---|
   | **`wait`** (canlı bekleyiş) | **tutar** (aktif bekleyici) | yaşamalı | varsayılan — B bu oturumda bitecekse |
   | **`devret`** (Maestro devri) | tutmaz (işaret) | ölebilir | oturum kapanacak / B bağımsız koşabilir |

   **`wait`** — sırada yer tutmanın TEK yolu:
   ```
   Bash(run_in_background: true):
     node ~/.claude/skills/eszamanli/scripts/claim.mjs wait --res "<kaynak>" --intent "<parça B>"
   ```
   Komut **çıkınca** harness seni yeniden çağırır; kaynak **zaten senindir** (bekleyen süreç
   kilidi senin adına alır) ve çıktı `--intent`'i geri söyler — ne için beklediğin uyanışta
   yazılıdır. Beklemedeki maddeyi bitir, bırak.

   **`devret`** — bekleyiş süreçte değil iş kuyruğunda taşınır:
   ```
   node ~/.claude/skills/eszamanli/scripts/claim.mjs devret --res "<kaynak>" --gorev "<parça B tarifi>"
   ```
   Maestro'ya `when-shell` işi yazar (koşul = `free` sondası: kaynak serbest ∧ aktif bekleyen
   yok — kimliksiz, deterministik, 0 token); kaynak devralınabilir olunca iş ateşlenir ve
   ateşlenen session claim'i **kendisi alır** (önsözü komut yazar). Oturumun yaşaması
   gerekmez — "part B kuyruktan gelince" sözünün oturum-ötesi hali. `--kuru` ile önce ne
   yazacağını gör. Devir **ajan doğuracak** bir iş yazar (ateş anında, Maestro kaydında
   görünür); `wait` ise 0 token'dır — canlıysan onu seç.

   **Devir ÇİFT YOLLUDUR — Maestro ölüyken de iş kaybolmaz.** Eskiden tek taşıyıcı Maestro'ydu:
   `aide` yoksa/kuyruk kapalıysa komut **exit 5** ile ölür, iş de onunla giderdi — yani metronom
   KİLİTLİ olduğu dönemde (en çok gerektiği anda) devir hiç çalışmıyordu. Artık:

   | yol | taşıyıcı | ömür | ne zaman devralınır |
   |---|---|---|---|
   | Maestro işi | `jobs/` kuyruğu (`when-shell` + `free` sondası) | kuyruk kadar | daemon ateşleyince |
   | **devir işareti** | `~/.claude/claims/<repo>/devir/<id>.json` | **TTL'siz · süreçsiz · kalıcı** | `devir al --id` ile ELLE / açılış-devralmada |

   İşaret **Maestro'dan ÖNCE** yazılır (yazılamayan işareti telafi edecek yol yoktur). Maestro
   yazılamazsa komut artık **exit 0** verir ve ne olduğunu söyler: *"MAESTRO YAZILAMADI — devir
   işareti kaldı"*. İşaret yazılamazsa **exit 5** (gerçekten kaybediyoruz — tek hata dalı).

   **Aynı iş İKİ KEZ koşulmaz:** ateşlenen goal'ün İLK adımı `devir al --id <id>`'dir; üstlenme
   `renameSync` ile atomiktir (POSIX: tek kazanan) ve **kaybeden işi KOŞMAZ** (exit 1 →
   "Bu işi KOŞMA"). Dedup bir niyet beyanı değil, bir mekanizmadır.
4. **Kilidi bırak.** `release --res <kaynak>` — unutma. `status`unda bekleyen ya da
   devir işareti görünüyorsa elverişli ilk anda bırak (küçük iş önceliklidir).

### Sıra GERÇEKTİR (ama yalnız gerçekten bekleyene)

Kuyruk artık **kaynağa** aittir (`<sha1>.q.json`), claim'e değil — kilit bırakılınca sıra
ölmez. Bekleyen iki cinstir ve ayrım adaletin temelidir:

| cins | ne | sıra tutar mı |
|---|---|---|
| **aktif** | canlı `wait` süreci dönüyor | **evet** — kilit boşalınca sıradakine gider |
| **işaret** | kapıda DENY yedin, yoluna devam ettin — ya da `devret` iz bıraktı | hayır — bilgi sinyali (sahibe "isteyen var" der) |

`devret` işareti sıra tutmaz çünkü devrin sırası **iş kuyruğundadır**: `free` sondası ancak
aktif bekleyen kalmayınca 0 döner — canlı bekleyiş her zaman devirden önce alır.

Boşalmış bir kaynağı önünde aktif bekleyen varken kapmaya çalışırsan `claim` **exit 4**
("sıra sende değil") verir. Ölçüt yine süre değil **süreç**: vazgeçip devam etmiş bir session
kimseyi bekletmez, ölen bir bekleyici sırayı kilitleyemez. Sıra tutmak istiyorsan `wait` kur;
istemiyorsan hiçbir şey yapma — ikisi de dürüst.

(Burada eskiden *"kuyruk bilgilendirmedir, FIFO YOK"* yazıyordu ve doğruydu: kuyruk claim'in
İÇİNDE yaşadığı için release'te onunla birlikte ölüyordu — FIFO o tasarımda imkânsızdı.
Kuyruk kaynağa taşındı; artık vaat mekanizmaya dayanıyor.)

## Kilit YAZIMI korur, OKUMAYI değil

Bir kaynağın adını yalnızca **anan** komut (grep · cat · git log · rg · sed -n · bir mesaj
metni) hiçbir şeyi mutasyona uğratmaz → kapı onu **reddetmez**. Ölçüldü (2026-07-16): çıplak
substring eşleşmesi yüzünden salt-okunur bir `grep` 4 session'ı 35 dk durdurdu; hatayı ANLATAN
mesaj bile adı metninde geçtiği için reddedildi.

Ölçüt **fail-safe**tir: tanımadığı komut YAZAR sayılır (`claims-lib.isReadOnlyBash`). Yani liste
hiçbir korumayı gevşetmez; yalnız bilinen-güvenli okumayı serbest bırakır. `$(…)`/backtick,
`bash -c`, `eval`, `xargs`, `sudo`, yönlendirme (`> dosya`, `tee`), `sed -i`, `git checkout`,
`find -delete` → **yazar** sayılır.

Segmentlere bölme (`;` `|` `&` `&&` `||`) **tırnak içini ayırıcı SAYMAZ**: argümanının içinde
`|` geçen bir okuma (`grep -rn "a\|b" <kilitli-yol>`) ikiye kesilip ikinci parçası
"tanınmayan binary" → yazar sayılıyordu (ölçüldü 2026-07-27). Tırnak dengesizse hüküm
verilmez — komut yazar sayılır.

## KAPI KENDİ ÇARESİNİ REDDEDEMEZ

DENY metni "sıraya girmek için `claim.mjs wait --res <kaynak>` koş" der. O komut kilitli
**yolu argüman olarak anar** ve `node` salt-okunur listede olmadığı için yazar sayılıyordu:
çarenin kendisi kapıda ölüyor, kuyruğa girilemiyor, "sıra gerçektir" vaadi yalanlanıyordu
(ölçüldü 2026-07-27 — model kapıyı dolanmak için yolu kabuk değişkenine saklamak zorunda
kaldı; kapıyı dolandıran bir kapı, kapı değildir).

Bu yüzden protokolün kendi CLI'ı muaftır (`claims-lib.isProtocolBash`): `claim.mjs
status|claim|release|wait|free|devret|devir|limit-devir|gc|resources` kilit **defterine** yazar,
kilitli **kaynağa** değil — kapının koruduğu şey kaynaktır. Kapı, DENY metninde ÖNERDİĞİ hiçbir
çareyi reddedemez: `devir list`/`devir al`/`limit-devir` de o çarelerdendir.

Muafiyetin sınırı **İLAN EDİLİR** (kalkan olarak kullanılamaz):
- yalnız `…/eszamanli/…/claim.mjs` yolundaki script (adı çakışan yabancı `claim.mjs` DENY),
- tanınan alt-komut (`bilinmeyen` → DENY),
- zincirdeki **her** segment protokol ya da salt-okunur olmalı:
  `claim.mjs wait … && rm -rf <kilitli>` → **DENY**.

**Haritadaki `bash` desenleri ÇAĞRIYI ölçmeli, ANMAYI değil.** Yeni desen yazarken komut
konumuna demirle (`(^|[;&|(]\s*)npm\s+run\s+build\b`), çıplak kelime yazma. Çıplak desen aynı
anda iki yönde de yanılır: fazla geniş (adı anan her komutu keser) ve fazla dar (gerçek yazarın
öbür çağrı biçimini — `npm run build` — kaçırır).

## Çakışma POLİTİKASI: kilit ancak işler gerçekten kesişiyorsa

Çakışmanın ölçütü **anahtar eşitliği değildir**. Üç kaynaktan türer:

1. **Aynı anahtar** — bariz.
2. **Yol kesişimi** — farklı anahtarlar, aynı dosyalar. `pm:defter` ile
   `~/.claude/pm/log.jsonl` farklı anahtarlardır ama aynı dosyayı sürer; eşitlik tek ölçüt
   olsaydı ikisi de claim edilir, iki session da "sahibim" sanırdı. Kesişim mekanik ölçülür.
3. **İlan edilmiş ilişki** (`conflictsWith`) — **yolların ifade EDEMEDİĞİ** şey: *"A bitmeden
   B anlamsızdır"* (öncül/precursor) ya da *"A koşarken B'nin çıktısı bozulur"*.
   Örnek: `plan-index` ⟂ `plan-state` — INDEX, STATE ağacından **türer**; yarım yazılmış bir
   STATE üzerinden türetilen INDEX yanlıştır ve kimse hata görmez, endeks sessizce yalanlar.

Kesişmeyen kaynaklar **serbesttir** — paralellik korunur; kapı fazladan kilitlemez.

**Öncüllük görülemez, BEYAN edilir.** Makine yol kesişimini görür; "bu iş şunun öncülüdür"
bilgisi koda bakarak çıkarılamaz — haritaya yazılır. Bir çakışmayı yaşadıysan, çözümü
oturumda anlatmak değil `conflictsWith`'e işlemektir; yoksa bir dahaki sefere yine olur.

**Glob-glob kesişiminin sınırı ilan edilir:** `src/*.ts` ile `src/a*.ts` gerçekte kesişir ama
makine bunu SAĞLAM söyleyemez → kesişmez sayılır (fazla-blokaj üretmemek için). Görülemeyen
kesişimi `conflictsWith` ile beyan et.

## Öncelik: küçük iş önceliklidir, kapsamlı olan yol verir

Kullanıcının kuralı: *kapsamlı session, küçük scope'lu işin bitmesini bekler.* Protokol bunu
**zorla devralmayla değil** üç kuralla ifade eder (yarım kalmış çok adımlı yazım, kilitten
beterdir):

1. **Dar ve geç claim'le — kilit YAZIM PENCERESİNDE alınır (P6).** Kapsamlı iş
   `--breadth broad` ilan eder, kaynağı **o adıma gelince** alır, madde biter bitmez
   **bırakır**. Kaynağı "ne olur ne olmaz" diye baştan kapatma. Kural tek cümle:
   **kilit yazım penceresinde alınır, düşünme · ölçüm · ajan bekleme süresince TUTULMAZ**
   → `claim → yaz → release`; ajanın sonucu gelince **yeniden** claim'le. Ölçüldü: 16,7
   saatlik kilitlerin yazımı 3 dakikaydı, gerisi ajan koşumuydu (ve 13 saatlik `plan-state`
   vakası bu kültürel kökten doğdu). Geniş bir anahtar yerine dalını claim'lemek de aynı
   kuralın parçasıdır: `--res "glob:plans/<slug>/v<N>/**"` iki planın paralel ilerlemesine
   izin verir, çıplak `plan-state` vermez.
2. **Bekleyeni gör, yol ver.** `status`'ta ya da bir sonraki `claim`'de kilidinde bekleyen
   görünüyorsa, **elverişli ilk anda** (yarım yazım bırakmadan) bırak.
3. **Kilit tutarken bekleme.** Bir kaynağı tutup başkasını beklemek konvoy üretir: ölçüldü
   (2026-07-16) — tarayıcıyı 35 dk tutan session kendisi başka bir kilitte blokeydi, arkasında
   3 session bekliyordu. Beklemeden önce tuttuklarına bak; elverişliyse önce bırak.

## DÖNGÜ (deadlock): makine tespit eder, sen sırayı çevirirsin

Eskiden burada *"deadlock yok; ikisi de bırakamıyorsa bu insan kararıdır"* yazıyordu — yani
mekanizma yoktu. Artık var: bekleme grafiği zaten defterde (claim `owner` + kaynağın kuyruğu),
`claim.mjs` ve kapı **aynı çözümleyiciyi** (`claims-lib.waitCycle`) okur.

Zincir **yalnız AKTİF bekleyişten** kurulur (canlı `wait` süreci). Kapıda bir kez DENY yiyip
yoluna devam etmiş bir session "bekliyor" değildir; onun işaretini zincire saymak, kimsenin
beklemediği yerde DÖNGÜ hükmü verir ve karşı tarafa haksız yere "tuttuğunu bırak" dedirtir —
yani yarım kalmış bir yazım. Deadlock **iki tarafın da bloke olmasıdır**; blokenin ölçütü
niyet değil, dönen süreçtir.

Bir kaynağı TUTARKEN, seni (zincir üzerinden) **aktif bekleyen** birinin kaynağını istersen:

* `claim` **exit 7** verir ve **kuyruğa YAZMAZ** (kuyruğa yazılmak yalan olurdu — o sıra asla
  gelmez: iki pid de canlı olduğundan otomatik biçme devreye girmez, `wait`in varsayılan
  timeout'u sonsuzdur),
* kapı DENY metni "bekle" demez, **"sırayı çevir"** der,
* `wait` her turda aynı ölçütü yeniden ölçer — zincir bekleme SIRASINDA kapanırsa da çıkar.

Çözüm her zaman aynı: **tuttuğunu bırak → hedefi bekle/al → işini bitir → bıraktığını geri
claim'le.** Komutları çıktı sana hazır verir.

## Canlılık ölçütü (ve neden süre DEĞİL)

Bir claim ancak sahibinin **süreci gerçekten canlıysa** geçerlidir: kayıtlı `pid` yaşıyor mu
+ süreç başlama zamanı eşleşiyor mu (pid geri dönüşümüne karşı çift). Ölü sahibin kilidi her
okumada otomatik biçilir → **sistem sonsuza dek kilitlenemez**.

Süre (TTL/mtime) **ölçüt değildir**: gece açık kalan kapsamlı bir işin kilidini çalardı.
`session-status/<sid>.json` dosyasının VARLIĞI da ölçüt değildir — ölçüldü: crash'te SessionEnd
ateşlenmediği için aylar öncesinden `state:"generating"` kalan ölü kayıtlar var. Kilidi **elle
silme**; sahibi ölmüşse zaten biçilir, ölmemişse silmen çakışmayı geri getirir.

## BAYATLIK ayrı bir eksendir — kilidi silmez, DEVİR HAKKI doğurur

Canlılık ikili ve serttir (pid). Ama bir sahip **canlı görünüp askıda** olabilir: süreç yaşıyor,
kimse yazmıyor. Bu, canlılığın değil **bayatlığın** konusudur ve iki eksen birbirine karışmaz —
`activeClaims`/`procAlive` bayatlıktan habersizdir, süre oraya ASLA girmez.

Kilidin tazeliği artık gerçekten ölçülür: sahip kendi kilidine her dokunuşta kapı `renewedAt`i
tazeler (**P1 kalp atışı**, 60 sn throttle; alan daha önce ölüydü — 1 yazar, 0 okuyucu). Üç kademe:

| kademe | ölçüt | sonuç |
|---|---|---|
| **TAZE** | yenileme < 15 dk · **ya da ölçüm yok** | DENY (bugünkü metin) |
| **BAYAT** | sahip `idle`/`waiting` ∧ yenileme > 15 dk | DENY (metin bunu söyler) |
| **DEVREDİLEBİLİR** | sahip `idle`/`waiting` ∧ yenileme > 1 sa | sıradaki **aktif bekleyen** devralabilir |

**Üç fren** (yanlış pozitif en pahalı hatadır — iki yazar aynı dosyaya girerse koruma tersine
döner): `generating` sahip **asla** düşürülmez · **bekleyen yoksa hiçbir şey olmaz** (devir yalnız
canlı bir `wait` sürecinin içinde gerçekleşir, arka planda koşan zamanlayıcı YOKTUR) · **ölçüm
yokluğu ölüm değildir** (ps ölçülemiyorsa · session-status kaydı yoksa · `renewedAt` taşımayan
legacy kayıtta → TAZE).

**Devir asla sessiz değildir.** Kilit SİLİNMEZ, sahibi DEĞİŞİR; eski sahibe kalıcı bir devir
işareti bırakılır ve o, ilk yazımında DENY metninin başında **"KİLİDİN DEVREDİLDİ (sebep)"**
bloğunu + yeniden claim yolunu okur. Kaybolan iş yoktur, sürpriz de yoktur.

## LİMİTLENDİYSEN kilidini bırak (yoksa kuyruk donar)

Ölçülmüş vaka (2026-07-27): tek bir `plan-index` kilidinin sahibi spend-limit'e girdi. pid
CANLIYDI — yani kilit **doğru** olarak biçilmedi — ama süreç iş yapamıyordu: **4 session dondu.**
Sınıfın adı: *canlı-görünen-ama-askıda sahip.* Karar sahipliği KATMANLIDIR ve en üst katman SENSİN:

1. **Talimat (bu satır):** limit uyarısını görürsen tuttuğun kilitleri bırak ya da devret —
   `node $S limit-devir` (kendi kilitlerini devir işaretine çevirir) · `node $S release --all`.
2. **Deterministik ağ:** tur sonunda (`Stop`) kapı kendi kilitlerini otomatik devreder; bir
   sonraki turun `ctx` yedeği pencereyi 07 gecikse de kapatır. **YALNIZ KENDİ** kilitleri —
   üçüncü bir tarafın "şu limitli görünüyor" diye başkasının kilidini biçmesi YOKTUR.
3. **Son ağ:** SessionEnd `release_all`.

Ölçüt dar tutulur (yanlış pozitif kapısı): geçici overload (`diger` sınıfı) **asla** tetiklemez,
reset penceresi geçmiş bayat bir limit alanı da tetiklemez. Sen limitliysen `wait` de anlamsızdır:
bekleyiş **tur başında kendini ölçer** ve *"LİMİTLİSİN — bekleyiş anlamsız, devret"* diyip çıkar
(exit 6) — sıra sana gelse kilidi kapar ama iş yapamazdın, yani kuyruğu yeniden dondururdun.

Beklerken karşı taraf limitliyse bunu **görürsün**: MEŞGUL/DENY/`ctx` metinleri sahip satırına
*"⚠ sahip LİMİTLİ (sınıf, reset ~HH:MM) — kilidi birazdan devredilecek"* satırını ekler.

## Kapsam ve İLAN EDİLEN muafiyetler

Kapı şunları görür:
- `Edit` · `Write` · `NotebookEdit` (`file_path`/`notebook_path`) — repo içi **ve** repo dışı
  (`~/.claude/pm/…`) yollar. Bu sistemin koruduğu kaynakların çoğu repo dışındadır; kalıplar
  repo köküne göreli çözülürken hepsi sessizce eleniyordu (koruma ilan ediliyor ama yoktu).
- `Bash` — yazar komutlar: haritadaki `bash` regex'leri **ve** komutun andığı yol-benzeri
  argümanlar (`sed -i … src/app.ts`, `echo x > src/app.ts` artık claim'li dosyayı ezemez).

**Görmediği (bilinen ve ilan edilen delikler):**
- **Dolaylı yazım:** yolu komut metninde geçmeyen yazar (bir script'in içinden yazdığı dosya,
  `python - <<EOF` gövdesi, `$(…)`/`bash -c` içi). Komut ikamesi ve `bash -c` "yazar" sayılır
  ama hedefleri ölçülemez → yol kesişimi görülmez. Yıkıcı işi claim arkasına almak
  **protokolün** işidir, kapının değil.
- **Dizin seviyesi yazım:** `jobs/**` claim'liyken `rm -rf jobs` — token dizindir, kalıp
  altındaki dosyalarla eşleşmez.
- **Cross-repo Bash:** `cd başka-repo && …` — kapı çağıran repo defterine bakar.
- **MCP dosya-yazar araçları** ve **claude dışı yazarlar** (Maestro `shell` payload'ları,
  daemon'lar): hook hiç ateşlemez, `CLAUDE_CODE_SESSION_ID` yoktur → protokole katılamazlar.
- **Claim'lenmemiş kaynaklar** (tasarım gereği — claim zorunlu değil).
- Aynı claude sürecindeki **subagent'lar** ebeveynin claim'ini paylaşır (sahiplik ata-pid
  köprüsüyle) — bu bilinçli: subagent'ı kendi ebeveyninin kilidi bloke etmemeli.

Sessiz kırpma yerine dürüst ilan: "her şeyi kapsıyorum" demek, kapsamadığını gizlemekten kötüdür.

## Ölçemediğinde hüküm verme (fail yönü)

`ps` çökerse/boş dönerse her pid "yok" görünür. Bu **"hepsi ölü"** demek değil, **"ölçemedim"**
demektir — ayrım kritikti: ölçüm yokluğunu ölüm sayan kod, tek bir `ps` hatasında TÜM kilitleri
aynı anda biçerdi (kapı **açık** fail eder = telafisiz yön). Ölçüm yoksa hüküm de yoktur:
kilit **korunur**. Gerçekten ölmüşse bir sonraki başarılı okumada biçilir.

Aynı yön kapının her yerinde: iç hata → **PASS** (ürünü kilitleme), şüpheli komut → **YAZAR**
say (koruma tarafında kal). İki yön çelişince kazanan, telafisi olan yöndür.

## Yeni bir repoya bağlamak

`<repo>/.claude/claims-resources.json` yaz — mantıksal kaynak = paylaşılan yazar:

```json
{ "resources": {
    "dc-html":  { "paths": ["design-source/*.dc.html"], "note": "tek kaynak dosya" },
    "publish":  { "paths": ["extracted-v2/**"], "bash": ["(^|[;&|(]\\s*)node\\s+\\S*extract-pages\\.js"],
                  "conflictsWith": ["dc-html"], "note": "yayın dc-html'den TÜRER — öncül" },
    "kadran":   { "paths": ["~/.claude/pm/ayar.json"], "note": "repo dışı yol da korunur" },
    "db:media_slot": { "bash": ["tbl_media_slot", "media\\.php.*op=(assign|delete)"] } } }
```

Alanlar: `paths` (repoya göreli **veya** mutlak/`~`) · `bash` (yazar komut regex'i — çağrıya
demirle) · `conflictsWith` (yolların göremediği öncüllük/bozma ilişkisi) · `note` (MEŞGUL/DENY
metnine girer — bloke olan model bunu okuyup karar verir, o yüzden *neden* tek yazar olduğunu yaz).

Harita yoksa protokol yine çalışır (yol/glob claim'leri). Granülerlik rehberi: **dosya-bazlı
kilit doğru ödünleşimdir** — Edit string-eşlemeli yazar, iki session'ın aynı dosyadaki
eşzamanlı Edit'i satır bazında birleşmez. Paralellik dosya DIŞINDA kazanılır; harita tam bunun
için kaynakları ayırır.
