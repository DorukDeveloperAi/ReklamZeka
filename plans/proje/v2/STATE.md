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

**Slice 2 / Decision Room:** İç kategori/talimat registry'sini ve effective-context
resolver'ı, timeframe-aware deterministic analysis ile birleştir; agent yalnız L4/L5
kanıt paketinden finding/proposal üretsin. A13'e kadar production write scope veya writer
ReklamZeka'ya taşınmaz.

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
