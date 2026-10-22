---
name: soft-resume
description: Kapalı ya da BAŞKA HESABIN session'ını hard-resume ETMEDEN devam ettirir — transcript + oturum hedef defteri + plan ağacı + DEVRALIS.md'yi deterministik toplar (0 token), bu oturumda titiz bir SOFT-RESUME BRİFİ'ne damıtır (amaç · nerede kaldı · planlar · kararlar · yapılacak ilk iş) ve brifi taze bir claude oturumunda açan komutu kullanıcıya verir. Hard resume (`claude --resume`) hesaba/makineye kilitlidir; token'ı biten hesabın session'ı bu yolla ölüdür — soft-resume o işi CANLI hesapta sürdürür. Devir sözleşmesinin okuma ucu: kapatan taraf agentic iş yapmaz, anlamlandırmayı DEVRALAN üstlenir. Ayrıca OTURUM KASASI'nı taşır (kasa.mjs): o an AÇIK olan sekmelerin sıkıştırılmış fotoğrafını + yeniden başlatma komutunu plans/oturumlar/kasa/'ya yazar, devralan onları tek tek geri açar. Kullanıcı "soft resume", "yumuşak devam", "token'ı biten hesabın işini sürdür", "şu session'ı oku ve buradan devam et", "o session'da kaldığım yeri buraya taşı", "açık sekmeleri/oturumları kaydet", "sekmeleri devralayım / yeniden başlatayım", "kasa" dediğinde veya /soft-resume çağrıldığında kullan.
rol: ajan
---

# soft-resume — yumuşak devam: oku · damıt · taze oturumda sürdür

## Kavram — hard vs soft

| | hard resume | soft-resume |
|---|---|---|
| komut | `claude --resume <id>` | brif + taze `claude` |
| geçmiş | tamamı yeniden yüklenir (ağır) | damıtılmış brif (ucuz) |
| hesap | AYNI hesap/makine şart | taşınabilir — başka hesap OK |
| token'ı biten hesap | **ölü yol** | **ana senaryo** |

**Sınıf ilanı (terimler sözleşmesi):** Faz 1–2 **deterministik motor, 0 token** ·
Faz 3–4 **agentic, bu oturum** (ajan spawn edilmez — damıtmayı skill'i çağıran
oturum yapar). Oturum açmak sarı iştir → Faz 4 **insan onaylı**.

**Devir sözleşmesi (kullanıcı kararı 2026-07-23):** kapatan/devreden taraf agentic
iş YAPMAZ — devir motoru (`oturum.mjs devir` · kasa) deterministik kalır. Agentic
anlamlandırma yükü DEVRALANINDIR; bu skill o yükün taşıyıcısıdır.

**Rol sınırı — ben ne DEĞİLİM:** irtifam TEK SESSION'ın devridir. Plan ağacı →
**plan-organizatoru**; kesilmiş işin hâlâ geçerli olup olmadığı → **/devam**; aynı
hesap/makinede devam → hard resume (`claude --resume`). Ben yalnız kapalı/başka-hesap
session'ı damıtıp taze oturumda sürdürürüm.

## Faz 1 — SEÇ

Argüman bir sessionId ise doğrudan Faz 2'ye geç. Değilse:

```bash
node ~/.claude/skills/soft-resume/scripts/topla.mjs --liste [--proje <root>] [--gun 14]
```

Çıktıyı kullanıcıya tablo olarak sun (depo · proje · son aktivite · id) ve seçtir.
`--liste` TÜM depoları tarar: `~/.claude` + `~/.claude-*` (diğer hesaplar) +
`CLAUDE_CONFIG_DIR`. Kesin canlılık ölçülmez (İLAN): `muhtemelenCanli` mtime<2dk
sezgisidir.

**Uyarı dalı:** seçilen session AYNI hesapta ve muhtemelen canlıysa soft-resume
gereksiz — kullanıcıya o sekmeye dönmesini ya da hard resume'u öner. Kullanıcı yine de isterse devam et (canlı session'ın o anki
hâli okunur, kopya niyet çatallanabilir — bunu söyle).

## Faz 2 — TOPLA (deterministik, 0 token)

```bash
node ~/.claude/skills/soft-resume/scripts/topla.mjs --session <id> [--depo <dir>] [--tail 30]
```

Tek JSON demet döner: `meta` (depo · slug · cwd · hardResume) · `amac.ilkIstek` ·
`neredeKaldi` (son anlamlı istek + **son TodoWrite** + son N mesaj kuyruğu) ·
`planlar` (agac.mjs --durum, proje tarafı) · `kaptanHedefi` (session'ın DEPOSUNDAN)
· `devralis` (`.claude/filing/DEVRALIS.md`) · `git` · `uyarilar[]`.

`kaptanHedefi` alanı oturum hedef defterini taşır: `goal-tracker` hook'unun yazdığı
`<depo>/kaptan/goals/…/<sessionId>.json` (başlık + açık todo'lar). Alan ve dizin adı
tarihseldir; `kaptan` skill'i 2026-10-22'de arşive gitti, veri yolu geçerlidir.
`devralis` alanını besleyen filing katmanı da 2026-10-22'de arşive gitti. Dosya eski
bir projede duruyorsa okunur ama artık tazelenmez; tarihini brifte belirt.

Veri yönü kuralı script'in içindedir: hedef defteri session'ın deposundan, plan/
DEVRALIS/git proje tarafından. Sır eleği de içindedir — damıtan modele güvenilmez;
elenen alan `«sır içerdiği için çıkarıldı»` olur.

## Faz 3 — DAMIT (agentic, bu oturum) → BRİF

Demeti aşağıdaki şablona damıt ve `~/.claude/soft-resume/<sessionId>/BRIF.md`'ye
yaz (dizin TÜREV sınıfıdır: transcript'ten yeniden üretilir, handover'da taşınmaz).

```markdown
# SOFT-RESUME BRİFİ — <proje> · <id kısa> · <tarih>
## Amaç (ne için açılmıştı)
## Nerede kaldı (son istek + açık todo'lar + son konuşmanın özeti)
## Planlar / açık hedefler (plan ağacı + hedef defteri + DEVRALIS)
## Kararlar ve kısıtlar (transcript'ten damıtılan sözleşmeler — TİTİZ ol)
## Açık sorular (demetten çıkarılamayanlar — UYDURMA)
## YAPILACAK İLK İŞ (tek, somut adım)
## DEVAM KOMUTU (Faz 4'te kullanıcıya verilen satır)
```

Kurallar: brif **kanıta bağlı** — demette olmayan şey uydurulmaz, belirsizlik
`## Açık sorular`a yazılır. "Kararlar ve kısıtlar" en değerli bölümdür: kuyruktaki
konuşmadan kullanıcının verdiği kararları, reddettiği yaklaşımları, koyduğu
kısıtları çıkar. Todo'ları aynen aktar (yorumlama), konuşmayı damıt (aktarma).

## Faz 4 — SÜRDÜR (insan onaylı)

Brifi kullanıcıya göster ve sor: **(a)** yeni oturumda sürdür · **(b)** yalnız brif.

**(a) yeni oturum** — kullanıcı aşağıdaki komutu yeni bir terminal sekmesinde kendisi
çalıştırır. Brif dosyadan OKUTULUR; komut metnine gömülmez (pointer-komut deseni):

```bash
cd <proje-root> && claude 'SOFT-RESUME: ~/.claude/soft-resume/<id>/BRIF.md dosyasını OKU ve "YAPILACAK İLK İŞ"ten başlayarak uygula.'
```

Skill oturum AÇMAZ. Yeni oturumu zamanlı kuyrukla açan katman (Maestro + `zamanla`)
2026-10-22'de arşive gitti. Yeni cwd `~/.claude.json`'da güvenilir (trust) olarak onaylı
değilse claude açılışta onay ister; bu onayı kullanıcı verir, asla otomatik yanıtlanmaz.

## OTURUM KASASI — açık sekmelerin yeniden başlatılabilir yedeği

Yukarıdaki dört faz **kapalı** bir session'ı sürdürür. Kasa onun ikizidir ve **açık**
sekmeleri hedefler: devralan kişi geldiğinde ortada tek bir oturum değil, bir ekran
dolusu sekme vardır — hiçbirinin kapanış notu YOKTUR (kapanmadılar ki) ve hepsi
hesap/makineye bağlıdır. Kasa her AÇIK sekmenin sıkıştırılmış fotoğrafını + onu geri
açan komutu projeye (git'e) düşürür.

```bash
node ~/.claude/skills/soft-resume/scripts/kasa.mjs yaz     # canlı sekmeleri kasala
node ~/.claude/skills/soft-resume/scripts/kasa.mjs list     # kayıtlar + CANLI/ÖLÜ rozeti
node ~/.claude/skills/soft-resume/scripts/kasa.mjs goster <kisa>   # brifi bas
node ~/.claude/skills/soft-resume/scripts/kasa.mjs baslat <kisa>   # başlatma komutlarını basar
```

- **Nerede yaşar:** `<proje>/plans/oturumlar/kasa/<kisa>.{json,md}` + `KASA.md` indeksi.
  `.md` DEVRALANIN okuduğu brif, `.json` makine ucudur. Tek yazar `kasa.mjs`.
- **Özet nereden gelir:** harness'ın context sıfırlarken yazdığı **compact özet HASAT**
  edilir — üretilmez. Yoksa alan boş kalır ve bu İLAN edilir (motor uydurmaz, 0 token).
- **Kim çağırır:** SessionEnd zinciri (`oturum-kapanis.mjs`, devirden sonra) + SessionStart
  tazelemesi (`--bayat 30`, ayrık süreç). Elle de çağrılır; `--zorla` guard'ları deler.
- **Başlatma iki yol** (`baslat` ikisini de basar, kullanıcı çalıştırır):
  `cd <cwd> && claude --resume <id>` (aynı hesap) → **soft** (`claude` + brif pointer; başka
  hesapta TEK yol). 2026-10-22 öncesi kayıtlardaki arşivlenmiş `aide open` satırı okunurken
  `claude --resume` satırına çevrilir.
- **`--ates`:** geçerli yolu (aynı hesapta `claude --resume`, başka hesapta brifli taze `claude`)
  BU terminalde, ön planda açar. Etkileşimli terminal (TTY) yoksa açmaz, komutu basıp exit 3
  verir. Bir ajanın Bash aracından `--ates` çağırma; komutu kullanıcıya ver.
- **İkiz koruması:** CANLI bir kaydı başlatmak REDDEDİLİR (`--zorla` ister) — aynı session
  iki pencerede aynı işi yürütür ve kilit protokolü bunu çözmez.
- **Kasa ≠ devir notu:** devir notu KAPANANIN hükmüdür (bir tane), kasa AÇIK KALANLARIN
  fotoğrafıdır (N tane). İkisi de gerekir.

## Kenar durumlar

- **Session bulunamadı** → `topla.mjs` exit 1 + taranan depo listesi; id'yi ve
  `--depo`yu kontrol ettir.
- **Dev transcript** → kuyruk tavanı script'te (64KB); `--tail` ile daralt.
- **cwd çözülemedi** → plan/DEVRALIS/git boş, `uyarilar[]`de ilan edilir; brifte
  `## Açık sorular`a taşı.
- **Başka hesabın deposu** → `uyarilar[]` bunu söyler; `meta.hardResume` null'dur
  (çalışmayacak komut önerilmez).
