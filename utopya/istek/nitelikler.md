# İSTEK · nitelikler
### erişilmesi gereken kalite · eşik · titizlik seviyeleri

> Buradaki her giriş **ölçülebilir bir seviyedir**: satisfy edilmesi gereken quality/feature,
> erişilmesi gereken skor/eşik. `esik:` satırı damıtmada hedefin kabul kriterine iner.
>
> ```
> <!-- uy:nitelik/ornek-slug -->
> ## Örnek nitelik başlığı
> esik: <ölçü — ör. "test coverage ≥ %80" ya da "docs-check hep temiz">
> Bu seviyenin ne anlama geldiği + neden önemli olduğu — tek paragraf.
> ```

<!-- uy:nitelik/veri-tazeligi -->
## Veri tazeliği görünür ve ölçülür
esik: başarılı bağlı hesapların en az %95'inde son senkronizasyon yaşı 60 dakikadan küçük; gecikme kullanıcıya açıkça görünür
Kullanıcı güncel olmayan veriyi güncel sanmamalı; her görünüm kaynak ve son başarılı senkronizasyon zamanını göstermelidir.

<!-- uy:nitelik/izlenebilir-oneri -->
## Öneriler kaynağına kadar izlenebilir
esik: önerilerin %100'ü kaynak hesap, kampanya, tarih aralığı, karşılaştırma ve hesaplama sürümü taşır
Bir önerinin neden üretildiği sonradan aynı veriyle yeniden hesaplanabilmeli ve kullanıcıya açıklanabilmelidir.

<!-- uy:nitelik/ilk-deger-suresi -->
## İlk değer süresi kısa
esik: desteklenen bir hesap için bağlantı başlangıcından ilk doğrulanmış dashboard görünümüne medyan süre 15 dakika veya daha az
Kurulum akışı teknik bilgi gerektirmeden kullanıcıyı ilk anlamlı performans görünümüne ulaştırmalıdır.
