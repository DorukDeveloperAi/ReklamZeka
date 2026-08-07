---
kosum: tek-ajan
---
# Aşama 01 — Ürün temeli (v1)

> Roadmap: [MASTER.md](MASTER.md) · Bağımlı: —

## SONUÇ

**Bu aşama bitince:** ReklamZeka'nın hedef kullanıcısı, güvenli MVP sınırı, ölçülebilir
şartnamesi ve uygulama roadmap'i repo içinde tek kanonik zincir oluşturur.

## Task'lar

### T01.1 — Ürün tezini sabitle
**SONUÇ:** Ürün brifi kullanıcı, problem, temel akış, kapsam içi/dışı ve başarıyı açıklar.
**Kabul kriteri:** `node scripts/check-project-foundation.mjs` → `FOUNDATION PASS`.

### T01.2 — Şartnameyi doldur
**SONUÇ:** Vizyon ve beş istek tipi benzersiz `uy:` çıpalarıyla doludur.
**Kabul kriteri:** foundation kapısı çıpa ve placeholder kontrollerini geçer.

### T01.3 — Roadmap ve kanıtı bağla
**SONUÇ:** `plans/proje/v1` ve `.claude/kanit.json` birbirini tüketebilir.
**Kabul kriteri:** `npm test` exit 0.

## Doğrulama

`npm test` iki kez koşulduğunda aynı `FOUNDATION PASS` hükmünü vermelidir.

## Durum

KAPALI — 2026-08-06 · kanıt: `npm test`.
