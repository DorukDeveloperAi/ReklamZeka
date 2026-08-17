# P03-B — Kanonik Operasyon read model

- deliveryRef: `P03-B-operation-read-model-20260817`
- requirements: güncel published slice çözümü, hiyerarşik campaign/ad-set facts, dönem kapsamı, CBO/ABO sahipliği, salt-okunur tenant sınırı
- schema/migration: yok
- authority: read-only; action/approval/Meta write `0`

## Kabul kanıtı

- Operasyon repository aynı `REPEATABLE READ + READ ONLY` transaction içinde güncel published slice revision, predicate, override ve bounded aday kanıtını yükler.
- Persisted revision kanonik olarak yeniden kurulur ve definition hash exact doğrulanır; frozen run snapshot güncel görünümün kaynağı değildir.
- Kategori çözümü mevcut `inspectEffectiveCategory` semantiğini kullanır: manual-lock, source önceliği, cardinality, add/override/deny ve campaign→ad-set mirası korunur.
- Üyelik yalnız entity'nin kendi seviyesinde çözülür; parent include child exclude veya yabancı market sınırını geçemez.
- Global ve slice görünümünde pazar, entity'nin own/effective kanonik kanıtından gelir; Kurum Kampanyası fallback'i yanlış gerçek olarak kullanılmaz.
- Campaign summary ve ad-set child satırları stable opaque keyset ile ayrılır; CBO/ABO budget owner çift sayılmaz. Eksik spend/coverage sıfır sayılmaz.
- UUID setleri boş/dolu durumda güvenli JSONB binding ile çalışır; `ad_set` insight enumu kanonik değerdir.

## Gate ve canlı kanıt

- Focused: 6 dosya / 31 test PASS
- `npm run typecheck` — PASS
- `npm run db:check` — PASS
- `npm run check:security-boundaries` — PASS
- `npm run verify:operation-read-live` — PASS; gerçek current slice + inherited ad set fixture, outer rollback, `fixtureWritesRolledBack:true`, repository Meta write `0`, zero residue
- `git diff --check` — PASS
- Bağımsız critical review — FINAL ACCEPT

## Bilinen sınırlar

Primary result binding kalıcılığı henüz yoktur; read model bilinçli olarak `unbound/null` gösterir ve tahmin etmez. Saved views, ayrı Kapsam Raporu, export ve UI kabulü sonraki P03 alt paketleridir.
