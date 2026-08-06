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
Kullanıcı çoklu iç kategorileri isim ve Meta özellikleriyle eşleyebilmeli; düz metin veya yapılandırılmış talimatını etki ve çatışma önizlemesiyle sürümleyebilmelidir.

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
Core reklam motorları modelsiz çalışmalı; dashboard assistant, Codex, Claude ve gelecekteki agent'lar aynı tenant-scoped MCP/tool, output validation, audit ve action valve sözleşmesini kullanabilmelidir.

<!-- uy:yetenek/hibrit-reklam-operasyonu -->
## Manuel, agent destekli ve policy-otomatik işletim
boy: epik
Kullanıcı manual, assisted, automated-read veya sınırlı policy-automated mod seçebilmeli; campaign/adset/ad durumunu ve campaign/adset bütçesini dashboarddan önizleme, onay, execute, verify ve rollback zinciriyle yönetebilmelidir.

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

<!-- uy:yetenek/nadir-yeni-reklam -->
## Nadir ve kontrollü yeni reklam üretimi
boy: epik
Kullanıcı açıkça istediğinde verilen asset/metinden veya üretici modelden yeni reklam
taslağı oluşturulabilmeli; içerik/spec sürümü ayrı onaylanmadan publish, publish ayrı
onaylanmadan activate edilememeli ve üretim hiçbir zaman sürekli/onaysız olmamalıdır.

<!-- uy:yetenek/atomik-approval-only -->
## Atomik approval-only otonomi valfi
boy: epik
Sistem ilk ve varsayılan dönemde tüm Meta write eylemlerini approval-only tutmalı; bir
öneri paketindeki creative/post, yapı, bütçe, create/publish ve activate satırları ayrı
approve/reject/request-changes almalı, toplu onay yalnız açık kullanıcı seçimi olmalıdır.
