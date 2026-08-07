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

Bu şartnamenin bütün görüşmelerden damıtılmış çalışma özeti
[kanonik ürün distilasyonu](../docs/product/reklamzeka-product-distillation.md)dır. KUZEY
nihai isteği, distilasyon sistem davranışını, v2 MASTER ise teslim sırasını tanımlar.

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

Nihai ürün yayındaki reklamların gerçek metin/CTA/destination/post kimliğini kaynak
provenance ile okur; yeni reklam metni, görseli, videosu, kreatif varyantı veya serbest
hedef kitle üretmez. Bağlı Instagram/Page gönderisi yalnız yayınlanmış, sürümlü bir
promotion şablonu ve immutable ön ayarlı hedef kitleyle reklamlaştırılabilir. Gönderi,
şablon/hedef kitle, hedef yapı, bütçe, create/publish ve activate kararları ayrı atomik
onaylardır; paket görünümü zımni toplu onay değildir. İlk production execution profili
approval-only'dır ve agent, schedule, süre sonu veya alt scope bu kilidi genişletemez.

Dashboard ile açık Codex CLI/VS Code, Claude Code veya başka yerel MCP-capable AI CLI
session'ı aynı tenant-scoped bağlamı, proposal kayıtlarını, action queue'yu ve timeline'ı
kullanır. ReklamZeka model-provider API anahtarı saklamaz ve model API'si çağırmaz; yerel
CLI kendi login/session'ıyla localhost/STDIO MCP'ye bağlanır. Session içindeki insan onayı
agent tool çağrısı değil, dashboard veya yerel human-presence doğrulamalı companion yoludur.
Meta Graph veri ve reklam eylemi bağlantısı bu model-provider sınırından ayrıdır.

Ana ürün deneyimi bir **Operating Dashboard + ReklamZeka Orchestrator Agent** ikilisidir.
Dashboard periyodik veri, deterministik ön işleme, kampanya/bütçe/kural yönetimi, scheduled
analysis, approval inbox ve timeline'ın kalıcı yüzeyidir. Orchestrator aynı state üzerinde
Campaign Context Resolver, Analysis Director, Budget Steward, Rule Coach, Decision Cadence
Guard ve Action Proposal Builder rollerini vendor-agnostic skill'ler olarak kullanır.
Kullanıcı bu agent ile yalnız analiz yapmaz; kendi hassasiyetini ilgili Meta context ve
kaynaklı practice'lerle birlikte guidance/policy/practice haline getirirken de çalışır.

Otonomi tek bir aç/kapa düğmesi değildir: analiz, öneri, bütçe azaltma/artırma, pause/
activate ve post promotion gibi action türleri; workspace/account/internal category/
campaign scope'u ve risk sınıfına göre ayrı sınırlandırılır. Alt scope üst sınırdan daha
özgür olamaz. Dashboard aktif effective autonomy'yi gösterir; agent her proposal'da neden
otomatik çalıştığını veya neden onaya sunduğunu açıklar.

Kullanıcının şahsi strateji/anlatımları ile kaynaklı Meta best-practice bilgisi, yerel
agent session'ında kritik ve karşılaştırmalı bir sohbetle GuidanceCard/Set olarak gelişir.
Her düşünce ilk günden katı kurala çevrilmez: doğal dil guidance global, hesap grubu/hesap,
Meta amacı, iç kategori, entity ve analiz başlığına bağlanıp sıralı analizlerde geri gelir;
yalnız harcama veya yetkiyi bağlayacak olgun maddeler replay/impact/onayla deterministik
policy'ye yükseltilir. Karar temposu, learning/cooldown, observation window, kontrollü
deney ve geçerli `no-change` sonucu gereksiz hiperaktif optimizasyonu engeller.

Bu sohbetlerde birlikte geliştirilen tekrar kullanılabilir yöntem `AdvisedPractice` olarak
trial ve outcome ile izlenir; official best-practice veya algoritmik kural sayılmaz.
Standardizasyon daha sonra açık review ile yapılır: practice'in hesaplanabilir kısmı feature/
guardrail, soru sırası agenda/playbook, iş nüansı guidance, riskli karar insan onayı olarak
ayrılabilir. Sistem sessizce öğrenip kural değiştiremez.

Ham Meta verisi agent'a yığılmaz. PostgreSQL tabanlı L0 raw→L1 canonical→L2 feature→L3
window/rollup→L4 evidence→L5 compact context hattı ve frozen EffectiveCampaignContext
kullanılır. İlk teslim modular monolith+Postgres'tir; vector DB, warehouse, event bus ve
microservice ancak ölçülen ihtiyaçla gelir. Geliştirme read mirror→decision room→budget lab→
approval-only operations→existing-post promotion→selective standardization dilimleriyle ilerler.

## Şartname bölümleri (vizyon/)

| # | bölüm | kapsadığı davranış alanı | durum |
|---|---|---|---|
| 1 | [ürün ve MVP kapsamı](vizyon/1-urun-ve-mvp.md) | kullanıcı, değer, veri, içgörü, güvenlik ve başarı | başlangıç şartnamesi |
| 2 | [Meta reklam işletim sistemi](vizyon/2-analiz-platformu.md) | dijital ikiz, kategori/talimat, analiz, bütçe, şablonlu post promotion, yerel AI CLI/MCP, atomik approval-only eylem ve kontrol merkezi | genişletilmiş şartname |

## İstek envanteri (istek/)

| tip | dosya | ne |
|---|---|---|
| hedef | [istek/hedefler.md](istek/hedefler.md) | ulaşılması istenen genel hedefler |
| yetenek | [istek/yetenekler.md](istek/yetenekler.md) | edinilecek capability'ler |
| nitelik | [istek/nitelikler.md](istek/nitelikler.md) | kalite · eşik · titizlik seviyeleri |
| ilke | [istek/ilkeler.md](istek/ilkeler.md) | kalıcı kısıtlar — **PM her koşumda okur** |
| alt-proje | [istek/alt-projeler.md](istek/alt-projeler.md) | direkt verilen büyük işler |
