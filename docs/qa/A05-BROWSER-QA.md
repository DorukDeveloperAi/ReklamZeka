# A05 tarayıcı QA kanıtı

2026-08-06 tarihinde yerel Next.js uygulaması Codex in-app browser ile sürüldü.
Masaüstü hazır ekranının tam sayfa görüntüsü, mobil kısmi veri görüntüsü ve DOM/a11y
snapshot'ları test oturumunda üretildi. Yapılandırılmış sonuç
[`a05-browser-evidence.json`](a05-browser-evidence.json) dosyasındadır.

## Kapsam

- 1280 px masaüstü: dört metrik sütunu, kaynak/tazelik/attribution ve kampanya tablosu.
- 820 px tablet: iki metrik sütunu, hata `alert` rolü, gövde taşması yok.
- 390 px mobil: tek metrik sütunu, dikey durum kartı, yalnız tablo kapsayıcısında yatay kaydırma.
- Hazır, bağlantı, ilk senkronizasyon, boş, kısmi, gecikmiş ve hata durumlarının tümü.
- Hata CTA'sı kullanıcıyı ilk senkronizasyon durumuna taşıyor.
- Tarayıcı konsolunda uygulama hatası gözlenmedi.

## Erişilebilirlik hükmü

Her durumda tek adlandırılmış H1, durum veya uyarı canlı bölgesi, etiketli dönem navigasyonu,
satır/sütun başlıklı kampanya tablosu ve görünür klavye odak stilleri vardır. Ekran genişliği
küçüldüğünde sayfa yatay taşmaz; geniş tablo kendi adlandırılmış kaydırma bölgesinde kalır.
