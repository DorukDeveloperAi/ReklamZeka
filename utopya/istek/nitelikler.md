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

<!-- uy:nitelik/brief-baglilik -->
## Brief bağlılığı mutlaktır
esik: brief'e bağlanamayan öneri sayısı = 0 (şema kısıtı + test)
Rastgele AI fikri istemiyorum: her skor ve öneri hangi brief'e, hangi metriğe, hangi
eşiğe dayandığını söylemek zorunda; söyleyemeyen kayıt sistemde var olamamalı.

<!-- uy:nitelik/paused-garanti -->
## PAUSED garantisi test edilmiş olmalı
esik: ACTIVE-create engeli + PAUSED zorunluluğu birim testleri sürekli yeşil; canlı provada geri-okuma PAUSED
Platformun varsayılanına güvenmiyorum; yeni nesnenin PAUSED doğduğu benim kodumun
garantisi olmalı ve bu garanti hem testte hem canlı geri-okumada kanıtlanmalı.

<!-- uy:nitelik/gate-temiz -->
## Governance kapıları hep temiz
esik: agac.mjs --gate PASS + pytest yeşil + terminoloji lint'i temiz (CI'da)
Plan ağacı, oturum defteri ve kod tabanı her an denetlenebilir durumda olmalı; bayat
INDEX, künyesiz plan, çıplak terim kullanımı birikmeden kapıda yakalanmalı.
