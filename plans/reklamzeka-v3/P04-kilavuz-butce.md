# P04 — kilavuz-butce

**Bağımlılık:** P03. **DoD:** R3-11–R3-13.

## Kılavuz kontratı

Her Kılavuz revisionında tek slice, frequency/schedule, mode, closed actions, free-text ve strict yapı; kapsam/metric/eşik/pencere/rollback/authority/budget alanları bulunur. Manual run aynı kontratı izler. Schedule ve mode **P04 Kılavuz kontratıdır**, P03’e ait değildir.

- Dört mode kanonik enum olarak tanımlanır; her mode izinli closed actions/staging/autonomy sınırını açıklar.
- Natural-language formül, strict alana çevrilirken explicit interpretation diff gösterir; kullanıcı kabul etmeden binding olmaz.
- Activation, stale geçişi, revision lifecycle ve template detachment izlenir.
- Guide Agent yalnız wording/soru/eksik alan önerir; explicit transfer editöre getirir, user save olmadan kalıcı kayıt oluşmaz.

## Bütçe

Dört katman: market → hizmet/ana aile → geo/hedefleme/platform → kampanya/ad set. Havuzlar/alt havuzlar upper ceiling, distribution, special-audience protection ve overlapta most-restrictive sınırını dry-run gösterir.

## Test, rollout, rollback

Revision/OCC, one-slice/frequency/mode/action, manual/schedule, four-mode capability, NL-diff acceptance, stale/activation/template-detach, budget property/overlap/market negatifleri; transfer-without-save write reddi ve RLS kabulü. Rollback Agent inputunu kapatır, user revisionını korur.

