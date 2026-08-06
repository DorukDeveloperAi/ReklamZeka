# İSTEK · ilkeler
### adhere edilmesi gereken rules & principles — kalıcı kısıtlar

> **Bu dosyayı PM her koşumda okur.** Buradakiler hedefe DÖNÜŞMEZ — bu projede karar alınırken
> hep gözetilen kısıtlardır; damıtma bunlardan chunk üretmez. İlkeler proje-spesifiktir.
>
> ```
> <!-- uy:ilke/ornek-slug -->
> ## Örnek ilke başlığı
> İlkenin kendisi + niçin var olduğu — tek paragraf, kesin dille.
> ```

<!-- uy:ilke/insan-onayi -->
## Reklam hesabı değişikliklerinde insan onayı
Ürün ilk sürümde reklam platformlarında bütçe, teklif, durum veya kreatif değişikliği yapmaz; ileride eklenecek her yazma yeteneği açık yetki, değişiklik önizlemesi, insan onayı, idempotency anahtarı ve geri alma planı taşır.

<!-- uy:ilke/kaynak-korunur -->
## Kaynak ve hesaplama izi korunur
Normalleştirme hiçbir platform alanının kaynağını belirsizleştiremez; türetilmiş her metrik formül sürümünü ve kaynak kayıt bağını korur.

<!-- uy:ilke/en-az-yetki -->
## En az yetki ve kiracı izolasyonu
Bağlantılar mümkün olan en dar salt-okunur kapsamla kurulur; kimlik bilgileri loglara yazılmaz ve bir çalışma alanının verisi başka bir çalışma alanından hiçbir uygulama yoluyla okunamaz.

<!-- uy:ilke/kanit-once -->
## Öneriden önce kanıt
Bir içgörü veri kalitesi veya örneklem yetersizliği nedeniyle güvenilir değilse sistem kesin öneri üretmek yerine belirsizliği ve eksik kanıtı gösterir.
