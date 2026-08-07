---
kosum: tek-ajan
---
# Slice 01 — Meta Read Mirror yürütme planı

## Sonuç

ReklamZeka, Meta'dan hiçbir write yapmadan bir workspace'in seçili reklam hesabını;
account→campaign→ad set→ad→creative/post hiyerarşisi, config, gerçek budget owner, günlük
insights, yayındaki reklam metni ve bağlı asset graph'ıyla güvenilir biçimde aynalar. İlk
hesap kanıtından sonra ikinci hesapta tenant/account izolasyonu doğrulanır.

Bu dosya yalnız güncel teslim dilimini yönetir. A08 domain şartnamesinin minimum değer
üreten sırasıdır; S2 category/analysis veya A13 write kapsamını öne çekmez.

## Güncel ilerleme — 2026-08-07

- **S1.1 çekirdek sözleşme tamam:** read-only connection service, capability doctor,
  workspace authorization, redacted public model, environment/in-memory secret reference,
  lifecycle ve append-only audit testli. Kalıcı DB adapter ve secret rotation S1.5'e açık.
- **S1.2 tamam:** non-destructive digital-twin migration, full hierarchy/content/asset
  canonical modeli ve deterministik CBO/ABO budget-owner resolver testli.
- **Canlı read kanıtı:** 5 ad account, 22 Page, 8 Instagram, 422 campaign, 1.108 ad set,
  4.620 ad; tüm hesaplarda son-7-gün insight erişimi, 0 hata ve 0 write.
- **S1.3 core tamam:** parçalı/resumable runtime, persistence schema, metric contract,
  transaction adapter, somut Drizzle repository ve hash-only replay ledger fixture/golden
  testli. Her sayfa/slice durable olur ve yeni runtime cursor'dan hydrate edilir.
- **GET-only Graph binding tamam:** inventory hierarchy, creative/post ve insight edge'leri,
  cursor pagination ve usage headroom gerçek Meta'da sınırlı smoke ile 0 write doğrulandı.
- **S1.3 kapalı:** Supabase PostgreSQL 17'ye sekiz migration/29 public tablo uygulandı;
  transaction/session pooler SSL bağlantıları ve yeni connection/runtime ile durable
  `partial`→cursor restore→`completed` kabulü geçti. Geçici E2E workspace'i cascade silindi.
- **Aktif S1.4:** canlı asset/content mirror. S1.5 henüz kapanmadı; schema/contract varlığı
  canlı asset-content sync veya lifecycle kapanışı sayılmaz.

## Değişmez sınırlar

- Meta write import'u, management operation ve action proposal yok.
- Token değeri repoya, loga, audit payloadına veya agent context'ine kopyalanmaz.
- İlk bağlantı mevcut güvenli secret reference üzerinden yapılır; devralma açık prosedürdür.
- Inventory, creative/post ve insights ayrı sync stream'idir.
- Eksik Meta alanı tahmin edilmez; `unknown/unsupported/permission_missing` nedeni taşır.
- L0 raw agent'a verilmez; configurable retention ve provenance içindir.
- Tek hesap kanıtı alınmadan çok hesap optimizasyonu yapılmaz.
- PostgreSQL+mevcut worker/ingest deseni yeterlidir; yeni data infrastructure yoktur.

## Increment sırası

### S1.1 — Connection ve secret boundary

**Amaç:** Güvenli, read-only ve gözlemlenebilir Meta bağlantı temeli.

Yapılacaklar:

- mevcut `SecretReference`/workspace authorization sözleşmesini Meta connection'a genişlet;
- tokenı kopyalamadan yan proje/env kaynağına geçici migration/reference prosedürü tanımla;
- configured Graph API version, `/me`, account access, expiry ve permission doctor'u kur;
- read scope ile gelecekteki management scope'u şema ve capability'de ayır;
- token/log/error/redaction negatif testleri ve disconnect davranışını ekle;
- fixture/sahte transport ile CI'da gerçek token gerektirmeyen contract testi yaz.

**Çıkış kapısı:** Doctor token göstermeden connection/account capability sonucu verir;
cross-workspace erişim ve log sızıntısı reddedilir; write endpoint/import yolu yoktur.

### S1.2 — Digital twin core

**Amaç:** Meta hiyerarşisini ve karar için gerekli config'i kayıpsız saklamak.

Yapılacaklar:

- connection, ad account, campaign, ad set, ad ve creative/post identity şemalarını ekle;
- external ID, first/last seen, sourceUpdatedAt/fetchedAt/raw hash ve soft disappearance;
- configured/effective status, objective/legacy objective ve buying/special-category alanları;
- CBO/ABO, daily/lifetime budget ve gerçek budget-owner resolver;
- ad-set optimization, billing, bid/cost cap, attribution, promoted object ve targeting özeti;
- versioned field/catalog mapping ve unsupported capability nedeni;
- golden schema, hierarchy/orphan, budget-owner ve replay testleri.

**Çıkış kapısı:** Active campaign'lerde budget owner resolved veya sebepli unknown; aynı
source snapshot aynı canonical sonucu verir; ad-level budget yanlışlığı oluşmaz.

### S1.3 — Parçalı read sync

**Amaç:** Büyük hesapları rate-limit/payload hatasında kaybetmeden aynalamak.

Yapılacaklar:

- inventory, creative/post ve insights için ayrı cursor/run/state;
- campaign/ad-set/ad level × date-slice query planner;
- adaptive page size, usage headroom, backoff+jitter, bounded retry ve resumable partial run;
- günlük insights, action/action-value, attribution etiketi ve additive/non-additive metadata;
- idempotent upsert, duplicate/stale/revision davranışı ve parent run correlation;
- reduce-data/HTTP 500, rate-limit, timeout, partial success ve resume golden testleri.

**Çıkış kapısı:** Aynı snapshot ikinci kez satır çoğaltmaz; yarım run kaldığı slice'tan
devam eder; bir stream/account hatası tamamlanan sonucu geri almaz; sonsuz retry yoktur.

### S1.4 — Asset ve içerik aynası

**Amaç:** Reklamın gerçekte ne gösterdiğini ve hangi aktöre bağlı olduğunu okuyabilmek.

Yapılacaklar:

- Facebook Page, Instagram account, pixel/dataset, app, WhatsApp/destination asset graph;
- actor/promoted-object/creative/post/media edge, permission/capability ve orphan nedeni;
- effective primary text, headline, description/caption, CTA, destination ve source field;
- dynamic asset-feed varyantlarını tek metne ezmeden ad bağlamında snapshot;
- linked Instagram/Page post inventory, ownership ve promotion eligibility;
- hassas preview URL için kısa ömürlü server-side proxy/ref sözleşmesi;
- extraction golden fixture ve yanlış post/actor/cross-account negatif testleri.

**Çıkış kapısı:** En az bir active ad'in görünen metin/CTA/post kimliği source spec'e
izlenir; dynamic varyant provenance korunur; promotable/non-promotable post sebeplidir;
promotion veya creative write çağrısı `0`dır.

### S1.5 — Trust, lifecycle ve iki hesap kanıtı

**Amaç:** Read mirror'ın analiz için güvenilir olup olmadığını açıkça göstermek.

Yapılacaklar:

- entity/metric/content coverage, freshness, orphan, duplicate, currency/timezone,
  attribution, permission ve unsupported alan raporu;
- L0 retention/encryption/purge ve provenance hash;
- connection revoke/disconnect, token invalidation, export/delete ve orphaned-local-data durumu;
- status/budget/config/targeting-signature/creative-binding snapshot diff;
- bizim action ledger dışındaki değişikliği `external_change` timeline olayına dönüştür;
- ikinci ad account/actor bağlamında isolation, partial success ve account-group sınırı testi;
- read-mirror runbook, operational alert ve evidence raporu.

**Çıkış kapısı:** İki hesap birbirinin permission/currency/timezone/result state'ini ezmez;
disconnect sonrası secret kullanılamaz; retention yalnız hedef workspace verisini işler;
coverage eksikleri sebeplidir; Meta write network call sayısı `0`dır.

## Uygulama ve kanıt disiplini

Her increment:

1. önce schema/contract ve negatif sınır testini kurar;
2. en küçük vertical backend davranışını uygular;
3. fixture/golden ile deterministic replay'i kanıtlar;
4. mümkünse read-only gerçek hesap smoke'u çalıştırır, secret/ID basmaz;
5. `STATE.md` ve mevcut `CHECKLIST.md` maddelerini yalnız kanıtla günceller;
6. foundation, data, security ve ilgili slice testleri temiz olmadan sonraki incremente geçmez.

## Durma ve eskalasyon koşulları

- Gerekli read permission yoksa alan uydurulmaz; capability gap olarak park edilir.
- Configured Graph version alanı desteklemiyorsa catalog/version kararı kaydedilir.
- Rate headroom güvenli eşiğin altındaysa yeni sorgu alanı eklenmez.
- Mevcut secret kaynağını güvenli referansla kullanmak mümkün değilse token kopyalanmaz;
  kullanıcıdan yeni bağlantı yetkilendirmesi istenir.
- Herhangi bir write yolu veya gereğinden geniş scope görülürse increment durur.

## Traceability

- Domain planı: A08/T08.1–T08.11.
- Gereksinimler: R-G2–R-G6, R-G19, R-G25 ve R-08.1–R-08.13.
- Sonraki dilim: S2 Decision Room; S1 çıkış kapısı tamamlanmadan başlamaz.
