# ReklamZeka

ReklamZeka, Meta Ads ve Google Ads performansını ortak metriklerde birleştirmeyi,
sapmaları açıklanabilir kanıtla göstermeyi ve sonraki aksiyonları insan onayında tutmayı
hedefleyen çok kiracılı reklam karar destek ürünüdür.

## Mevcut durum

- A01–A06 kapalı: ürün, teknik temel, kanonik veri, kiracı güvenliği, dashboard ve
  açıklanabilir içgörü motoru kanıt kapılarından geçti.
- Meta/Google fixture adapter'ları ve CSV connector aynı sürümlü günlük metrik modeline
  idempotent akar; MVP connector sınırı salt-okunurdur.
- `/pilot`, `/dashboard`, `/reports/demo`, `/api/dashboard` ve `/api/insights` üretim derlemesinde çalışır.
- Yedi adımlı fixture pilot yolculuğu 1280/390 px tarayıcı sürüşünden geçti; bu kanıt
  gerçek saha pilotu olarak etiketlenmez.
- Süreli/iptal edilebilir salt-okunur rapor, audit ve operasyon alarm çekirdeği hazırdır.
- `REPORT_SIGNING_KEY` yapılandırıldığında pilot yüzeyi gerçek HMAC URL üretir; dinamik
  rapor ve CSV aynı bearer tokenı doğrular, iptal sonrası erişimi reddeder.
- A07 teknik pilot hazırlığı PASS; gerçek 3 çalışma alanı/10 hesap `field_pilot` ölçümü
  tamamlanmadan roadmap kapanmaz.

## Yerel başlangıç

```bash
npm ci
npm run dev
```

Uygulama: `http://localhost:3000` · pilot yolculuğu: `http://localhost:3000/pilot` ·
demo dashboard: `http://localhost:3000/dashboard`

İmzalı demo paylaşımı için `.env.local` içinde standart base64 biçiminde en az 32 byte
anahtar tanımlayın:

```bash
openssl rand -base64 32
```

Üretilen değeri `REPORT_SIGNING_KEY` olarak kaydedin. Aynı deployment'ın tüm replica'ları
aynı anahtarı kullanmalıdır; anahtar rotasyonu mevcut bağlantıları geçersiz kılar. Demo
runtime'ındaki iptal listesi süreç-içidir; kalıcı production iptali ADR-0005 uyarınca
veritabanı kaydı gerektirir.

## Kaynaklar

- [Ürün brifi](docs/URUN-BRIFI.md)
- [Kanonik ürün distilasyonu](docs/product/reklamzeka-product-distillation.md)
- [Kutup yıldızı](utopya/KUZEY.md)
- [MVP şartnamesi](utopya/vizyon/1-urun-ve-mvp.md)
- [Kanonik ana roadmap](plans/proje/v2/MASTER.md)
- [Agentic guidance ve kademeli policy mimarisi](docs/architecture/guidance-deliberation-and-progressive-formalization.md)
- [L0–L5 analiz pipeline'ı](docs/architecture/analysis-processing-pipeline.md)
- [Uçtan uca gap review ve vertical slice sırası](docs/discovery/2026-08-06-end-to-end-gap-review.md)
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
