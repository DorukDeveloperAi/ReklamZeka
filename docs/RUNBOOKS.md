# ReklamZeka operasyon runbook'ları

| alarm | eşik | ilk güvenli onarım |
|---|---|---|
| `sync_lag` | 60 dakikadan uzun | Connector cursor ve kuyruk yaşını kontrol et; checkpoint'ten güvenli retry çalıştır. |
| `sync_error_rate` | en az 5 denemede %10 üzeri | Hata sınıfını ayır; auth için bağlantı yenile, transient için backoff uygula. |
| `rate_limit` | kalan kota %10 altı | İstek hızını düşür, `Retry-After` ve cursor checkpoint'ini koru. |
| `insight_generation` | beklenen snapshot'ta sıfır sonuç | Snapshot şema sürümü ve kural hatalarını kontrol et; önceki sonucu değiştirme. |

Alarm, sağlıklı örnek geldiğinde `resolved` olur; geçmiş olay silinmez. Sırlar alarm etiketi,
log veya bildirim payload'ına eklenmez.

## Meta read mirror

- Kimlik bilgisi yalnız git dışındaki `.env.local` veya production secret manager içinde
  `META_ACCESS_TOKEN` adıyla tutulur. Token UI, API payload, agent context veya loga yazılmaz.
- `/api/meta/inventory` yalnız `GET` Graph çağrıları yapar. Yanıttaki dış kimlikler maskelidir;
  `X-ReklamZeka-Access-Mode: read-only` başlığı ve audit özetindeki `writeOperations: 0`
  işletim sınırını görünür kılar.
- Dashboard açıldığında ve her 15 dakikada envanter yenilenir. Manuel yenileme aynı salt-okunur
  yolu kullanır; kısmi hesap hataları diğer hesapların sonucunu engellemez.
- `temporary_exposed` güvenlik durumu görüldüğünde ilk bakım adımı Meta tokenını döndürmek,
  eskisini iptal etmek ve mümkün olan en düşük kapsamlı yeni tokenı yerel secret alanına almaktır.
- Auth hatasında token değerini hata kaydına eklemeden bağlantıyı yenile. Rate-limit durumunda
  connector retry/backoff uygular; tekrarlayan 429 için otomatik yenilemeyi geçici olarak seyrekleştir.
