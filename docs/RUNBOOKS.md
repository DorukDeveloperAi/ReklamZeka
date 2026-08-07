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
- Lokal PostgreSQL kabul sırası: `npm run verify:meta-asset-content-db`,
  `npm run verify:meta-post-media-db`, ardından gerçek ve salt-okunur iki hesap kanıtı için
  `npm run verify:meta-s14-live-db`. Son komut geçici workspace kurar ve `finally` içinde
  hedefli olarak temizler; yalnız aggregate/maskeli kanıt basar.
- S1.5 lifecycle kabul sırası: `npm run verify:meta-change-timeline-db`,
  `npm run verify:workspace-tombstone-db`, ardından `npm run verify:supabase-security`.
  Timeline testi replay/restart, unknown, iki hesap scope ve composite FK'yi; tombstone
  testi explicit purge, audit korunumu, hard-delete engeli ve foreign-workspace izolasyonunu
  transaction rollback içinde doğrular.
- Yeni workspace-owned tablo eklendiğinde tombstone allowlist testi kasıtlı olarak kırılır.
  Tablo ancak FK-safe inspect/delete sırasına açıkça eklenip PostgreSQL rollback kabulü
  yeniden geçtikten sonra lifecycle kapsamına alınmış sayılır.
- Canlı kabulte `wrong_actor`, eksik actor alanının tahmin edilmeyeceği anlamına gelir;
  ilgili kayıt park edilir. `permission_missing/unsupported/partial` sıfıra veya başarıya
  çevrilmez ve trust/readiness raporunda sebepli eksik olarak kalır.
- Yerel Next/Turbopack build gerçek `.env.local` ile çalıştırılırsa deploy edilmeyen
  `.next/cache` environment snapshot'ı secret baytlarını tutabilir. Secret taraması tracked
  kaynakları ve cache dışındaki deploy edilebilir `.next` çıktısını kapsar; gerçek-tokenlı
  kabul/build sonrasında `.next/cache` güvenli biçimde temizlenir. Cache deploy edilmez.

## Action guardrail registry

- Migration sonrası `npm run verify:action-guardrail-db` çalıştırılır. Kabul; geçici workspace içinde
  draft→published append, yeniden kurulan repository ile resolve ve UPDATE append-only trigger'ını sınar;
  transaction sonunda bütün geçici satırlar rollback edilir.
- Ardından `npm run verify:supabase-security` ile bütün public tabloların RLS durumu ve Data API grant/
  schema-create/public-function-execute yüzeyi yeniden doğrulanır.
- Canonical affected-geo snapshot kanıtı yoksa kategori veya audience preset bilgisiyle geo tahmini yapılmaz;
  protection sonucu `unknown/unresolved` kalır ve proposal kuyruğuna ilerlemez.
- Meta targeting yapısı yalnız `npm run verify:meta-targeting-shape` ile küçük, GET-only ve redakte canary
  üzerinden gözlemlenir. Çıktı sadece sabit alan adları, tür/adet sayımları ve stable-key varlığı içerir;
  ülke kodu, region/city/custom ID, isim, koordinat, adres veya raw targeting değeri basılmaz. Canonical country
  normalizer yalnız bu canary ile doğrulanmış exact included-country + `home/recent` biçimini kabul eder; diğer
  coğrafya biçimleri canlı kanıt ve ayrı reviewed adapter gelene kadar `unknown` kalır.
- Affected-geo migration sonrası `npm run verify:meta-affected-geo-db` çalıştırılır. Kabul; geçici workspace ve
  Meta hiyerarşisi içinde canonical snapshot append/replay/restart-resolve ile UPDATE trigger'ını sınar, sonra
  bütün satırları rollback eder. Çıktıda raw targeting veya ülke değeri bulunmaz; Meta network/write sayısı sıfırdır.
- Ardından `npm run verify:supabase-security` ile yeni tablolar dahil RLS ve Data API grant yüzeyi doğrulanır.
- Graph→canonical inventory→immutable geo atomisitesi `npm run verify:meta-affected-geo-live-db` ile bounded canlı
  kabulden geçirilir. Script bir hesabın en fazla üç AdSet'ini yalnız GET ile okur, geçici workspace'e yazar,
  canonical/geo adetleri ile raw-targeting kolonunun sıfır olduğunu doğrular ve workspace'i siler.
- Meta read-sync schedule migration sonrası `npm run verify:meta-read-sync-schedule-db` çalıştırılır. Geçici active
  read-only connection/schedule üzerinde due derivation, lease, yanlış token reddi, atomic cursor advance ve
  duplicate-completed sınanır; transaction sonunda tüm satırlar rollback edilir. Bu işlem cron başlatmaz.
- ApprovalPolicy proposal-lifetime migration'ı seed veya backfill yapmaz. Migration öncesinde
  `approval_policy_definition_revisions` ve `action_approval_policy_snapshots` satırları varsa migration bilinçli
  olarak durur; her policy için explicit reviewed yeni revision hazırlanmalıdır. Boş/uygun ortamda migration sonrası
  `npm run verify:action-proposal-queue-db` exact policy snapshot, proposal/decision replay, immutability ve rollback
  temizliğini sınar; Meta veya execution çağrısı yapmaz.
- `runDrizzleMetaReadSyncScheduleTick` yalnız server-private composition'dır; cron, public route veya scheduler
  principal değildir. Bir runner açılmadan önce principal kimliği, tek-instance/lease davranışı, process shutdown,
  deadman/alert ve timezone/misfire kabulü ayrı olarak tamamlanmalıdır. Caller'dan workspace, connection, account,
  token veya adapter alınmamalıdır.
- Existing-post proposal policy composition'ında evidence freshness için sessiz varsayılan kullanılmaz.
  `resolveNotBefore` yalnız reviewed server configuration/registry'den gelmelidir; request body, model çıktısı,
  template etiketi veya audience preset freshness kanıtı değildir. Kaynak yoksa adapter `null` döner ve queue yazımı
  yapılmaz. Proposal expiry; approval definition, uygulanan autonomy rule, eşleşen guardrail revision, binding ve
  maximum proposal lifetime bitişlerinin en erkenini aşmamalıdır.
