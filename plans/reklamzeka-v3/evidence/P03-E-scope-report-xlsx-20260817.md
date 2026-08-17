# P03-E — Scope Report XLSX

**Karar:** Kabul edildi; şemasız XLSX/export kısmi dilimi. Saved report persistence ve full report UI/browser kapsam dışıdır.

## Sözleşme

- Scope, Membership, Raw Metrics, Coverage ve Pivot olmak üzere beş deterministik sayfa üretir.
- Public refler, ham action/spend kanıtı, availability/missing-day coverage, exact rational/pivot/drill ve period/granularity context'i korunur.
- Formül, macro, shared formula, external link veya runtime timestamp yoktur; ZIP metadata sabit `1980-01-01 00:00:00` kullanır.
- XML 1.0 forbidden scalar/lone surrogate güvenli normalize edilir; formula önekleri nötralize edilir.
- Cell başına 32.767 UTF-16, source 8 MiB ve exact stored-ZIP 16 MiB sınırı vardır. XML escape/tag/ZIP header boyutu worksheet stringleri oluşturulmadan hesaplanır; final byte sayısı yeniden doğrulanır.
- HTTP mevcut session/same-origin/intent sınırını yeniden kullanır; XLSX MIME, attachment ve `no-store` kapalıdır; bound ihlali typed 400 üretir.

## Kanıt

- Bağımsız kritik final: ACCEPT.
- Focused 3 dosya / 14 test PASS; typecheck ve diff-check PASS.
- `unzip -t`, `xmllint`, OpenPyXL roundtrip: beş sayfa geçerli.
- Deterministik SHA, preflight byte == actual byte; cap-edge çıktı `16,777,212 <= 16,777,216`, bir sonraki byte yükü reddedildi.
- Quote-heavy 250×32.767 girdi büyük XML join öncesi reddedildi; max RSS önceki ~328 MB'den ~115 MB'ye düştü.

## Açık işler

- Saved report persistence ve paylaşım/version lifecycle
- Full filter/pivot UI, XLSX browser download/a11y acceptance
- Contextual Guide/decision/audit links
