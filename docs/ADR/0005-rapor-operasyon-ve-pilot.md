# ADR-0005 — Salt-okunur rapor, operasyon alarmları ve pilot hükmü

## Bağlam

Paylaşılan raporlar kiracı sınırını aşan yeni bir erişim yüzeyi yaratır. Pilot kararı ayrıca
yalnız “uygulama çalışıyor” hükmüne değil tazelik, aktivasyon, geri bildirim ve güvenlik
ölçülerine dayanmalıdır.

## Karar

- Paylaşım tokenları HMAC-SHA256 imzalı, süreli, salt-okunur, snapshot'a bağlı ve iptal
  edilebilir olacak; oluşturma yetkisi sunucu rol policy'siyle denetlenip audit'e yazılacak.
- Rapor dashboard ile aynı snapshot toplamlarını, para birimini, saat dilimini, attribution
  ve tazelik bilgisini taşıyacak. CSV dışa aktarımı aynı rapor nesnesinden üretilecek.
- Sync gecikmesi, hata oranı, connector kotası ve içgörü üretimi ayrı alarmlar olacak;
  her alarm sabit bir runbook ve açık/çözüldü durumu taşıyacak.
- Pilot hükmü ürün şartnamesindeki 3 çalışma alanı, 10 hesap, %95/60 dakika tazelik,
  15 dakika medyan aktivasyon, %60 yararlı/aksiyon geri bildirimi ve sıfır açık kritik
  güvenlik olayı eşiklerinden hesaplanacak.
- Fixture readiness raporu yalnız teknik hazırlığı kanıtlar; gerçek saha pilotu yerine geçmez.

## Gerekçe

İmzalı ve iptal edilebilir token yetkisiz/değiştirilmiş erişimi reddeder. Tek rapor nesnesi
dashboard/paylaşım tutarsızlığını önler. Açık eşikler ürün kararını denetlenebilir kılar.

## Alternatifler

- **Süresiz tahmin edilebilir bağlantı:** İptal ve sızıntı riski nedeniyle reddedildi.
- **Rapor metriklerini ayrı hesaplamak:** Dashboard drift riski nedeniyle reddedildi.
- **Tek genel sağlık alarmı:** Onarım adresini gizlediği için dört ayrı alarm seçildi.
- **Sentetik fixture sonucunu saha pilotu saymak:** Kullanıcı değeri kanıtlamadığı için reddedildi.

## Sonuçlar

Production token iptal durumu veritabanından okunmalıdır; imzalama anahtarı secret manager'da
tutulur. A07 ancak gerçek pilot ölçümü `field_pilot` modunda eşikleri geçtiğinde kapanabilir.
