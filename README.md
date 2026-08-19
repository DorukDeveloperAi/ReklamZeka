# ReklamZeka

ReklamZeka, Meta Ads ve Google Ads performansını ortak metriklerde birleştirmeyi,
sapmaları açıklanabilir kanıtla göstermeyi ve sonraki aksiyonları insan onayında tutmayı
hedefleyen çok kiracılı reklam karar destek ürünüdür.

Tek plan otoritesi `plans/proje/v2` altındaki dört kanonik dosyadır:

- [MASTER](plans/proje/v2/MASTER.md)
- [STATE](plans/proje/v2/STATE.md)
- [CHECKLIST](plans/proje/v2/CHECKLIST.md)
- [REQUIREMENTS](plans/proje/v2/REQUIREMENTS.md)

## Yapı

Aktif uygulama sınırı Next.js/TypeScript modular monolith, Drizzle ve PostgreSQL'dir.
Meta bağlantısı tenant-bağlı secret reference üzerinden salt-okunur Graph adapter'ına gider.
Codex CLI/VS Code ve Claude Code entegrasyonu project-scoped local MCP'nin exact safe-tool
allowlist'ini kullanır; raw Meta writer agent veya dashboard yüzeyine açılmaz.

## Kurulum

```bash
npm ci
npm run check:quick
npm run dev
```

## Mevcut durum

- A01–A06 kapalı: ürün, teknik temel, kanonik veri, kiracı güvenliği, dashboard ve
  açıklanabilir içgörü motoru kanıt kapılarından geçti.
- Meta/Google fixture adapter'ları ve CSV connector aynı sürümlü günlük metrik modeline
  idempotent akar; MVP connector sınırı salt-okunurdur.
- Kullanıcıya açık tek çalışma yüzeyi `/dashboard`'dır; gerçek kanonik kaynak veya açık
  `EMPTY` / `UNAVAILABLE` durumu gösterir.
- Eski fixture pilotu, demo raporları ve `/api/dashboard` / `/api/insights` demo endpoint'leri
  `410 legacy_demo_retired` döndürür veya dashboard'a yönlenir; sahte operasyon verisi yayınlanmaz.
- Eski fixture kanıtları yalnız tarihsel test/plan artefaktı olarak tutulur; saha pilotu veya
  canlı veri kanıtı değildir.
- A07 teknik pilot hazırlığı PASS; gerçek 3 çalışma alanı/10 hesap `field_pilot` ölçümü
  tamamlanmadan roadmap kapanmaz.

## Yerel başlangıç

```bash
npm ci
npm run dev
```

Uygulama: `http://localhost:3000/dashboard`

## Kaynaklar

- [Ürün brifi](docs/URUN-BRIFI.md)
- [Kanonik ürün distilasyonu](docs/product/reklamzeka-product-distillation.md)
- [Kutup yıldızı](utopya/KUZEY.md)
- [MVP şartnamesi](utopya/vizyon/1-urun-ve-mvp.md)
- [Kanonik ana roadmap](plans/proje/v2/MASTER.md)
- [Agentic guidance ve kademeli policy mimarisi](docs/architecture/guidance-deliberation-and-progressive-formalization.md)
- [L0–L5 analiz pipeline'ı](docs/architecture/analysis-processing-pipeline.md)
- [Uçtan uca gap review ve vertical slice sırası](docs/discovery/2026-08-06-end-to-end-gap-review.md)
- [Aktif S1 Meta Read Mirror yürütme planı](plans/proje/v2/slice-01-meta-read-mirror.md)
- [Güncel plan durumu](plans/proje/v2/STATE.md)
- [Tarihsel v1 planı](plans/proje/v1/MASTER.md)
- [Pilot hazırlık ve saha giriş kılavuzu](docs/PILOT-READINESS.md)
- [Operasyon runbook'ları](docs/RUNBOOKS.md)

## Doğrulama

```bash
npm run check:quick
npm run check:data
npm run check:security-boundaries
npm run check:experience
npm run check:insights
npm run check:pilot-web
npm run check:pilot-readiness
npm run build
npm run check:security
```

Gerçek pilot özeti üretimi:

```bash
npm run pilot:field-preflight -- path/to/field-input.json
npm run pilot:field-report -- path/to/field-input.json docs/qa/field-pilot.json
npm run check:field-pilot
```

Ham pilot girdisi repoya alınmaz. Şema ve attestation talimatı
[`docs/pilot/README.md`](docs/pilot/README.md) içindedir.
Önerilen telemetri yolu, anonim bağlantı/dashboard/sync/feedback/güvenlik olaylarını
deterministik aggregate ölçülere dönüştürür; manuel aggregate şablonu yalnız fallback'tir.
