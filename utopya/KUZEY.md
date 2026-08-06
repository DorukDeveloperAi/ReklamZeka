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

ReklamZeka; ajansların ve şirket içi pazarlama ekiplerinin ücretli medya verisini tek
bir yerde görmesini, kanıtı açıklanabilir içgörüler üretmesini ve alınacak aksiyonları
insan onayıyla yönetmesini sağlayan çok kiracılı bir karar destek ürünüdür. İlk ürün
Meta Ads ve Google Ads için salt-okunur veri toplama, ortak metrik modeli, performans
ve anomali görünümü, açıklanabilir öneriler ve paylaşılabilir raporlar sunar.

İlk sürüm reklam hesabında otomatik değişiklik yapmaz. Nihai ürün; kullanıcının
iç kampanya kategorilerini ve talimatlarını, Meta kampanya→reklam seti→reklam→kreatif
yapısını, zaman serisini ve bütçe taahhütlerini birlikte değerlendirir. Bütçe ve durum
değişiklikleri ancak ayrı scope, dry-run, etki önizleme, risk valfi, insan onayı,
idempotency, read-after-write ve geri alma tasarımı tamamlandıktan sonra açılır.

## Şartname bölümleri (vizyon/)

| # | bölüm | kapsadığı davranış alanı | durum |
|---|---|---|---|
| 1 | [ürün ve MVP kapsamı](vizyon/1-urun-ve-mvp.md) | kullanıcı, değer, veri, içgörü, güvenlik ve başarı | başlangıç şartnamesi |
| 2 | [Meta reklam işletim sistemi](vizyon/2-analiz-platformu.md) | dijital ikiz, kategori/talimat, analiz, bütçe, prompt, schedule, eylem ve kontrol merkezi | genişletilmiş şartname |

## İstek envanteri (istek/)

| tip | dosya | ne |
|---|---|---|
| hedef | [istek/hedefler.md](istek/hedefler.md) | ulaşılması istenen genel hedefler |
| yetenek | [istek/yetenekler.md](istek/yetenekler.md) | edinilecek capability'ler |
| nitelik | [istek/nitelikler.md](istek/nitelikler.md) | kalite · eşik · titizlik seviyeleri |
| ilke | [istek/ilkeler.md](istek/ilkeler.md) | kalıcı kısıtlar — **PM her koşumda okur** |
| alt-proje | [istek/alt-projeler.md](istek/alt-projeler.md) | direkt verilen büyük işler |
