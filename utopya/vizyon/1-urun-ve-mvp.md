# 1 — Ürün ve MVP kapsamı

<!-- uy:urun-ve-mvp/hedef-kullanici -->
## Hedef kullanıcı ve temel iş

- Ürün ajans performans ekipleri ile birden fazla ücretli medya hesabı yöneten şirket içi pazarlama ekiplerine hizmet etmelidir.
- Kullanıcı çalışma alanı → müşteri → reklam hesabı → kampanya hiyerarşisinde gezebilmelidir.
- Ana iş, “ne değişti, neden değişti ve güvenli sonraki adım nedir?” sorusunu platformlar arasında yanıtlamaktır.

**Kabul:** Bir pilot kullanıcı iki farklı kaynak hesabını aynı çalışma alanında görürken müşteri sınırları karışmadan son 7/30/90 gün performansını karşılaştırabilir.

▸ bugün nerede: fixture tabanlı pilot yolculuğu ve çok kaynaklı dashboard hazır; gerçek pilot üyelikleri ve canlı hesap verisi bekliyor.

<!-- uy:urun-ve-mvp/veri-sozlesmesi -->
## Veri toplama ve ortak model

- İlk doğrudan bağlantılar Meta Ads ve Google Ads olmalıdır; CSV aynı kanonik şemaya giren kontrollü fallback'tir.
- Ham kaynak kayıtları değişmeden saklanmalı; normalleştirilmiş kayıtlar kaynak kimliği ve şema sürümü taşımalıdır.
- Para birimi, saat dilimi, attribution penceresi ve veri tazeliği görünümden saklanmamalıdır.
- Aynı senkronizasyon tekrarlandığında kayıtlar çoğalmamalıdır.

**Kabul:** Aynı fixture iki kez işlendiğinde kanonik kayıt sayısı değişmez; türetilen metrikler beklenen formüllerle eşleşir.

▸ bugün nerede: Meta/Google fixture adapter'ları, CSV fallback, kanonik şema ve idempotent ingest hazır; canlı OAuth/API bağlantıları pilot ortamında bağlanacak.

<!-- uy:urun-ve-mvp/icgoru-sozlesmesi -->
## İçgörü ve öneri sözleşmesi

- Bir bulgu en az `tür`, `önem`, `güven`, `kaynak`, `zaman aralığı`, `karşılaştırma`, `kanıt` ve `önerilen sonraki adım` alanlarını taşımalıdır.
- Veri azlığı, gecikme veya attribution uyumsuzluğu güveni düşürmeli; sistem bunu gizlememelidir.
- Öneri motoru ilk sürümde reklam hesabına yazmamalıdır.

**Kabul:** Her öneri aynı veri snapshot'ı ve hesaplama sürümüyle yeniden üretilebilir; kaynağı olmayan öneri şema kapısından geçemez.

▸ bugün nerede: dört deterministik kural, kaynak/güven/sürüm kanıtı, API görünümü ve idempotent feedback hazır.

<!-- uy:urun-ve-mvp/deneyim -->
## MVP kullanıcı deneyimi

- Kullanıcı giriş, çalışma alanı oluşturma, bağlantı/CSV içe aktarma, senkronizasyon durumu, genel bakış, kampanya detayı, içgörü listesi ve rapor paylaşımı akışlarını tamamlayabilmelidir.
- Boş, yükleniyor, gecikmiş, kısmi ve hata durumları birbirinden ayırt edilebilir olmalıdır.
- Kritik metrikler masaüstü ve mobil genişlikte okunabilir olmalıdır.

**Kabul:** Temel pilot senaryosu otomatik tarayıcı testiyle girişten paylaşılabilir rapora kadar tamamlanır.

▸ bugün nerede: yedi adımlı fixture pilot yüzeyi, responsive dashboard, veri durumları, içgörü/feedback ve salt-okunur demo rapor hazır; canlı giriş ve bağlantı kurulumu saha ortamında bağlanacak.

<!-- uy:urun-ve-mvp/guvenlik -->
## Güvenlik ve denetlenebilirlik

- Çok kiracılı veri erişimi sunucu tarafında çalışma alanı üyeliğiyle zorlanmalıdır.
- OAuth tokenları ve bağlantı sırları şifreli saklanmalı ve hiçbir log/telemetri alanına düşmemelidir.
- Bağlantı, senkronizasyon, öneri üretimi, rapor paylaşımı ve kullanıcı kararları audit olayları üretmelidir.

**Kabul:** Yetkisiz kiracı erişimi entegrasyon testlerinde reddedilir; sır taraması fixture tokenlarının log ve hata çıktısına sızmadığını kanıtlar.

▸ bugün nerede: merkezi tenant policy, şifreli sır kasası, redaksiyon ve hash-zincirli audit sınırı hazır; canlı IdP/PostgreSQL RLS entegrasyonu pilot ortamına ait.

<!-- uy:urun-ve-mvp/pilot-basari -->
## Pilot başarı ölçütleri

- En az 3 çalışma alanı ve 10 reklam hesabı kontrollü pilotta kullanılmalıdır.
- Desteklenen hesapların en az %95'i 60 dakikalık tazelik hedefinde kalmalıdır.
- İlk doğrulanmış dashboard'a medyan ulaşma süresi 15 dakikayı aşmamalıdır.
- Kullanıcıların haftalık oluşturulan içgörülerin en az %60'ını “yararlı” veya “aksiyon alındı” olarak sınıflandırabilmesi hedeflenmelidir.

**Kabul:** Pilot ölçüm raporu veri tazeliği, aktivasyon süresi, öneri geri bildirimi ve açık güvenlik olaylarını çalışma alanı bazında gösterir.

▸ bugün nerede: fixture readiness 3 çalışma alanı/10 hesap için eşikleri geçiyor; attestation, rapor üreticisi ve saha kapısı hazır, fakat gerçek kullanıcı pilotu henüz koşmadı.
