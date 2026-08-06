# İSTEK · yetenekler
### edinilmesi gereken capability'ler

> Buradaki her giriş sistemin **edinmesi istenen bir yetenektir** ("şunu yapabilmeli").
> `boy: epik` işaretli girişleri damıtma sub-hedeflere böler (`uy:<ref>#alt-N`, tavan 5).
>
> ```
> <!-- uy:yetenek/ornek-slug -->
> ## Örnek yetenek başlığı
> boy: epik
> Sistemin neyi yapabilir olması istendiği + niçin — tek paragraf.
> ```

<!-- uy:yetenek/cok-kanalli-veri-toplama -->
## Çok kanallı reklam verisi toplama
boy: epik
Sistem Meta Ads ve Google Ads hesaplarından salt-okunur yetkiyle kampanya, harcama, gösterim, tıklama ve dönüşüm verisini alabilmeli; bağlantı yokken aynı kanonik modele CSV içe aktarımıyla veri kabul edebilmelidir.

<!-- uy:yetenek/ortak-metrik-modeli -->
## Ortak metrik modeli
boy: orta
Platforma özgü alanlar kaynak kimliğini kaybetmeden harcama, erişim, tıklama, dönüşüm, gelir, CTR, CPC, CPM, CPA ve ROAS gibi karşılaştırılabilir ölçülere normalleştirilmelidir.

<!-- uy:yetenek/aciklanabilir-icgoru -->
## Açıklanabilir içgörü ve öneri
boy: epik
Sistem performans sapmalarını ve fırsatları belirleyebilmeli; her bulgu için zaman aralığını, karşılaştırma tabanını, etkilenen kampanyayı, güven seviyesini ve önerilen sonraki adımı gösterebilmelidir.

<!-- uy:yetenek/paylasilabilir-rapor -->
## Paylaşılabilir performans raporu
boy: orta
Kullanıcı seçtiği müşteri, hesap ve tarih aralığı için kaynakları ve veri tazeliği görünen bir performans özetini dışa aktarabilmeli veya salt-okunur bağlantıyla paylaşabilmelidir.

<!-- uy:yetenek/kampanya-amacina-duyarli-analiz -->
## Kampanya amacına duyarlı analiz ve karar kılavuzu
boy: epik
Sistem kampanyayı platform hedefi, funnel aşaması ve optimizasyon olayına göre sınıflandırmalı; awareness, trafik, etkileşim, lead, uygulama ve satış kampanyalarını aynı başarı ölçüsüyle değerlendirmemelidir. Her amaç profili ana KPI, tanı metrikleri, guardrail, minimum veri koşulu, değerlendirme soruları ve insan onaylı karar kılavuzu taşımalıdır.

<!-- uy:yetenek/kullanici-tanimli-analiz -->
## Kullanıcı tanımlı analiz şablonları ve kurallar
boy: epik
Kullanıcı çalışma alanı içinde kendi analiz şablonunu oluşturabilmeli; kampanya kapsamını, timeframe'i, karşılaştırmayı, allowlist metrik/operator kurallarını ve isteğe bağlı anlatım talimatını sürümlü taslak olarak yönetip dry-run sonrasında yayınlayabilmelidir.

<!-- uy:yetenek/zamanlanmis-analiz -->
## Zamanlanmış analiz ve çalıştırma geçmişi
boy: epik
Yayınlanmış analiz şablonları timezone, sıklık, misfire ve concurrency politikasıyla zamanlanabilmeli; her logical tetik tek snapshot-bağlı run üretmeli ve kullanıcı çalıştırma geçmişini, bulguları, hatayı ve yeniden deneme durumunu görebilmelidir.

<!-- uy:yetenek/meta-dijital-ikiz -->
## Meta dijital ikizi
boy: epik
Hesap, kampanya, reklam seti, reklam ve mevcut kreatifler Meta konfigürasyonu, bütçe sahibi, günlük insights ve zaman içindeki değişiklikleriyle izlenebilmelidir.

<!-- uy:yetenek/ic-kategori-ve-talimat -->
## İç kategori ve kullanıcı talimatı
boy: epik
Kullanıcı çoklu iç kategorileri isim ve Meta özellikleriyle eşleyebilmeli; düz metin
talimatını strict DSL zorunlu olmadan scoped guidance olarak sürümleyebilmeli ve yalnız
seçtiği enforceable maddeleri etki/çatışma/replay önizlemesiyle policy'ye yükseltebilmelidir.

<!-- uy:yetenek/agentic-guidance-deliberation -->
## Kritik agentic guidance ve best-practice müzakeresi
boy: epik
Kullanıcı analiz/strateji/promotion şablonu oluştururken agent ile amaç, öncelik, istisna,
kanıt eşiği, observation/cooldown ve no-change koşullarını tartışabilmeli; kendi anlatımları,
kaynaklı Meta best-practice, gerçek kampanya kanıtı ve experiment sonuçları yan yana
değerlendirilerek sade, sürümlü GuidanceSet oluşmalıdır.

<!-- uy:yetenek/cok-kapsamli-guidance-erisim -->
## Genel, grup, kategori ve başlık bazlı guidance erişimi
boy: epik
Guidance global, account-group/account, Meta objective/funnel, internal category, lifecycle,
campaign/adset/ad/creative/post, PromotionTemplate ve topic heading'e bağlanabilmeli; agent
analizi sırayla yürütürken ilgili setleri kaynak/scope nedeni ve conflictleriyle getirebilmelidir.

<!-- uy:yetenek/stabil-karar-ve-test -->
## Stabil karar temposu ve tutarlı deney
boy: epik
Sistem data settle, minimum observation, learning/cooldown, max karar/hamle sıklığı ve tekrar
sınırlarıyla hiperaktif optimizasyonu önlemeli; act/test/observe/no-change seçeneklerini ve
hypothesis→baseline→metric/guardrail→window→winner/loser/inconclusive deney kaydını desteklemelidir.

<!-- uy:yetenek/advised-practice-standardization -->
## AdvisedPractice ve seçici standardizasyon
boy: epik
Agentic sohbette geliştirilen tekrar kullanılabilir yöntem candidate/trial/outcome olarak
izlenebilmeli; outcome ve kullanıcı review'u sonrası hesaplanabilir feature, agenda/playbook,
guidance, typed policy veya insan muhakemesi parçalarına ayrılarak standardize edilebilmelidir.

<!-- uy:yetenek/deterministik-on-isleme-context -->
## Deterministik ön işleme ve kompakt agent context
boy: epik
Ham reklam verisi raw→canonical→feature→window/rollup→evidence→compact context hattında
işlenmeli; agent frozen EffectiveCampaignContext ve bounded drill-down kullanmalı, raw
payload dump alamamalı ve aynı sürümler replay edilebilir sonuç üretmelidir.

<!-- uy:yetenek/business-outcome-signal -->
## Gerçek iş sonucu sinyali
boy: orta
Meta proxy metriklerine ek olarak qualified lead, appointment, sale/revenue ve invalid lead
manual/CSV kaynakla bağlanabilmeli; mapping yetersizse sistem bunları Meta conversion ile
eş anlamlı saymamalı, canlı CRM connector'ı daha sonraki ayrı increment olmalıdır.

<!-- uy:yetenek/butce-planlama-ve-koruma -->
## Bütçe planlama ve korunan tahsis
boy: epik
Hesap, kategori, bölge ve kampanya bütçe zarfları; sabit taban/tavan, transfer yasağı, hedef KPI, pacing, forecast ve CBO/ABO'ya uygun simülasyonla yönetilmelidir.

<!-- uy:yetenek/kontrollu-meta-eylemi -->
## Kontrollü Meta eylemi
boy: epik
Pause/activate ve bütçe değişikliği dry-run, risk kademesi, onay, idempotency, read-after-write, timeline ve rollback valfinden geçmeden uygulanmamalıdır.

<!-- uy:yetenek/reklam-kontrol-merkezi -->
## Reklam kontrol merkezi
boy: epik
Portföy, kategoriler, talimatlar, analizler, bütçe, onaylar, otomasyonlar, kreatifler ve hamle timeline'ı tek sade dashboarddan rol bazlı yönetilebilmelidir.

<!-- uy:yetenek/cok-hesap-ve-meta-asset -->
## Çok hesap ve Meta asset graph
boy: epik
Bir workspace birden fazla business connection, reklam hesabı, Facebook Page, Instagram hesabı, pixel/dataset, app ve destination asset'iyle; hesap grupları, ayrı currency/timezone/capability/permission ve kısmi başarılı sync ile çalışabilmelidir.

<!-- uy:yetenek/model-agnostic-agent -->
## Model-agnostic agent ve MCP
boy: epik
Core reklam motorları modelsiz çalışmalı; ReklamZeka model-provider API'si veya API key'i
kullanmadan açık Codex CLI/VS Code, Claude Code ve gelecekteki yerel AI CLI session'ları
aynı tenant-scoped MCP/tool, handoff, output validation, audit ve action valve sözleşmesini kullanabilmelidir.

<!-- uy:yetenek/hibrit-reklam-operasyonu -->
## Manuel, agent destekli ve policy-otomatik işletim
boy: epik
Kullanıcı planlama için manual, assisted, automated-read veya scheduled-plan; execution
için approval-only veya sınırlı policy-limited profil seçebilmeli; campaign/adset/ad durumu
ve campaign/adset bütçesini dashboarddan veya human-presence'lı local companion CLI'dan
önizleme, onay, execute, verify ve rollback zinciriyle yönetebilmelidir.

<!-- uy:yetenek/yayindaki-reklam-metni -->
## Yayındaki reklam metni ve creative gerçeği
boy: epik
Sistem active reklamların primary text, headline, description/caption, CTA, destination,
Page/Instagram actor, post/media/creative kimliği ve dynamic varyantlarını kaynak alanına
izlenebilir biçimde okuyup reklam, ad set, kampanya ve performans bağlamında göstermelidir.

<!-- uy:yetenek/mevcut-gonderi-reklami -->
## Mevcut Instagram/Page gönderisini reklama dönüştürme
boy: epik
Kullanıcı bağlı Instagram veya Page gönderisini seçebilmeli; sahiplik/uygunluk, hedef
campaign-adset, bütçe, identity ve destination preflight'ından sonra promotion taslağı
oluşturabilmeli; yaratım ve aktivasyon ayrı onaylarla tek valften geçmelidir.

<!-- uy:yetenek/atomik-approval-only -->
## Atomik approval-only otonomi valfi
boy: epik
Sistem ilk ve varsayılan dönemde tüm Meta write eylemlerini approval-only tutmalı; bir
öneri paketindeki creative/post, yapı, bütçe, create/publish ve activate satırları ayrı
approve/reject/request-changes almalı, toplu onay yalnız açık kullanıcı seçimi olmalıdır.

<!-- uy:yetenek/promotion-template-audience -->
## Promotion şablonu ve ön ayarlı hedef kitle
boy: epik
Kullanıcı existing-post promotion için internal kategori/hesap/actor/post türü selector'ı,
objective/optimization, destination/placement, budget/schedule ve immutable audience preset
bağı olan sürümlü şablon tanımlayabilmeli; agent şablonu anlayıp seçebilmeli fakat targeting üretememelidir.

<!-- uy:yetenek/yerel-ai-cli-session -->
## Dashboard ile ortak yerel AI CLI session'ı
boy: epik
Kullanıcı dashboardda seçtiği kampanya/post/timeframe bağlamını açık Codex CLI/VS Code,
Claude Code veya ek MCP CLI session'ına aktarabilmeli; session'da yapılan analiz/proposal
aynı dashboard inbox/timeline'a yazılmalı ve provider model API anahtarı gerekmemelidir.
