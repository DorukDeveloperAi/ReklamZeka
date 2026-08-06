# İSTEK · ilkeler
### adhere edilmesi gereken rules & principles — kalıcı kısıtlar

> **Bu dosyayı PM her koşumda okur.** Buradakiler hedefe DÖNÜŞMEZ — bu projede karar alınırken
> hep gözetilen kısıtlardır; damıtma bunlardan chunk üretmez. İlkeler proje-spesifiktir.
>
> ```
> <!-- uy:ilke/ornek-slug -->
> ## Örnek ilke başlığı
> İlkenin kendisi + niçin var olduğu — tek paragraf, kesin dille.
> ```

<!-- uy:ilke/insan-onayi -->
## Reklam hesabı değişikliklerinde insan onayı
Ürün ilk sürümde reklam platformlarında bütçe, teklif, durum veya kreatif değişikliği yapmaz; ileride eklenecek her yazma yeteneği açık yetki, değişiklik önizlemesi, insan onayı, idempotency anahtarı ve geri alma planı taşır. İlk production profili approval-only'dır; schedule, agent, expiry veya alt scope bu kilidi kendiliğinden genişletemez.

<!-- uy:ilke/kaynak-korunur -->
## Kaynak ve hesaplama izi korunur
Normalleştirme hiçbir platform alanının kaynağını belirsizleştiremez; türetilmiş her metrik formül sürümünü ve kaynak kayıt bağını korur.

<!-- uy:ilke/en-az-yetki -->
## En az yetki ve kiracı izolasyonu
Bağlantılar mümkün olan en dar salt-okunur kapsamla kurulur; kimlik bilgileri loglara yazılmaz ve bir çalışma alanının verisi başka bir çalışma alanından hiçbir uygulama yoluyla okunamaz.

<!-- uy:ilke/kanit-once -->
## Öneriden önce kanıt
Bir içgörü veri kalitesi veya örneklem yetersizliği nedeniyle güvenilir değilse sistem kesin öneri üretmek yerine belirsizliği ve eksik kanıtı gösterir.

<!-- uy:ilke/kampanya-amaci-once -->
## Değerlendirmeden önce kampanya amacı
Bir kampanyanın başarısı, doğrulanmış amacı ve optimizasyon olayı bilinmeden tek bir genel KPI ile hükme bağlanamaz. Amaç eşlemesi belirsizse sistem kullanıcı onayı ister; farklı amaçların KPI'larını doğrudan sıralamaz.

<!-- uy:ilke/prompt-politikayi-degistiremez -->
## Kullanıcı promptu platform politikasını değiştiremez
Kullanıcı anlatım tercihi system/developer talimatına doğrudan eklenmez; tenant, veri, araç, timeframe, kanıt ve reklam hesabına yazmama sınırlarını genişletemez. Model yalnız deterministik finding kayıtlarını kanıt kimliğiyle açıklayabilir.

<!-- uy:ilke/talimat-once-ama-guvenlik-ustu-degil -->
## Kullanıcı talimatı explicit ve izlenebilirdir
Kilitli kullanıcı talimatı metrik tavsiyesinden önceliklidir; fakat platform ve hukuk, tenant güvenliği ve sistem hard-safety sınırlarını aşamaz.

<!-- uy:ilke/guidance-policy-ayrimi -->
## Guidance esnek, harcama kuralı deterministiktir
Kullanıcının doğal dil stratejisi strict DSL olmadan scoped guidance olarak analizde kullanılabilir; fakat soft guidance bütçe hard constraint'i, approval veya action authorization olamaz. Yalnız kullanıcı tarafından replay/impact ile G3 policy'ye yükseltilmiş madde yürütmeyi bağlayabilir.

<!-- uy:ilke/kaynakli-best-practice -->
## Best-practice kaynaklı ve tarihli olmalıdır
Agent model hafızasını resmi Meta best-practice gibi sunamaz. Official guidance source ref, applicable scope, captured/review-by tarihi ve freshness taşır; kullanıcı istisnası ayrı provenance ile korunur.

<!-- uy:ilke/hiperaktif-olma -->
## Sistem değişiklik üretmek için değişiklik üretmez
No-change ve observe geçerli kararlardır. Settle olmamış veri, learning/cooldown, yetersiz observation veya yeni kanıt olmadan sistem aynı öneriyi tekrarlamaz; deney ve karar temposu tutarlı olmalıdır.

<!-- uy:ilke/sessiz-ogrenme-yok -->
## Sohbetten sessiz kural öğrenilmez
Agentic sohbet AdvisedPractice candidate üretebilir fakat outcome ve açık StandardizationReview olmadan algoritma, policy veya otomasyon değişemez. Bir practice bütünüyle rule yapılmak zorunda değildir; insan muhakemesi olarak kalan kısım açıkça korunur.

<!-- uy:ilke/karmasiklik-kazanilir -->
## Altyapı karmaşıklığı ölçülerek kazanılır
İlk çözüm modular monolith, PostgreSQL ve DB-backed worker'dır. Vector database, data warehouse, event bus, microservice veya kara-kutu optimizer yalnız ölçülen hacim/latency/kalite eşiği ve ADR ile eklenebilir; olası gelecek ihtiyaç tek başına gerekçe değildir.

<!-- uy:ilke/eylem-valften-gecer -->
## Para harcayan her yol tek valften geçer
Agent, prompt, schedule veya dashboard ayrıcalıklı write yolu açamaz; her Meta eylemi aynı typed executor, risk, onay, tavan, idempotency ve verify zincirinden geçer.

<!-- uy:ilke/onay-atomiktir -->
## Onay atomiktir, paket onayı varsayılmaz
Bir öneri paketi yalnız ilgili eylemleri birlikte gösterir; creative/post identity, campaign/adset yapısı, bütçe, create/publish ve activate kararları ayrı action unit ve ayrı onay kaydıdır. Bir satırın onayı sibling veya downstream satırı onaylayamaz; toplu seçim açık kullanıcı işlemi olmalıdır.

<!-- uy:ilke/uretim-draft-only -->
## Yeni creative veya hedef kitle üretilmez
Sistem mevcut reklam metnini okur ve yalnız seçili mevcut gönderiyi yayınlanmış promotion şablonu ile immutable audience preset üzerinden reklamlaştırır. Model yeni metin/görsel/video/creative veya targeting spec üretemez ve değiştiremez.

<!-- uy:ilke/model-api-yok -->
## Agent yerel CLI oturumudur, provider API entegrasyonu değildir
ReklamZeka OpenAI/Anthropic model API anahtarı saklamaz ve model API'si çağırmaz. Codex CLI/VS Code, Claude Code veya diğer yerel istemci kendi login/session'ıyla ortak MCP'ye bağlanır; Meta Graph bağlantısı ayrı güvenlik sınırıdır.

<!-- uy:ilke/model-motoru-degistiremez -->
## Model seçimi domain hükmünü değiştiremez
Codex, Claude Code veya başka yerel AI CLI yalnız talimat çevirisi, kanıtlı anlatım ve proposal hazırlama istemcisidir; classification, policy precedence, analiz formülü, bütçe constraint'i, promotion template/audience resolution ve action authorization modelsiz deterministik motorların sorumluluğudur.

<!-- uy:ilke/hesap-ve-asset-izolasyonu -->
## Hesap ve asset yetkisi ayrı korunur
Toplu portföy görünümü veya hesap grubu; child reklam hesabının currency, timezone, capability, permission, budget cap, approval ve rate-limit sınırını birleştirip aşamaz.
