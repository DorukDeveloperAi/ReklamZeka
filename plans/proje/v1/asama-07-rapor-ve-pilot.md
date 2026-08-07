---
kosum: tek-ajan
---
# Aşama 07 — Rapor ve pilot (v1)

> Roadmap: [MASTER.md](MASTER.md) · Bağımlı: 05, 06
> Durum: **AÇIK / SAHA PİLOTU BEKLİYOR** · 2026-08-06

## SONUÇ

**Bu aşama bitince:** Salt-okunur rapor paylaşımı, ürün telemetrisi, operasyon alarmları,
geri bildirim ve kontrollü pilot ölçümü birlikte çalışır; MVP hükmü kanıtla verilir.

## Task'lar

### T07.1 — Paylaşılabilir rapor
**SONUÇ:** Süreli salt-okunur bağlantı ve dışa aktarım kaynak/tazelik bilgisini korur; iptal edilebilir.
**Kabul kriteri:** Yetkisiz, süresi dolmuş ve iptal edilmiş bağlantılar reddedilir; rapor metrikleri dashboard ile eşleşir.

### T07.2 — Gözlemlenebilirlik
**SONUÇ:** Senkronizasyon gecikmesi, hata oranı, connector limiti ve içgörü üretimi ölçülür; her alarmın onarımı vardır.
**Kabul kriteri:** Kasıtlı fixture hataları doğru alarmı üretir ve iyileşince alarm kapanır.

### T07.3 — Pilot ve kapanış
**SONUÇ:** En az 3 çalışma alanı/10 hesap pilot raporu aktivasyon, tazelik, öneri geri bildirimi ve güvenlik olaylarını gösterir.
**Kabul kriteri:** E2E sürüş artefaktı, hızlı/tam kanıtlar ve pilot raporu birlikte PASS; açık kritik güvenlik bulgusu yok.

## Doğrulama

Temiz ortamda migration → seed/connector → dashboard → içgörü → feedback → paylaşım yolculuğu koşar; pilot raporu şartname eşiklerini hesaplar.

## Ara kapanış kanıtı

- T07.1 tamam: ortam anahtarıyla imzalı, süreli, iptal edilebilir dinamik salt-okunur
  paylaşım ve aynı tokenı doğrulayan CSV yüzeyi; iptal/bozuk imza HTTP sınırları kanıtlı.
- T07.2 tamam: dört alarm, açık/çözüldü geçişi ve `docs/RUNBOOKS.md`.
- T07.3 teknik hazırlık tamam: `fixture_readiness` modunda 3 çalışma alanı/10 hesap eşikleri PASS.
- Girişten rapora yedi adımlı fixture yolculuğu `/pilot` altında hazır; ayrı kapı `npm run check:pilot-web` ve 1280/390 tarayıcı kanıtı `docs/qa/a07-pilot-browser-evidence.json`.
- Field pilot attestation şeması, rapor üreticisi ve `check:field-pilot` kapısı hazır.
- Anonim saha telemetrisi bağlantı/dashboard/sync/feedback/güvenlik olaylarından deterministik,
  idempotent pilot aggregate'ı üretir; e-posta biçimli/sözleşme dışı kimlik ve eksik olay zinciri reddedilir.
- Yazma yapmayan `pilot:field-preflight` eşikleri resmi, üzerine yazılmaz kanıt üretilmeden sınar.
- Açık: aynı ölçüm gerçek kullanıcı verisiyle `field_pilot` modunda koşmadan A07 kapanmaz.
