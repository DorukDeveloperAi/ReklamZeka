# ADR-0003 — Kiracı, bağlantı sırrı ve audit güvenliği

## Bağlam

ReklamZeka aynı süreçte birden fazla çalışma alanının reklam verisini ve OAuth sırlarını
işleyecektir. Yalnız arayüzde öğe gizlemek çapraz-kiracı erişimini önlemez; log veya hata
payload'ı da sır sızıntısına dönüşebilir.

## Karar

- Her sunucu veri işlemi kimliği doğrulanmış aktör, hedef `workspaceId`, üyelik ve eylem
  üzerinden fail-closed yetkilendirilecek.
- Owner/admin/analyst/viewer rolleri merkezi eylem matrisiyle değerlendirilecek; repository
  sonuçları yetkilendirilmiş çalışma alanıyla ayrıca filtrelenecek.
- OAuth sırları AES-256-GCM ile, sürümlü dış anahtar kullanılarak şifreli saklanacak; anahtar
  kaynak kodda veya veritabanında bulunmayacak.
- Connector scope allowlist'i yalnız MVP okuma kapsamlarını kabul edecek. Bilinmeyen veya
  yazma scope'u bağlantıyı reddedecek.
- Bağlantı, sync, paylaşım ve öneri geri bildirimi audit olayları aktör/zaman/kaynak ve
  önceki hash ile zincirlenecek. Veritabanı trigger'ı audit update/delete işlemini reddedecek.
- İstemci payload'ları secret alanı taşımayacak; bilinen sırlar log/hata metinlerinden
  `[REDACTED]` ile çıkarılacak.

## Gerekçe

Merkezi, sunucu tarafı policy hem API hem arka plan işlerinde aynı güvenlik kararını üretir.
AEAD şifreleme gizlilik yanında veri bütünlüğü sağlar. Hash zinciri ve append-only trigger
audit geçmişindeki sessiz değişiklikleri görünür ve engellenebilir kılar.

## Alternatifler

- **Yalnız route middleware kontrolü:** Arka plan işlerini ve doğrudan service çağrılarını
  kapsamadığı için reddedildi.
- **Tokenları uygulama anahtarı olmadan veritabanında tutmak:** Veritabanı sızıntısında açık
  metin riski nedeniyle reddedildi.
- **Rol başına dağınık `if` blokları:** Policy drift yarattığı için merkezi matris seçildi.
- **Değiştirilebilir audit tablosu:** Olay geçmişi güvenilirliğini azalttığı için reddedildi.

## Sonuçlar

Anahtar rotasyonu eski `keyVersion` anahtarlarının kontrollü erişimini gerektirir. Canlı
OAuth sağlayıcılarının gerçek scope adları adapter seviyesinde allowlist'e eşlenmelidir.
PostgreSQL RLS ve birleşik tenant foreign key'leri gerçek database entegrasyon turunda bu
uygulama sınırına ikinci savunma katmanı eklemelidir.
