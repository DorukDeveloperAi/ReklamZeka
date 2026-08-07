# A07 fixture pilot tarayıcı QA kanıtı

2026-08-06 tarihinde yerel Next.js uygulaması Codex in-app browser ile girişten
salt-okunur rapora kadar sürüldü. Bu kanıt yalnız `fixture_guided_journey` modundadır;
gerçek çalışma alanı, reklam hesabı veya saha pilotu kanıtı değildir. Yapılandırılmış sonuç
[`a07-pilot-browser-evidence.json`](a07-pilot-browser-evidence.json) dosyasındadır.

## Kapsam

- Demo oturumu → çalışma alanı → veri kaynağı → ilk sync → dashboard → içgörü → paylaşım.
- İçgörüde “Yararlı” geri bildirimi ve görünür başarı durumu.
- Ortam anahtarıyla HMAC imzalı 24 saatlik URL oluşturma; dinamik raporda `read_only`,
  snapshot, kaynak/tazelik, üç metrik ve kanıtlı bulgu.
- Aynı bearer token ile CSV: geçerli token `200`, `private, no-store`, attachment ve
  `nosniff`; iptal sonrası `410`.
- Paylaşım iptali audit olayı üretir; iptal edilen ve imzası bozulan rapor URL'leri `404`
  döner ve metrikleri göstermez.
- Paylaşılan HTML `private, no-store`, `no-referrer`, `noindex`, `DENY` frame ve `nosniff`
  başlık sözleşmesine sahiptir.
- `/reports/demo` yalnız imzasız görsel önizleme olduğunu açıkça belirtir.
- 1280 × 900 masaüstü ve 390 × 844 mobil yerleşim.
- Mobilde yedi adımın tamamında gövde taşması yok; rapor kaynak bilgisi tek sütun.
- Dinamik rapor `noindex, nofollow`; temiz son sürüşlerde tarayıcı konsol hatası yok.

## Sürüşte bulunan regresyon

İlk iptal denemesinde geliştirme bundler'ı hata sınıfını farklı modül kimliğiyle yüklediği
için `instanceof` kontrolü iptal durumunu tanımadı ve `500` üretti. Kontrol doğrulanmış hata
koduna dayalı type guard'a çevrildi. Aynı URL yeniden sürüldüğünde iptal ve bozuk imza `404`,
iptal edilmiş CSV `410` verdi.

## Hüküm

Fixture tabanlı ürün yolculuğu tarayıcıda PASS. A07 kapanış şartı olan gerçek 3 çalışma
alanı/10 hesap `field_pilot` raporu bu testten ayrı ve hâlâ bekleniyor.
