# KUZEY
### kutup yıldızı · projenin ürün şartnamesi

> Bu belge projenin **ulaşması istenen nihai davranışını** tanımlar — bugünkü durumunu değil.
> Bir **procurement şartnamesi / ürün tarifi**dir: kullanıcı, isteklerini ve elde etmek
> istediklerini burada SET eder — ihtiyaçlar, talepler, spesifikasyonlar, yerine getirilecek
> requirement'lar, end-state'te sunulacak imkânlar. Yaşayan sistem hedeflerini buradan türetir.
>
> **— nasıl okunur —**
> - Yıldız **iki katmandır**: `vizyon/` (şartname **bölümleri** — her biri bir davranış
>   alanının gereksinimleri) ve `istek/` (tipli envanter — doğrudan verilen girdiler).
> - **Bölüm sayısı sabit değildir** — vizyon koşusu (`/vizyoner`) yeni ihtiyaç alanı çıktıkça
>   yeni bölüm açar.
> - Dil **şartname dilidir**: maddeli gereksinim + kabul ölçütü + `▸ bugün nerede` kıyası.
>   Şiirsel/metaforik anlatım kullanılmaz.
> - Her madde/giriş bir **çıpa** taşır (`<!-- uy:<tip-veya-bölüm>/<slug> -->`) — damıtma
>   bunları kimlik sayar. Giriş biçimi ve dönüşüm yetkisi: [KURALLAR.md](KURALLAR.md).
> - Bu belge kod değişince **bayatlamaz**; yalnız vizyon sahibinin kararıyla değişir.

## Amaç ve kapsam

ReklamZeka, Doruk Sağlık Grubu'nun Meta reklam operasyonu için **brief-temelli,
kontrol-öncelikli, sürekli çalışan bir reklam yardımcı ajanıdır**. Nihai durumda
kullanıcıya sunulan: Meta reklam verisi kayıpsız kendi ambarında durur; her İç Kampanya
kullanıcının brief'ine ve amaç kapsamından türeyen rubriğe göre iki düzeyde (birim +
portföy) değerlendirilir; bütçe/portföy önerileri gerekçeli diff'ler olarak onay
kuyruğuna düşer; Meta'ya dokunan her yazma insan onayından geçer ve append-only karar
günlüğüyle izlenir; digest bir ürün olarak üretilip kanallara (Telegram, panel, …)
dağıtılır; metin yazarlığı kısıtlarını kullanıcı koyar, sistem mekanik uygular. AI
vardır ama otonom değildir; brief'e bağlanamayan öneri üretilmez. Bu şartname beş
davranış alanını tanımlar: veri edinimi, brief yargısı, insan hakimiyeti, uyum güveni,
açık uçlu büyüme.

## Şartname bölümleri (vizyon/)

| # | bölüm | kapsadığı davranış alanı | durum |
|---|---|---|---|
| 1 | [veri-gercegi](vizyon/1-veri-gercegi.md) | Meta verisinin kayıpsız, dayanıklı, eşleme-bütün edinimi | taslak (2026-08-06) |
| 2 | [brief-yargisi](vizyon/2-brief-yargisi.md) | brief'e/rubriğe bağlı iki-düzey değerlendirme; ölçülemeyen dürüstlüğü | taslak (2026-08-06) |
| 3 | [insan-hakimiyeti](vizyon/3-insan-hakimiyeti.md) | diff→onay hattı, PAUSED garantisi, karar günlüğü, digest=ürün | taslak (2026-08-06) |
| 4 | [uyum-guveni](vizyon/4-uyum-guveni.md) | kullanıcı-tanımlı metin kural motoru, pasif başlangıç paketi, KVKK sınırı | taslak (2026-08-06) |
| 5 | [acik-uclu-buyume](vizyon/5-acik-uclu-buyume.md) | dikey-agnostik motor, konfigle genişleme, CRM v2 kapısı | taslak (2026-08-06) |

## İstek envanteri (istek/)

| tip | dosya | ne |
|---|---|---|
| hedef | [istek/hedefler.md](istek/hedefler.md) | ulaşılması istenen genel hedefler |
| yetenek | [istek/yetenekler.md](istek/yetenekler.md) | edinilecek capability'ler |
| nitelik | [istek/nitelikler.md](istek/nitelikler.md) | kalite · eşik · titizlik seviyeleri |
| ilke | [istek/ilkeler.md](istek/ilkeler.md) | kalıcı kısıtlar — **PM her koşumda okur** |
| alt-proje | [istek/alt-projeler.md](istek/alt-projeler.md) | direkt verilen büyük işler |
