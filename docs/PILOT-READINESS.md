# Pilot hazırlık raporu

Bu rapor gerçek kullanıcı pilotu değildir. `fixture_readiness` modunda, ölçüm hattının
ürün şartnamesindeki eşikleri doğru hesapladığını kanıtlayan sentetik hazırlık sürüşüdür.

| ölçü | fixture sonucu | eşik | durum |
|---|---:|---:|---|
| çalışma alanı | 3 | ≥3 | PASS |
| reklam hesabı | 10 | ≥10 | PASS |
| 60 dakika içinde taze hesap | %100 | ≥%95 | PASS |
| medyan ilk dashboard süresi | 10,5 dk | ≤15 dk | PASS |
| yararlı veya aksiyon alındı | %75 | ≥%60 | PASS |
| açık kritik güvenlik olayı | 0 | 0 | PASS |

Kaynak fixture: `tests/fixtures/pilot.json`; makine çıktısı:
`docs/qa/pilot-readiness.json`.

## Saha pilotunu kapatma koşulu

Aynı ölçüm sözleşmesi gerçek 3 çalışma alanı ve 10 hesap üzerinde `field_pilot` modunda
koşmalı; çalışma alanı bazlı sonuç, açık güvenlik olayları ve E2E sürüş kanıtı birlikte
arşivlenmelidir. Bu gerçekleşmeden A07 ve tüm MVP roadmap'i KAPALI sayılmaz.

Doğrulanmış saha girdisi ve attestation için [`docs/pilot/README.md`](pilot/README.md)
izlenir. Üretilen özet `docs/qa/field-pilot.json` olur ve `npm run check:field-pilot`
kapısından geçer; ham hesap girdisi repoya alınmaz.
