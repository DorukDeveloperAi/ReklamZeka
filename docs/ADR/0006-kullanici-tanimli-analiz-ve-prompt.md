# ADR-0006 — Kullanıcı tanımlı analiz, scheduling ve prompt eklentisi

## Bağlam

Sabit dört içgörü kuralı pilot için yeterlidir; fakat kullanıcıların farklı müşteri hedefleri,
ölçüm dönemleri ve raporlama ritimleri vardır. Serbest prompt'u doğrudan sistem talimatına
eklemek tekrar üretilebilirliği, tenant sınırını ve kanıt zincirini zayıflatır.

## Karar

- Analiz tanımı sürümlü ve deklaratif olacaktır; kullanıcı kodu, SQL veya `eval` kabul edilmez.
- Deterministik kural motoru her zaman önce çalışır ve bulgular snapshot'a bağlanır.
- Timeframe ile schedule ayrıdır: timeframe hangi verinin analiz edildiğini, schedule ne zaman
  çalıştırıldığını tanımlar.
- Ham cron yerine doğrulanmış frequency/timezone sözleşmesi kullanılır; DST ve misfire
  politikaları açıkça saklanır.
- Prompt eklentisi `narrative_only` çalışır. Kullanıcı metni system/developer prompt'a
  birleştirilmez; yapılandırılmış `userGuidance` verisi olarak taşınır.
- Model çıktısı yalnız mevcut `findingId` kayıtlarını açıklayabilir. Tenant, araç, timeframe,
  metrik veya eylem kapsamını genişleten çıktı şema kapısından geçmez.
- Scheduled sonuç reklam hesabına yazmaz; rapor ve bildirimle sınırlıdır.

## Neden “prompt injection” değil?

Doğrudan metin ekleme kolay görünür ama talimat önceliğini belirsizleştirir. Güvenli eklenti,
değişmez platform politikası ile kullanıcı tercihlerini ayrı alanlarda tutar. Böylece aynı
deterministik bulgu seti yeniden üretilebilir ve model kapalıyken de analiz çalışmaya devam eder.

## Sonuçlar

Model entegrasyonu analiz motorunun önkoşulu değildir. Narrative başarısız olursa run'ın
deterministik bulguları korunur. Model/prompt değişikliği ayrı `narrativeVersion` artırır;
rule/timeframe değişikliği yeni analysis definition version üretir.
