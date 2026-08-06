# CLAUDE.md sözleşmesi — bu dosyaya ne girer, ne girmez

> **Neden bu sözleşme var.** `CLAUDE.md` ve `@` ile çektiği her belge, o projedeki **her
> oturumun her isteğinde** context'e girer. Ölçüm (2026-07-27): bir projede zincir
> **150.010 B ≈ 46.900 token**, başka birinde 98.471 B ≈ 30.772 token — ve ikincisinin
> ~12.600 token'ı **aynı metnin ikinci kopyasıydı**. Kimse kötü niyetle yazmadı; herkes
> "şunu da bilsin" diye tek bir bölüm ekledi. Tavansız bir dosyada her ekleme makuldür.
>
> Sınıf: bu belge **kanondur**. Ölçen kapı: `aide claudemd` — **deterministik, 0 token**.

## Tek ölçüt

> **CLAUDE.md DAVRANIŞ dosyasıdır, BİLGİ deposu değildir.**

Bir satırı eklemeden önce tek soru sorulur:

**"Bu satır silinseydi model YANLIŞ DAVRANIR mıydı, yoksa yalnızca BİLGİSİZ mi kalırdı?"**

- **Yanlış davranırdı** → TALİMAT. Burada yaşar.
- **Bilgisiz kalırdı** → o bilgi kendi dosyasında yaşar; buraya **tek satırlık atıf** düşer.

Bilgisizlik ucuzdur: model gerektiğinde dosyayı okur. Yanlış davranış pahalıdır: model o
dosyayı okumayı hiç akıl etmez. Ayrım budur.

## Ne girer

| girer | örnek |
|---|---|
| **Sistematik kodlama/analiz talimatı** | efor kademesi · "önce ölç, sonra hüküm ver" · test etmeden bitti deme |
| **Model ve ajan politikası** | hangi iş hangi tier · Fable yürütmez, Opus planlamaz |
| **Çalışma protokolü** | claim al/bırak · commit sözleşmesi · tur-sonu DURUM bloğu |
| **Projenin sarsılmaz mimari kısıtı** | "atomik birim SATIR'dır" · "INDEX asla elle yazılmaz" |
| **ATIF** — bir satır, kopya değil | `Detay: docs/MIMARI.md` |

Ölçüt: hepsi **jenerik ve süreklidir**. Bugün doğruysa yarın da doğrudur; bir işin
bitmesiyle yalanlaşmaz.

## Ne girmez — ve nerede yaşar

| girmez | doğru yeri |
|---|---|
| **Tamamlananlar · yapılanlar · değişiklik kaydı** | `docs/DURUM.md` (türev) · `docs/gunluk/` · git geçmişi |
| **Nerede kaldık · aşama durumu** | `plans/<slug>/v<N>/STATE.md` |
| **Yol haritası · roadmap · aşama listesi** | `plans/<slug>/v<N>/` |
| **Mimari döküm · tasarım sistemi · API/şema kanonu** | `docs/MIMARI.md` · `docs/ADR.md` · ilgili kanon |
| **Kontrol seti · parametre tabloları · varyant listeleri** | ilgili spec belgesi (`docs/`) |
| **İstek · vizyon · şartname** | `utopya/` |
| **Başka bir kanonun kopyası** | **hiçbir yerde** — kanon tektir, buraya atıf düşer |
| **Kurulum/komut kılavuzu** | `docs/KURULUM.md` · `README.md` |

## İki sert kural

**K1 — KOPYA YASAK.** Bir metin iki yerde yaşayamaz. Zincirde aynı içerik iki kez
görünüyorsa (ev kopyası + proje kopyası dahil) bu **FAIL**'dir, üslup tercihi değil.
İki kopya er geç ayrışır ve hangisinin doğru olduğunu kimse bilemez.

**K2 — TAVAN GERÇEKTİR.** Tavan aşıldığında "bu bölüm gerçekten gerekli" tartışması
açılmaz; en büyük bölüm kendi dosyasına taşınır ve yerine atıf düşer.

| ölçü | uyarı | FAIL |
|---|---|---|
| `CLAUDE.md` dosyasının kendisi | > 6 KB | > 12 KB |
| zincir toplamı (`@` import dahil) | > 40 KB | > 80 KB |
| zincirde yinelenen içerik | — | herhangi biri |

**Seviye-0 rezervi (plan kararı 2026-07-29, `seviye-0-otonomi/v1` aşama 03).** 40 KB'lık
uyarı eşiğinin **4–6 KB'ı seviye-0 talimatlarına ayrılmıştır** — session-yerleşik taban
(devir notu · açılış devralma · limit nabzı · stop dalı) davranışı `CLAUDE.md`'den yönetir
ve o satırlar TALİMATtır, taşınamaz. Dolayısıyla **aide'ın kendi halkaları ≤ ~35 KB
hedefler**; zincir 35 KB'ı aşıyorsa rezerv yenmeye başlamıştır ve en ağır halka
tıraşlanır. Bu bir plan kararıdır, evrensel kural değil: `claudemd.ts`'teki `TAVAN`
sabitleri DEĞİŞMEZ (kapı hâlâ 40/80 KB ölçer; rezerv insanın okuduğu bir bütçe payıdır).

## Taşıma nasıl yapılır

Bölüm silinmez — **taşınır ve yerine atıf düşer**. Bilgi kaybı taşımanın bedeli değildir:

```md
## Kontrol seti
Detay: `docs/KONTROL-SETI.md` (kanon; buraya kopyalanmaz).
```

Atıf **tek satırdır**. "Özet olsun bari" diye eklenen üç paragraf, taşımayı geri alır.

## Ölçüm

```sh
aide claudemd            # zincir tablosu: ne, kaç KB, kaç token, yineleme var mı
aide claudemd --kuru     # ne taşınmalı — onar: satırlarıyla
aide claudemd doctor     # KAPI: FAIL'de exit 1
```

Kapı deterministiktir (LLM doğurmaz, 0 token). Ölçemediği şeyi **muaf ilan eder**:
bir bölümün "talimat mı bilgi mi" olduğuna kapı karar veremez — onu yazan karar verir,
kapı yalnız **boyutu, yinelenmeyi ve yasak başlık desenlerini** ölçer.
