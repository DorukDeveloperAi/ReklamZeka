# ReklamZeka MVP — STATE (v1)

> Bu dosya ilerleme defteridir; her uygulama turu kanıtıyla günceller.

## Aşama durumları

| # | aşama | durum | bağımlı | son dokunuş | kanıt |
|---|---|---|---|---|---|
| 01 | ürün temeli | KAPALI | — | 2026-08-06 | `npm test` → FOUNDATION PASS |
| 02 | teknik temel | KAPALI | 01 | 2026-08-06 | `npm run check:quick`; `npm run build`; `npm run check:security` |
| 03 | veri platformu | KAPALI | 02 | 2026-08-06 | `npm run check:data`; `npm run check:quick` |
| 04 | kiracı güvenliği | KAPALI | 02 | 2026-08-06 | `npm run check:security-boundaries`; `npm run check:quick` |
| 05 | performans deneyimi | KAPALI | 03, 04 | 2026-08-06 | `npm run check:experience`; browser QA 1280/820/390 |
| 06 | içgörü motoru | KAPALI | 03, 04 | 2026-08-06 | `npm run check:insights`; production build |
| 07 | rapor ve pilot | AÇIK | 05, 06 | 2026-08-06 | ara: `npm run check:pilot-readiness`; field pilot bekliyor |

## Tur günlüğü (en yeni üstte)

### 2026-08-06 — rapor-ve-pilot-hazirlik
- Yapılan: İmzalı/süreli/iptal edilebilir salt-okunur paylaşım, CSV export, dört operasyon alarmı/runbook'u ve pilot ölçüm motoru kuruldu.
- Kullanıcı yolculuğu: `/pilot` altında demo oturumu → çalışma alanı → kaynak → sync → dashboard → içgörü/feedback → salt-okunur rapor akışı eklendi; bu yüzey fixture tabanlıdır.
- Tarayıcı kanıtı: 1280 ve 390 px üzerinde yedi adım, feedback ve `read_only` rapor PASS; console error 0 (`docs/qa/a07-pilot-browser-evidence.json`).
- Paylaşım yaşam döngüsü: HMAC URL oluşturma → dinamik rapor/CSV → audit bağlı iptal; geçerli rapor `200`, iptal/bozuk sayfa `404`, iptal CSV `410`. Tarayıcı sürüşünde bulunan bundle-sınırı hata tanıma regresyonu kod tabanlı guard ile kapatıldı.
- Bearer URL sınırı: paylaşılan HTML production yanıtında `private, no-store`, `no-referrer`, `nosniff`, `DENY` frame ve `noindex` başlıkları doğrulandı.
- Ara kanıt: `npm run check:pilot-readiness`; 3 çalışma alanı/10 hesap fixture readiness → tazelik %100, medyan aktivasyon 10,5 dk, yararlı/aksiyon %75, kritik olay 0.
- Ek hazırlık: Gerçek hesap attestation doğrulaması, SHA-256 provenance, üzerine yazmayan rapor üreticisi ve `npm run check:field-pilot` kapısı hazırlandı.
- Ölçüm hattı: Anonim bağlantı/dashboard/sync/feedback/güvenlik olaylarını sıra bağımsız ve idempotent biçimde saha raporu aggregate'ına dönüştüren telemetri yolu eklendi; manuel JSON fallback olarak kaldı.
- Operasyon: `npm run pilot:field-preflight -- <input>` resmi kanıtı yazmadan aynı eşikleri ve provenance hash'ini sınar.
- Açık kalan / bloker: Bunlar sentetik hazırlık verileridir. A07 ancak gerçek pilot `field_pilot` modunda aynı eşikleri geçtiğinde kapanabilir.

### 2026-08-06 — icgoru-motoru
- Yapılan: Sürümlü kanıt şeması, saf kural SDK'sı, harcama/dönüşüm/verimlilik/tazelik kuralları, API/dashboard kartları ve audit bağlı feedback kuruldu.
- Kanıt: `npm run check:insights` → 3 dosya / 8 test + Drizzle temiz; `npm run check:quick` → 7 dosya / 24 test; production build `/api/insights` dahil temiz.
- Açık kalan / bloker: A06 kapandı; son aşama 07 paylaşım, gözlemlenebilirlik ve kontrollü pilot.

### 2026-08-06 — performans-deneyimi-kapanis
- Yapılan: Bağlantı/sync/boş/kısmi/gecikmiş/hata durumları, erişilebilir canlı bölgeler ve responsive davranış tamamlandı.
- Kanıt: `npm run check:experience`; `docs/qa/a05-browser-evidence.json` → 1280/820/390 PASS; yedi durum ve hata kurtarma etkileşimi PASS; console error 0.
- Açık kalan / bloker: A05 kapandı; sıradaki aşama 06 açıklanabilir içgörü motoru.

### 2026-08-06 — performans-deneyimi-baslangic
- Yapılan: Kanonik aggregation, dönem kıyası, tazelik, karışık para birimi koruması, `/api/dashboard` ve erişilebilir 7/30/90 gün kampanya dashboard'u eklendi.
- Ara kanıt: `tests/performance-experience.test.ts` → 3 test; `npm run build` → `/dashboard` ve `/api/dashboard` derlendi.
- Açık kalan / bloker: Aktivasyon durum fixture'ları ve üç viewport/a11y tarayıcı sürüşü tamamlanmadan A05 kapanmayacak.

### 2026-08-06 — kiraci-guvenligi
- Yapılan: Merkezi owner/admin/analyst/viewer policy'si, tenant filtreli sunucu servisi, AES-256-GCM sır kasası, salt-okunur scope allowlist'i, log redaksiyonu ve hash-zincirli append-only audit sınırı kuruldu.
- Kanıt: `npm run check:security-boundaries` → yapısal kapı + 2 dosya / 7 test + Drizzle temiz; `npm run check:quick` → 4 dosya / 13 test temiz.
- Açık kalan / bloker: Gerçek kimlik sağlayıcı ve PostgreSQL RLS canlı entegrasyon ortamında bağlanacak; uygulama sınırı fail-closed. Sıradaki aşama 05 performans deneyimi.

### 2026-08-06 — veri-platformu
- Yapılan: Sürümlü kanonik günlük metrik, Meta/Google fixture adapter'ları, CSV connector, cursor/retry/hata sözleşmesi, idempotent ingest çekirdeği ve PostgreSQL kalıcılık şeması kuruldu.
- Kanıt: `npm run check:data` → 2 dosya / 6 test + Drizzle temiz; `npm run check:quick` → 3 dosya / 7 test temiz.
- Açık kalan / bloker: Canlı platform OAuth/API bağlantıları MVP fixture sözleşmesi sonrasına bırakıldı; sıradaki aşama 04 kiracı güvenliği.

### 2026-08-06 — teknik-temel
- Yapılan: ADR-0001, Next.js 16 App Router uygulaması, health API, PostgreSQL/Drizzle başlangıç şeması, migration, Vitest ve GitHub Actions hızlı kapısı kuruldu.
- Kanıt: `npm run check:quick`; `npm run db:check`; `npm run build`; `npm run check:security`.
- Açık kalan / bloker: Drizzle Kit geliştirme bağımlılığındaki ilanlı orta seviye esbuild bildirimi; production audit temiz. Sıradaki aşama 03 veri platformu.

### 2026-08-06 — reklamzeka-baslangic
- Yapılan: Ürün tezi, hedef kullanıcı, MVP sınırı, şartname çıpaları, kalite eşikleri, ana roadmap ve kanıt sözleşmesi oluşturuldu.
- Kanıt: `npm test` → `FOUNDATION PASS`; eşzamanlılık regresyonu → `257/257 PASS`.
- Açık kalan / bloker: Bu tur sonunda sıradaki iş aşama 02 idi; sonraki turda kapatıldı.
