# P05-C — Guide Run v1.1 zincir sertleştirmesi

## Kabul edilen kapsam

- Her genesis/event hash'i immutable `runRef` kimliğine bağlanır; cross-run splice reddedilir.
- Lease epoch, renew ve expiry sonrası reclaim aynı-state olaylarıyla kanıtlanır; stale token/epoch reddedilir.
- Lease nesneleri exact-key, lowercase UUID, canonical ISO ve safe-integer epoch sınırındadır.
- v1.0 historical run zincirleri hash yeniden yazılmadan ayrı salt-okunur verifier ile doğrulanır.
- Missed slotlar O(1) bounded range receipt + deterministic idempotency key ile kaydedilir; yalnız en yeni due slot claim edilir.
- Scheduler kalıcı girdileri `0102–9996`, internal calendar envelope `0100–9998` aralığındadır; timezone, DST ve 366 günlük lookback güvenlidir.
- Manual koşum schedule cursor'ını ilerletmez; bütün authority alanları kapalı kalır.

## Kabul kanıtı

- Bağımsız son inceleme: `ACCEPT`.
- `tests/guide-run.test.ts` + `tests/guide-run-scheduler.test.ts`: 18/18 geçti.
- `npm run typecheck`: geçti.
- `git diff --check`: geçti.
- UTC/New York alt sınırı, Kiritimati üst sınırı, New York DST, 366 günlük custom schedule ve 0102→9996 uzun downtime regresyonları doğrudan doğrulandı.

## Açık kalan kapsam

Bu teslim saf domain/scheduler zinciridir. Guide schedule/run/event/head persistence, frozen slice member incelemesi, Agent runtime, artifact/finding bağlantısı ve P01 generic ledger scope bridge P05 persistence paketinde açıktır. P05 paketi tamamlanmış değildir.
