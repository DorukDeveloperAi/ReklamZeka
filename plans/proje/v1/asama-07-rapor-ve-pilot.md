---
kosum: tek-ajan
---
# Aşama 07 — Rapor ve pilot (v1)

> Roadmap: [MASTER.md](MASTER.md) · Bağımlı: 05, 06

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
