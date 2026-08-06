# ReklamZeka

ReklamZeka, Meta Ads ve Google Ads performansını ortak metriklerde birleştirmeyi,
sapmaları açıklanabilir kanıtla göstermeyi ve sonraki aksiyonları insan onayında tutmayı
hedefleyen çok kiracılı reklam karar destek ürünüdür.

## Mevcut durum

- A01–A06 kapalı: ürün, teknik temel, kanonik veri, kiracı güvenliği, dashboard ve
  açıklanabilir içgörü motoru kanıt kapılarından geçti.
- Meta/Google fixture adapter'ları ve CSV connector aynı sürümlü günlük metrik modeline
  idempotent akar; MVP connector sınırı salt-okunurdur.
- `/dashboard`, `/api/dashboard` ve `/api/insights` üretim derlemesinde çalışır.
- Süreli/iptal edilebilir salt-okunur rapor, audit ve operasyon alarm çekirdeği hazırdır.
- A07 teknik pilot hazırlığı PASS; gerçek 3 çalışma alanı/10 hesap `field_pilot` ölçümü
  tamamlanmadan roadmap kapanmaz.

## Yerel başlangıç

```bash
npm ci
npm run dev
```

Uygulama: `http://localhost:3000` · demo dashboard: `http://localhost:3000/dashboard`

## Kaynaklar

- [Ürün brifi](docs/URUN-BRIFI.md)
- [Kutup yıldızı](utopya/KUZEY.md)
- [MVP şartnamesi](utopya/vizyon/1-urun-ve-mvp.md)
- [Ana roadmap](plans/proje/v1/MASTER.md)
- [Güncel plan durumu](plans/proje/v1/STATE.md)
- [Pilot hazırlık ve saha giriş kılavuzu](docs/PILOT-READINESS.md)
- [Operasyon runbook'ları](docs/RUNBOOKS.md)

## Doğrulama

```bash
npm run check:quick
npm run check:data
npm run check:security-boundaries
npm run check:experience
npm run check:insights
npm run check:pilot-readiness
npm run build
npm run check:security
```

Gerçek pilot özeti üretimi:

```bash
npm run pilot:field-report -- path/to/field-input.json docs/qa/field-pilot.json
npm run check:field-pilot
```

Ham pilot girdisi repoya alınmaz. Şema ve attestation talimatı
[`docs/pilot/README.md`](docs/pilot/README.md) içindedir.
