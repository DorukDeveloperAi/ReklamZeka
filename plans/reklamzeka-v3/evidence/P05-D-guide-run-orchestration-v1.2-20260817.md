# P05-D — Guide Run orchestration ve v1.2 recovery kanıtı

## Kabul edilen kapsam

- Schema-free Guide Run application orchestration: scheduled/manual fire, exact fire replay, lease/head/epoch fence, scope freeze, üye analizi, holistik sentez ve disposition.
- v1.2 post-analysis aynı-state lease renew/reclaim yalnız `recorded|held|staged|no_action`; ana state zinciri değişmez.
- v1.0 ve v1.1 hash/event biçimleri ayrı salt-okunur verifierlarla aynen korunur; historical evidence upcast edilmez.
- Frozen scope üyeleri bounded, unique, deep-cloned ve slice revision/definition/member evidence hash'ine bağlıdır.
- Trusted data-health evidence tek disposition yetki girdisidir; modelin kalite beyanı authority değildir.
- Per-kind artifact prewrite decoder, canonical ref/payload hash, deep freeze ve append-timeout exact reload.
- Typed finding observation: stable semantic fingerprint + run/evidence-bound observation ref.
- Typed Development Log intent: `producer=agent`, `state=proposed`, authority=false.
- Crash/retry sırasında eksik finding/DevLog yan kanıtları bağımsız reconcile edilir; storage hataları Agent failure olarak etiketlenmez.

## Kabul kanıtı

- Bağımsız kritik inceleme: `ACCEPT`.
- Guide run/domain/scheduler/orchestration focused: 26/26 geçti.
- `npm run typecheck`: geçti.
- `git diff --check`: geçti.

## Özellikle doğrulanan regresyonlar

- Wrong/stale lease hiçbir scope/Agent/artifact yan etkisi üretmeden reddedilir.
- Stale trusted-data finding koşumu `held` olarak tamamlanır ve exact replay edilir.
- Invalid finding ref prewrite aşamasında reddedilir; immutable kötü artifact oluşmaz.
- Aktif Guide allowlist dışı persisted holistic candidate yüklemede reddedilir.
- Member artifact write arızası false `member_failure` üretmez.
- Finding fingerprint yeni evidence'da sabit, observation ref farklıdır.
- v1.2 recorded/held/staged/no_action crash recovery token/epoch fencing ile completed'a devam eder.

## Açık kalan kapsam

Guide schedule/run/event/head/artifact persistence, P01 finding ledger scope binding, gerçek Guide/Daily Agent runtime transport ve browser/run history P05 persistence/runtime paketinde açıktır. Bu alt paket P05'in tamamı değildir.
