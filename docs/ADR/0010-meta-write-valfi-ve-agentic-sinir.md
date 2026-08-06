# ADR-0010 — Meta write valfi ve agentic sınır

## Durum

Kabul — 2026-08-06; production write ayrı rollout onayına bağlı

## Bağlam

v1 read-only ilkesi pilot güvenliğini sağladı. Yeni kapsam anık pause/activate ve bütçe
yönetimi istiyor. LLM veya tek bir UI/prompt komutunun harcama değiştirmesi kabul edilemez.

## Karar

- Read connector ile write connector ayrı interface, scope, secret ve deploy flag taşır.
- Varsayılan dry-run; write A13'e kadar ReklamZeka runtime'nda bulunmaz.
- Tek typed executor allowlist status ve resolved budget-owner alanlarına yazar; raw Graph
  endpoint/field kullanıcıya veya advisor'a açılmaz.
- K0 read, K1 non-spend, K2 reduce/pause, K3 increase/activate, K4 structural risk modelidir.
- K3/K4 açık approval + config mode + secret allowWrite + explicit execute + cap ister.
- Approval execute değildir. Decision ID idempotency; stale snapshot/plan reddedilir.
- Her write previous/new, actor, policy, approval, request result ve read-after-write verify taşır.
- Rollback yeni valfli eylemdir. Manual/external change ilgili otomasyonu park eder.
- Agent sync→analyze→plan→approval queue yapabilir; action authorization veya writer'a
  erişemez. Rutin otomatik execute etmez.

## Sonuçlar

Agentic deneyim korunurken harcama yolu deterministik kalır. Ayrı worker, approval UX,
sandbox/shadow rollout ve operasyonel kill switch maliyeti kabul edilir.
