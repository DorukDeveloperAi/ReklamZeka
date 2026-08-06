# ReklamZeka operasyon runbook'ları

| alarm | eşik | ilk güvenli onarım |
|---|---|---|
| `sync_lag` | 60 dakikadan uzun | Connector cursor ve kuyruk yaşını kontrol et; checkpoint'ten güvenli retry çalıştır. |
| `sync_error_rate` | en az 5 denemede %10 üzeri | Hata sınıfını ayır; auth için bağlantı yenile, transient için backoff uygula. |
| `rate_limit` | kalan kota %10 altı | İstek hızını düşür, `Retry-After` ve cursor checkpoint'ini koru. |
| `insight_generation` | beklenen snapshot'ta sıfır sonuç | Snapshot şema sürümü ve kural hatalarını kontrol et; önceki sonucu değiştirme. |

Alarm, sağlıklı örnek geldiğinde `resolved` olur; geçmiş olay silinmez. Sırlar alarm etiketi,
log veya bildirim payload'ına eklenmez.
