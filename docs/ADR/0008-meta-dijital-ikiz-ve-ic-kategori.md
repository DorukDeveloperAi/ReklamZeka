# ADR-0008 — Meta dijital ikizi ve çoklu iç kategori

## Durum

Kabul — 2026-08-06

## Bağlam

Mevcut kanonik model günlük campaign toplamlarını taşıyor. Gerçek karar için Meta'nın
campaign→adset→ad→creative ağacı, budget owner ve optimization/targeting/config
bağlamı gerekir. Meta objective kullanıcının hizmet/bölge/dil/operasyon kategorisi değildir.

## Karar

- Meta nesne ve config'leri kayıpsız dijital ikiz olarak, API version/provenance ile saklanır.
- Platform objective kaynak değeri korunup canonical objective'e versioned mapping edilir.
- Kullanıcı iç kategorileri çoklu assignment'tır; Meta kategorisinin yerine geçmez, overlay'dir.
- Atama manual lock, mapping, name pattern, property rule veya inference olabilir; evidence,
  confidence ve effective interval zorunludur.
- Manual lock inference tarafından ezilemez; uncertain sınıflandırma action-ready değildir.
- Inventory, creative ve insights sync ayrı stream; level/date slicing ve rate usage uygulanır.

## Sonuçlar

Model genişler fakat kararlar kampanya adına veya generic conversions'a mahkûm olmaz.
Kategoriler kullanıcıya ait olur; Meta API değişiklikleri mapping/capability katmanında
yalıtılır. Daha fazla depolama ve sync orkestrasyonu gerekir.
