# PLAN AĞACI — ReklamZeka

> **ELLE DÜZENLEME YAPMA** — bu dosyayı `plan-organizatoru/scripts/agac.mjs` türetir (tek yazar).
> Damga: `c7d890617a53` · Kaynak: `plans/*/v*/{MASTER,STATE,CHECKLIST}.md` + `plans/legacy.json`
> Tazelik: `node ~/.claude/skills/plan-organizatoru/scripts/agac.mjs --gate` (damga uyuşmazlığı = bayat INDEX → yeniden türet)

## Ağaç

- **proje** (v1 · SÜRÜYOR · aşama 2/7 · sıradaki: 03-veri platformu) — ReklamZeka MVP `[proje]` `P2`

## Planlar

| plan | kategori | künye (kritiklik/aciliyet · hacim) | üst | sürüm | durum | aşamalar | checklist (açık/kapalı) | son tur |
|---|---|---|---|---|---|---|---|---|
| [proje](proje/v1/MASTER.md) | proje | yüksek/normal · epik (P2) | — | v1 | SÜRÜYOR | 2/7 | 9/8 | 2026-08-06 — teknik-temel |

## Öncelik sırası (türev — künye: kritiklik × aciliyet)

1. **proje** — yüksek/normal · epik (P2) · hedef: ReklamZeka, iki reklam platformundan salt-okunur veri alan ve açıklanabilir öneri sunan güvenli bir pilot ürüne dönüşür.

## Nerede kalmıştık

### proje — ReklamZeka MVP
- Künye: proje · yüksek/normal · epik (P2) · **hedef:** ReklamZeka, iki reklam platformundan salt-okunur veri alan ve açıklanabilir öneri sunan güvenli bir pilot ürüne dönüşür.
- Kaynak oturum: `ot:2026-08-06/reklamzeka-baslangic`
- Son tur: **2026-08-06 — teknik-temel** — ADR-0001, Next.js 16 App Router uygulaması, health API, PostgreSQL/Drizzle başlangıç şeması, migration, Vitest ve GitHub Actions hızlı kapısı kuruldu.
- Sıradaki aşama: **03 — veri platformu** (AÇIK)
- Hazır küme (paralel koşulabilir): **03-veri platformu** · **04-kiracı güvenliği**
- Bekleyen: 05-performans deneyimi ⟵ 03, 04 · 06-içgörü motoru ⟵ 03, 04 · 07-rapor ve pilot ⟵ 05, 06
- Hazır komut: `/goal plans/proje/v1/asama-03-veri-platformu.md planını uygula; bitince aynı klasördeki STATE.md ve CHECKLIST.md'yi güncelle; kanıt yollarını STATE.md'ye yaz`

