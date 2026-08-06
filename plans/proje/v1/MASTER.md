# ReklamZeka MVP — MASTER (v1)

> Üretici: /plan-kur uyumlu başlangıç · Tarih: 2026-08-06 · Kaynak görev: "iyileştirmelerini ekle ve planı hayata geçirelim"
> Kategori: proje · Üst: —
> Kritiklik: yüksek · Aciliyet: normal · Hacim: epik
> Hedef: ReklamZeka, iki reklam platformundan salt-okunur veri alan ve açıklanabilir öneri sunan güvenli bir pilot ürüne dönüşür.
> Oturum: ot:2026-08-06/reklamzeka-baslangic
> Sürüm: v1

## Amaç ve başarı tanımı

Boş ürün kabuğunu; ürün şartnamesi, güvenli çok kiracılı veri temeli, iki platformlu
veri akışı, performans deneyimi, açıklanabilir içgörü ve ölçülen pilotla çalışan bir
MVP'ye dönüştürmek.

**BAŞARI =** Aşamaların tamamı KAPALI, `.claude/kanit.json` hızlı ve tam kanıtları temiz,
pilot başarı raporu en az 3 çalışma alanı/10 hesap için şartname eşiklerini gösteriyor ve
kritik güvenlik bulgusu bulunmuyor.

**Durma kuralı:** Bir aşama aynı kabul kriterinde iki uygulama turu sonunda ilerlemiyorsa
`BLOKE` olur; kanıt, kök neden ve kullanıcıdan gereken karar STATE'e yazılmadan kapsam
daraltılmaz. Reklam hesabına yazma yeteneği bu plan içinde açılmaz.

## Aşamalar ve bağımlılık grafiği

| # | aşama | SONUÇ (bitince dünya nasıl?) | bağımlı | dosya |
|---|---|---|---|---|
| 01 | ürün temeli | Ürün tezi, MVP sınırı, ölçülebilir şartname ve kanıt zinciri kanoniktir. | — | [asama-01-urun-temeli.md](asama-01-urun-temeli.md) |
| 02 | teknik temel | Seçilen mimariyle yerelde ve CI'da çalışan güvenli uygulama iskeleti vardır. | 01 | [asama-02-teknik-temel.md](asama-02-teknik-temel.md) |
| 03 | veri platformu | Meta/Google fixture ve CSV verisi idempotent kanonik modele akar. | 02 | [asama-03-veri-platformu.md](asama-03-veri-platformu.md) |
| 04 | kiracı güvenliği | Kimlik, üyelik, sır yönetimi ve audit sınırları entegrasyon testleriyle zorlanır. | 02 | [asama-04-kiraci-guvenligi.md](asama-04-kiraci-guvenligi.md) |
| 05 | performans deneyimi | Kullanıcı taze ve kaynaklı metrikleri genel bakıştan kampanyaya inceleyebilir. | 03, 04 | [asama-05-performans-deneyimi.md](asama-05-performans-deneyimi.md) |
| 06 | içgörü motoru | Sapmalar açıklanabilir, yeniden üretilebilir önerilere dönüşür. | 03, 04 | [asama-06-icgoru-motoru.md](asama-06-icgoru-motoru.md) |
| 07 | rapor ve pilot | Paylaşım, geri bildirim, gözlemlenebilirlik ve kontrollü pilot uçtan uca çalışır. | 05, 06 | [asama-07-rapor-ve-pilot.md](asama-07-rapor-ve-pilot.md) |

## /goal komutları

```text
/goal plans/proje/v1/asama-02-teknik-temel.md planını uygula; bitince aynı klasördeki STATE.md ve CHECKLIST.md'yi güncelle; kanıt yollarını STATE.md'ye yaz
/goal plans/proje/v1/asama-03-veri-platformu.md planını uygula; bitince aynı klasördeki STATE.md ve CHECKLIST.md'yi güncelle; kanıt yollarını STATE.md'ye yaz
/goal plans/proje/v1/asama-04-kiraci-guvenligi.md planını uygula; bitince aynı klasördeki STATE.md ve CHECKLIST.md'yi güncelle; kanıt yollarını STATE.md'ye yaz
/goal plans/proje/v1/asama-05-performans-deneyimi.md planını uygula; bitince aynı klasördeki STATE.md ve CHECKLIST.md'yi güncelle; kanıt yollarını STATE.md'ye yaz
/goal plans/proje/v1/asama-06-icgoru-motoru.md planını uygula; bitince aynı klasördeki STATE.md ve CHECKLIST.md'yi güncelle; kanıt yollarını STATE.md'ye yaz
/goal plans/proje/v1/asama-07-rapor-ve-pilot.md planını uygula; bitince aynı klasördeki STATE.md ve CHECKLIST.md'yi güncelle; kanıt yollarını STATE.md'ye yaz
```

## Global requirements

→ [REQUIREMENTS.md](REQUIREMENTS.md)

## Riskler

- Platform API ve attribution farkları yanlış karşılaştırma üretebilir — kaynak, para birimi, saat dilimi ve attribution görünür kalır.
- OAuth ve çok kiracılı veri yüksek güvenlik riski taşır — salt-okunur scope, şifreli sır, sunucu tarafı üyelik ve negatif test zorunludur.
- “AI önerisi” güveni kanıtsız büyütebilir — ilk motor deterministik kurallar ve sürümlü hesaplamayla başlar; LLM karar kaynağı olmaz.
- İki connector aynı anda kapsamı büyütebilir — CSV ve fixture ile sözleşme önce kapanır; canlı connector sırası keşif kararına göre uygulanır.

## İLAN EDİLMİŞ muafiyetler

- Otomatik reklam hesabı değişikliği — ilk pilotta geri alınamaz risk; ürün ilkesi gereği salt-okunur.
- Self-service faturalandırma — pilot değerini kanıtlamaz; ticari pilot elle yönetilir.
- Meta/Google dışı connector — ortak model doğrulandıktan sonra ayrı özellik planıdır.
- Çoklu dokunuş attribution ve kreatif üretimi — ayrı ürün yeteneği, MVP karar desteğinin önkoşulu değildir.
