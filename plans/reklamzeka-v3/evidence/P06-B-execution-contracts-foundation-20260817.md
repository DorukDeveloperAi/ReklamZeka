# P06-B — Execution contracts foundation

**Karar:** Kabul edildi; şemasız, executor-disabled saf sözleşme temeli. DB persistence veya Meta write yetkisi değildir.

## Kabul edilen sözleşme

- Yalnız `createP06ExecutionContractService(...)` factory yüzeyi vardır; active-head, human-presence/freshness, kill receipt ve rollback kanıtları injected trusted portlardan `unknown` gelir ve kapalı parserlarla doğrulanır.
- Limited-autonomy admission exact workspace/account/entity/slice/market/window/budget/delta/cap/quota ile canonical active Guide set + overlap resolution'ı hash'e bağlar. Wrong slice/current-head ve eksik cap fail-closed'dur.
- Human karar kanıtı actor, decision, action, ActionUnit, proposal ve freshness zaman aralığını bağlar; rename insan-only, create/raw deny'dır.
- Kill recheck receiptleri source/version/stage/sequence/previous-hash/time/expiry ile zincirlidir ve execution lease/fence kimliğine bağlıdır.
- Exact 10-step normal, already-applied ve ambiguous-read-before-retry yolları ayrıdır. Interrupt prefix, olay step/outcome, stage receipt, immediate terminal+release ve stale-fence bütünlüğü doğrulanır.
- Rollback yalnız typed/recomputed terminal+observation kanıtı, exact workspace/target/action/currency ve doğru budget/status yönüyle yeni insan onaylı proposal üretir.
- Canonical hash safe-integer/bounded girdiler kullanır; NaN/Infinity, oversized trace/collections ve malformed evidence reddedilir. Çıktılar deep-frozen ve bütün capability bayrakları false'dur.

## Kanıt

- Bağımsız kritik final karar: ACCEPT.
- Odaklı güvenlik/foundation matrisi: 7 dosya / 61 test PASS.
- P06 modül regresyonları: 7/7 PASS.
- Full TypeScript typecheck ve `git diff --check` PASS; suppression directive yok.

## Açık işler

- P05 disposition artifact → ActionUnit immutable DB binding/materializer
- Persisted defer ve rename-human-only approval lifecycle genişletmesi
- Limited-autonomy atomik kota ve current Guide revalidation persistence
- Execution-v2 event/head/observation/rollback ledger
- Default-off central kill/allowlist gate, typed Meta writer ve sandbox/live kabulü
