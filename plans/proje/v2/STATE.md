# ReklamZeka Meta Reklam İşletim Sistemi — STATE (v2)

> Kümülatif ilerleme defteri. v1'in ayrıntılı tur geçmişi
> [v1 STATE](../v1/STATE.md)'te değişmeden korunur.

## Aşama durumları

| # | aşama | durum | bağımlı | kanıt / açık iş |
|---|---|---|---|---|
| 01 | ürün temeli | KAPALI | — | `check:foundation` |
| 02 | teknik temel | KAPALI | 01 | `check:quick`, build, security |
| 03 | veri platformu | KAPALI | 02 | `check:data` |
| 04 | kiracı güvenliği | KAPALI | 02 | `check:security-boundaries` |
| 05 | performans deneyimi | KAPALI | 03,04 | `check:experience` + browser QA |
| 06 | içgörü motoru | KAPALI | 03,04 | `check:insights` |
| 07 | rapor ve saha pilotu | DEVAM | 05,06 | fixture hazır; gerçek 3 workspace/10 hesap kanıtı son kapanışta alınacak; A08'i engellemez |
| 08 | Meta dijital ikizi | DEVAM | 03,04 | S1.1–S1.5 ve Slice 01 kapalı; geniş field/breakdown kataloğu, multi-business grouping ve export/rotation ileri işi açık |
| 09 | kategori ve talimat | AÇIK | 08 | requirement/precedence tasarımı tamam; uygulama sırada |
| 10 | zamansal analiz | DEVAM | 06,08,09 | objective schema/playbook temeli var; tam motor sırada |
| 11 | bütçe planlama | AÇIK | 09,10 | planlandı |
| 12 | prompt/advisor | DEVAM | 09–11 | narrative envelope/claim guard temeli var; translator/ledger sırada |
| 13 | eylem valfi ve rutin | AÇIK | 04,10–12 | planlandı; write kapalı |
| 14 | kontrol merkezi | AÇIK | 07,09–13 | planlandı |

## 2026-08-06 — bütün görüşmelerin kanonik ürün distilasyonu

- Konuşmalardaki ürün niyeti, sınırlar, iç kategori/talimat modeli, analiz ve prompt
  assembly, bütçe, otonomi, creative/post, dashboard/CLI ve standardizasyon kararları tek
  davranış doktrininde birleştirildi.
- “Vizyon / davranış / teslim / açık iş” otoritesi ayrıldı: KUZEY nihai istek, product
  distillation çalışma modeli, MASTER teslim sırası, REQUIREMENTS kabul hükümleri,
  CHECKLIST açık işler ve STATE gerçekleşen durumdur.
- A08–A14 domain stage'leri korunurken S1 içi beş küçük increment ve her S1–S6 diliminin
  amaç/çıkış kapısı açıklandı. Güncel uygulama odağı değişmedi: S1 Meta Read Mirror.
- Kaynak: `docs/product/reklamzeka-product-distillation.md`.

## 2026-08-06 — ana plan konsolidasyonu ve Meta keşfi

- Düzeltme: analiz kapsamı paralel mini-v2 olmaktan çıkarıldı; v1'in A01–A07
  zincirini miras alan tek kümülatif v2 ana plana dönüştürüldü.
- Kullanıcı ihtiyacı: Meta hiyerarşisi, çoklu internal kategori, isim/özellik mapping,
  editable talimat registry, objective/category-aware zaman analizi, protected budget,
  prompt/advisor, instant+scheduled routines, controlled action ve tek dashboard.
- Yan proje `/Users/ybg/dev/meta-adsmanager-ai` incelendi: real read client, hierarchy,
  creative raw spec, 3-level insights, rule/flow, valve/audit desenleri yeniden kullanılabilir.
- Token değeri gösterilmeden `doctor` smoke: geçerli; Graph v23 `/me` ve config hesabı
  erişilebilir; dry-run ve writer kapalı. 7 Ağustos'ta token yalnız git-dışı, `0600`
  izinli `.env.local` secret kaynağına alındı; geçici/riskli credential olarak işaretli.
- Canlı geniş sorgu Meta `reduce amount of data`, sonra request-limit verdi. Karar:
  inventory/creative/insights ayrı stream; level/date slice; usage headroom/adaptive page.
- Mevcut gerçek cache anonim kapsamı: 419 campaign, 1.096 ad set, 4.560 ad,
  4.153 creative, 8.385 daily snapshot; legacy ve outcome objective'ler birlikte.
- Mevcut cache'te audit 0; bu nedenle gelecekteki her internal/external hamle için tek
  append-only timeline ve snapshot-diff zorunlu.
- Kaynaklar: [keşif raporu](../../../docs/discovery/2026-08-06-meta-operating-system.md),
  ADR-0008/0009/0010, `npm run check:analysis-platform`.

## 2026-08-06 — çok hesap ve model-agnostic hibrit işletim

- Workspace→business connection→account group→ad account ile Facebook Page/Instagram/
  pixel-dataset/app/WhatsApp destination asset graph'ı A08'e eklendi. Hesap currency,
  timezone, permission, capability, cap, rate-limit ve action sonucu ayrı kalır.
- Status eylemleri campaign/adset/ad; budget eylemleri yalnız gerçek budget owner campaign/
  adset seviyesidir. Ad-level budget strict şema hatası; activate parent/effective status,
  review/issues ve schedule eligibility ister.
- İlk tasarımda `AgentProvider` ile OpenAI/Anthropic adapter düşünülmüştü; sonraki kullanıcı
  kararıyla bu kapsam kaldırıldı. Güncel A12 local Codex/Claude Code/diğer CLI + MCP modelidir.
- Codex/Claude MCP read ve draft/proposal tools kullanabilir; raw Meta writer/execute tool
  alamaz. Approval ve execute application role + A13 valfi + ayrı worker'da kalır.
- Planlama için manual/assisted/automated-read/scheduled-plan; execution için approval-only/
  policy-limited ayrımı tanımlandı. Yalnız açık cap'li K1/K2 policy-limited olabilir;
  K3 artış/activate ve K4 yapısal insan onaylı.
- Kaynaklar: [model-agnostic mimari](../../../docs/architecture/model-agnostic-agent-interface.md),
  ADR-0011 ve resmi Codex/Anthropic MCP dokümanları.

## 2026-08-06 — kategori-aware analiz temeli

- `src/analyses/schema.ts`: objective/funnel/optimization/classification, timeframe/schedule,
  safe rule DSL ve narrative configuration.
- `src/analyses/objective-playbooks.ts`: altı objective için KPI/diagnostic/guardrail/
  min-sample/evaluation/decision guide; cross-objective guard.
- `src/analyses/prompt-envelope.ts`: user guidance untrusted data; finding-bound output.
- Kanıt: 62 test, typecheck, DB check, production build, audit 0 zafiyet; plan gate temizdi.

## 2026-08-06 — creative/post ve atomik otonomi valfi plan revizyonu

- A08 live ad copy/spec modeline primary text/headline/description/caption, CTA,
  destination, actor, post/media identity ve dynamic varyant provenance eklendi.
- Bağlı Instagram/Page gönderisini mevcut veya yeni uygun ad-set yapısında öne çıkarma,
  ownership/capability/preflight ile K4 typed action bundle olarak A13'e alındı.
- Düzeltme: yeni reklam/kreatif üretimi yapılmayacak. Yalnız yayındaki metin okunur ve
  mevcut post frozen identity/content ile şablonlu promotion'a referans olur.
- PromotionTemplate + immutable AudiencePreset internal category/account/actor/post
  selector'ıyla resolve edilir; agent hedef kitle veya creative üretemez.
- Planlama modu execution autonomy'den ayrıldı. Varsayılan/ilk rollout `approval_only`;
  K1–K4 her write action unit tek tek onaylanır, expiry veya child scope yetkiyi genişletmez.
- Bundle gruplama/dependency yüzeyidir; authorization ve audit atomik action unit'tadır.
  Kaynaklar: ADR-0012 ve `docs/architecture/creative-and-approval-operations.md`.

## 2026-08-06 — dashboard ile ortak yerel AI CLI session modeli

- Provider API adapter kapsamdan çıkarıldı. ReklamZeka OpenAI/Anthropic model API key'i
  saklamaz/çağırmaz; Meta Graph connector ayrı kalır.
- Codex CLI/VS Code, Claude Code ve ek MCP-capable CLI kendi login/session'ıyla localhost
  Streamable HTTP veya project STDIO ReklamZeka MCP'ye bağlanır.
- Dashboard local session hub; config/health, selected entity/timeframe handoff, tool/citation,
  proposal ve action queue correlation gösterir. Açık session aynı backend state'ini kullanır.
- Session içi insan onayı model tool'u değildir; local companion TTY/passkey ile tek
  ActionUnit/spec'e bağlı HumanPresenceGrant üretir. Kaynaklar: ADR-0011 ve
  `docs/architecture/local-cli-agent-bridge.md`.

## 2026-08-06 — agentic guidance ve kademeli katılaştırma

- Talimat modeli iki lane oldu: doğal dil owner strategy/Meta best-practice/observation/
  experiment önce scoped GuidanceCard/Set; yalnız enforceable clause typed G3 policy.
- G0 raw→G1 scoped→G2 reviewed→G3 deterministic→G4 automation maturity tanımlandı;
  G2→G3 semantic diff, historical replay, conflict/impact preview ve kullanıcı onayı ister.
- Retrieval global→account group/account→objective/funnel→internal category→entity→topic→
  history deterministic scope filter ve bounded relevance ranking ile EffectiveGuidancePack üretir.
- Versioned AnalysisAgenda top-down pass ve finding-bazlı bounded drill-down; kullanıcı
  kategori/grup/başlık subset'i seçebilir.
- DecisionCadenceProfile ve ExperimentRecord settle/observation/learning/cooldown/repeat
  guard'ları, act/test/observe/no-change ve inconclusive sonucu ile hiperaktiviteyi bastırır.
- Başlangıç storage Postgres metadata/JSON/full-text; vector DB erken kapsam değildir.
  Kaynaklar: ADR-0013 ve `docs/architecture/guidance-deliberation-and-progressive-formalization.md`.

## 2026-08-06 — uçtan uca gap review ve verimli dikey teslim

- Ham Meta verisinden agent bağlamına L0 raw→L1 canonical→L2 feature→L3 window→L4
  evidence→L5 compact context pipeline'ı ve frozen `EffectiveCampaignContext` eklendi.
- Agent L4/L5 ile başlar; L1–L3 bounded typed drill-down'dır, L0 raw erişimi yoktur.
- Agentic sohbet çıktısı `AdvisedPractice` yaşam döngüsüne alınır; sessiz öğrenme yoktur.
  `StandardizationReview` yalnız uygun parçayı feature/agenda/playbook/guidance/policy veya
  human judgment olarak ayırır.
- Optional manual/CSV `BusinessOutcomeSignal`, Meta async review/delivery state'i, raw
  retention/disconnect ve in-app scheduled-analysis inbox boşlukları kapatıldı.
- Teslim sırası S1 Meta Read Mirror→S2 Decision Room→S3 Budget Lab→S4 approval-only
  operations→S5 existing-post promotion→S6 selective standardization olarak sabitlendi.
- İlk mimari modular monolith+PostgreSQL+DB worker; vector DB, warehouse, event bus,
  microservice, canlı CRM ve external notification ölçüm/ayrı karar olmadan eklenmez.
  Kaynaklar: ADR-0014, `docs/architecture/analysis-processing-pipeline.md` ve
  `docs/discovery/2026-08-06-end-to-end-gap-review.md`.

## 2026-08-07 — Operating Dashboard ve Orchestrator demo çerçevesi

- Eski salt-okunur demo raporu, günlük işletim odaklı Today/portfolio/analysis/budget/
  rules/Orchestrator/approval/timeline navigasyonuna sahip etkileşimli demo kabuğuna çevrildi.
- Demo mevcut kanonik dashboard snapshot'ından temel metrikleri kullanır; kampanya context,
  rule edit, budget scenario, autonomy matrix, agent chat ve approval state ürün davranışı
  prototipidir, production Meta write veya tamamlanmış backend capability kanıtı değildir.
- Kalıcı `ReklamZeka OrchestratorProfile` ile Codex/Claude runtime session ayrımı; altı
  vendor-agnostic skill ve action/category/campaign scoped effective autonomy planlara eklendi.
- `/dashboard` ve `/reports/demo` aynı Operating Dashboard deneyimini gösterir; imzalı
  paylaşılan raporlar ayrı salt-okunur `ReportView` sözleşmesini korur.

## 2026-08-07 — S1.1 bağlantı sınırı ve S1.2 Meta dijital ikiz çekirdeği

- Workspace-scoped, read-only `MetaConnectionService`; public redaction, capability doctor,
  disconnect/revoke/invalid lifecycle, environment/in-memory secret reference ve append-only
  audit sözleşmeleri eklendi. Graph istemcisi yalnız GET kullanır; management grant'leri
  etkin veya doğrulanmış write yetkisi sayılmaz.
- Secret-free `meta_connections` ve account→campaign→ad set→ad→creative/post şeması;
  Page/Instagram/pixel/dataset/app/WhatsApp asset graph'ı, provenance, configured/effective
  status, first/last seen ve soft disappearance alanları non-destructive migration ile eklendi.
- Deterministik CBO/ABO budget-owner resolver ad-level budget'ı reddeder; eksik veya çelişkili
  durumlarda sebepli `unknown` döndürür. Replay, hierarchy, orphan, cross-account ve provenance
  negatifleri golden fixture ile kanıtlandı.
- Birleşik kanıt: 20 test dosyası/90 test, typecheck, Drizzle check, security-boundary ve
  production build temiz. Canlı read-only smoke: 5 reklam hesabı, 22 Page, 8 bağlı Instagram,
  422 campaign, 1.108 ad set, 4.620 ad; 0 kısmi hata ve `writeOperations=0`.
- Secret taraması: git geçmişi, çalışma ağacı ve production bundle eşleşmesi `0`; `.env.local`
  modu `0600`. Token 23 Eylül 2026 12:15 TSİ'ye kadar geçerli görünür.
- Bilinçli açık iş: kalıcı Postgres connection/secret adapter'ı, explicit revoked timestamp
  persistence ve rotating secret devri S1.5 lifecycle kapanışına kadar tamamlanacak.

## 2026-08-07 — S1.3 parçalı sync runtime ve persistence çekirdeği

- Inventory, creative/post ve insights için bağımsız parent/stream/account/slice/cursor
  korelasyonlu read-sync runtime; deterministik date planner, adaptive page size, bounded
  retry+jitter, hata sınıflandırması, partial success ve cursor'dan resume eklendi.
- Meta'ya özel portfolio run, stream, run, slice/checkpoint, daily insight ve extensible metric
  tabloları non-destructive migration ile eklendi. Additive/non-additive/derived ayrımı,
  attribution/currency/timezone provenance ve sebepli unavailable alanları sözleşmeye alındı.
- Runtime ile persistence arasına all-or-nothing transaction adapter ve somut Drizzle/PostgreSQL
  repository bağlandı. Her sayfa/slice ilerlemesi durable olur; yeni runtime aynı cursor'dan
  hydrate/resume eder. `creative_post` runtime adı DB'deki `creative` enum'una açık mapping ile
  çevrilir. Hash-only replay ledger raw payload kopyalamadan restart idempotency'sini korur.
- Entegrasyon testi, ilk sayfası kaydedilmiş bir run'ın yanlışlıkla `failed` sayıldığını yakaladı;
  parent status artık cursor ilerlemesini `partial` olarak korur.
- Birleşik kanıt: 23 test dosyası/108 test, typecheck, Drizzle check, security-boundary ve
  production build temiz. Canlı Meta smoke yeniden 5 hesap/22 Page/8 Instagram/422 campaign/
  1.108 ad set/4.620 ad, 0 hata ve `writeOperations=0` verdi; git/bundle secret eşleşmesi 0.
- GET-only Graph transport inventory hierarchy, creative/post ve daily insight edge'lerine
  bağlandı; usage header headroom ve cursor pagination runtime'a aktarılıyor. Canlı sınırlı
  transport smoke 5 hesap keşfetti, account+creative+insight sorgularını 0 write ile tamamladı.
- Supabase PostgreSQL 17 bağlantısı runtime transaction pooler ve migration session pooler ile
  SSL üzerinden doğrulandı. Sekiz migration 29 public tabloya uygulandı. Gerçek DB kabulü yeni
  pool/runtime ile `partial`→`page-2` cursor restore→`completed` akışını, 1 run/1 slice/2 ledger
  kaydını ve geçici workspace'in cascade temizliğini kanıtladı. S1.3 kapandı.

## Sıradaki uygulama

**Slice 4 / Approval-only Operations:** typed action plan, K0–K4 risk sınıfı, varsayılan
`approval_only` autonomy valve, tek tek approve/reject/request-changes ve stale/expiry
korumalarını kur. Production Meta writer yalnız ayrı sandbox/read-after-write kapısından sonra açılır.

## 2026-08-07 — S1.4 asset/content mirror kapanışı

- Asset graph, creative/post extraction, linked Page/Instagram inventory, promotion
  eligibility ve güvenli preview ref sözleşmeleri ortak read-only servise bağlandı.
- Canlı geçici PostgreSQL kabulü iki gerçek hesapla 79 asset/79 edge, 1.179 post/media,
  6 reklam metni/post bağı, 4 creative, 6 binding ve 3 durable checkpoint üretti.
- İkinci hesap transient hatası ve bounded page-limit partial sonucu diğer hesabın kalıcı
  verisini geri almadı; Meta write çağrısı `0`, cleanup sonrası geçici workspace `0` kaldı.
- Actor kanıtı olmayan post kayıtları tahmin edilmedi; `wrong_actor` ile fail-closed edildi.
- Trust/readiness saf motoru ve Drizzle adapter'ı iki hesap üzerinde gerçek SQL okudu; public
  çıktı teknik ID/metin/token taşımadı ve eksik insights nedeniyle doğru biçimde `not_ready`
  kaldı. Tam trust/lifecycle çıkış kapısı S1.5'tedir.

## 2026-08-07 — S1.5 trust, lifecycle ve değişim timeline kapanışı

- Meta connection/secret metadata'sı PostgreSQL'de restart-durable hale getirildi; secret
  değeri DB'ye yazılmıyor, environment allowlist dışı binding reddediliyor. Disconnect,
  revoke/destroy ve invalid lifecycle fail-closed ve workspace-scoped çalışıyor.
- Varsayılan raw retention `hash_only/0 gün`; workspace silme hard-delete yerine audit'i
  koruyan tombstone akışıdır. Explicit 28-tablo purge allowlist'i, revision/TTL/application
  approval ve foreign-workspace izolasyonu gerçek PostgreSQL rollback kabulünde geçti.
- Config/status/budget/targeting/creative-binding canonical snapshot'ı server-private ve
  restart-durable saklanıyor. Unknown gözlem change uydurmuyor; yalnız exact `verified`
  action-ledger korelasyonu `internal_expected`, diğer değişiklik `external_change` oluyor.
- Timeline replay idempotent; en yeni authentic snapshot restart sonrası geri yükleniyor;
  composite scope FK hesaplar arası snapshot bağını engelliyor ve public sonuçlar maskeli.
- Kanıt: 39 test dosyası/202 test, production build, audit 0 zafiyet; timeline ve tombstone
  PostgreSQL kabulleri geçici veri bırakmadan geçti. Supabase 32/32 RLS, API role table
  grant'i 0 ve public routine execute grant'i 0. Meta write yolu halen kapalıdır.

## 2026-08-07 — S2 Decision Room ilk çekirdekleri

- S2 için sekiz incrementli yürütme planı açıldı; kategori/guidance/timeframe ilk üç
  bağımsız çekirdek olarak, write ve bütçe kapsamı açılmadan geliştirildi.
- Category dimension/definition/assignment PostgreSQL şeması; manual lock, evidence,
  confidence, version/archive ve campaign→adset→ad→creative add/override/deny resolver'ı
  eklendi. Single belirsizlik ve kilit ihlali `parked_conflict`; frozen replay deterministik.
- Guidance registry owner/official/strategy/observation/experiment provenance'ını ayırır;
  official Meta kaynağı metadata olmadan yayınlanamaz. Scope/precedence/conflict/freshness
  ve context budget tekrarlanabilir; pack policy/action/approval yetkisi taşımaz.
- Timeframe resolver rolling/fixed/calendar/lifetime/learning/action-relative pencereleri,
  IANA timezone/DST ve comparison'ları çözer. Forged/future/uyumsuz pencere analysis ID'sine
  girmeden reddedilir; insufficient data sebepsiz finding olmaz.
- Kanıt: 44 test dosyası/246 test, production build ve audit 0. Supabase 35/35 RLS,
  API role table grant'i 0; tombstone allowlist 31 workspace-owned tabloyu FK-safe kapsar.

## 2026-08-07 — S2 kategori/guidance/metrik/context kalıcılık kapısı

- Category registry workspace-scoped repository/application core ile gerçek PostgreSQL
  CRUD, restart, optimistic concurrency, manual-lock denial, frozen archive replay,
  cross-workspace/cross-account rejection ve tam rollback kabulünden geçti.
- Guidance registry dört append-only tabloda kalıcıdır. Owner ve official kaynaklar ayrı
  kalır; restart hash'i, freshness suppression, optimistic conflict ve tenant izolasyonu
  kanıtlandı. `guidance_only` authority, official URL/review evidence ve scope value
  gereksinimleri DB seviyesinde fail-closed; NULL ile CHECK bypass edilemiyor.
- Sürümlü Meta metrik motoru AnalysisMetric sözlüğünü tamamen kapsar; additive değerleri
  exact decimal ile toplar, ratio-of-sums üretir, reach/frequency'yi toplamaz. Attribution,
  currency ve aynı insight identity'deki çelişkili revision fail-closed olur.
- Frozen EffectiveCampaignContext Meta config ref'leri, category, guidance, policy, cadence,
  data/history ve katalog sürümlerini authentic hash'te birleştirir; L0 raw, token, agent
  narration ve action/write authority taşımaz.
- Guidance migration'ı Supabase'e uygulandı. Category, guidance ve 35-tablolu workspace
  tombstone PostgreSQL kabulleri geçici satır bırakmadan geçti. Supabase 39/39 RLS ve API
  table grant `0`; 47 test dosyası/263 test, production build ve audit 0. Tracked/build/cache
  token eşleşmesi `0`; Meta write çağrısı `0`.

## 2026-08-07 — S2 frozen context ve analitik karar çekirdekleri

- EffectiveCampaignContext append-only PostgreSQL repository'sine bağlandı. Composite tenant
  foreign key'leri connection→account→campaign→entity zincirini doğruluyor; snapshot zamanı ve
  source component sürümleri context capture'ıyla bağlı. Aynı identity/farklı hash çatışması,
  cross-tenant ve bozuk hierarchy fail-closed.
- `workspace_component` ve `exact_entity_component` invalidation modları açık semantik taşıyor;
  latest-valid seçim invalidated context'i atlıyor, historical replay immutable kalıyor. Güvenli
  public projection workspace ve dahili ref'leri maskeliyor, authentic hash doğrulanmadan çıktı vermiyor.
- AnalysisAgenda on deterministik top-down pass üretir; seçili category dimension/definition ve
  applied-guidance topic'leri agenda hash'ine girer. Finding motoru context/timeframe/metric allowlist
  sınırlarını korur ve yalnız finding'e bağlı max 2 derinlik/max 3 driver bottom-up inceleme açar.
- DecisionCadenceProfile yeni kanıt, settle/observation/learning/cooldown ve tekrar bastırma kapılarını
  uygular. ExperimentRecord tek ana değişken, baseline, guardrail, örneklem/pencere ve contamination
  taşır. Append-only decision ledger canonical hash-chain ile tamper ve yetki enjeksiyonunu reddeder;
  henüz PostgreSQL'e bağlanmış değildir ve hiçbir action authority üretmez.
- Context migration'ı Supabase'e uygulandı. Gerçek production tablolarında outer-rollback E2E;
  idempotent replay, identity conflict, cross-tenant/hierarchy/snapshot guard, invalidation/replay,
  payload/NULL/nested-authority reddi ve rollback-clean kontrollerinden geçti. Workspace tombstone
  kabulü de 38 workspace tablosunda temiz geçti.
- Kanıt: 53 test dosyası/296 test, `db:check`, production build ve audit `0`. Supabase 42/42
  RLS, API table grant `0`, API schema create `0`, public routine execute `0`; tracked/build/cache
  token eşleşmesi `0`; Meta write/network çağrısı `0`.

## 2026-08-07 — S2 Decision Room persistence ve scheduler kapısı

- Analysis/decision ledger Supabase'e uygulandı. Append-only workspace chain context ve analysis
  satırlarına composite tenant FK ile bağlıdır; workspace kilidi sequence yarışını önler. Analysis
  context capture'dan, decision bağlı analysis'ten önce tarihlenemez. Restart ve idempotent replay
  aynı authentic zinciri geri verir.
- SQL ve repository katmanları payload-column eşleşmesi, token/prompt/raw, NULL authority bypass,
  nested `actionAuthority` ve tamper girişlerini fail-closed reddeder. Applied production tablo
  rollback E2E bütün conflict/isolation/temporal/security bayraklarında geçti ve kalıcı fixture bırakmadı.
- Tek `runDecisionRoom` servisi EffectiveCampaignContext→agenda→finding→cadence→optional experiment→
  ledger staging akışını modelsiz orkestre eder. Public sonuç yalnız `draft/advisory/observe/no_change`
  ve opaque ref'ler taşır; tam ledger yalnız injected persistence portunda kalır. `occurredAt` ile
  cadence instant'ı bağlıdır ve replay yeniden stage etmez.
- Manual ve scheduled analiz aynı executor sözleşmesini kullanır. Deterministik idempotency,
  duplicate/in-flight/campaign-overlap suppression, retry/expired lease ve idempotent inbox recovery
  testlidir. Daily/weekly timezone, DST gap/overlap, `skip/run_once` catch-up ve gerçek slot validation
  vardır; tek çıktı kanalı `in_app_inbox`, action authority daima `none`dır.
- Build sırasında Meta tokenı bilinçli olarak boş environment ile tutuluyor; tracked dosyalar,
  production bundle ve Turbopack cache exact-secret taraması otomatik build kapısıdır. Önceki üç
  yerel cache kopyası geri alınabilir biçimde Çöp Sepeti'ne taşındı; runtime `.env.local` değişmedi.
- Kanıt: 57 test dosyası/314 test, typecheck, `db:check`, production build, audit `0`.
  Supabase 43/43 RLS, API table grant `0`, API schema create `0`, public routine execute `0`;
  tracked/build/cache token eşleşmesi `0`; Meta write/network çağrısı `0`.

## 2026-08-07 — S2 gerçek finding ve kalıcı scheduled inbox kapısı

- İlk gerçek deterministic finding ailesi trend, anomaly, pacing, threshold, period comparison
  ve pre/post hesaplarını kapsar. Yalnız authentic metric-engine sonuçlarını ve resolved timeframe'i
  kabul eder; ratio/non-additive değerleri yeniden toplamaz. Minimum sample/point, settling,
  data-quality, missing metric, zero baseline ve precision overflow açık reason üretir.
- Decision Room ledger staging artık gerçek Drizzle repository'ye bağlıdır. Workspace row lock,
  optimistic head ve immutable prefix kontrolüyle bir koşumun en fazla analysis→optional decision
  suffix'ini tek transactionda yazar; stale head, prefix rewrite, cross-workspace ve partial failure
  tam rollback olur. Public sonuç ledger, workspace ref veya internal UUID taşımaz.
- Schedule tanımları canonical hash ve monoton revision ile immutable'dır. Yeni revision eskisini
  supersede eder ve due kuyruğundan çıkarır; eski run exact revisionı görmeye devam eder. Scheduled
  request definition hash'i idempotency anahtarına taşır, dolayısıyla edit/claim yarışı yanlış
  revisiona bağlanamaz.
- Manual ve scheduled run'lar gerçek account/campaign zincirine; scheduled run ayrıca exact
  schedule revision/hash kombinasyonuna composite FK ile bağlıdır. PostgreSQL advisory lock,
  lease token, retry ve scope overlap yarışlarını korur. Inbox yalnız `in_app_inbox` kabul eder;
  notification ve per-reader read-state idempotent ve workspace-scoped'dur.
- Migration Supabase'e uygulandı. Uygulanmış production tablolarında outer-rollback E2E 22/22
  kabul bayrağında geçti; historical revision, immutable definition, hash/cross-asset/cross-combination,
  lease/retry/duplicate, inbox/read-state, forbidden reader/channel ve kalıcı-fixture kontrolleri temiz.
- Kanıt: 60 test dosyası/336 test, typecheck, `db:check`, production build, audit `0`.
  Supabase 47/47 RLS, API table grant `0`, API schema create `0`, public routine execute `0`;
  43-tablolu tombstone rollback temiz; tracked/build/cache token eşleşmesi `0`; Meta network ve
  dış bildirim çağrısı `0`.

## 2026-08-07 — S2 worker ve deterministik observation sınırı

- Daily/weekly due schedule worker'ı bounded batch, partial-failure isolation ve deterministic
  catch-up ile schedule registry/executor zincirine bağlandı. Yalnız completed veya daha önce
  completed duplicate run schedule cursor'ını ilerletir; diğer sonuçlar güvenli biçimde yeniden
  denenebilir kalır.
- Cursor güncellemesi exact current `revision + definitionHash` koşuluna bağlandı. Execution
  sırasında yeni revision yayınlanırsa eski worker tick'i `tick_conflict` olur ve yeni revision'ın
  `nextRunAt` değeri değişmez. Eşzamanlı worker aynı slot için tek kalıcı run üretir.
- Deterministik L2 observation builder primary/comparison/series/pre/post query planlarını
  sürümlü hash ile üretir. Query/read/row/metric şekilleri exact-key ve bounded'dır; canonical
  content hash, tenant/entity/attribution/currency/timezone scope'u ve snapshot kanıtı yeniden
  doğrulanır. Raw payload, token, prompt ve authority taşıyan girişler reddedilir.
- Public Decision Room read service schedule/run/inbox projection ve keyset cursor sözleşmesini
  kurdu. Inbox read zamanı istemciden alınmaz; server clock ile üretilir ve tekrar çağrıda ilk
  timestamp korunur. Bu aşama henüz public HTTP endpoint veya güvenilir workspace principal açmaz.
- Uygulanmış production tablolarındaki outer-rollback kabulü worker partial isolation, catch-up,
  concurrency ve revision-race bayraklarıyla geçti; kalıcı fixture, Meta network çağrısı ve dış
  bildirim `0`. Kanıt: 63 test dosyası/355 test, typecheck, `db:check`, production build, audit `0`;
  tracked/build/cache token eşleşmesi `0`.

## 2026-08-07 — S2 gerçek read-side ve dashboard/agent kontratı

- Decision Room run satırları trigger/account/campaign/timeframe/template trace'lerini claim
  anında saklıyor; aynı idempotency key farklı metadata ile retry edilirse fail-closed oluyor.
  Nullable kolonlar legacy satırları migration sırasında bozmuyor, fakat trace'siz legacy run
  public read modeline giremiyor.
- Gerçek Drizzle read repository current schedule, run ve inbox için workspace-bound keyset
  pagination sağlıyor. Public account/campaign referansları yalnız workspace + internal random
  UUID'den türetilmiş sabit alias; full Meta referansı ve internal UUID dışarı çıkmıyor. Read-state
  transaction/advisory lock ile yarış güvenli ve ilk server timestamp'ini koruyor.
- Canonical Meta daily-insight tablolarını okuyan gerçek L2 adapter exact tenant/account/connection,
  entity, attribution, timezone, currency ve tarih scope'u uygular; SQL row cap'ten sonra metricleri
  canonical hash ile yeniden kurar. Sync completion attribution finality sayılmaz: zorunlu,
  deterministik settlement policy cutoff'u calendar/sync coverage ile birleştirilir.
- Dashboard'a ayrı Decision Room read-only görünümü ve model-agnostic Codex/Claude tool/HTTP
  kontratı eklendi. Tool argümanı workspace/reader/authority seçemez. Güvenilir authenticated
  principal ve production assembly henüz bağlanmadığı için route `503 source_not_configured`
  verir; demo fixture canlı sonuç gibi gösterilmez.
- Additive migration Supabase'e uygulandı. Decision Room ve insight adapteri applied-table
  outer-rollback kabullerinde bütün projection/pagination/tenant/legacy/trace/settlement/hash/
  row-cap bayraklarını geçti; Meta network/write, dış bildirim ve kalıcı fixture `0`.
- Kanıt: 68 test dosyası/381 test, typecheck, `db:check`, production build, audit `0`;
  Supabase 47/47 RLS, API table grant `0`, schema create `0`, public routine execute `0`;
  tracked/build/cache token eşleşmesi `0`.

## 2026-08-07 — S2 local session, analysis runtime ve AdvisedPractice kapısı

- Manual ve scheduled executor için tek deterministic analysis runtime L2 observation
  materialization, calculator, agenda/finding ve Decision Room ledger akışını exact frozen
  snapshot ref'lerine bağladı. Model, Meta write veya notification çağrısı yoktur. Persisted
  template/timeframe registry ile production asset loader kapanış işi olarak açık kaldı.
- Dashboard ve CLI aynı read/mark-read application contract'ına bağlandı. HMAC capability
  exact workspace/user/reader/tool scope, OS UID ve süre taşır; dashboard tek kullanımlık
  bootstrap'tan Secure/HttpOnly cookie, CLI süreli bearer alır. Loopback Host/Origin ve her
  istekte aktif DB üyeliği fail-closed doğrulanır.
- Veritabanında ilk local owner/workspace bağı serializable transaction + advisory lock ile
  oluşturuldu ve audit edildi. Kimlik binding'i ile 32-byte signing key git-dışı, `0600`
  `.env.local` içine değerleri yazdırmadan yerleştirildi; başka tenant seçilmedi/değiştirilmedi.
- AdvisedPractice candidate/review/trial/outcome/standardization-review yaşam döngüsü iki
  append-only tabloya bağlandı. Owner anlatımı, resmi Meta source, evidence ve deliberation
  zorunlu; conditional/rejected korunur. Policy artifact/promotion, automation ve action
  authority DB/domain sınırında kapalıdır; tombstone purge 45 workspace tablosunu kapsar.
- Additive migration Supabase'e uygulandı. Gerçek rollback kabulleri practice lifecycle,
  cross-tenant/tombstone, workspace bootstrap idempotency/audit/foreign isolation ve sıfır
  kalıntı için geçti. Kanıt: 74 test dosyası/426 test, typecheck, `db:check`, production build;
  Supabase 49/49 RLS, API grant `0`, tracked/build/cache secret eşleşmesi `0`, Meta write `0`.

## 2026-08-07 — S2 production analysis asset binding ve Practice Lab read kapanışı

- Versioned timeframe/template registry, immutable schedule-revision binding ve tek frozen
  run asset dört append-only PostgreSQL tablosuna bağlandı. Manual ve scheduled analiz aynı
  production loader/executor'ı kullanır; retry `latest` seçmez, ilk run'daki exact revision,
  definition hash, context, account/campaign ve entity scope'unu yeniden doğrular.
- İlk migration denemesinde Drizzle'ın composite FK'lerden önce referenced unique index
  üretmemesi canlı kapıda yakalandı. İki workspace-row unique index FK'lerden önceye alındı;
  57 statement outer-rollback validation'ı ve ardından gerçek migration temiz geçti.
- Practice Lab public-safe list/detail/lifecycle/source görünümü, yalnız konuşma içi ephemeral
  draft ve model-agnostic read araçlarıyla dashboard'a bağlandı. Ayrı `practice_lab:read`
  scope'u vardır; guidance/policy promotion, persistence, automation, Meta/action authority yoktur.
- Dashboard bootstrap-cookie ve CLI bearer aynı güvenli public Decision Room ref'lerini üretir;
  replay, expiry, Host spoof, cross-site ve proxy negatifleri conformance testinde fail-closed.
- Canlı rollback kabulleri frozen registry/retry, cross-tenant, immutability, 49-tablolu
  tombstone purge ve sıfır kalıntı için geçti. Kanıt: 80 test dosyası/441 test, production build,
  security/secret kapıları; Supabase 53/53 RLS, API grant `0`, Meta write/network `0`.
- Browser QA: Practice Lab unavailable state fixture göstermeden açıkça ayrılıyor; 1280px'te
  yatay overflow yok ve read-only/no-persist sınırı görünür. S2 kapanmıştır; sıradaki dilim S3'tür.

## 2026-08-07 — S3 Budget Lab saf karar çekirdekleri başlangıcı

- BudgetEnvelope period/currency, açık scale/rounding, total/min/max/fixed/reserve/allocatable
  ve planned/committed/actual/forecast ayrımını `bigint` exact decimal ile kurdu. CBO campaign
  ve ABO ad-set owner parent-child toplamları fail-closed uzlaştırılır; ad-level budget yoktur.
- Constraint motoru floor/cap/fixed/reserve, transfer allow/deny/only-within-group ve category/
  geo protected davranışını fixed/proportional/priority/ladder allocation ile çözer. “Pahalı
  bölgeden taşıma” yalnız açık koruma kuralı varsa engellenir; sistem bunu default varsaymaz.
  Proportional dağıtım exact integer-weight/BigInt kalan sırasıyla deterministiktir.
- Pacing motoru timezone/DST dönem ilerlemesi, expected-to-date/variance, bounded linear ve
  configurable conservative forecast üretir. Freshness, coverage, sample, attribution lag,
  learning, cooldown, proxy-vs-outcome ve max-change guard'ları bütün başarısızlıkları sıralı
  trace ile bastırır; retrieval observation'dan önce olamaz.
- Üç çekirdek de saf/advisory'dir; action authority `none`, persistence ve Meta network/write
  yoktur. Sıradaki increment simulation/proposal composition ve append-only persistence'tır.

## 2026-08-07 — S3 Budget Lab senaryo ve hedef/proxy kapısı

- BudgetScenario composer aynı frozen ref/hash üzerinde en fazla üç benzersiz, tamamen explicit
  `keep / conservative / target_seeking` alternatifi üretir. Before/after, pacing ve constraint
  trace'leri kayıpsızdır; suppressed/no-change/unsatisfied sonuçlar öneriye çevrilmez. Pacing
  suppression üst disposition olarak korunur, alt constraint sonucu yalnız açıklama olarak kalır.
- OutcomeProxyMapping iş sonucu hedefini Meta proxy metriğinden kesin ayırır. Category/objective/
  timeframe scope, provenance, sample, coverage, proxy lag, confidence, review ve freshness birlikte
  değerlendirilir; mapping yoksa, eski/yetersizse veya birden fazla uygunsa seçim yapılmaz.
- Bu çekirdekler de saf ve advisory-only'dir. Sıradaki increment mapping→scenario application
  binding, append-only proposal persistence ve Budget Lab read API/dashboard kesitidir.

## 2026-08-07 — S3 Budget Lab proposal persistence kapısı

- BudgetProposalService exact frozen EffectiveCampaignContext üzerinde mapping gate ve scenario
  composer'ı birleştirir. `target_seeking` yalnız ready mapping, exact proxy signal ve açık proxy
  izniyle compose edilir; aksi explicit suppressed. `keep/conservative` mapping'e bağlı değildir.
- İki append-only tablo proposal revision/hash/idempotency zincirini ve en fazla üç alternative'i
  workspace/account/campaign/context composite scope'uyla saklar. Action authority `none`;
  capabilities approve/execute/Meta-write için false'dur. Public projection full UUID, Meta ref,
  allocation ref ve authentic context hash'i opaque alias'a çevirir.
- Drizzle migration'da composite alternative FK'sinin unique index'i önce yaratılacak şekilde
  statement sırası düzeltildi; 26 statement outer-rollback doğrulandı ve migration Supabase'e
  uygulandı. Proposal, 51-tablolu tombstone ve security rollback kabulleri temizdir.
- Canlı kanıt: exact context/mapping suppression/idempotency/revision/cross-tenant/immutability/
  public-redaction bütün bayraklar true, geçici satır `0`, Meta/execution çağrısı `0`;
  Supabase 55/55 RLS ve API table grant `0`. Sırada Budget Lab read API/dashboard vardır.

## 2026-08-07 — S3 Budget Lab gerçek read yüzeyi

- Budget proposal repository tenant-bound keyset list/detail ve bounded trace summary üretir.
  Model-agnostic `budget_lab_list/get`, GET-only `/api/budget-lab` ve dashboard aynı public-safe
  projeksiyonu kullanır. Ayrı `budget_lab:read` scope'u her request'te aktif üyelikle doğrulanır.
- Dashboard Bütçeler sekmesindeki eski demo planları kaldırıldı. Gerçek source unavailable,
  empty, error, list/detail, before-after, mapping ve suppression/trace durumları ayrıdır;
  draft/approval/execute/Meta write yoktur.
- Test kanıtı 90 dosya/532 test, build/security/secret/Drizzle kapıları temizdir. Browser QA'da
  unavailable state fixture göstermedi; 1280/820/390 genişliklerinde yatay overflow `0`.
- Local capability doğrulaması non-canonical base64url HMAC imzalarını byte olarak aynı değere
  decode olsalar bile reddeder; canonical re-encode negatif testi tam suite içinde geçer.
- S3 read kesiti hazırdır. Sıradaki increment explicit dry-run/draft command + audit ve ardından
  S4 approval-only action valve tasarımıdır; production Meta writer hâlâ yoktur.

## 2026-08-07 — S3 Budget Lab draft ve audit kapanışı

- `budget_lab_dry_run` aynı deterministic proposal motorunu kullanır fakat proposal/audit
  persistence portunu çağırmaz; yalnız exact frozen context'i salt okuyabilir. `budget_lab_save_draft`
  append-only proposal ile `budget.draft_saved` audit olayını tek outer transaction'da commit eder.
- Ayrı `budget_lab:draft` local capability scope'u vardır. Workspace ve actor server-bound'dır;
  owner/admin/analyst draft oluşturabilir, viewer proposal/context erişiminden önce reddedilir.
  Exact intent, same-origin cookie, bounded JSON ve strict proposal shape fail-closed çalışır.
- Idempotent aynı taslak ikinci proposal veya audit üretmez. Agent/dashboard çıktısı public-safe'dir;
  approve, execute ve Meta writer authority/capability'leri false kalır. Yeni tablo veya migration
  gerekmedi; mevcut append-only `audit_events` zinciri kullanıldı.
- Canlı Supabase kabulü proposal+audit görünürlüğü, idempotent replay ve outer rollback sonrası
  sıfır geçici satırı doğruladı. Kanıt: 92 test dosyası/540 test; production build, security,
  secret ve Drizzle kapıları temiz. S3 kapanmıştır; sıradaki dilim S4 approval-only operations'tır.

## 2026-08-07 — S4 typed action, autonomy ve atomik approval çekirdekleri

- Saf action plan motoru `no_change/internal_annotation`, campaign/adset/ad pause-activate,
  resolved campaign/adset budget değişimi ve S5 için existing-post placeholder'ını K0–K4'e
  deterministik ayırır. Ad-level budget ve raw Graph action şema sınırında reddedilir.
- Effective autonomy workspace→account group→account→internal category→campaign→entity→action
  scope'larını en dar biçimde çözer. Varsayılan `approval_only`; expiry genişletmez, child widening,
  aynı scope conflict, kill switch, cap eksikliği ve protected/unresolved kapsam fail-closed'dur.
  K3/K4 daima insan onayı ister; hiçbir çıktı execute/write/grant/raw-Graph capability'si taşımaz.
- Immutable ActionBundle yalnız dependency DAG ve sunum kabıdır. Her ActionUnit ayrı approve,
  reject veya request-changes alır; downstream failure cascade edilir. Approval exact plan/unit/
  scope/source/context/spec hash'ine bağlı, kısa ömürlü ve tek kullanımlık evidence grant üretir;
  grant tüketimi bile execute değildir.
- Lifecycle duplicate event/grant ref, attacker-rehashed sahte actor/consumer/decision state,
  stale/expired/superseded spec, wildcard, sibling/bundle approval, dependency cycle ve SoD bypass
  girişlerini reddeder. Analyst proposal sahibi olabilir fakat approver/consumer olamaz.
- Kanıt: 94 test dosyası/578 test, production build ve secret kapısı temiz. Bu dilim saf ve
  persistence'sızdır; Meta network/write `0`. Sıradaki increment append-only action/autonomy
  persistence ve public-safe approval queue read modelidir; approval mutation ve writer hâlâ kapalıdır.

## 2026-08-07 — S4.1 restart-durable action proposal queue

- Yalnız `approval_required` typed action plan'ları kabul eden staging servisi eklendi. Exact
  plan/action/context/policy hash'leri, deterministic bundle/unit kimlikleri ve public-safe özet
  üretilir; K0/policy-limited adaylar, ad-level budget, raw Graph/secret/prompt benzeri alanlar ve
  saldırgan tarafından yeniden hash'lenmiş biçimler fail-closed reddedilir. Budget action'ları artık
  `daily` veya `lifetime` sahibini açıkça taşır; çıkarım yapılmaz.
- Policy snapshot, proposal bundle, action unit, dependency ve ilk lifecycle event'i beş append-only
  PostgreSQL tablosunda tek transaction ile saklanır. Exact replay yeni satır üretmez; aynı anahtarla
  farklı içerik conflict olur. Tenant/entity bağları, RLS, PUBLIC/anon/authenticated revoke,
  update engeli ve kontrollü workspace tombstone sırası migration düzeyinde uygulanır.
- Public-safe approval queue list/detail read modeli ve model-agnostic agent contract eklendi.
  Capability matrisi açıkça salt-okunurdur: approve, reject, request-changes, grant, execute,
  Meta-write ve raw Graph kapalıdır. Drizzle read adapter, GET API ve dashboard inbox sonraki küçük
  increment'tir; bu aşama kullanıcı kararını veya Meta varlığını değiştirmez.
- Migration gerçek Supabase'e uygulandı. Canlı kabul: `tablesApplied`, insert, exact replay,
  immutability, RLS/grants, exact row count ve rollback temiz; `metaCalls=0`, `executionCalls=0`.
  Workspace tombstone kabulü hedef satırların child-first temizlendiğini, yabancı workspace'in
  değişmediğini ve geçici satır kalmadığını doğruladı. Supabase güvenlik sonucu 60/60 tabloda RLS,
  API rollerinde sıfır tablo/schema-create/routine-execute yetkisidir.
- Kanıt: 98 test dosyası/607 test, production build, Drizzle schema check ve secret artifact kapısı
  temiz. Production Meta writer hâlâ yoktur; S4 rollout kapısı ayrıca ve açık kullanıcı kararıyla açılır.

## 2026-08-07 — S4.2 salt-okunur approval inbox

- Kalıcı action proposal tablolarını tenant-bound ve descending keyset pagination ile okuyan Drizzle
  adapter eklendi. Internal UUID/Meta bağları workspace'e özel public ref'lere çevrilir; status/budget
  before-after, bağımlılık ve otonomi izi yalnız doğrulanmış tiplerden projekte edilir. Bozuk veya
  değiştirilmiş persisted satır kısmen gösterilmez; tüm okuma fail-closed'dur.
- `/api/approval-queue` yalnız GET list/detail sunar. Ayrı `approval_queue:read` local-session scope'u,
  her istekte membership doğrulaması, bounded/tekil query parametreleri, no-store güvenlik başlıkları
  ve public-safe hata eşlemesi vardır. POST/PATCH/PUT/DELETE, approval mutation, grant, execute ve
  Meta writer handler'ı yoktur.
- Dashboard onay kuyruğu gerçek API'yi kullanır; loading/unavailable/error/empty, satır ve detay,
  risk/action/status, before-after, otonomi izi, expiry ve dependency gösterir. Eski demo
  approve/reject/request-changes/execute kontrolleri ve sahte bekleyen rozeti kaldırıldı.
- Canlı Supabase read kabulü bağlı workspace'te gerçek boş kuyruk döndürdü: `readOnly=true`,
  `canApprove=false`, `canExecute=false`, `canWriteMeta=false`. Browser QA'da local-session cookie
  bulunmadığında görünüm güvenli 503/unavailable durumuna geçti; fixture fallback veya istemci konsol
  hatası oluşmadı.
- Kanıt: 102 test dosyası/626 test, production build, security boundary, Drizzle ve npm audit temiz.
  Sıradaki increment insan-varlığı kanıtlı append-only approve/reject/request-changes mutation'ıdır;
  approval yine execute olmayacak ve production Meta writer kapalı kalacaktır.

## 2026-08-07 — S4.3 insan kararı ve append-only approval evidence

- Tek `ActionUnit` için approve/reject/request_changes uygulama servisi ve ayrı
  `approval_queue:decide` local-session scope'u eklendi. Karar endpoint'i yalnız HttpOnly cookie,
  exact same-origin, proxy/bearer/CSRF reddi, exact intent ve bounded JSON kabul eder; caller workspace,
  actor, wildcard veya bundle-level karar veremez. Viewer/analyst karar veremez; policy rolü ve
  separation-of-duties domain içinde yeniden uygulanır.
- Human-presence iki aşamalıdır. Exact actor/workspace/unit/action için dışarıdan güvenilir ceremony
  başarılı olursa 60 saniyelik process-local ve tek-kullanımlık proof üretilir. macOS adapter'ı shell
  kullanmadan sistem diyaloğu açar; vazgeçme, timeout, restart veya platform uyumsuzluğu fail-closed'dur.
  Dashboard ayrıca exact before→after satırını işaretleyerek teyit ister; toplu karar kontrolü yoktur.
- Repository proposal lifecycle'ını transaction içinde kilit altında replay eder, expected trace ve
  frozen freshness hash'lerini doğrular, human proof'u ancak bundan sonra tüketir ve domain kararını
  aynı transaction içinde bir kez hesaplar. Böylece load/approve arası TOCTOU yoktur. Exact replay
  idempotent, farklı içerik conflict'tir.
- `action_approval_decision_events` ve `action_approval_evidence_grants` append-only tabloları eklendi.
  Approval grant yalnız `approval_evidence_only`, tek-kullanımlık, henüz tüketilmemiş ve
  `canExecute=false` biçimindedir; public API grant materyalini döndürmez. Read model karar event'lerini
  replay ederek approved/rejected/changes_requested ile cascade dependency durumlarını gösterir.
- Migration gerçek Supabase'e uygulandı. Canlı kabul proposal+decision insert/replay/immutability,
  RLS+revoke, exact rows, tombstone ve rollback temizliğini doğruladı; `metaCalls=0`,
  `executionCalls=0`. Güvenlik sonucu 62/62 tabloda RLS ve API rollerinde sıfır tablo/schema-create/
  routine-execute yetkisidir.
- Kanıt: 108 test dosyası/658 test, production build, security boundary, Drizzle, npm audit ve secret
  artifact kapıları temiz. Approval hâlâ execute değildir; grant consumption ve production Meta writer
  ayrıca, açık kullanıcı rollout kararı olmadan açılmayacaktır.

## 2026-08-07 — S5.1 immutable promotion registry ve güvenli existing-post preflight

- `AudiencePresetRevision`, `PromotionTemplateRevision` ve account/Page-or-Instagram/internal-category
  binding'leri canonical hash'e bağlı ve yayınlandıktan sonra değişmezdir. Bütçe sınırları kayan nokta
  sayıya çevrilmeden scale-normalized `BigInt` ile karşılaştırılır; template zorunlu preset, objective,
  optimization, destination, placement, tracking, budget owner ve timeframe politikasını taşır.
- Saf preflight yalnız ownership/permission/capability'si doğrulanmış mevcut Page/Instagram gönderisi ve
  frozen content hash kabul eder. Organik gönderinin daha önce reklam creative'ine bağlanmış olması gerekmez;
  proposal aşamasında platform post/object-story kimliği immutable olarak dondurulur. Post içeriği, bu bağ,
  template veya preset revision değişikliği preflight/action kimliğini değiştirir. Çıktı K4 `approval_required`
  placeholder'dır; targeting değiştirme, creative üretme, approve, execute ve Meta write kapalıdır.
- Public-safe model-agnostic sözleşme yalnız exact ref seçimi kabul eder; account/actor/post/category/
  objective/budget/timeframe ile destination/optimization/placement/special-category/tracking ve aktif
  guidance uyumunu fail-closed değerlendirir. Ham targeting, raw ID, creative, wildcard, bulk veya
  workspace override reddedilir.
- Dört PostgreSQL registry tablosunda tenant-scoped composite FK, RLS, API grant revoke ve append-only
  UPDATE trigger'ı vardır; kontrollü silme yalnız kilitli workspace tombstone purge yolundadır. Migration
  gerçek Supabase'e uygulandı; güvenlik sonucu 66/66 RLS, API rollerinde sıfır tablo/schema-create/
  routine-execute yetkisidir.
- Dashboard'a ref-only existing-post preflight görünümü eklendi. Güvenilir katalog runtime'ı henüz bağlı
  olmadığından selector sahte veri göstermeden `source_not_configured` ile güvenli kapalı kalır; hazır
  sonuçta exact before→after, compatibility/guidance nedenleri ve bütün kapalı capability'ler görünür.
- Çekirdek kanıtı 112 test dosyası/677 test, typecheck, Drizzle, secret ve diff kapılarında temizdi;
  dashboard odaklı 5 test ayrıca geçti. Sıradaki increment gerçek registry repository/katalog runtime'ı,
  ardından proposal persistence ve atomik approval bağlantısıdır. Production Meta writer hâlâ kapalıdır.

## 2026-08-07 — S5.2 registry repository ve guided catalog sınırı

- Server-private registry servisi ve Drizzle repository preset→template→binding→normalized category
  edge zincirini tek tenant transaction'ında yayınlar. Domain constructor'ları canonical hash'leri yeniden
  kurar; active workspace lock, authentic account/actor/campaign/category opak-ref çözümü, exact replay,
  conflict ve corrupt-store kontrolleri uygulanır. Dışarı yalnız public ref projeksiyonu çıkar.
- Doğrudan repository testleri dört tablonun atomik insert'ini, idempotent replay'i, geç edge hatasında
  tam rollback'i, inactive tenant/eksik foreign ref halinde sıfır write'ı, canonical revision conflict'ini
  ve bozuk persisted payload'ın public read'de fail-closed kalmasını doğrular.
- Public-safe guided catalog sözleşmesi hesap→Page/Instagram→mevcut post ve template→zorunlu preset→
  internal kategori/objective ilişkilerini strict, bounded ve ID/hash/credential sızdırmayan biçimde
  doğrular. GET sınırı same-origin cookie ister; bearer, proxy ve caller workspace override'ı reddeder.
- Dashboard mount/retry ile kataloğu yükler; loading, trusted-empty, unavailable ve error ayrıdır. Form
  yalnız doğrulanmış, tam katalogla açılır. Gerçek DB katalog adapter'ı henüz bağlanmadığı için route
  güvenli `source_not_configured` durumundadır; hiçbir demo fallback kullanılmaz.
- Bu increment migration veya Meta çağrısı yapmaz; action/approval/execute/write/creative capability'leri
  false kalır. Sıradaki iş gerçek catalog read adapter/runtime ve K4 proposal persistence bağlantısıdır.

## 2026-08-07 — S5.3 gerçek katalog runtime'ı ve K4 proposal persistence köprüsü

- Drizzle/PostgreSQL catalog adapter aktif connection/account/Page-or-Instagram bağları, yayınlanmış
  immutable registry revision'ları, internal category edge'leri ve yalnız promotion eligibility'si
  `eligible` olan mevcut gönderileri workspace içinde birleştirir. Bütçe ve schedule/timeframe seçenekleri
  yayınlanmış template'ten türetilir; bağımsız veya uydurulmuş plan oluşturulmaz.
- Preset/template/binding payload'ları katalog projeksiyonundan önce domain constructor'larıyla yeniden
  kurulur; persisted hash/identity/link uyuşmazlığı fail-closed'dur. Belirsiz actor→account bağı çıkarılır;
  10.001 registry, 1.001 post veya 100 public seçenek sınırında kısmi katalog gösterilmez.
- Public katalog Meta ID, tam hash, targeting, reklam metni veya credential taşımaz. Ayrı
  `promotion_catalog:read` local-session scope'u, cookie-only/same-origin GET runtime'ı ve dashboard
  loading/empty/unavailable/error akışı gerçek kaynağa bağlandı. POST preflight runtime'ı henüz kapalıdır.
- Existing-post typed action artık frozen post content yanında `creativeBindingHash`, `timeframeRef`,
  `scheduleMode` ve `durationDays` taşır. Böylece creative veya zaman planı değişikliği action hash,
  ActionUnit ve proposal ref'ini değiştirir; eski approval yeni spesifikasyona taşınamaz.
- Proposal service saf K4 preflight'ı mevcut append-only action queue repository'sine verir. Exact replay
  `unchanged`, kaynak değişimi ayrı proposal; persistence hatası public-safe ve authority'siz fail-closed
  sonuçtur. Bu sınır approve, grant, execute, targeting, creative veya Meta transport içermez.
- Canlı Supabase katalog okuması gerçek boş durum döndürdü; `metaWrites=0`, `businessMutations=0`.
  Sıradaki increment server-resolved POST context repository'si, dashboard'dan proposal oluşturma ve
  mevcut tek-ActionUnit approval inbox'a uçtan uca bağlantıdır.

## 2026-08-07 — S5.4a server-resolved existing-post preflight

- Dashboard seçimine mevcut reklam seti eklendi; hesap değişince reklam seti seçimi temizlenir. Public
  preflight artık account, ad-set, actor, post, template, preset, budget, timeframe, objective ve internal
  category olmak üzere exact 10 opak ref ister. İstemciden Meta ID, targeting, raw payload veya workspace
  seçimi kabul edilmez.
- Ayrı Drizzle resolver seçimi aktif connection ve tenant içinde yeniden çözer; account→campaign→ad-set,
  actor→post, binding→category ve varsa binding→campaign bağlarını doğrular. Preset/template/binding
  belgeleri canonical constructor ve persisted hash'lerle tekrar sınanır. Organik post için önceden reklam
  creative binding'i aranmaz; gönderi kimliği ve içerik hash'i dondurulur.
- `promotion_preflight:read` ayrı local-session kapsamıdır. POST runtime same-origin cookie ister; bearer,
  proxy ve caller workspace override'ı storage erişiminden önce reddedilir. Preflight ephemeral'dir:
  persist/approve/execute/Meta-write/creative-generation yetkilerinin tamamı false kalır.
- Fixed-duration ve continuous schedule ayrı modellenir; continuous için uydurma bitiş tarihi üretilmez.
  Budget minor-unit dönüşümü exact'tir. Paused veya hiyerarşik olarak paused reklam seti aktif sayılmaz;
  durum kanıtı yoksa `unknown` kalır. Destination/optimization/placement/special-category/tracking için
  kanıt kaynağı henüz bağlı olmadığından gerçek kaynak `unknown` döndürür ve approval preview üretmez.
- Odaklı doğrulama 10 dosya/39 test, typecheck ve diff-check'te temizdir. Sıradaki increment aynı immutable
  context'i yeniden çözerek explicit proposal draft oluşturmak ve oluşan tek ActionUnit'i mevcut approval
  inbox'ta ayrı ayrı onaylanabilir hale getirmektir. Production Meta writer kapalıdır.

## 2026-08-07 — S5.4b explicit proposal-draft kapısı

- `promotion_proposal:draft` local-session capability'si ve `promotion:draft` workspace action'ı ayrıldı;
  owner/admin/analyst taslak isteyebilir, viewer isteyemez. Same-origin cookie ve ayrı explicit intent
  gerekir; bearer, proxy, caller workspace, genişletilmiş body ve serbest budget/targeting alanı reddedilir.
- Draft coordinator exact 10 ref'i S5.4a gerçek Drizzle resolver'ı üzerinden yeniden preflight eder.
  Yalnız `ready_for_approval_proposal` sonucu server-private submit portuna ilerleyebilir. Dashboard bu
  explicit komutu ayrı düğmeyle sunar ve dönen tek K4 ActionUnit sonucunda approval/execute/Meta-write/
  creative-generation yetkilerinin kapalı olduğunu tekrar doğrular.
- Canlı submit portu bilinçli olarak `material_unavailable` durumundadır ve queue transaction kabiliyeti
  taşımaz. Çünkü canonical belgeler public resolver'da redakte edilir; verified platform post/object-story
  binding, frozen plan, approval policy ve action context için henüz tek bir kanıtlı private materializer
  yoktur. Ayrıca beş compatibility alanı kanıtsız `unknown` kaldığından gerçek preflight hazır sayılmaz.
- Sahte creative binding, targeting, preset, policy veya plan üretilmedi. Mevcut saf proposal service ve
  append-only queue repository hazır ve testlidir; sıradaki dilim private materializer/evidence kaynağını
  kurup bu porta bağlayacak. O zamana kadar endpoint 409/503 ile fail-closed ve sıfır business/Meta write'dır.
