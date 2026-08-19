# P03-D — Kapsam Raporu v1 foundation

**Karar:** Kabul edildi; salt-okunur, şemasız kısmi Kapsam Raporu temeli. Full P03 report ürünü değildir.

## Kabul edilen sözleşme

- Current published slice, canonical P03 resolver ve aynı RR/read-only transaction yeniden kullanılır; ikinci resolver/frozen replay karıştırılmaz.
- Üyelik satırları included/excluded ve exact missing/ambiguous/conflicting/market nedenlerini public evidence refleriyle taşır.
- `day|week|month`, campaign/ad-set level, metric/action filtreleri, stable sort, subtotal, exact rational, drill ve raw metric/action long-form bulunur.
- Action selector tenant-bound trusted canonical catalogdan doğrulanır; unknown selector reddedilir.
- Oranlar `Number` kullanmaz. Spend + selected action kanıtı bucket içindeki bütün günlerde available ve aynı currency/attribution olduğunda üretilir; missing/unavailable/mixed kanıt null kalır.
- Coverage, görünüm metric filtresinden önce seçili action evidence üzerinden hesaplanır; missing sıfır sayılmaz.
- JSON/CSV export public refs taşır; CSV formula/leading whitespace/CR-LF neutralize edilir.
- HTTP cookie/session + same-origin + exact intent ile bağlıdır; workspace/header override ve bearer reddedilir; yazma yetkisi yoktur.
- Tarih aralığı calendar-valid ve en fazla 366 gündür; raw metric query `LIMIT 50_001` + fail-closed cap ve total deterministic order kullanır.

## Canlı kanıt

`npm run verify:scope-report-live` bağımsız uzun oturumda exit 0 verdi. Bütün bayraklar true:

- day/week/month buckets
- lead + purchase selector ve zero-row unavailable coverage
- missing day/availability
- exact large-decimal rational
- mixed currency/attribution => null
- excluded-market conflict + public evidence
- level/metric/action filters, requested sort, subtotal/ratio/drill
- deterministic order, limit+1 cap, public refs/no UUID
- service catalog selectors
- repeatable-read/read-only smoke
- `writeOperations=0`
- outer rollback / zero fixture residue

Ek gates: focused 4 dosya / 16 test PASS; full typecheck PASS; `git diff --check` PASS.

## Açık işler

- Saved report persistence
- XLSX export
- Full filter/sort/pivot UI ve browser/a11y kabulü
- Guide/decision/audit için yalnız contextual link yüzeyi

Bu işler tamamlanana kadar P03 paketinin tüm Kapsam Raporu DoD'u tamamlanmış sayılmaz.
