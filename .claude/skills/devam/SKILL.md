---
name: devam
description: Kesintiden (token limiti · login düşmesi · süreç ölümü · pencere kapanması) sonra yarım kalan işi DEVAM ETTİRİR — ama önce GEÇERLİLİĞİNİ ÖLÇER: iş hâlâ gerekli mi, dayandığı gerçeklik değişti mi, başkası bitirdi mi, aynı işi koşan başka session var mı. Sapma yoksa ajan doğmaz (0 token) ve doğrudan devam eder; sapma varsa hüküm (GEÇERLİ | REVİZE | DÜŞTÜ) verilir ve brif ona göre işaretlenir. Toplama+ateşleme motoru olarak /soft-resume'u ÇAĞIRIR, çoğaltmaz. TETİKLEME DAR: yalnız /devam açıkça çağrıldığında ya da kullanıcı BAŞKA/KESİLMİŞ bir işi kastederek "limitten sonra devam ettir", "token bitti, o işi sürdür", "kırık session'ları devam ettir", "yarım kalanları sürdür", "kaldığı yerden devam ettir ama hâlâ geçerli mi bak" dediğinde kullan. Tek başına "devam" / "devam et" bu skill'i TETİKLEMEZ — o, süren işe devam demektir (kullanıcı düzeltmesi 2026-07-27).
rol: ajan
---

# devam — önce geçerliliği ölç, sonra sürdür

## Neden ayrı bir alet

`/soft-resume` kesintiye uğramış bir session'ı taze oturumda sürdürür — ama
**hiç sormaz**: "bu iş hâlâ gerekli mi?" Topla → damıt → ateşle. Kesinti uzunsa
ya da gerçeklik altından kaydıysa, sürdürülen iş **bayat** olabilir: başkası
bitirmiştir, plan aşaması kapanmıştır, hedef değişmiştir, aynı işi koşan bir
session zaten vardır.

`/devam` o soruyu sorar. `soft-resume`'un yerine geçmez — onu **motor olarak
çağırır** (`topla.mjs` toplar, ateşleme onun yolundan gider) ve araya tek bir
faz ekler: **GEÇERLİLİK**.

**Sınıf ilanı (terimler sözleşmesi):** Faz 1–2 **motor, 0 token** · Faz 3
**sapma varsa agentic** (sapma yoksa hiç doğmaz) · Faz 4 **insan onaylı**.

**Rol sınırı — ben ne DEĞİLİM:** irtifam TEK İŞİN sürdürülmesidir. Genel
"durum ne / nerede kaldık" → **kaptan**; projeler-arası karar → **pm**; plan
ağacı → **plan-organizatoru**; salt taşıma (geçerlilik sorusu olmadan) →
**soft-resume**. Ben yalnız "kesildi → hâlâ geçerli mi → sürdür" halkasıyım.

## Faz 1 — SEÇ

Argüman bir sessionId ise Faz 2'ye geç. Değilse adayları listele:

```bash
node ~/.claude/skills/soft-resume/scripts/topla.mjs --liste [--proje <root>] [--gun 14]
```

Tabloyu kullanıcıya sun (depo · proje · son aktivite · id) ve seçtir.
Birden çok kırık iş varsa **hepsini tek tek** geçerlilikten geçir — toplu
"hepsini devam ettir" YAPMA (bayat iş kütlesi en pahalı hatadır).

## Faz 2 — GEÇERLİLİK (motor, 0 token)

```bash
node ~/.claude/skills/devam/scripts/gecerlilik.mjs --session <id> [--depo <dir>] [--esik-saat 24] [--json]
```

Script `topla.mjs`'i kendisi koşar, demeti tüketir ve **altı ekseni** ölçer:

| eksen | ne sorar | sapma anlamı |
|---|---|---|
| `kesinti-yasi` | ne kadar bekledi (eşik varsayılan 24 sa) | uzun bekleyen iş bayatlamış olabilir |
| `dayanak-degisimi` | kesintiden bu yana repo hareket etti mi | işin dayandığı gerçeklik kaydı |
| `yarim-is` | son TodoWrite'taki açık maddeler | *(envanter — sapma değil)* |
| `plan-asamasi` | koştuğu aşama STATE'te hâlâ açık mı | KAPALI ise iş başkasınca bitmiş olabilir |
| `kilit-sahipligi` | kaynaklar başka session'da mı | kesişiyorsa çakışma riski |
| `cift-kosum` | aynı işi anlatan canlı session var mı | çift koşum riski *(sezgisel — İLAN edilir)* |

**Çıkış kodu sözleşmesi:** `0` = GECERLI · `1` = INCELE · `2` = kullanım hatası.
**FAIL-CLOSED:** ölçülemeyen eksen "temiz" sayılmaz, INCELE'ye düşer — ölçüm
yokluğu geçerlilik kanıtı değildir.

## Faz 3 — HÜKÜM

**`hukumOnerisi: GECERLI` ise (sapma 0 ∧ ölçülemedi 0): HİÇBİR AJAN DOĞMAZ.**
Hüküm zaten bellidir; doğrudan Faz 4'e geç. Bu yolun maliyeti sıfırdır ve
normal hâl budur.

`INCELE` ise hükmü **bu oturum** verir (ajan spawn etme — sen zaten ajansın).
Sapma eksenlerini ve `yarimIs` listesini oku, üç hükümden birini ver:

| hüküm | ne zaman | ne olur |
|---|---|---|
| **GEÇERLİ** | sapmalar işi geçersiz kılmıyor (ör. alakasız dosyalar değişmiş) | brife "şunlar değişti ama işi etkilemiyor: …" satırı, aynen devam |
| **REVİZE** | iş hâlâ gerekli ama girdisi değişmiş | brife **ZORUNLU İLK ADIM** olarak "önce şunu doğrula: …" yazılır; devam eder |
| **DÜŞTÜ** | iş artık gerekli değil (bitmiş · hedef değişmiş · başkası koşuyor) | **DEVAM ETTİRME.** Gerekçeyi yaz, kullanıcıya bildir; istenirse PM gelen kutusuna düşür |

**Kural — hüküm ≠ eylem:** hüküm brifi *işaretler*, tek başına iş ateşlemez.
Ateşleme her hâlükârda Faz 4'ün insan onayından geçer.
**Uydurma yasak:** hüküm yalnız `eksenler[]` kanıtına dayanır; ölçülmemiş bir
şey hükümde gerekçe olamaz.

## Faz 4 — SÜRDÜR (insan onaylı)

Brifi `soft-resume` Faz 3 biçiminde kur (amaç · nerede kaldı · planlar ·
kararlar · yapılacak ilk iş) ve **başına hüküm bloğunu** koy:

```
## GEÇERLİLİK HÜKMÜ — <GEÇERLİ|REVİZE>  (ölçüm: <ISO>, kesinti <N> sa)
- sapma: <eksen> — <detay>
- ZORUNLU İLK ADIM (yalnız REVİZE): <doğrulanacak şey>
```

Sonra `soft-resume`'un ateşleme yolunu kullan (Maestro üzerinden taze oturum,
insan onaylı). Yeni yol açma — tek ateşleyici odur.

**DÜŞTÜ hükmünde Faz 4 KOŞULMAZ.** Sessizce atlama: kullanıcıya "şu iş
düştü, gerekçe şu" diye İLAN et.

## Kısıtlar

- `soft-resume` kurulu olmalı (`topla.mjs`). Yoksa script `onar:` satırıyla
  exit 2 verir — kendi toplayıcısını YAZMAZ (çoğaltma yasak,
  `uy:ilke/tek-projeksiyon`).
- Bu skill **hiçbir dosyaya yazmaz**; yalnız ölçer, hüküm üretir, ateşlemeyi
  soft-resume'a devreder.
- Eşik (`--esik-saat`) ürün tercihidir; varsayılan 24 sa. Kullanıcı başka bir
  değer söylerse ona uy, uydurma.
- Sezgisel eksen (`cift-kosum`) çıktıda İLAN edilir — kesin kanıt sayma.

## Kanıt

```bash
node ~/.claude/skills/devam/proof/proof.mjs
```
