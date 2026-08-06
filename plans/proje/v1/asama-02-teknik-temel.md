---
kosum: tek-ajan
---
# Aşama 02 — Teknik temel (v1)

> Roadmap: [MASTER.md](MASTER.md) · Bağımlı: 01

## Bağlam

Ürün sözleşmesi hazır, uygulama kodu yok. Bu aşama stack seçimini gerekçeli ADR'a bağlar
ve sonraki veri/güvenlik aşamalarının üzerinde birlikte çalışacağı iskeleti kurar.

## SONUÇ

**Bu aşama bitince:** Web uygulaması, API, ilişkisel veritabanı, migration, test fixture'ı,
yerel geliştirme komutu ve CI hızlı kapısı temiz kurulumda çalışır.

## Task'lar

### T02.1 — Mimari karar kaydı
**SONUÇ:** Runtime, web framework, veritabanı/ORM, iş kuyruğu, test ve dağıtım kararları alternatifleriyle ADR'da kayıtlıdır.
**Subtask'lar:** Güncel resmi dokümantasyonla sürümleri doğrula; `docs/ADR/0001-teknik-temel.md` yaz; monorepo sınırlarını belirle.
**Kabul kriteri:** ADR lint, her karar için `karar/gerekçe/alternatif/sonuç` alanlarını doğrular.

### T02.2 — Çalışan iskelet
**SONUÇ:** Sağlık endpoint'i, başlangıç migration'ı ve bir fixture testi çalışır.
**Subtask'lar:** Uygulama paketlerini kur; env örneği ekle; sır içermeyen yerel veritabanı akışını kur; health ve migration testlerini yaz.
**Kabul kriteri:** Temiz bağımlılık kurulumundan sonra hızlı test exit 0 ve health testi 200 döner.

### T02.3 — Kanıt ve CI
**SONUÇ:** Hızlı test `.claude/kanit.json` ve CI tarafından aynı argv ile çalıştırılır.
**Kabul kriteri:** CI yapılandırması parse edilir; kanıt komutu yerelde exit 0.

## Doğrulama

Temiz checkout simülasyonu, migration ileri/geri testi, hızlı test ve health smoke art arda geçer.

## Durum

KAPALI — 2026-08-06 · kanıt: `npm run check:quick`, `npm run db:check`, `npm run build`, `npm run check:security`.
