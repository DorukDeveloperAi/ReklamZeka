# P06-D — Defer approval decision persistence

**Karar:** PRE APPLY APPROVE ve uygulanmış migration için POST ACCEPT. Bu alt paket `defer` kararını mevcut insan-kararı zincirine ileri uyumlu ekler; execution veya Meta write yetkisi üretmez.

## Teslim edilen sınır

- `defer`, approval lifecycle, human-presence ceremony, HTTP intent/challenge, yerel karar akışı, read model ve timeline projeksiyonunda ayrı bir karardır; `request_changes` ile eş anlamlı değildir.
- Deferred karar authorization/grant üretmez ve bağlı ActionUnit bağımlılıklarını terminal biçimde durdurur.
- `agent` requester rolü proposal ile sınırlıdır; insan kararı/grant/consume yollarında reddedilir.
- `campaign_create` ve ham Graph/create eylemleri karar servisinde fail-closed reddedilir.
- Eski decision evidence/hash sözleşmeleri yeniden yazılmaz; yalnız forward constraint migration uygulanır.

## Migration / ledger

- `20260818000200_p06_approval_decision_defer.sql`
- SHA-256: `1b43e119274eeca917e5dac394ccebb1b2d3b1e1532da6a39976aef7db2b5671`
- Journal: idx `118`, version `7`, timestamp `1787011320000`
- DB ledger: id `135`, aynı hash ve timestamp ile exact tek satır

## Kanıt

- PRE outer rollback verifier bütün 13 boolean gate'i geçti: direct defer insert/replay, authorization/grant negative, agent/create/raw negative, immutable/read projection parity, journal absence ve zero residue.
- POST verifier bütün 14 gate'i geçti; migration hash/journal/DB ledger tuple exact eşleşti.
- Focused 40/40 test, TypeScript, Drizzle schema check, security boundaries ve diff-check yeşil.

## Açık kalanlar

- Gerçek execution-v2 persistence/worker ve Meta writer ayrı, default-off ileri migration dilimleridir.
- Rename insan-onaylı akışı ve protected pilot browser/live Meta kanıtı P08 kapsamında açık kalır.
