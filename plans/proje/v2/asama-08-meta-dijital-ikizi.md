---
kosum: tek-ajan
---
# Aşama 08 — Meta dijital ikizi

## SONUÇ

Bir workspace'in birden çok Meta business connection/reklam hesabı ile bunlara bağlı
Facebook Page, Instagram account, pixel/dataset, app/destination asset graph'ı ve her hesabın
kampanya→ad set→ad→mevcut kreatif ağacı; konfigürasyon,
bütçe sahibi, hedefleme özeti, durum/issues ve campaign/adset/ad insights ile
versioned snapshot olur. Yayındaki reklam metni/spec'i ve bağlı Instagram/Page gönderi
envanteri kaynak kimliğiyle okunur. Büyük hesaplar payload/rate-limit'e çarpmadan parçalı koşar.

## Tasarım

- Inventory, creative ve insights ayrı sync stream/run; ortak parent `portfolio_sync_run`.
- Insights sorgu planlayıcısı level × date slice × breakdown uyumluluk matrisi kullanır.
- `rawPayloadHash + sourceUpdatedAt + fetchedAt`; hassas/raw spec sunucu tarafında.
- Meta alan kataloğu API version'a bağlı; deprecated/unknown alan capability raporudur.
- Legacy objective mapping veri tabanlı; kaynak değer kaybolmaz.
- Snapshot diff, bizim action ledger'da olmayan config değişikliğini `external_change` yapar.
- Connection, account ve asset ayrı nesnedir; permissions/capabilities her sync'te snapshot olur.
- Account group ortak policy bağlar; currency/timezone/cap ve action sonucu hesap bazında kalır.
- Creative source type; effective text fields, CTA/destination, actor, object story/post/media
  identity, asset-feed varyantı ve kaynak alan/provenance ile ad bağına snapshot'lanır.

## Task'lar

### T08.1 — Secret ve connector devralma
Yan projedeki tokenı kopyalamadan secret reference/migration prosedürü; read ve management
scope ayrı; Graph version doctor, debug-token, hesap capability ve expiry alarmı.

### T08.2 — Meta entity şemaları
Account/campaign/adset/ad/creative tabloları; MASTER R-08.2/3 alan matrisi; first/last seen,
configured/effective status, raw source hash ve soft disappearance.

### T08.3 — Budget owner ve Meta config resolver
CBO/ABO, campaign/adset daily/lifetime, bid/cost cap, Advantage+, special category,
optimization/billing/attribution/promoted object ve geo/language/placement özetleri.

### T08.4 — Insights kataloğu
Additive/non-additive/ratio/action/action-value metrikleri; purchases/revenue/leads/messages/
LPV/video/quality rankings; izinli age/gender/country/region/placement/device breakdown'ları.

### T08.5 — Parçalı sync orkestrasyonu
Cursor, adaptive page size, date chunk, rate usage headroom, backoff+jitter, resume, partial
success ve idempotent upsert. HTTP 500 reduce-data ve code 17 rate-limit golden senaryoları.

### T08.6 — Timeline snapshot diff
Status, budget, bid/optimization, targeting signature, creative bağı ve isim değişikliği;
action ledger ile eşleşiyorsa verify, değilse external/manual intervention.

### T08.7 — Capability ve veri kalitesi raporu
Hesap/entity/metric coverage, orphan, duplicate, freshness, attribution, para/timezone,
permission ve sorgulanamayan alanlar; publish/automation readiness girişi.

### T08.8 — Çok hesap/connection orkestrasyonu
Workspace→connection→account grant; hesap grubu/portfolio; paralellik tavanı, hesap bazlı
cursor/run/rate usage ve partial success. Bir hesap hatası diğerlerinin sonucunu iptal etmez.

### T08.9 — Page, Instagram ve destination asset graph
Facebook Page, Instagram account, pixel/dataset, app, WhatsApp/destination; actor/promoted
object/creative/campaign edge'leri, permission/capability, first/last seen ve orphan nedeni.

### T08.10 — Yayındaki reklam metni ve post envanteri
Creative raw spec'ten effective primary text, headline, description/caption, CTA,
destination, actor, post/media/creative ID ve dynamic asset-feed varyantlarını ad bağıyla
çıkar. Linked Instagram/Page post-media inventory ownership, permission, promotion
capability, media/lifecycle ve last-seen taşır. Eksik alan uydurulmaz; preview URL'si süreli proxy'dir.

### T08.11 — Raw retention, disconnect ve veri yaşam döngüsü
L0 raw payload için configurable retention/encryption, provenance hash ve purge job;
connection revoke/disconnect, token invalidation, export/delete request ve orphaned local
data durumu. Audit silinmez; kullanıcı verisi retention/policy'ye göre silinir veya anonimleşir.

## Kabul ve kanıt

- Gerçek portföyde isim/ID/token basmadan entity ve metric coverage raporu.
- Aynı snapshot iki kez: satır sayısı sabit; yarım run resume kayıpsız.
- Rate-limit/payload testleri stream/date slice küçülterek recovery; sonsuz retry yok.
- Entity orphan 0 veya sebepli; budget owner her aktif kampanyada resolved/unknown reason.
- Meta write network call sayısı bu aşamada 0.
- En az iki reklam hesabı ve iki farklı Page/Instagram bağlamı tenant/account izolasyonuyla koşar.
- Account group toplu analizi child currency/timezone/permission'ı ezmez.
- En az bir active ad için ekranda görünen copy/CTA/post identity kaynak spec'e izlenir;
  dynamic varyantlar tek metinmiş gibi ezilmez.
- Promotion uygun ve uygun olmayan bağlı Instagram/Page gönderileri sebepli ayrılır;
  bu aşamada hiçbir post promotion/write yapılmaz.
- Disconnect tokenı kullanılamaz yapar; retention run'ı raw payloadı policy'ye göre temizler,
  başka workspace verisine dokunmaz.

## Risk / durma

Gerçek token write scope taşısa bile A13'e kadar writer import edilmez. Bir alan her hesapta
okunamıyorsa zorunlu şema yapılmaz; capability olarak saklanır. API maliyeti/rate-limit
headroom %20 altında yeni slice başlatılmaz.
