# ADR-0002 — Kanonik reklam verisi ve idempotent ingest

## Bağlam

Meta Ads, Google Ads ve dosya içe aktarımları para, attribution, kimlik ve sayfalama
alanlarını farklı biçimlerde sunar. Ham alanları doğrudan karşılaştırmak yanlış performans
yorumlarına ve yeniden senkronizasyonda kayıt çoğalmasına yol açar.

## Karar

- Günlük hesap/kampanya grain'inde sürümlü `CanonicalDailyMetric` sözleşmesi kullanılacak.
- Para değerleri kayan nokta yerine para biriminin küçük biriminde güvenli tam sayı tutulacak.
- Para birimi, IANA saat dilimi ve attribution modeli/penceresi her metrikte korunacak.
- Her connector yalnız `read_only` erişim ilan edecek; cursor, rate-limit ve sınıflı hata
  sözleşmesini uygulayacak.
- Kanonik benzersizlik; çalışma alanı, kaynak, kampanya, gün, attribution ve şema sürümünden
  oluşacak. Aynı içerik yeniden gelirse `unchanged`, gecikmiş veri değişirse `updated` olacak.
- Kaynak satır kimliği, güncellenme zamanı ve içerik hash'i denetim izi olarak saklanacak.

## Gerekçe

Bu model platformlar arası ortak metrikleri karşılaştırılabilir kılarken attribution farkını
gizlemez. Cursor ve idempotent upsert birlikte yarıda kalan senkronizasyonun güvenli şekilde
devam etmesini sağlar. Salt-okunur sözleşme MVP'nin insan onayı ilkesini teknik sınır yapar.

## Alternatifler

- **Ham platform tablolarını doğrudan sorgulamak:** Hızlı başlar; ortak metrik ve tekrar
  davranışını her sorguya yaydığı için reddedildi.
- **Parayı ondalıklı/kayan nokta tutmak:** Yuvarlama sapması riski nedeniyle reddedildi.
- **Attribution farkını tek varsayılanda eritmek:** Yanıltıcı karşılaştırma ürettiği için
  reddedildi.
- **İlk sürümde canlı API çağrılarıyla sözleşme geliştirmek:** Ağ, OAuth ve kota belirsizliği
  çekirdek doğrulamayı yavaşlattığı için fixture/CSV sözleşmesinden sonraya bırakıldı.

## Sonuçlar

Kanonik sözleşme değişiklikleri sürüm artışı gerektirir. Gerçek PostgreSQL adapter'ı aynı
upsert sonuçlarını transaction içinde üretmelidir. Canlı Meta/Google connector'ları bu
sözleşme suite'ini geçmeden etkinleştirilemez.
