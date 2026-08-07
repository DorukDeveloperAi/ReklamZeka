---
kosum: orkestrator
---
# Slice 02 — Decision Room yürütme planı

## Sonuç

ReklamZeka, Meta'ya write açmadan seçili kampanyayı Meta config'i, çoklu iç kategorileri,
kullanıcı guidance'ı, zaman pencereleri ve karar geçmişiyle birlikte analiz eder. Aynı
frozen context aynı deterministik finding'leri üretir; agent yalnız kaynaklı L4/L5 bağlamı
açıklar ve draft öneri üretir. `observe` ve `no-change` birinci sınıf sonuçtur.

Bu slice A09, A10, A12 ve A14'ün yalnız ilk değer üreten kesitidir. Policy enforcement,
bütçe simülasyonu ve Meta write sırasıyla S3 ve S4'e aittir.

## Güncel ilerleme — 2026-08-07

- **S2.1 persistence/domain core hazır:** üç tablo migration'ı Supabase'e uygulandı;
  dimension/definition/assignment, manual lock, child add/override/deny, kesintisiz path,
  frozen replay ve `parked_conflict` resolver'ı testli. Workspace-scoped repository ve
  gerçek iki-workspace CRUD/restart/rollback kabulü geçti; rol/audit mutation API'si açık.
- **S2.2 persistence/domain core hazır:** provenance türleri ayrık, official source governance,
  deterministic scope/precedence/conflict/context budget ve guidance-only authority testli.
  Dört append-only guidance tablosu Supabase'e uygulandı; restart/hash, optimistic conflict,
  tenant izolasyonu ve nullable CHECK bypass kabulleri geçti. Analysis-run pack binding'i açık.
- **S2.3 resolver/contract core hazır:** rolling/fixed/calendar/lifetime/learning/action-
  relative, DST/weekday/previous-year ve forged-window doğrulaması; deterministik analysis
  run/record ID, snapshot/context ref ve sebepli insufficient-data sözleşmesi testli.
  Sürümlü metrik/formül motoru additive/non-additive/ratio-of-sums, attribution, currency,
  replay ve çelişkili revision guard'larıyla hazır; L2 materialization açık.
- **S2.4 frozen context kapısı hazır:** Meta config refs, effective category, guidance pack,
  policy/cadence/data/history ve katalog sürümleri tek authentic hash'te birleşiyor. Append-only
  PostgreSQL persistence, tenant/hierarchy bağları, source-version selective invalidation,
  historical replay ve güvenli public projection testli; raw L0, token, agent narration ve
  action/write authority reddediliyor.
- **S2.5 agenda/finding core hazır:** on deterministik top-down pass, category/topic subset,
  bounded finding-driver drill-down, objective metric allowlist'i, timeframe/context bağları ve
  protected-guidance suppression testli. Trend/anomaly/pacing/threshold/period/pre-post calculator
  ailesi authentic metric result, precision zarfı ve explicit insufficient/settling reason'larıyla
  hazır. L2 materialization ve calculator→agenda application binding'i açık.
- **S2.6 cadence/experiment/ledger persistence hazır:** settle/observation/learning/cooldown,
  evidence ve repeat suppression; tek değişkenli experiment lifecycle ve append-only authentic
  hash-chain ledger testli. Ledger Supabase'e uygulandı; context/analysis tenant bağları,
  temporal guard, restart/idempotency/tamper ve nested-authority reddi rollback E2E'den geçti.
- **S2.7 persistence/application/executor core hazır:** dashboard ve CLI için tek model-agnostic
  read/draft servis, optimistic/atomic ledger suffix adapterı ve güvenli public projection testli.
  Immutable hash/revision schedule, exact account/campaign/schedule run binding, PostgreSQL lease/
  retry/overlap, idempotent in-app inbox/read-state ve timezone/DST/catch-up Supabase'e uygulandı.
  Bounded worker tick; partial-failure isolation, concurrent duplicate suppression ve schedule
  revision yarışı guard'ıyla gerçek tablolarda rollback kabulünden geçti. L2 observation builder
  exact-key/scope/hash doğrulamalı, bounded ve replay-stable deterministic query/read sözleşmesini
  kurdu. Public read service read-state zamanını yalnız server clock'tan alıyor. Gerçek Drizzle
  read repository ve gerçek insight read adapteri Supabase rollback kabulünden geçti. Dashboard
  Decision Room görünümü ile Codex/Claude araç/HTTP kontratı hazır. HMAC capability'li, OS
  kullanıcısına ve exact workspace üyeliğine bağlı loopback-only local session; dashboard cookie,
  CLI bearer ve read/mark-read route assembly'sini aynı servise bağlar. Yerel owner/workspace
  bootstrap'ı dry-run + explicit apply ile oluşturuldu ve private env binding etkinleştirildi.
- **S2.8 persistence/domain core hazır:** AdvisedPractice candidate→review→trial→outcome→
  standardization-review zinciri owner + resmi Meta kaynağı + evidence + deliberation ister.
  Conditional/rejected sonuçlar korunur; standardization review policy artifact, promotion,
  automation veya action authority üretemez. İki append-only tablo tenant-bound repository,
  RLS ve tombstone purge ile Supabase'e uygulandı. Practice Lab UI açık iştir.
- **Birleşik kanıt:** 74 test dosyası/426 test, production build, audit 0; category/guidance,
  frozen-context, decision-ledger, Decision Room persistence ve 45-tablolu tombstone PostgreSQL
  rollback kabulleri temiz. Supabase 49/49 RLS, API table grant'i `0`; otomatik
  tracked/build/cache token eşleşmesi `0`.
  Meta write/network çağrısı `0`.

## Değişmez sınırlar

- Guidance, agent anlatımı veya prompt hard constraint/action yetkisi vermez.
- L0 raw payload, token ve sınırsız tablo dökümü agent context'ine girmez.
- Kategori eşlemesi belirsiz veya single-cardinality çatışmalıysa sessiz seçim yapılmaz.
- Official Meta guidance kaynak/review metadata'sı olmadan official sayılamaz.
- Timeframe ve comparison hesap timezone'unda, sürümlü ve deterministiktir; eksik veri `0` değildir.
- Learning, settle, cooldown ve repeat guard'ı yeni kanıt yoksa öneriyi bastırabilir.
- PostgreSQL + mevcut worker düzeni korunur; vector DB, warehouse veya model API eklenmez.
- Dashboard ve yerel Codex/Claude aynı frozen context/finding/proposal servislerini kullanır.

## Increment sırası

### S2.1 — Kategori registry ve effective inheritance

Dimension/category/assignment şeması; single/multi cardinality, allowed entity level,
manual lock, evidence/confidence, version/archive ve campaign→adset→ad/creative child
add/override/deny resolver'ı. Frozen run, effective assignment ve definition sürümlerini taşır.

**Çıkış kapısı:** Aynı entity çoklu boyut taşır; single conflict `PARKED_CONFLICT` olur;
manual lock isim değişiminden etkilenmez; child override eski frozen sonucu değiştirmez;
tenant sınırı ve RLS kanıtlıdır.

### S2.2 — Guidance registry ve EffectiveGuidancePack

Owner statement, official Meta guidance, strategy, observation, experiment outcome ve
operating note ayrı provenance nesneleridir. Deterministik scope filter global→account→
objective→category→entity→topic sırasını, freshness/review durumunu ve bounded context
bütçesini uygular; applied/suppressed/conflicting/missing reason üretir.

**Çıkış kapısı:** Aynı input aynı pack/hash'i verir; owner exception ile official kaynak
birbirine eritilmez; stale/kaynaksız official kart fail-closed olur; pack action yetkisi taşımaz.

### S2.3 — Timeframe resolver ve metrik temeli

Rolling/fixed/calendar/lifetime/learning/action-relative pencere, inclusive dates, IANA
timezone, previous-period ve weekday-matched comparison; additive/non-additive/ratio
metadata ve missing/settle reason sözleşmesi.

**Çıkış kapısı:** DST ve ay sınırı golden matrisi geçer; aynı pencere byte-eş resolve olur;
reach/frequency toplanmaz, ratio numerator/denominator olmadan üretilmez.

### S2.4 — Frozen EffectiveCampaignContext

Meta identity/config/budget owner, effective categories, guidance pack, policy refs,
cadence, data-quality/L2-L3 refs ve change/decision history tek canonical context/hash'te
birleşir. Agent narration hash'e dahil değildir; invalidation kaynak sürümüne bağlıdır.

**Çıkış kapısı:** Aynı source/version seti aynı hash'i verir; category/guidance değişimi
yalnız ilgili context'i invalid eder; L0/secret/ad-copy dump'ı context dışındadır.

### S2.5 — Deterministik analysis agenda ve finding motoru

Genel veri sağlığı→account/objective→category→campaign→adset/ad/creative→budget/pacing→
history→decision sıralı pass; kullanıcı subset'i; top-down ana tur ve finding'e bağlı
bounded bottom-up driver. Finding ID, evidence, blocker, suppression ve unresolved reason taşır.

**Çıkış kapısı:** Aynı frozen context aynı sıralı finding setini verir; protected guidance
bulguyu gizlemez fakat action eligibility'yi bastırır; en az bir driver path veya sebepli
`driver_unresolved` vardır.

### S2.6 — Cadence, experiment ve decision ledger

Settle/min observation/learning/cooldown/repeat/evidence threshold; act/test/observe/
no-change; hypothesis, tek ana değişken, baseline, guardrail, min sample/window,
contamination ve inconclusive outcome. Append-only analysis/decision kayıtları frozen
context ve timeline referansına bağlanır.

**Çıkış kapısı:** Yeni kanıt yoksa tekrar öneri bastırılır; learning/cooldown acil guardrail
dışında `observe/no-change` verir; geçmiş karar yeni guidance edit'iyle değişmez.

### S2.7 — Advisor boundary, dashboard ve scheduled inbox

Tek read/draft application service; dashboard Analysis Room ve yerel MCP/CLI aynı servisi
kullanır. Agent L5 ile başlar ve yalnız allowlist bounded drill-down çağırır. Scheduled ve
instant analysis aynı executor/idempotency anahtarını kullanır; ilk teslim yalnız in-app inbox'tır.

**Çıkış kapısı:** Raw/write tool expose edilmez; prompt injection finding/policy/scope
uyduramaz; dashboard ve CLI aynı context/finding ref'lerini gösterir; duplicate schedule
tek run üretir. Meta write network call sayısı `0`dır.

### S2.8 — AdvisedPractice düşük riskli yaşam döngüsü

Agentic müzakereden candidate/reviewed/trial/outcome kaydı; standardization review practice'i
feature/agenda/playbook/cadence/guidance/policy/human-judgment parçalarına ayırır. Bu slice
yalnız candidate/trial izler; enforceable promotion veya automation yapmaz.

**Çıkış kapısı:** Outcome görmeyen practice standardized olamaz; rejected/conditional
korunur; sohbet sessizce kural veya otomasyon üretmez.

## Kanıt disiplini

Her increment önce pure contract/negative test, sonra en küçük persistence/application
binding'i, ardından PostgreSQL rollback kabulü ve public redaction testiyle kapanır. Yeni
tablolar RLS + API grant `0` olmadan uygulanmaz. `STATE.md` ve `CHECKLIST.md` yalnız geçen
kanıtlarla güncellenir; production write kapsamı S4'e kadar açılmaz.

## Traceability

- A09: T09.1–T09.10, T09.12–T09.15'in Decision Room için gereken alt kümesi.
- A10: T10.1–T10.13; business outcome signal bu slice'ı bloke etmez.
- A12: read/draft prompt boundary ve local-session contract'ın ilk kesiti.
- A14: Analysis Room ve in-app scheduled inbox'ın ilk gerçek backend kesiti.
- Sonraki dilim: S3 Budget Lab; S2 çıkış kapısı tamamlanmadan bütçe proposal motoru açılmaz.
