# ReklamZeka MVP — STATE (v1)

> Bu dosya ilerleme defteridir; her uygulama turu kanıtıyla günceller.

## Aşama durumları

| # | aşama | durum | bağımlı | son dokunuş | kanıt |
|---|---|---|---|---|---|
| 01 | ürün temeli | KAPALI | — | 2026-08-06 | `npm test` → FOUNDATION PASS |
| 02 | teknik temel | KAPALI | 01 | 2026-08-06 | `npm run check:quick`; `npm run build`; `npm run check:security` |
| 03 | veri platformu | AÇIK | 02 | — | — |
| 04 | kiracı güvenliği | AÇIK | 02 | — | — |
| 05 | performans deneyimi | AÇIK | 03, 04 | — | — |
| 06 | içgörü motoru | AÇIK | 03, 04 | — | — |
| 07 | rapor ve pilot | AÇIK | 05, 06 | — | — |

## Tur günlüğü (en yeni üstte)

### 2026-08-06 — teknik-temel
- Yapılan: ADR-0001, Next.js 16 App Router uygulaması, health API, PostgreSQL/Drizzle başlangıç şeması, migration, Vitest ve GitHub Actions hızlı kapısı kuruldu.
- Kanıt: `npm run check:quick`; `npm run db:check`; `npm run build`; `npm run check:security`.
- Açık kalan / bloker: Drizzle Kit geliştirme bağımlılığındaki ilanlı orta seviye esbuild bildirimi; production audit temiz. Sıradaki aşama 03 veri platformu.

### 2026-08-06 — reklamzeka-baslangic
- Yapılan: Ürün tezi, hedef kullanıcı, MVP sınırı, şartname çıpaları, kalite eşikleri, ana roadmap ve kanıt sözleşmesi oluşturuldu.
- Kanıt: `npm test` → `FOUNDATION PASS`; eşzamanlılık regresyonu → `257/257 PASS`.
- Açık kalan / bloker: Bu tur sonunda sıradaki iş aşama 02 idi; sonraki turda kapatıldı.
