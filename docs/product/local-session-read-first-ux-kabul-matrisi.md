# Local-session bağlı yol — read-first UX kabul matrisi

Bu matris, `Ana Sayfa → Portföy/Slice → Kural Kütüphanesi → Agent → İncele/Onay`
yolunda yerel oturum yokken veya salt-okunur kaynak eksikken kullanıcıya ne
gösterileceğini tanımlar. Durum metni, sahte metrik, tahmin edilmiş kapsam veya
yetki açmadan kullanıcıya tek güvenli sonraki adımı verir.

## Ortak kabul

- Ekran, durumu açıkça `hazır`, `kısmi`, `boş`, `yerel oturum gerekli` veya
  `kullanılamıyor` diye adlandırır; renk tek belirti değildir.
- `yerel oturum gerekli` durumunda ilgili kayıt, metrik veya karar gösterilmez.
  Kullanıcı yerel oturumu bağladıktan sonra aynı kanonik URL/bağlamı yeniden açar.
- `kısmi` durumda mevcut kanıt yön bulmak içindir; eksik kapsam için kesin karar,
  toplam veya sonuç üretilmez.
- `boş`, başarılı bir okumanın sonucudur. Başka kaynaktan örnek kayıt, kapsam ya
  da kural eklenmez.
- `kullanılamıyor`/`hata` durumunda yalnız güvenli yeniden deneme veya kaynak
  ayarlarına gitme sunulur. Meta write, policy/action yetkisi, cookie/token
  görünümü veya bypass akışı açılmaz.

| Ekran | Boş | Kısmi | Yerel oturum gerekli | Hata / kullanılamıyor |
|---|---|---|---|---|
| Ana Sayfa | “Gösterilebilir 7 günlük hesap performansı yok” ya da “Doğrulanmış açık risk kaydı yok”; portföy toplamı üretilmez. | Kısmi hesap penceresi ayrı gerekçesiyle görünür; toplam metrik üretilmez. | Metrik/risk kaydı gizlenir; oturum bağlandıktan sonra Portföy/Slice’da ilgili kapsamı açma anlatılır. | Kaynağın risksiz olduğu söylenmez; kaynak ayarları veya güvenli yenileme ile devam edilir. |
| Portföy / Slice | “Aynada kampanya yok” veya filtre sonucu boş açıkça ayrılır; başka portföy doldurulmaz. | “Kaynak kısmi” notu, eksik hesap/performance için kesin sonuç çıkarılmamasını ve güncel kanıt geldiğinde yeniden kontrolü söyler. | Hiyerarşi, isim, bütçe ve performans gösterilmez; aynı çalışma alanı içindeki oturum bağlantısı sunulur. | Kanonik sözleşme doğrulanana kadar örnek hiyerarşi gösterilmez; tekrar dene veya kaynak ayarları sunulur. |
| Kural Kütüphanesi | Kayıtlı kural yoksa kullanıcı, kanıtlı kapsam seçip kendi kuralını yazmaya yönlendirilir; kural tahmin edilmez. | Kapsam adayları yok/kısmi ise form fallback ile doldurulmaz; kategori incelemesine yönlendirilir. | Kural, slice ve karar kaydı gizlenir; oturum bağlantısından sonra aynı kanonik kural/revizyon tekrar açılır. | “Kaynak şu anda kullanılamıyor” ile “çalışma alanı okunamadı” ayrılır; yalnız tekrar dene sunulur. |
| Agent | Mesaj yoksa konuşmanın bağlı ama boş olduğu belirtilir; yeni konuşma yaratılmış gibi gösterilmez. | Skill/kanıt bağlamı eksikse kayıt veya seçim gösterilmez; Agent belirsizliği korur. | Konuşma ve skill kaydı gösterilmez; oturum bağlandıktan sonra ikisinin birlikte yenileneceği açıklanır. | Kalıcı konuşma yoksa hata gösterilir; yalnız manuel, read-only Codex aktarımı kullanılabilir. |
| İncele / Onay | İncelemede doğrulanmış pencere, Onay’da kuyruk boşluğu ayrı belirtilir; örnek öneri eklenmez. | Yetersiz kanıt “izlemeye devam”/hold olarak kalır; kesin başarı veya başarısızlık denmez. | İnceleme/Onay kaydı gösterilmez; yalnız bu bağlamdaki yerel oturum bağlantısı sunulur. | Kaynak/karar izi okunamadığında tekrar dene sunulur; uygulama, execute veya Meta write kontrolü görünmez. |

## Doğrulama senaryoları

1. Oturumsuz URL ile doğrudan Kural Kütüphanesi açıldığında, 401 genel kaynak
   hatasına düşmez; kullanıcı kayıt gösterilmediğini ve oturumdan sonra aynı
   kanonik kuralın açılacağını görür.
2. Kısmi Meta aynasında Portföy/Slice, seçili hiyerarşiyi gösterebilir; ancak
   eksik hesap/performance için kesin karar veya toplam vermez.
3. Ana Sayfa, Portföy ve Onay kuyruğunun gerçek boş halleri örnek metrik,
   örnek kampanya veya örnek karar üretmez.
4. Yolun hiçbir durumunda proof/cookie/token değeri geri gösterilmez; Agent ve
   kullanıcı arayüzü Meta write, policy publish, action yetkisi veya otomasyon
   açmaz.
