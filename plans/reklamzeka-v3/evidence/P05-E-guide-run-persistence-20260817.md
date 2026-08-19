# P05-E — Guide Run persistence

**Karar:** PRE APPLY APPROVE ve bağımsız POST ACCEPT. Bu alt paket P05'in persistence/worker temelidir; gerçek Agent sağlayıcıları ve P06 action materialization kapsam dışıdır.

## Kabul edilen sözleşme

- Persistence yalnız `guide-run/1.2.0` yazar; v1.0/v1.1 historical domain kanıtı salt-okunur kalır.
- Run/event/head/artifact/schedule receipt immutable ve tenant-bound'dur; exact active workspace, non-tombstoned Guide ve current active revision yeniden doğrulanır.
- SQL guardları canonical JSON'un desteklenen kapalı subsetini, event/artifact/receipt hash+reflerini, bütün run event dizisini, transition/lease epoch/renew/reclaim/terminal semantiğini doğrular.
- Scope snapshot 4 MiB, diğer artifactler 16.878 byte ile bounded'dır; scheduler missed-count 4.000.000 üst sınırı domain ile aynıdır.
- Worker fire→receipt→claim/reclaim→execute/resume→completed→P01 projection akışını fence altında yürütür; completion sonrası crash replay P01 projection'ı uzlaştırır.
- P01 projection agent önerisini kapalı authority ile taşır ve mevcut human triage durumunu korur.
- Workspace tombstone beş P05 tablosunu child-first temizler.

## Migration ve canlı kanıt

- Migration: `20260817180000_guide_run_persistence`
- SHA-256: `5fea42aa85b081d225104f99feccccf3821dfe6a2e0c104a500a6e700efbae4f`
- Journal: `idx=115`, `when=1786987200000`
- Drizzle ledger: `id=132`, exact hash/timestamp tek satır
- PRE outer rollback: RLS/FORCE/revokes, 7 trigger, repository replay, lease/fence/reclaim, lifecycle/hash vectors, null-value regressions, forged artifact/receipt rejection, scheduler replay, crash resume, P01 replay/human triage, tenant FK, tombstone ve zero residue bayrakları true.
- POST: iki ayrı Pool client, gerçek `DrizzleGuideRunRepository.compareAndSet` ile bir winner/bir conflict; exact fence yalnız winner; v1.2 fixture ve v1.0/v1.1 read-only boundary true.
- POST cleanup gerçek `WorkspaceTombstoneService` yaşam döngüsünü kullandı; beş P05 tablosu `0`, orphan run `0`.
- Bağımsız katalog denetimi: 5/5 tablo ENABLE+FORCE RLS, API rolleri için grant/policy `0`, 24 beklenen indeks, 7 enabled trigger ve 23/23 validated constraint.

## Açık işler

- Gerçek Guide/Daily Agent sağlayıcı ve üretim scheduler çağrı kompozisyonu
- P05 disposition artifact → tenant-bound P06 ActionUnit materializer/binding
- P06 execution-v2 persistence/limited-autonomy quota/Meta writer
- Full P07/P08 browser, rollout ve operasyon kabulü
