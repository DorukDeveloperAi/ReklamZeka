# P04-Cc — budget action fail-closed foundation

**Karar:** Kabul edildi; yalnız şemasız, fail-closed kısmi temel. Production-ready action consumer veya tamamlanmış P04 değildir.

## Kabul edilen sınır

- Guide budget dry-run çıktısı mevcut canonical ActionPlan ve single-human staging sözleşmesine typed olarak bağlanır.
- `daily` / `lifetime`, CBO campaign owner ve ABO exact ad-set owner ayrımı korunur.
- Yalnız `prepare_human_approval` + human-approval sonucu staging adayı olabilir; recommend, limited-autonomy, eksik mode/disposition ve bütün belirsiz kanıtlar hold üretir.
- Plan kimliği tam `dryRunHash` taşır. `planHash`, dry-run, ActionPlan, action, frozen context ve approval-policy digestlerini bağlar.
- Admission güncel dry-run ve trusted contexti yeniden kurar; constraint, policy, kill-switch, protection, action, context veya tutar driftinde exact karşılaştırma başarısız olur.
- Legacy/kısa Guide plan refleri, eksik gate, süresi dolmuş unit, stale evidence ve data-health gerilemesi fail-closed olur.
- Public owner aliası production queue entity kimliği olarak kullanılamaz.
- Kod approve, execute, Meta-write veya network authority açmaz.

## Kanıt

- Bağımsız kritik re-review: **ACCEPT — fail-closed partial foundation**.
- Focused test: 5 dosya / 26 test PASS.
- Full typecheck PASS.
- `git diff --check` PASS.
- P04-Cb applied migration SHA-256 değişmedi: `d975d255108a31e19caa69432e8f960ec4d60256031f19cac229b5d64fa8abdc`.

## Açık production blockerları

1. Authoritative parent/pool ceiling kaynağı yoktur; adapter `parent_ceiling_unavailable` hold üretir. Draft/recommendation-only Budget Lab hierarchy otorite sayılmaz.
2. Exact external writable entity, current rules/kill-switch, protection, data-health identity, frozen context ve approval policy sağlayan concrete trusted-context composition tamamlanmamıştır.
3. CBO campaign protection için bütün canlı ad setleri kapsayan canonical geo evidence gerekir; tek ad setten türetilemez.
4. Production runtime staging/queue/admission composition ve canlı Guide-origin stage→approve→admission testi yoktur.
5. P06 executor, write-time kill switch, verify ve rollback hattı bu paketin dışındadır.

Bu blockerlar kapanana kadar gerçek Guide budget ActionUnit staging/admission yolu kapalı kalmalıdır.
