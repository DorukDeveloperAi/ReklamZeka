# P01-F — Kanonik bütçe/config geçmişi

- deliveryRef: `P01-F-budget-config-history-20260817`
- requirements: P01 bütçe tarihi, tam normal inventory sonrası immutable değişim kanıtı, CBO/ABO tek ekonomik sahiplik
- public contract: normal sync sonucu `postProcess` ve `postProcessRetryable` alanlarını taşır; Meta write/action authority eklenmez
- schema/migration: yok
- authority: Meta GET dışında network write `0`; action/policy/approval/Meta write yetkisi `0`

## Kabul kanıtı

- Yalnız normal, recovery/bootstrap olmayan ve account/campaign/ad_set/ad inventory dilimlerinin tamamı durable cursor ile tamamlanmış koşum materialize edilir.
- `capturedAt` yalnız terminal cursor `updatedAt` değerinden türetilir; wall-clock fallback yoktur.
- Hesap bazında transaction-local advisory lock altında baseline, replay, stale ve equal-time conflict ayrılır.
- İlk snapshot sıfır event üretir; identical replay idempotenttir; eski snapshot yazılmaz; aynı zamanda farklı hash fail-closed olur.
- Açıklanamayan değişiklik yalnız `external_change` sınıfındadır. CBO campaign, ABO ad set bütçe sahipliği çift sayılmaz; owner belirsiz/non-owner ham config anomalisi kaybolmaz.
- Campaign/ad set/ad/creative/binding okumaları `cap + 1` ile bounded ve overflow fail-closed'dur.
- Post-process hatası kaynağın tamamlanmış GET/mirror sonucunu silmez; redacted `partial_result`, retryable sonuç üretir.

## Gate sonuçları

- `npm run test:unit -- tests/canonical-budget-history-materializer.test.ts tests/meta-read-sync-runtime.test.ts tests/meta-change-snapshot-drizzle-adapter.test.ts tests/meta-change-timeline-persistence.test.ts tests/meta-snapshot-diff.test.ts` — 5 dosya / 39 test PASS
- `npm run typecheck` — PASS
- `npm run db:check` — PASS
- `npm run check:security-boundaries` — PASS
- `git diff --check` — PASS
- Bağımsız critical review — ACCEPT, açık blocker yok

## Bilinen sınır

Meta kaynağı UI içindeki manuel değişiklik ile başka harici değişikliği güvenilir biçimde ayırmadığından provenance dürüstçe `external_change` kalır. P01 paketinin generic Finding/Development Log kalıcılığı P01-E altında açıktır.
