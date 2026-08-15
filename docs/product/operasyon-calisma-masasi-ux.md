# ReklamZeka Operasyon Çalışma Masası — Ürün ve UX Kararı

## Amaç

ReklamZeka, Meta reklam operasyonunu çok sayıda bağımsız ekranla değil; kanıtı
görmek, kapsamı seçmek, kullanıcının kuralını yönetmek ve gerektiğinde Agent ile
incelemek için sade bir çalışma sistemiyle sunar.

Bu belge, önceki navigasyon kararlarını aşağıdaki ürün modeliyle tamamlar:

`genel bakış → seçili portföy/slice → kullanıcı kuralı → analiz/agent → insan kararı → karar izi`

Meta write, otomasyon ve policy yayınlama bu UX kararının parçası değildir. Bunlar
ancak mevcut ayrı, insan-kapılı capability akışlarında ve feature flag kapalı
kalacak biçimde görünür.

## Ana sürücü için bağlayıcı ürün felsefesi

Bu belge, ana sürücünün implementation kararlarında şu somut yorumla uygulanır:

- Kullanıcının günlük başlangıç noktası geniş metrikli **Ana Sayfa**dır; bunun
  görevi karar vermek değil, nereye bakılması gerektiğini dürüstçe göstermektir.
- Kampanya grubu, ana kampanya ve slice; kullanıcının operasyonel kapsamlarıdır.
  Her kapsamın sonuç, harcama, bütçe, sağlık ve kullanıcı kuralı aynı çalışma
  bağlamında incelenebilir.
- Bir kural, analiz yaklaşımı, bütçe sınırı ve takip penceresi kullanıcıya aittir.
  Agent bu özü yazmaz; yalnız kapsam, veri eksikliği, çelişki ve kanıt sorularını
  görünür kılar.
- Aynı işlevin ana sayfa, çalışma masası veya kural kütüphanesinde erişilebilir
  olması serbesttir. Ancak görünüm tekrar edebilirken kayıt/ownership tekrar
  edemez: aynı `ruleRef/revision`, aynı slice, aynı Agent konuşması ve aynı karar
  izi kullanılır.
- Analiz ile uygulama ayrı katmanlardır. Belirsiz/kısmi kanıt “pahalı”,
  “kazanan” ya da “başarısız” hükmüne; öneri ise Meta aksiyonuna dönüşmez.
- Arayüz önce sade, insan-dili açıklamasını sunar. Teknik ref/hash/DSL yalnız
  gerekirse kanıt ayrıntısında kalır. Renkler sınırlı, soft ve durumun tek
  göstergesi değildir.

## Tek kayıt, çok görünüm

Aynı bilgi birden fazla ekranda görünebilir; fakat ikinci bir kayıt ya da ikinci
bir sahip oluşmaz.

| Kanonik kayıt | Sahibi | Nerede görünür |
|---|---|---|
| Meta hesap/hiyerarşi/performans | Salt-okunur Meta aynası | Ana Sayfa, Portföy/Slice masası |
| Kampanya grubu, ana kampanya, slice | Kullanıcı tanımlı kapsam | Masa, slice detayı, bağlı kural |
| Kural ve revizyonu | Kullanıcı | Kural Kütüphanesi, slice içi bağlamlı düzenleme |
| Analiz ve zaman penceresi kanıtı | Frozen context/analiz ledger'ı | İncele çekmecesi, karar izi |
| İnsan kararı | Approval ledger | Onay alanı, karar izi |
| Agent konuşması | Tek kalıcı konuşma | Global Agent paneli; kaynak ekran yalnız bağlam ekler |

## Ana yüzeyler

### 1. Ana Sayfa — Genel Bakış

**Sorusu:** Bugün nerede inceleme, risk veya fırsat var?

- Hesaplar ve slice'lar üstü performans/hacim özeti.
- Veri sağlığı, freshness, ödeme/delivery sinyalleri ve eksik kapsam.
- Değişim özeti ile öncelikli giriş noktaları.
- Her kart, yeni veri yaratmadan Portföy/Slice masasında doğru kapsamı açar.

Bu sayfa metrik bakımından geniştir; bir kuralı veya tek kampanyayı işletmenin ana
yeri değildir.

### 2. Portföy / Slice Çalışma Masası

**Sorusu:** Bu seçili kapsam nasıl çalışıyor ve neyi incelemeliyim?

Varsayılan operasyon yüzeyidir. Tek hiyerarşik masa şunları birlikte sunar:

| Katman | Sonuç | Harcama | Bütçe | Veri durumu | Kural / Not | İşlem |
|---|---:|---:|---:|---|---|---|
| Hesap | | | | | | |
| Kampanya grubu | | | | | | |
| Ana kampanya | | | | | | |
| Slice | | | | | | |
| Meta kampanya / reklam seti / reklam | | | | | | |

- Meta hiyerarşisi ile kullanıcı tanımlı katmanlar aynı nesne gibi gösterilmez;
  tanımlı kapsam ayrı işaretlenir.
- Satır eylemleri: **İncele**, **Kuralı aç**, **Agent'a sor**. Bunlar seçili
  bağlamı taşır; yeni sayfa ya da kopya kayıt oluşturmaz.
- Satır ayrıntısı sağ panelde/açılır alanda açılır: performans kanıtı, ayna
  freshness'i, bağlı Meta nesneleri, kural özeti ve geçmiş.
- İkincil veri yatay kaydırma veya “Ayrıntılar” altında bulunur; mobilde seçili
  satır tam ekran sheet'e dönüşür.

### 3. Kural Kütüphanesi

**Sorusu:** Hangi kullanıcı kuralları var ve hangi kapsamda geçerli?

- Kural-merkezli toplu liste, arama ve kapsam/durum/sahip filtreleri.
- Her kuralın bağlı slice'ları, revizyonu, öneri/insan-onayı modu ve kanıt
  hazırlığı görünür.
- Slice masasındaki “Kuralı aç” aynı kanonik kaydı açar. Yeni/kopya kural
  oluşturmaz.
- Kural özünü, kapsamını, kısıtını, izleme penceresini ve geri alma koşulunu
  yalnız kullanıcı yazar/değiştirir. Agent formu otomatik doldurmaz.

### 4. Agent — Tek Yardımcı Katmanı

**Sorusu:** Bu bağlamı kanıt ve belirsizlikleriyle nasıl anlamalıyım?

- Her ekrandan açılan tek kalıcı konuşma.
- Kaynak ekran yalnız güvenli bağlam özeti ekler: sayfa amacı, seçili slice/kural
  veya portföy kapsamı, kaynak durumu.
- Her yanıtta seçilen skill, kanıt tazeliği/kapsamı, belirsizlik ve bağlı
  kullanıcı playbook/soru seti makbuzu görünür.
- Agent kural, policy, action metni oluşturmaz; kaydetmez, onaylamaz veya
  Meta'da işlem yapmaz.

### 5. İncele, Onay ve Geçmiş

Bu üçü günlük navigasyon hedefi değil; seçili kapsamdan açılan ikincil katmanlardır.

- **İncele:** zaman penceresi, eşdeğer kohort, kanıt, yetersiz veri ve senaryo.
- **Onay:** yalnız insan kararının kaydı; execution değildir.
- **Geçmiş:** kural → gözlem → öneri → insan kararı → sonuç ilişkisi.

### 6. Ayarlar ve Tanımlar

Meta bağlantısı, kategori/künye registry'si, şablonlar ve benzeri ileri tanımlar
günlük çalışma yüzeyinin dışında tutulur.

## Durum dili ve aşamalı açılım

- Her kaynak açıkça `hazır`, `kısmi`, `boş`, `kullanılamıyor` veya `demo` diye
  adlandırılır. Kısmi veri sıfır ya da kesin metrik gibi gösterilmez.
- İlk katmanda yalnız bağlam, temel metrikler ve tek sonraki eylem vardır.
- Hover/focus kısa açıklama verir. Sağ tık masaüstünde bağlamı sabitler; mobilde
  aynı işlev görünür üç-nokta menüsünde bulunur. Klavye ile Enter/Space açar,
  Escape kapatır.
- Teknik kimlikler, hash'ler ve DSL varsayılan görünümde yoktur; gerekirse yalnız
  Kanıt ayrıntısı içinde gösterilir.
- Tema; yumuşak Meta esintili ana tonlar, sınırlı accent rengi ve eşdeğer light/
  dark kontrastları kullanır. Renk hiçbir zaman tek durum göstergesi değildir.

## Uygulama sırası

1. Ana Sayfa ile Portföy/Slice masasının URL, kapsam ve giriş noktalarını tek
   kanonik bağlam modelinde birleştir.
2. Hiyerarşik Portföy/Slice masa kabuğunu ve sağ ayrıntı panelini oluştur.
3. Kural Kütüphanesi ↔ slice içi bağlamlı kural düzenleme handoff'unu aynı
   `ruleRef/revision` üzerinde kur.
4. Global Agent'ın sayfa/slice/kural bağlamı ekleme yüzeyini sadeleştir.
5. İncele/Onay/Geçmiş çekmecelerini bağla; kaynak sınırı ve zero-Meta-write
   kabulünü koru.
6. Light/dark tema, responsive masa, klavye, tooltip/sağ-tık eşdeğerliği ve
   boş/kısmi/hata kabulünü tamamla.

## Kabul ölçütleri

- Bir kullanıcı ana sayfadan bir uyarı veya metriği doğru Portföy/Slice kapsamına
  taşıyabilir.
- Aynı kural, hem kütüphanede hem bağlı slice'ta aynı ref/revision olarak görünür.
- Agent konuşması sayfa başına ayrışmaz; yalnız görünür güvenli bağlam değişir.
- Eksik/kısmi kaynakta sahte performans, otomatik kategori veya action oluşmaz.
- Hiçbir yüzey Meta write, policy publish/approval veya otomasyon yetkisi açmaz.

## Ana hedef yürütme sözleşmesi

Bu belge, aktif ana hedefin ürün yorumudur. Teslimler aşağıdaki felsefeye
uygun olmadıkça tamamlanmış sayılmaz:

- ReklamZeka, Meta'yı kendiliğinden yöneten bir kara kutu değil; kanıt-temelli,
  insan liderliğinde ve agent destekli bir operasyon masasıdır.
- Döngü `Meta aynası + içerik + zaman → künye/slice → analiz → kullanıcı
  kuralı → öneri → insan kararı → kontrollü uygulama → sonuç/audit`tir.
- Kullanıcı kuralın, playbook'un ve policy taslağının yazarıdır. Agent yalnız
  kanıtı, eksikleri, belirsizliği, eşdeğer kohort sınırını ve sorulması gereken
  soruları görünür kılar; kural/policy/action metni üretmez veya kalıcılaştırmaz.
- Yerli ve yabancı kesin olarak ayrıdır. İsim; Meta kurulumu, hedefleme,
  platform, geo, sonuç rotası ve creative içeriğinden güçlü bir kanıt değildir;
  kanıtlar çatışıyorsa inceleme kuyruğu açılır.
- ``Pahalı``, ``kazanan`` veya ``başarısız`` gibi kesin dil, yeterli zaman
  penceresi ve eşdeğer kohort olmadan kullanılmaz. Sistem bunun yerine
  `belirsiz`, `yetersiz veri` veya `izlemeye devam` der.
- Ana Sayfa geniş yön bulma yüzeyidir; Portföy/Slice masası derin çalışmadır;
  Kural Kütüphanesi tek kanonik kullanıcı kaydıdır; Agent tek kalıcı
  konuşmadır. Görünümler bağlamsal olarak tekrar edebilir ama sahiplik/kayıt
  çoğaltılamaz.
- Arayüz Türkçe, sade, soft Meta tonlarında light/dark, progressive disclosure
  ilkeli ve teknik ayrıntıları varsayılan olarak gizleyen bir çalışma aracıdır.
- Meta write altyapısı ancak ileride pilot için hazırlanır; bu hedef kapsamında
  feature flag kapalı kalır. Her teslim zero-Meta-write, tenant isolation,
  kaynak durumu ve insan onayı sınırlarını korur.
