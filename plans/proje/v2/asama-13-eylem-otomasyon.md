---
kosum: tek-ajan
---
# Aşama 13 — Eylem valfi, scheduler ve agentic rutin

## SONUÇ

Onaylı planlar doğru Meta entity/field'e idempotent ve geri izlenebilir uygulanır;
anık veya zamanlanmış rutin aynı güvenli executor'da çalışır. Varsayılan dry-run ve
workspace genelinde `approval_only` otonomi kilididir.

## Eylem durumu

`proposed → awaiting_approval → approved → executing → verified`
ve yan kollar `rejected / expired / suppressed / parked / failed / rollback_proposed /
rolled_back / changes_requested / superseded`. Approval execute değildir; stale
snapshot/plan/creative spec execute edilemez. Bundle durumu child action unit'lardan türetilir.

## Task'lar

### T13.1 — Meta writer allowlist
Campaign/adset/ad pause/activate; resolved campaign/adset budget owner'da daily/lifetime
budget; izinli schedule. Ad-level budget şema hatasıdır. Parent status chain, review/issues,
start/stop ve effective status activate eligibility'ye girer.
Typed method; raw endpoint/field yok. K4 bid/targeting yalnız proposed/approval contract.

### T13.2 — K0–K4 valf
Tenant/role, account allowlist, feature/kill switch, policy enabled, freshness, conflict,
budget caps, cooldown, approval, config mode + secret allowWrite + explicit execute.

### T13.3 — Approval ve separation of duties
Risk/limit bazlı approver; K3/K4 proposer≠approver seçeneği; bulk action ayrı toplam cap;
expiry ve yeniden simülasyon. `ActionBundle` içindeki campaign/adset/creative/ad/budget/status
unit'ları tek tek approve/reject/request-changes alır; bulk onay yalnız açık kullanıcı seçimi.
Dependency DAG eksik/rejected parent'ta downstream execute'u kapatır. Her geçiş previous-value auditlidir.

### T13.4 — Execute, verify ve rollback
Decision ID idempotency; Meta error taxonomy/backoff; read-after-write; partial batch tek tek
status; rollback yeni onaylı action. Silme yok, sonsuz retry yok.

### T13.5 — Scheduler/run ledger
Manual/hourly/daily/weekly/monthly/after_sync; timezone, settle delay, DST/misfire,
logical-fire idempotency, concurrency/quota, retry class ve append-only run steps.

### T13.6 — Agentic rutin
Sync → quality → classify → analyze → budget simulate → advisor explain → approval queue.
Rutin otomatik execute etmez; ayrı approved-action worker valften geçer.

### T13.7 — External intervention ve monitoring
Snapshot diff beklenmeyen manual Meta değişikliği bulursa ilgili otomasyon park/cooldown;
accept-as-baseline, restore-proposal veya keep-manual seçenekleri.

### T13.8 — Sandbox/shadow rollout
Fixture → Meta sandbox → production shadow-read → dry-run proposal → tek hesap/
tek action type approval-only. Her basamakta kill switch ve rollback tatbikatı.

### T13.9 — Hibrit automation mode
Planlama modu manual/assisted/automated-read/scheduled-plan; execution autonomy ayrı
`approval_only/policy_limited` profilidir. Workspace→account-group→account→category→entity
inheritance'ta child yalnız daha güvenliye daraltır. Default ve ilk production rollout
`approval_only`: K1–K4 tek tek onaylanır. Süre sonu otomatik genişletmez. Açıkça yayınlanan
`policy_limited` yalnız explicit cap'li K1/K2; K3/K4 daima approval. Kill switch K0'da.

### T13.10 — Çok hesap action batch
Cross-account plan ortak görünebilir fakat satırlar account permission/currency/cap ve
approval ile ayrı execute edilir. Bir hesap partial failure diğerini rollback etmez; batch
summary ve tek tek recovery vardır.

### T13.11 — Mevcut Instagram/Page gönderisini öne çıkarma
Linked actor/post seçimi; ownership/permission/promotion eligibility, media lifecycle,
yayınlanmış PromotionTemplate + immutable AudiencePresetVersion, objective/optimization,
destination, placement, special-category ve budget-owner preflight. Agent serbest targeting
üretemez/değiştiremez; iki template eşleşirse kullanıcı seçmeden publish-ready olmaz.
Mevcut uygun ad set'e ad ekleme veya yeni campaign/adset/creative/ad zinciri typed K4
`ActionBundle` olur. Post identity/preview, template+audience, bütçe, create/publish ve
activate ayrı unit'tır.

### T13.12 — Creative üretmeme sınırı
Existing-post promotion yalnız seçili post'un frozen identity/content hash'ini ve platform
creative reference'ını kullanır. ReklamZeka yeni primary text/headline, görsel, video,
carousel veya dynamic varyant üretmez/değiştirmez; asset upload/custom creative endpoint'i
writer allowlist'inde yoktur. Post içeriği değiştiyse eski approval stale olur.

### T13.13 — Creative approval invalidation
Approval `postContentHash + actorId + promotionTemplateVersion + audiencePresetVersion +
destination + targetAdSet + budgetPlanVersion`
üzerindedir. Bunlardan biri değişince yalnız etkilenen unit ve downstream approval stale
olur; yeniden preview ve açık onay gerekir. Eski onay yeni kopyaya taşınmaz.

## Kabul ve kanıt

- Tek anahtar, DB flag veya prompt write açamaz; K3 onaysız reddedilir.
- Duplicate execute Meta'ya tek update; verify mismatch failed/parked.
- DST/duplicate fire tek run; second run stable; rate-limit sonraki uygun zamana defer.
- External budget edit otomasyonu park eder ve timeline'da görünür.
- Sandbox read-after-write + rollback; production write ayrı insan onayı olmadan yok.
- Campaign/adset/ad status matrisi ve campaign/adset budget owner write matrisi yeşil.
- Codex/Claude/dashboard/schedule yollarının tamamı aynı valf sonucunu verir.
- `approval_only` aktifken K1 dahil hiçbir write otomatik execute olmaz; süre/alt scope/prompt atlayamaz.
- Existing-post sandbox akışında kullanıcı bundle'ın her satırını ayrı yönetir; rejected
  budget/create/activate bağımlılığı Meta write'ını durdurur.
- Promotion template/audience preset eksik veya belirsizse proposal create-ready değildir;
  yeni metin/creative üretme talebi kapsam dışı reason code ile reddedilir.
