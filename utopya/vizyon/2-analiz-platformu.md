# 2 — Kullanıcı tanımlı analiz platformu

<!-- uy:analiz-platformu/kampanya-baglami -->
## Kampanya amacı ve değerlendirme bağlamı

- Her analiz `objective`, funnel aşaması, optimizasyon olayı ve sınıflandırma kaynağı taşır.
- Platform objective eşlemesi belirsizse kullanıcı onayı olmadan kesin KPI hükmü verilmez.
- Awareness, trafik, etkileşim, lead, app ve satış amaçları ayrı KPI/guardrail profilleriyle değerlendirilir.
- Farklı amaçlar ancak bütçe dağılımı düzeyinde yan yana gösterilir; başarı KPI'ları doğrudan sıralanmaz.

**Kabul:** Aynı metrik snapshot'ı awareness ve sales profillerinde farklı, amacı doğru
değerlendirme soruları ve karar kılavuzu üretir; eksik zorunlu metrik yayın kapısını durdurur.

▸ bugün nerede: dört genel sabit kural var; objective profili ve amaç eşleme matrisi henüz kodlanmadı.

<!-- uy:analiz-platformu/sablon-ve-kural -->
## Analiz şablonu ve güvenli kural DSL

- Kullanıcı workspace içinde taslak şablon oluşturur, dry-run görür ve immutable sürüm yayınlar.
- Kural yalnız allowlist metrik/operator/eşik/minimum hacim alanlarını taşır; kod ve SQL çalıştırmaz.
- Sistem amaç profilinin ana KPI, tanı metriği, guardrail ve veri yeterliliği varsayılanlarını sunar.
- Kullanıcı varsayılanı genişletebilir; tenant ve güvenlik sınırlarını kaldıramaz.

**Kabul:** Geçersiz metric/operator, kullanıcı kodu, eksik objective veya desteklenmeyen zorunlu
metrik yayınlanamaz; geçerli taslak geçmiş snapshot'ta deterministik dry-run üretir.

▸ bugün nerede: v2 planı açıldı; sözleşme ve negatif test matrisi ilk uygulama işidir.

<!-- uy:analiz-platformu/timeframe-ve-schedule -->
## Timeframe, karşılaştırma ve scheduled analysis

- Timeframe hangi verinin analiz edildiğini; schedule ne zaman çalıştırıldığını ayrı tanımlar.
- Rolling, fixed ve calendar dönemleri; previous-period, previous-year ve none karşılaştırmaları desteklenir.
- Schedule IANA timezone, hourly/daily/weekly/monthly sıklık, misfire ve concurrency politikası taşır.
- Aynı logical fire iki kez teslim edilirse tek run oluşur; resolved window ve snapshot run kaydına yazılır.

**Kabul:** DST boş/çift saat, retry ve eşzamanlı teslim golden testleri yinelenen run üretmez;
run geçmişi definition sürümü, snapshot, timeframe, durum ve hata sınıfını gösterir.

▸ bugün nerede: yalnız manuel 7/30/90 görünümü var; scheduler ve run ledger yok.

<!-- uy:analiz-platformu/prompt-eklentisi -->
## Kanıt bağlı prompt eklentisi

- Kullanıcı anlatım tonu, odak soruları ve rapor bölüm tercihlerini tanımlayabilir.
- Kullanıcı metni sistem prompt'una enjekte edilmez; yapılandırılmış `userGuidance` verisi olarak taşınır.
- Model yalnız deterministik bulguları `findingId` referansıyla açıklar; yeni metrik, kaynak veya aksiyon uyduramaz.
- Model kapalı veya başarısız olduğunda deterministik analiz ve schedule sonucu korunur.

**Kabul:** Prompt injection, cross-tenant veri, tool/SQL talebi ve kanıtsız iddia negatif
matrisinin tamamı reddedilir; model/prompt/sampling sürümü audit kaydında görünür.

▸ bugün nerede: LLM karar kaynağı olarak kapalı; güvenli narrative eklentisi henüz uygulanmadı.
