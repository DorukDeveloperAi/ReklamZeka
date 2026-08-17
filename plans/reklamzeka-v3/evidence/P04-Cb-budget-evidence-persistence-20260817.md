# P04-Cb — Guide budget evidence/persistence kanıtı

## Kabul edilen kapsam

- Historical v1 Guide payload'larını yeniden yorumlamadan, immutable `guide-budget-contract/2.0.0` companion contract.
- Contract hash'i expression, market/currency/target, freshness ve P06 için complete action/restriction/numeric-cap/unresolved-conflict envelope'unu kapsar.
- `meta_complete_snapshot_receipts` yalnız normal, eksiksiz inventory composition'ından sonra aynı materialization transaction'ında yazılır; partial/recovery/bootstrap kanıt sayılmaz.
- Guide evidence reader tek RR/read-only transaction içinde current published slice üyeliği, active applicable Guide seti, canonical snapshot/receipt ve overlap kanıtını çözer.
- CBO campaign owner ve ABO ad-set owner tek ekonomik owner olarak çözülür; currency/market/freshness/scope/tenant veya receipt uyuşmazlığı fail-closed'dur.
- Dry-run ve servis authority-free'dir; approve/execute/Meta write/persistence yetkisi üretmez.

## Bütünlük ve overlap

- Persisted snapshot payload existing `diffMetaChangeSnapshots` self-diff/hash doğrulamasıyla canonical scope, account, time ve hash açısından yeniden doğrulanır.
- Action ve budget-ref aggregate'leri ayrı LATERAL sorgulardır; 2 action × 2 ref fanout üretmez.
- Valid farklı-target Guide ve contractless status-only Guide aynı entity overlap'ini zehirlemez. Contractless budget-capable Guide fail-closed; selected applicable binding zorunludur.
- Her mevcut v2 contract target applicability filtresinden önce hash/payload/column olarak doğrulanır; stale-hash target discriminator tamperi restrictive Guide'ı sessizce düşüremez.
- P06 aynı entity setinde deny/manual-lock/protection ve en düşük absolute/relative cap'i input-order bağımsız birleştirir.

## Migration ve canlı kanıt

- Migration: `20260817170000_guide_budget_contract_v2.sql`.
- Journal: `idx=114`, timestamp `1786983600000`.
- Drizzle ledger: `id=131`.
- File/ledger SHA-256: `d975d255108a31e19caa69432e8f960ec4d60256031f19cac229b5d64fa8abdc`.
- PRE: unjournaled outer rollback; schema objects ve fixture residue sıfır.
- POST: applied schema üzerinde gerçek CBO/ABO, current resolver, 2×2 action/ref, deny/manual-lock/min-cap, unrelated/status-only/missing-contract applicability, canonical/receipt/stale/currency/market/tenant ve discriminator/contract tamper matrisi geçti; fixture data outer rollback edildi.
- POST sonrası iki tablo da 0 satır; verifier user/workspace residue 0.

## Güvenlik ve gate'ler

- Bağımsız kritik PRE: `APPLY APPROVE`; bağımsız kritik POST: `POST ACCEPT`.
- Her iki tablo RLS ENABLE+FORCE, policy 0, PUBLIC/anon/authenticated/service_role grant 0.
- Tenant-leftmost FK indexes, validated PK/FK/CHECK constraints, enabled append-only triggers ve closed `search_path` SECURITY INVOKER functions doğrulandı.
- Workspace tombstone inspect/allowlist/child-first purge: receipt snapshot'tan, contract Guide revision'dan önce silinir.
- Focused 7 dosya / 36 test; `npm run typecheck`, `npm run db:check`, `npm run check:security-boundaries`, `git diff --check`: geçti.

## Açık kalan kapsam

Bu paket budget resolver/evidence ve safe dry-run temelini kapatır. P04'ün ActionUnit/admission/executor/rollback consumer bağlantısı, template/compatibility işleri ve P06 karar zinciri entegrasyonu açıktır.
