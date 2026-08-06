# ReklamZeka — ürün brifi

## Ürün tezi

ReklamZeka, ücretli medya verisini raporlayan başka bir panel olmaktan öte, “ne değişti,
neden değişti ve sıradaki güvenli karar nedir?” sorusunu kanıtıyla yanıtlayan bir karar
destek ürünüdür. İlk sürüm salt-okunurdur; öneriyi açıklar, hesabı kullanıcı adına değiştirmez.

## Birincil kullanıcılar

- Birden fazla müşteri ve reklam hesabı yöneten ajans performans ekipleri
- Meta Ads ve Google Ads'i birlikte yöneten şirket içi büyüme/pazarlama ekipleri

## MVP iş akışı

1. Kullanıcı çalışma alanı ve müşteri oluşturur.
2. Salt-okunur reklam hesabı bağlar veya doğrulanmış CSV içe aktarır.
3. Sistem ham veriyi saklar, ortak metrik modeline idempotent biçimde dönüştürür.
4. Kullanıcı 7/30/90 günlük performansı ve veri tazeliğini görür.
5. Sistem sapmaları kanıt, güven seviyesi ve önerilen sonraki adımla sunar.
6. Kullanıcı içgörüyü yararlı/yararsız/aksiyon alındı olarak işaretler.
7. Seçilen görünüm salt-okunur bağlantı veya dışa aktarımla paylaşılır.

## MVP dışı

- Reklam platformunda otomatik bütçe, teklif, durum veya kreatif değişikliği
- Çoklu dokunuş attribution modelleme
- Kreatif üretimi ve yayınlama
- Faturalandırma ve self-service abonelik
- Meta Ads ve Google Ads dışındaki doğrudan connector'lar

Bu sınırlar ürünün nihai yönünü yasaklamaz; ilk pilotun güvenli ve ölçülebilir kalmasını sağlar.

## Başarı

Ürün; pilot kullanıcıların iki platformdaki hesabı tek müşteri görünümünde güvenle
karşılaştırabildiği, tazelik ve kaynak bilgisini kaybetmediği, her önerinin kanıtını
inceleyebildiği ve geri bildirim bırakabildiği zaman MVP seviyesine ulaşır. Sayısal eşikler
[ürün şartnamesinde](../utopya/vizyon/1-urun-ve-mvp.md) kanoniktir.

## Açık ürün kararları

Roadmap'in ürün keşfi turunda şu hipotezler gerçek kullanıcı kanıtıyla doğrulanacaktır:

- İlk ödeme yapan segmentin ajans mı şirket içi ekip mi olacağı
- İlk pilotta Meta Ads ile Google Ads'in birlikte mi, sıralı mı açılacağı
- “yararlı öneri” eşiğinin ve geri bildirim dilinin nasıl ölçüleceği
- Rapor paylaşımında bağlantı, PDF veya e-posta önceliği
