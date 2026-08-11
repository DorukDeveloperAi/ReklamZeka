# ReklamZeka Meta Reklam İşletim Sistemi — STATE (v2)

> Kümülatif ilerleme defteri. v1'in ayrıntılı tur geçmişi
> [v1 STATE](../v1/STATE.md)'te değişmeden korunur.

## 2026-08-10 — Merkezi ürün akışı ve kademeli teslim ilkesi

- Bundan sonraki ana hat, teknik alt-katmanları tek başına tamamlamak değil; kullanıcının kampanyayı
  nasıl sınıflandırdığını ve hangi sırayla karar verdiğini görünür, denetlenebilir bir akışa çevirmektir:
  **kampanya bağlamı → dinamik brief/şablon → salt-okunur öneri → satır-bazlı insan onayı → ayrı,
  açıkça izinli uygulama**. Her checkpoint bu zincirde gözle görünür bir ilerleme üretmelidir.
- Öncelik sırası: (1) çalışma kitabından türetilen kategori ve brief şablonlarını Dashboard'da
  etkileşimli/read-only karar yüzeyine bağlamak, (2) öneri ve approval inbox'ını aynı context/timeline
  içinde birleştirmek, (3) yalnız bu ürün döngüsü hazır olduğunda A13'ün gerçek transport ve
  read-after-write kabulünü ayrı kullanıcı izniyle ele almak. Meta write, publish veya otomatik execute
  bu sıralama ile açılmaz.
- A09/A10'un mevcut fail-closed kanıtları korunur; ancak yeni ayrıntı yalnız güvenlik ihlali, veri
  bütünlüğü riski veya bu üç ürün adımını açan somut bir blocker olduğunda yapılır. Kapsam dışı
  "mükemmelleştirme" işleri checklist'e yeni teslimat gibi eklenmez.

## 2026-08-10 — A14 approval inbox execution-safety görünümü

- Approval Queue, onay kaydı, mirror yeniden kontrolü, ayrı human-presence seremonisi, kapalı Meta
  transportu ve verify/rollback sözleşmesini beş aşamalı salt-okunur bir durum panelinde gösterir.
  Panelde execute, rollback veya Meta çağrısı başlatan bir kontrol yoktur.
- Gerçek dashboard tarayıcısında masaüstü görünüm ve 390px responsive görünüm doğrulandı: panel tek
  sütuna iner, yatay taşma üretmez ve etkileşimli button içermez. Mevcut API'lerin local ortamda
  unavailable dönmesi panelin güvenlik durumunu değiştirmez.

## 2026-08-10 — A14 seçili kampanya → dinamik brief bağlamı

- Kampanyalar ekranındaki seçili campaign, proposal-only brief'in başlangıç sınıflandırmasını artık
  doğrudan belirler. İstanbul örneği WhatsApp lead akışıyla, GCC örneği uluslararası/Arapça/form
  akışıyla ve awareness örneği üst-huni ölçüm sınırıyla başlar. Kullanıcı brief alanlarını yalnız
  geçici olarak değiştirebilir ve "Bağlamı geri yükle" ile seçili campaign varsayımına dönebilir.
- Bu bağ bugün dashboard'un açıkça demo olan campaign projection'ından gelir; persisted current effective
  context veya bir campaign mutation'ı iddia etmez. Yeni kampanya/proposal/approval/execute/Meta write
  oluşmaz. Tarayıcıda GCC → geçici WhatsApp → bağlamdan form geri yükleme ve GCC → İstanbul WhatsApp
  bağlam geçişi doğrulandı.

## 2026-08-10 — A14 brief → salt-okunur öneri

- `interactive-campaign-template/1.2.0`, aynı kampanya brief'inden tek deterministik öneri üretir:
  sınıflandırma eksikse bağlamı çöz, teslimat kesintisiyse toparlanmayı ayır, eksik bilgi varsa brief'i
  tamamla, bağlam kapalıysa kampanya şeridini insan incelemesine al. Bu öneri ActionUnit, onay veya
  Meta değişikliği değildir.
- Dashboard brief paneli önerinin nedenini ve sonraki insan adımını seçili bağlamla birlikte gösterir.
  Ayrı persisted proposal/onay timeline bağlantısı hâlâ açıktır; demo campaign bağlamı gerçek approval
  kaydı gibi sunulmaz. Tarayıcı kabulünde GCC kampanyasında kapasite `bilinmiyor` seçimi öneriyi
  `Brief'i tamamlayın` durumuna geçirir; bağlamı geri yükleyince yalnız insan inceleme önerisi döner.
  Brief panelinde create/publish/execute kontrolü yoktur.

## 2026-08-10 — A14 persisted campaign-context read boundary

- Frozen `EffectiveCampaignContext`, opaque public `campaignRef` ile tenant SQL içinde çözülür; yalnız
  en güncel, invalidation almamış campaign context ve public-redacted projection döner. Private Meta
  kimliği ve ham context browser'a taşınmaz.
- `/api/campaign-context` local-session `decision_room:read` sınırına bağlı, tek-parametreli ve
  `read-only`/`Action-Authority: none` yanıt verir. UI henüz demo kimlikleriyle bu route'u çağırmaz;
  gerçek persisted ref geldiğinde brief/timeline birleşiminin kaynağı budur.
- Brief paneli, yalnız geçerli `persistedCampaignRef` verildiğinde bu read yolunu kullanır; demo seçiminde
  açıkça `persisted kaynağa bağlı değil` durumunu gösterir. Böylece demo, canlı approval/context verisi
  gibi görünmez.
- Context `ref_…` kimliği Approval Queue filtresinin `entity_…` kimliği değildir. Context read service
  private persisted campaign UUID'sinden ayrı, tenant-bound `approvalQueueCampaignRef` üretir; brief
  bu değeri yalnız formatı doğrulandıktan sonra inbox'a aktarır ve farklı campaign seçilince önce temizler.
  Böylece iki public alias birbirinin yerine geçirilemez.

## 2026-08-10 — A14 entity/campaign-scoped Approval Queue read boundary

- Approval Queue read modeli `entityRef` veya onunla aynı istekte kullanılamayan `campaignRef` ile
  exact opaque filtreyi tenant-bound SQL içinde uygular. Public ref, private UUID'den yalnız repository
  içinde yeniden türetilir; UI veya agent workspace/private ID gönderemez. Keyset pagination filtreyle
  birlikte korunur ve dönmüş satırın entity/campaign ref'i istenen filtreyle birebir eşleşmiyorsa bütün
  yanıt fail-closed olur.
- Campaign filtresi, direct campaign ActionUnit'inin yanı sıra ad-set ve ad ActionUnit'lerini tenant-scoped
  üst campaign ilişkisiyle çözer. Böylece gerçek child hareketler doğru campaign timeline kaynağına dahil
  olur. Dashboard'a sahte veya fixture tabanlı birleşik timeline bağlanmadı. PostgreSQL ve local-session
  ortamı 2026-08-11'de doğrulandı; bu campaign-context/inbox birleşimi için özel live HTTP kabulü sıradadır.

## 2026-08-11 — A14 context → Approval Queue alias bridge acceptance boundary

- Context/inbox bağının iki alias sözleşmesi hedefli servis, HTTP, dashboard ve verifier testleri ile;
  ardından tam kalite kapıları (`npm test`, production build, DB, security, architecture, model API,
  security-boundary ve secret-artifact kontrolleri) geçilerek doğrulandı. Sözleşme salt-okunurdur;
  context ve inbox yanıtları `Action-Authority: none` taşır ve Meta/model/action write capability'si açmaz.
- `verify:campaign-context-approval-queue-live`, gerçek local session ile iki local HTTP handler'ını aynı
  outer rollback transaction'ında çağırır; capability token'ı yazdırmaz ve network/write çağrı sayıları
  sıfırdır. Mevcut veritabanında geçerli frozen campaign context bulunmadığı için sonuç dürüstçe
  `no_valid_campaign_context` fail-closed blocker'ıdır. Bu verifier **semantic live başarı veya ortak
  campaign scope kanıtı değildir**; gerçek persisted context + ActionUnit fixture'ı oluştuğunda yeniden
  çalıştırılacaktır.
- Browser audit yalnız demo/unbound ve read-only UI sınırını kapsar: persisted frozen context bulunmadığı
  için tarayıcıdan context alias'ının gerçek Approval Queue sonucu ile birleştiği kanıtlanmadı. Bu nedenle
  A14'ün gerçek-session browser semantic acceptance işi açık kalır; demo görünüm canlı context/timeline
  gibi sunulmaz.

## 2026-08-10 — A13 execution-time Meta mirror revalidation

- Disabled admission ledger, approval/grant zincirini yeniden bağladıktan sonra current persisted Meta
  mirror'dan aynı account ve exact campaign/ad set/ad hiyerarşisini, latest authentic snapshot hash'ini
  ve status/budget-owner matrisini tekrar çözer. Frozen admission'ın eligibility snapshot/result hash'i
  bu yeniden hesaplanan sonuçla eşleşmezse hiçbir attempt/event yazılmaz.
- Bu yalnız stale veya dış müdahale edilmiş adayları fail-closed tutan read-side güvenlik bağıdır. Meta
  transportu, dispatch, executor, read-after-write veya rollback ve bütün write capability'leri kapalıdır.

## 2026-08-10 — A13 ayrı execution-admission seremonisi

- `ActionExecutionAdmissionService`, approval anından bağımsız `admit_execution` human-presence
  proof'unu tek kez tüketir. Plan/freshness/eligibility browser'dan kabul edilmez; yalnız server-owned
  source portundan yüklenir ve admission ledger'a disabled sonuç yazdırır. Owner/admin dışı roller ve
  proof replay'i fail-closed'dur.
- Bu checkpoint bir execute veya transport API'si açmaz. Persisted source/runtime bağı aşağıdaki
  checkpoint'te tamamlanmıştır; sıradaki açık kapı read-after-write ve rollback tasarımıdır.

## 2026-08-10 — A13 persisted admission-source runtime

- `DrizzleActionExecutionAdmissionSourceRepository`, immutable ActionUnit/approval lifecycle ile active
  connection'ın current Meta mirror hiyerarşisini ve latest authentic snapshot'ını read-only bağlar.
  Action plan, account/entity scope veya snapshot tutarsızlığı source'u reddeder. Sink, admission
  yazmadan önce aynı mirror kanıtını kendi kısa transaction'ında tekrar doğrular.
- `createLocalActionExecutionAdmissionService` yalnız bu source, single-use ceremony store ve disabled
  admission sink'ini birleştiren private composition root'tur. HTTP handler, scheduler, Meta transport
  veya action execution eklenmemiştir; gerçek session/DB acceptance ve read-after-write/rollback sonraki
  açık kapılardır.

## 2026-08-10 — A13 verify / rollback fail-closed contract

- `action-execution-verification/1.0.0`, frozen admission ve immutable action plan'dan doğrulanacak
  target değeri ile önceki değeri taşıyan rollback adayını hash-bound üretir. `accepted` transport,
  current mirror'da expected-value eşleşmesinden; bu eşleşme de platform review/delivery sonucundan
  ayrıdır. Böylece pending review/delivery, write verification ile karıştırılmaz.
- Retryable transport veya read eksikliği `parked`, read-after-write farkı `failed` kalır. Doğrulanmış
  satır bile rollback'i otomatikleştirmez: yalnız yeni, ayrı insan onaylı action adayına dönüşebilir;
  limited/rejected platform state manual recovery ister. Transport/DB event append/UI/Meta write yoktur.

## 2026-08-10 — A10 cadence/experiment adapter canlı kabulü

- `npm run verify:cadence-experiment-lifecycle-db`, gerçek owner cookie session'ı ile local
  cadence publish ve experiment plan→outcome HTTP handler'larını aynı outer rollback PostgreSQL
  transaction'ında çalıştırır. Cadence revision, experiment head zinciri ve üç audit event'i kalıcı
  akışta doğrulanır; stale outcome `409`, direct revision update append-only guard tarafından reddedilir.
- Live kabul, experiment resolver'ın intent'i yanlışlıkla `draft` allowlist'inde aradığını ve geçerli
  iki revisionlı plan→outcome geçmişinin repository tarafından bozuk sayıldığını ortaya çıkardı. Resolver
  artık publish-intent allowlist'ini, repository ise yalnız gerçek current head'i kilitler. Endpointler
  action/approval/Meta-write authority açmaz; rollback sonrası fixture sıfırdır.

## 2026-08-10 — A10 policy-configured PostgreSQL dry-run kabulü

- `npm run verify:decision-room-dry-run-db`, tek outer rollback içinde gerçek cookie-only
  `decision_room:dry_run` capability'si, server-bound operator settlement policy ref/cutoff'ı,
  immutable effective context/cadence/template ve L2 daily insight ile completed Decision Room run
  ve decision ledger üretir. Handler `analysis-dry-run` access mode'u ve `actionAuthority:none`
  döndürür; Meta network/write çağrısı ve rollback sonrası fixture kalıntısı sıfırdır.
- Canlı zincir 32-haneli L2 content-hash snapshot alias'ını 20-haneli tarihsel Meta snapshot alias'ı
  ile birlikte forward-only schema kontrolünde kabul eder. Context, template ve observation aynı
  immutable alias'a bağlıdır; eski 20-haneli alias biçimi replay-uyumlu kalır.
- Bu kabul Meta write, campaign create/publish, approval veya action execution açmaz. Browser
  acceptance ayrı açık çevresel kabul noktasıdır.

## 2026-08-11 — A10 authentic L1→L3 dry-run verifier correction

- Önceki dry-run verifier'ı güncel relational evidence sözleşmesine uymayan elle kurulmuş ready
  context kullanıyordu. Verifier artık normal L1 observation → persisted L2 feature snapshot → L3
  timeframe window → evidence-bound frozen context zincirini kurmadan Decision Room dry-run'a geçmez;
  replay, stale L1, tenant/tamper, network/Meta-write ve cleanup negatifleri bu gerçek ref'lere bağlıdır.
- Hedefli statik verifier/runtime testleri ve typecheck yeşildir. Sequential canlı PostgreSQL verifier da
  geçer: `.env.local`daki 6543 transaction ve 5432 session pooler endpointleri `ClientRead/idle in
  transaction` gösterebilir, ancak blocking PID yoktur; durum 114 FK-sıralı tombstone delete round-trip'i
  boyunca ilerler ve complete run/ledger/cleanup kanıtı alınır. Paralel workspace cleanup denemesi SQLSTATE
  `40001` serializable conflict verdiğinden geri alındı; fixture recovery yalnız sequential
  WorkspaceTombstoneService ile yapılır.

## 2026-08-11 — A10 frozen L2/L3 → Decision Room → L5 runtime bridge

- Decision Room runtime admissiondan sonra observation kaynağını yeniden L1'den seçmez. Frozen contextteki
  exact L2 feature refleri ve L3 window bindingleri tenant/scope/hash/state/coverage bakımından private
  readers ile yeniden doğrulanır; calculator girişi yalnız bu immutable L2 payloadlardan türetilir.
- Eksik, stale, foreign, tahrif edilmiş veya L3→L2 coverage'ı eksik evidence `evidence_not_frozen` ile
  ledger staging öncesi reddedilir. Successful run deterministik L5 compact-agent-context ref/hash/payload
  commitmentini immutable analysis ledger frozen context'ine bağlar; public executor/action sözleşmesi
  genişlemez ve Meta/network/write yetkisi üretmez.
- Runtime birim kanıtı ve authentic dry-run canlı PostgreSQL kabulü yeşildir. Pooler görünümü progress
  halindeki sequential tombstone cleanup'tır; runtime veya evidence sözleşmesi için blocker değildir.

## 2026-08-11 — A11 authentic budget-proposal PostgreSQL acceptance refresh

- Budget proposal verifier'ındaki eski sentetik frozen-context save kaldırıldı. Verifier artık shared
  current-source fixture ve closed-world composer ile source-bound context üretir; proposal scope hash'i
  bu gerçek context hash'ine exact bağlanır.
- PostgreSQL outer rollback altında keep/conservative ve mapping-suppression davranışı, idempotency,
  revision/audit, public-safe projection, cross-tenant/immutable/RLS negatifleri ve sıfır network/action
  doğrulanır. Primary ve foreign fixture workspace'leri sequential WorkspaceTombstoneService ile temizlenir;
  residue guard buna göre kontrol edilir.

## 2026-08-11 — A10 Agenda v2 ve frozen-L2 advisory diagnostics

- Analysis agenda `2.0.0`, deterministic exact pass sırasını `general → group_account → objective →
  internal_category → entity → topic → history` olarak freeze eder. Persistent Decision Room asset
  CHECK'i yalnız v2'yi kabul eder; v1 historical payload semantik olarak dönüştürülmez, authentication
  öncesi fail-closed kalır. Forward-only migration yerel PostgreSQL'e uygulanmıştır.
- Frozen primary L2 evidence üzerinden replay-stable spend contribution advisory hesaplanır. Peer
  veya metric kapsamı eksikse sonuç sırasıyla `insufficient_data`/`unknown` olur. Creative-level
  feature ve complete billing/destination config L2 payloadında olmadığı için fatigue/config finding
  üretmek yerine açık `not_supported` taşır; hiçbir ledger kararı, action veya Meta write yetkisi açılmaz.

## 2026-08-11 — A10.5a frozen diagnostic evidence substrate

- Immutable `frozen_diagnostic_evidence` sidecar'ı exact frozen context hash/ref, L2/L3 ref+hash
  manifestleri, subject hierarchy, objective/funnel/optimization, category/policy/config/source
  commitmentsini taşır. Yedi capability flag'i yapısal olarak false'tur; writer yalnız ready L2/L3,
  config ve category facts transaction içinde doğrulanabiliyorsa insert eder, aksi halde
  `insufficient_evidence` ile row oluşturmadan reddeder.
- Forward-only PostgreSQL migration FORCE RLS, public/API role revoke, append-only/tombstoning-only
  guard ve tombstone FK sırasını ekler. Outer-rollback live verifier authentic fixture/composer ile
  exact hash/capability zarfını, missing/cross-tenant/tamper negatiflerini, RLS/revoke, tombstone
  aggregate, zero network ve zero residue'yu doğrular. Bu yalnız substrate'tir; cohort veya creative
  fatigue/config sonucu henüz üretilmez.

## 2026-08-11 — A10.5b repository-selected robust cohort substrate

- `robust_cohort_diagnostic_assets`, yalnız target frozen diagnostic evidence ve metric/funnel/direction
  girişiyle çalışır; caller cohort üye listesi veremez. Repository aynı workspace/ad-account ve exact
  objective/funnel/optimization/category-composition/policy-set profile'ından ready, uninvalidated,
  primary L2 evidence seçer; mixed/stale/non-primary/missing target veya sample<4 fail-closed olur.
- MAD sonucu ve exact member ref/hash manifesti immutable advisory assette freeze edilir. Yeni forward-only
  migrationlar RLS/FORCE/revoke, append-only/tombstone guard ve purge sırasını taşır. Authentic fixture
  henüz explicit funnel commitment üretmediği için positive cohort live acceptance **açık** kalır;
  null funnel’da runtime sonuç uydurmaz.

## 2026-08-11 — A10.5c creative fatigue V2 hesap sözleşmesi

- `creative-fatigue-config-diagnostics/2.0.0`, günlük frequency veya CTR ortalaması
  kullanmaz: eşit/bitişik baseline-recent pencereler için frequency doğrudan source-grain
  değer, CTR ise `clicks / impressions` ratio-of-sums olarak hesaplanır. Daily kayıtlar
  yalnız tamlık/settlement kanıtıdır; frequency türetilmez ya da çoklu ad/creative arasında
  birleştirilmez.
- Bu yalnız saf, advisory hesap sözleşmesidir. Source-owned all-days Meta pencereleri,
  binding/config snapshotları, immutable repository ve canlı PostgreSQL kabulü henüz
  açık kaldığından Decision Room'a finding bağlanmamış, tüm yetkiler kapalıdır.

## 2026-08-11 — A10.5c direct creative config evidence contract

- `creative-diagnostic-config-snapshot/1.0.0`, objective, optimization, billing ve
  destination alanlarını ya ref/source-ref/source-hash ile doğrudan observed ya da
  `not_observed|unsupported|ambiguous` olarak explicit unknown saklar. `promoted_object`,
  implicit billing veya destination fallback'i sözleşme dışında tutulur.
- Bu saf sınır henüz mirror reader veya immutable persistence değildir; source-owned
  snapshot/definition/window repository ve PostgreSQL acceptance açık kalır. Böylece
  config drift veya fatigue finding'i bu contract tek başına üretmez.

## 2026-08-11 — A10.5c current mirror creative config reader

- Server-private `DrizzleCreativeDiagnosticSourceRepository`, active tenant/account/ad hierarchy,
  exact current ad→creative binding ve source hashes üzerinden direct config snapshot üretir. Binding
  ambiguity fail-closed; billing/destination gibi absent mirror alanları explicit unknown kalır;
  destination opaque digest/ref dışında taşınmaz.
- Okuyucu current read-only projection'dır. Immutable config/window snapshot tabloları, definition
  lifecycle, invalidation ve PostgreSQL verifier henüz açık olduğundan hiçbir diagnostic asset veya
  Decision Room finding'i yazmaz.

## 2026-08-11 — A07 field-pilot source coverage census

- Yeni read-only `census:field-pilot-source-db` REPEATABLE READ altında yalnız aggregate workspace/account
  sayıları ve evidence-family missing reason'larını verir; raw ID, secret veya yazı üretmez. Canlı
  `.env.local` sonucu 0 eligible workspace / 0 account ve tüm ailelerde unavailable döndü, exit 2 ile
  field-pilot closure'ı doğru biçimde engelledi. `docs/qa/field-pilot.json` veya A07 PASS iddiası eklenmedi.

## 2026-08-10 — Local MCP/session canlı kabulü

- Yerel geliştirme sunucusu ve yönetilen `.env.local` session yapılandırmasıyla `npm run verify:mcp-live`
  gerçek HTTP/STDIO zincirinde geçti: register, dashboard discovery, handoff consume, replay reddi ve boş
  MCP stderr doğrulandı. Bu doğrulama yalnız local coordination/read yüzeyini kullanır; Meta network/write,
  policy publish ve action execution sıfırdır.
- `.codex/config.toml` güvenli varsayılanları korunur: `required = false` ve
  `default_tools_approval_mode = "prompt"`. Bu checkpoint bunları değiştirmez.
- Gerçek tarayıcı oturumu/responsive kabulü bu agent oturumunda callable browser-control surface olmadığı
  için henüz çalıştırılmadı; açık kabul noktası olarak kalır.

## 2026-08-10 — Dinamik kampanya brief şablonları

- `interactive-campaign-template/1.0.0`, operasyonel sınıflandırmayı pazar → dil → hizmet →
  dönüşüm yolu olarak taşır; delivery health ve randevu/operasyon kapasitesini performans başarısından
  ayrı ön koşul yapar. Bu, kampanya bütçe/harcama takibindeki lead ile üst-huni ayrımı ve kesinti
  gözlemlerini karar sözleşmesine taşır; çalışma kitabındaki dönemsel sonuçlardan kalıcı bütçe kuralı
  türetmez.
- Lead acquisition, upper-funnel education, market/service learning, continuity recovery ve
  classification triage şablonları yalnız soru, ölçüm ayrımı ve insan-incelemeli sıra üretir. Kesinti
  veya sınıflandırılmamış kayıt `blocked`; eksik kapasite/dil/hizmet/rota `needs_input` kalır. Form ve
  WhatsApp varsayılan olarak farklı sonuç yollarıdır. Campaign create/publish/approve/execute/Meta write
  capability'leri yapısal olarak false'tur.

## 2026-08-10 — A09 complete relational authority-impact acceptance

- `verify:instruction-policy-authority-impact-db`, tek outer rollback altında gerçek draft → empty
  authority bootstrap → impact-OCC publish → private semantic/account-group/topic writer → bound catalog/
  snapshot materialization zincirini çalıştırır. Authority bağları hiçbir sentetik SQL authority satırı
  olmadan private owner/admin lifecycle yazarlarından gelir.
- Publish sonrasında bağ yoksa preview `trusted_authority_catalog` ailesini partial/blocked tutar. Aynı
  published policy için semantic fact, tenant-local non-disappeared account membership ve category-free
  active topic kaydedilip snapshot yenilendiğinde beş aile exact, integrity sıfır ve
  `coverage.complete=true` / `mutationAllowed=true` olur. Bu, policy publish ya da Meta/action write
  çalıştırmaz; bütün capability değerleri false kalır.
- Canlı doğrulama iki gerçek hatayı da kapattı: account-group writer tek elemanlı ref listesini artık
  PostgreSQL `text[]` olarak taşır; topic lifecycle active fakat category-bağsız authority fact'e izin verir.
  Impact reader, sidecar zorunluluğunu mevcut frozen contextlere uygular; context yoksa doğrulanmış
  relational binding'i sahte bozukluk saymaz. Cross-tenant görünürlük, RLS/revoke, append-only guard,
  network/action sıfır ve rollback sonrası sıfır kalıntı yine kanıtlandı.
- Browser/session kabulü ayrı açık çevresel kapıdır. G4/A13, HTTP/MCP/UI write yüzeyi veya Meta write
  eklenmedi.

## 2026-08-10 — A08 multi-business portfolio capability read model

- `DrizzleMetaPortfolioCapabilityRepository`, workspace'in bütün connection/data-source/ad-account
  topolojisini ve yalnız current active account-group membership'ini tek kısa `REPEATABLE READ, READ ONLY`
  snapshotta toplar. Dışarı yalnız opaque connection/account ref'leri, display name, currency/timezone,
  spend cap, current group refs ve read-readiness çıkar; external account ID, connection key, raw payload
  veya secret metadata çıkmaz.
- Grup üyeliği shared context'tir; child account permission veya capability'sini genişletemez. `ready`
  ancak aktif connection'da `ads_read` + `accounts.read`, account'ta `ads_read` ve
  `meta-account-capability/1.0.0` read evidence birlikte olduğunda verilir. Her eksik/corrupt kanıt
  `partial`/`unavailable` kalır; publish/approve/execute/Meta-write her durumda false'tur.
- Bu yalnız read model foundation'ıdır: group-scope inheritance ve dashboard/browser acceptance henüz
  açık kalır.

## 2026-08-10 — A08 source-bound account-read capability evidence

- Canonical `/me/adaccounts` asset discovery artık `meta-account-capability/1.0.0` evidence'ına
  dönüştürülür ve mevcut private asset persistence transaction'ında yalnız aynı tenant/connection'ın
  bilinen `ad_accounts` satırlarına yazılır. Evidence source snapshot hash'i, source status ve exact
  checked time taşır; daha yeni checked time'dan eski snapshot overwrite edemez.
- Verified listede görünen hesap `ads_read` + `canReadAccount:true` alır. Listede görünmeyen bilinen
  hesap ile empty/permission-missing/unsupported/unavailable discovery `ads_read` taşımayan,
  `canReadAccount:false` kanıtına güncellenir; eski permission sessizce korunmaz. Her capability setinde
  publish/approve/execute/Meta-write false'tur.
- Bu source evidence, group inheritance veya Meta write authority değildir. Concrete PostgreSQL live
  acceptance için yerel connection environment'i bulunmadığından, salt kod/test kanıtı ile sınırlıdır.

## 2026-08-10 — A09 authority materializer consistency hardening

- `policy_authority_bindings` exact-uniqueness'i global policy fact yerine immutable authority
  snapshot kapsamına taşındı; böylece aynı fact farklı historical snapshotlarda yeniden bağlanabilir,
  tenant-composite foreign key'ler korunur. Materializer current group/topic head revision+hash+active
  durumunu ve semantic ref'in en güncel immutable revision'ını transaction içinde yeniden doğrular.
- Aynı catalog hash'i mevcut current immutable catalog revision'ını tekrar kullanır. Geçerli aynı current
  snapshot (kaynak binding sayısı dahil) audit veya invalidation yazmadan idempotent döner; expiry-bound
  yenileme yeni snapshot/binding üretebilir. Catalog head değişiminde OCC fail-closed kalır.
- Effective-context policy composition registry hash'i snapshot payload içindeki var olmayan bir JSON yolu
  yerine authority catalog revision payload'ından doğrulanır. Bu checkpoint capability/impact coverage veya
  action yüzeyi açmaz.

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
| 09 | kategori ve talimat | DEVAM | 08 | Guarded category/policy/practice/profile lifecycle, 11-facet guidance ve run binding hazır; authoritative policy impact/formalization/mutable promotion ile canlı DB kabulü açık |
| 10 | zamansal analiz | DEVAM | 06,08,09 | objective schema/playbook temeli var; tam motor sırada |
| 11 | bütçe planlama | KAPALI | 09,10 | Checklist'teki envelope/constraint/forecast/scenario/ledger/target binding dilimleri kanıtlı; upstream context genişlemeleri A09/A10 altında izleniyor |
| 12 | prompt/advisor | DEVAM | 09–11 | narrative envelope/claim guard temeli var; translator/ledger sırada |
| 13 | eylem valfi ve rutin | AÇIK | 04,10–12 | planlandı; write kapalı |
| 14 | kontrol merkezi | AÇIK | 07,09–13 | planlandı |

## 2026-08-10 — A09.1 trusted authority safety foundation

- A09 trusted-authority işi aşamalı checkpoint'e ayrıldı. Tenant-bound authority snapshot, account-group
  revision/account binding, strict catalog/manual-lock, topic/semantic/category-topic relational temeli,
  frozen `policy_authority` context evidence'i ve action-unit↔frozen-context bridge'i forward-only
  migration ile eklendi. Yeni public tablolar FORCE RLS, API-role revoke, tenant-composite FK/index ve
  append-only/tombstone kontrolleri taşır.
- Public `composeTrustedPolicyContext` source-bound authority üretemez. Yalnız server-private repository
  loader; aktif workspace, snapshot hash'i, account eşleşmesi, current account-group head, temporal
  manual-lock head ve doğrulanmış catalog/scope bağlarından sonra source-bound compose closure döndürür.
  Tüm publish/approve/execute/Meta-write capability'leri yine false'dur.
- Etki kapsamı henüz yalnız gerçekten doğrulanmış aileler için kesin sayılır; authority/manual-lock/
  account-group/topic/semantic/opaque-unit taramalarında eksik veya belirsiz bağ varsa lifecycle mutation
  izni açılmaz ve `partial/blocked` kalır. Bu checkpoint A13/G4 yetkisi vermez.
- Kanıt: `npm test` 249 dosya/1.473 test, production build, `db:check`, `check:security` (0 vulnerability),
  architecture/model/security-boundaries ve secret-artifact kontrolleri yeşil. Canlı PostgreSQL ve gerçek
  browser kabulü çevresel olarak hâlâ `postgres_connection_not_configured` / local session yokluğu nedeniyle
  parkta; bu nedenle DB-backed authority verifier ve browser E2E tamamlanmış sayılmaz.

## 2026-08-10 — A09.2a manual-lock ve frozen action provenance

- Yeni private manual-lock portu yalnız owner/admin confirmed lock/unlock çağrısını aktif workspace
  ve membership recheck altında işler; exact published policy head OCC'si, append-only lock chain,
  audit kaydı ve `policy_authority` context invalidation aynı transaction'dadır. HTTP/MCP route'u,
  policy publish veya action capability eklenmedi.
- Action proposal queue artık her unit için aynı tenant/account/entity/hash'e ait tek bir persisted,
  invalidated olmayan EffectiveCampaignContext çözmek ve `action_proposal_unit_frozen_contexts`
  bridge'ini atomik yazmak zorunda. Eksik, belirsiz, cross-scope veya stale bağ fail-closed reddedilir.
- Kanıt: `npm test` 250 dosya/1.476 test, production build, `db:check`, `check:security` (0 vulnerability),
  architecture/model/security-boundaries ve secret-artifact kontrolleri yeşil. Yetki kataloğu
  materialization ve authoritative G3 preview sonraki küçük slice'tır; G4/A13 kapalıdır.

## 2026-08-10 — A09.2b authoritative G3 historical replay preview

- Server-private G3 preview root'u exact frozen historical context'i, G2 source/card provenance'ını,
  current strict-policy lifecycle'ını, tenant authority repository snapshot'ını ve strict impact
  reader'ı birlikte çözer. Snapshot yüklenemediğinde, G2/policy bağlantısı uyuşmadığında veya impact
  coverage tam olmadığında preview `blocked` olur.
- Başarılı source-bound replay dahi yalnız review sonucu üretir; authority alanları ve ayrıca G4
  alanı publish/approve/execute/Meta-write için false'tur. HTTP, MCP, dashboard veya mutation adapter
  eklenmedi; historical context invalidated olsa dahi explicit replay için immutable okunabilir.
- Kanıt: `npm test` 253 dosya/1.481 test, production build, `db:check`, `check:security` (0 vulnerability),
  architecture/model/security-boundaries ve secret-artifact kontrolleri yeşil. Authority catalog
  materialization lifecycle ve canlı PostgreSQL/browser kabulü sonraki sınırdır.

## 2026-08-10 — A09.2c private authority catalog materialization

- Private materializer; aktif workspace ve owner/admin membership'ini transaction içinde yeniden
  doğrular, published-policy registry ile catalog/snapshot head hash'lerini OCC ile kilitler. Yalnız
  current account-group/topic/semantic ve manual-lock kaynakları kanıtlandığında append-only catalog
  revision, tenant snapshot ve relational authority binding'leri birlikte yazar; aynı transaction
  `policy_authority` invalidation ve audit hash-chain kaydını da ekler.
- Catalog ve snapshot için deterministic current-head tabloları eklendi. Repository loader current
  kullanımda bu head'i, tarihsel replay'de ise explicit immutable snapshot ref/hash çiftini çözer;
  belirsizlik, stale head veya eksik kaynakta fail-closed kalır. Materializer herhangi bir HTTP/MCP/UI
  route'u ya da publish/approve/execute/Meta-write capability'si vermez; G4 kapalıdır.
- Canlı PostgreSQL şema kabulü de geçti: catalog ve snapshot head tabloları ile iki OCC trigger'ı
  mevcuttur; verifier bütün publish/approve/execute/Meta-write capability'lerini `false` doğrular.
  Gerçek oturum/browser kabulü ile impact coverage'ın daha geniş mutation kapsamı hâlâ açık kalır.

## 2026-08-10 — A09.3a policy-authority invalidation fidelity

- Catalog materializer ve private manual-lock writer artık tahmini catalog/snapshot veya policy hash'i
  invalidation hedefi olarak yazmaz. Aynı kısa transaction içinde workspace'in mevcut frozen context
  component kayıtlarından yalnız gerçek `policy_authority_workspace` ref/version çiftlerini okur ve
  her birini append-only invalidation fact'iyle kapatır; böylece eski authority closure taşıyan context
  yeniden seçilemez.
- Bu checkpoint authority/impact kapsamını genişletmez: complete exact-impact coverage sağlanmadı,
  `mutationAllowed=false` ve bütün publish/approve/execute/Meta-write capability'leri false kalır.
  HTTP/MCP/UI veya action adapter eklenmedi.

## 2026-08-10 — A09.3b effective policy-composition sidecar

- Trusted-authority ile compose edilen yeni effective context, registry hash'i, authority component,
  snapshot/catalog/scope hash'i ve çözüm hash'ini; her policy için exact immutable strict revision,
  applied/suppressed/parked state ve reason ile aynı save transaction'ında append-only yazar. Authority
  snapshot, catalog/binding zinciri veya bağlanan immutable strict revision eksik/mismatched ise save
  fail-closed kalır. Legacy context
  sidecar-sız historical replay olarak korunur; bu alan action/promotion yetkisi açmaz ve complete
  exact-impact coverage sınırı değişmez.

## 2026-08-10 — A09.3c family-by-family authority impact evaluation

- Policy impact preview, yalnız A09.3b immutable composition sidecar'ı mevcut, context payload ile
  header/itemları birebir tutarlı ve relational authority zinciri temiz olduğunda ilgili aileyi
  `exactRelational` olarak bildirir. Legacy, eksik, bozuk veya belirsiz sidecar taşıyan context bütün
  authority ailelerini `partialOrUnknown` bırakır; tek ailedeki bozukluk diğer ailelerin kanıtını silmez.
- Active manual lock kesin engeldir. Frozen action bridge hash'i unit/context kimliğinden yeniden
  hesaplanır; invalidated non-terminal unit engel, invalidated terminal unit ise yalnız tarihsel etkidir.
  Coverage ve `mutationAllowed`, bütün beş ailenin exact olması ile bütünlük/kesin engellerin temiz
  olmasına bağlıdır. G4 capability'leri yapısal olarak false kalır.

## 2026-08-10 — A09.3d live authority-impact fail-closed acceptance

- `verify:instruction-policy-authority-impact-db`, tek outer rollback içinde gerçek draft → empty
  authority bootstrap → impact-OCC publish zincirini PostgreSQL'de çalıştırır. Published policy için
  authority bridge yoksa preview `trusted_authority_catalog` ailesini partial bırakır ve mutation'ı
  kapatır; cross-tenant görünürlük, RLS/revoke, append-only triggers, sıfır network/action ve rollback
  sonrası sıfır geçici satır da doğrulanır.
- Canlı çalışma, impact SQL'indeki iki parantez hatasını ve `policy_contexts` CTE'sindeki eksik
  `ad_account_id` seçimini; pending sidecar migration'daki composite parent unique anahtar eksikliğini
  ortaya çıkardı. Düzeltilmiş migration, yerel Drizzle migrator ile başarıyla uygulandı.
- Bu **complete-positive acceptance değildir**: account-group, topic ve policy-semantic revisions için
  server-private materialization writer yoktur. Verifier bu veriyi sentetik SQL ile üretmez;
  `completeExactFixture:false` ve açık writer bağımlılığını raporlar. Browser/session kabulü de açık
  çevresel kabul noktası olarak kalır.

## 2026-08-11 — A09.4a transaction-local authoritative G3 evidence bridge

- Progressive G3 preview, yalnız aynı caller-owned transaction içinde exact G2 guidance-set manifestine
  bağlı en fazla 100 run → analysis asset → frozen context zincirini okur. Her frozen context yeniden
  canonicalize/hash-authenticate edilir; history içindeki outcome envelope'ları da workspace/ref/hash
  eşleşmeli immutable `business_outcome_evidence_snapshots` satırlarıyla ilişkisel olarak doğrulanır.
- Her historical context kendi capture zamanında kendi frozen authority snapshot ref/hash'iyle yeniden
  yüklenir. Mixed-account, missing/tampered context, missing/forged outcome snapshot veya authority
  replay başarısızlığında bridge source-bound iddiasını bırakır ve G3 preview incomplete/blocked kalır.
- Draft G3 adayı için mevcut production authority catalog'ı kasıtlı olarak kullanılmaz: catalog yalnız
  published policy taşır. Bu yüzden `candidate_authority_tier_decision_binding_unavailable` blocker'ı
  G3 promote'u revision/audit yazmadan reddeder. G4, HTTP/UI, action/network/Meta write veya
  `productionAuthoritySourceBound` semantiği değişmedi.
- Kanıt: 7 focused suite/23 test, `npm run typecheck`, `git diff --check`. Gerçek positive G3 canlı
  acceptance henüz iddia edilmez; ayrı owner-confirmed candidate preview-binding lifecycle'i sonraki
  forward-only checkpoint'tir.

## 2026-08-11 — A09.4b private candidate preview-binding evidence

- Draft policy, production authority catalog'ına sokulmadan ayrı append-only candidate ledger'da
  exact G2 head, reviewed guidance manifesti, draft policy revision/hash, active target account,
  canonical authority tier/structured decision ve repository-verified basis snapshot ile bağlanır.
  Read-time kontrol snapshot geçerliliğini, tenant/account scope'u, catalog/binding bütünlüğünü ve
  current draft/G2/guidance head'lerini yeniden doğrular; herhangi bir drift fail-closed'dur.
- `candidate_preview_binding_*` tablolarda FORCE RLS, public/API rol revoke, tombstoning-only
  delete ve OCC head korumaları vardır. Tombstone purge invalidation → head → revision sırasıyla
  bağımlılıkları kaldırır. Decision JSON CHECK'i NULL-true üç değerli mantığına karşı `IS TRUE`
  ile kapalıdır; tier sözlüğü canonical `PolicyAuthorityTier` ile aynıdır.
- Gerçek PostgreSQL outer-rollback kanıtı normal source/outcome/timeframe/Decision Room/G0→G2
  lifecycle'ından candidate binding üretir; positive binding, cross-tenant/tamper/stale retleri,
  G4/action/Meta/network kapılarının false/zero kalması ve residue=0 doğrulanır. Bu yalnız private
  G3 preview evidence'ıdır: draft `productionAuthoritySourceBound=false` kalır; G4 yetkisi açılmaz.

## 2026-08-11 — A09.4c candidate-aware G3 review/promotion

- Candidate ledger'dan gelen tier/structured decision, historical outcome zinciri ve repository
  doğrulamalı exact impact ayrı `candidateReviewEvidenceBound` altında birleşir. Bu kanıt, draftın
  production policy catalog'unda bulunmamasını source-bound eksikliği saymaz; buna karşılık
  `productionAuthoritySourceBound` ve `sourceBound` draft için false kalır.
- Progressive G3 preview artık candidate-review evidence + complete historical evidence + exact
  impact ister. Hazır durumdaki owner-confirmed `promote_g3`, gerçek impact sayılarıyla immutable
  formalization revision/audit üretir; malformed/stale/cross-tenant candidate evidence preview'i
  fail-closed bırakır ve yazı yapmaz.
- Outer-rollback PostgreSQL verifier normal source → outcome → timeframe → Decision Room → G0–G2
  lifecycle'ıyla positive preview/G3 promotionı, negative retleri, residue=0 ve network/action/Meta
  çağrılarının sıfırını doğrular. G4 için A13 risk/cap/approval/rollout/action-valve kanıtı hâlâ
  yoktur; G4 ve bütün ilgili yetkiler kapalıdır.

## 2026-08-10 — A10.1 kalıcı DecisionCadenceProfile

- `decision_cadence_profile_revisions` additive PostgreSQL tablosu tenant/account/campaign composite
  foreign key'leri, immutable revision zinciri, tek güncel revision index'i, RLS + FORCE RLS ve API
  rollerinden revoke ile eklendi. Tombstoning workspace altında kontrollü purge dışında delete reddedilir.
- Server-private publisher aktif workspace ile owner/admin membership'ini transaction içinde doğrular;
  current profile hash OCC ile supersede+insert yapar ve audit hash-chain olayı yazar. Cadence yalnız
  advisory tempo girdisidir; publish/approve/execute/Meta-write capability'leri yapısal olarak false kalır.
- Canlı PostgreSQL kabulü tablo, RLS/FORCE RLS, immutable trigger ve `service_role` için sıfır SELECT
  grant'ini doğruladı. ExperimentRecord lifecycle'i sonraki A10.2b kapsamındadır.

## 2026-08-10 — A10.2a cadence run-asset freeze binding

- Yeni Decision Room run asset'i context `profileRef` değerini aynı tenant/account/campaign kapsamındaki
  güncel cadence revision ile çözer; profile payload/hash template içindeki profil ile birebir eşleşmeden
  asset oluşturmaz. Revision UUID ve hash, immutable run asset satırına ve asset hash'ine birlikte yazılır.
- Legacy asset alanları nullable olarak korunur; loader bağsız veya hash'i uyuşmayan asset'i fail-closed
  reddeder. Canlı PostgreSQL migration kabulü iki alanı ve tenant composite foreign key'i doğruladı.
- ExperimentRecord append-only lifecycle'i A10.2b ile tamamlandı; hiçbir action/approval/Meta-write
  capability'si oluşturmaz.

## 2026-08-10 — A10.2c frozen AnalysisAgenda run binding

- Her yeni Decision Room run asset'i exact deterministic `AnalysisAgenda` hash+payload'ını aynı immutable
  satırda saklar; asset hash'i agenda hash'ini de kapsar. Loader yalnız context, resolved timeframe ve template
  pass'lerinden aynı agenda yeniden üretilebiliyorsa historical asset'i açar; legacy veya tahrif edilmiş bağ
  fail-closed reddedilir.
- Runtime, ilk L2 okumasından önce frozen agenda ile yeniden oluşturulan agenda'nın birebir eşitliğini denetler
  ve Decision Room sonucunun aynı `agendaRef`'i taşımasını zorunlu kılar. Bu bağ advisory-only'dir; action,
  approval, Meta-write ve model capability'leri açmaz.
- Additive migration canlı PostgreSQL'e uygulandı. Transactional asset verifier owner/member denetimli cadence
  fixture'ı üzerinden agenda payload/hash freeze'ini, RLS/revoke ve immutable asset guard'larını doğruladı;
  kalıcı fixture bırakmadı.

## 2026-08-10 — A10 server-bound deterministic dry-run endpoint

- `/api/decision-room` POST; yalnız cookie tabanlı `decision_room:dry_run` local-session scope'u, aktif
  workspace membership'i ve server-derived `workspaceRef`/`readerRef` ile manual Decision Room run başlatır.
  İstemci yalnız opaque request/account/campaign/timeframe/template ref'leri gönderebilir; action/approval/
  Meta-write veya raw/prompt/settlement alanı kabul edilmez.
- Observation reader attribution finality'yi request'ten veya sabit tahminden almaz. Yalnız explicit
  `REKLAMZEKA_ANALYSIS_SETTLEMENT_POLICY_REF` ve `REKLAMZEKA_ANALYSIS_SETTLED_THROUGH_DATE` birlikte
  geçerliyse compose edilir; yoksa public yüzey `source_not_configured` ile fail-closed 503 döndürür.
- Kanıt: service/HTTP/local-config hedef testleri ve tam `npm test` (261 dosya/1.510 test), production
  build, `db:check`, audit, architecture/model/security-boundaries/secret kontrolleri yeşil. Mevcut local
  ortamda settlement policy yapılandırılmadığı için gerçek PostgreSQL endpoint run acceptance bilinçli açık
  kalır; bir policy ref+cutoff sağlandığında rollback verifier ile tamamlanmalıdır.

## 2026-08-10 — A10.2b ExperimentRecord append-only lifecycle

- Experiment plan artık explicit `guardrail_breach` stop condition'ı taşımadan geçerli değildir. Plan ve
  outcome revision'ları aynı immutable hash zincirinde, exact cadence profile revision ve tenant account/
  campaign kapsamıyla saklanır; outcome yalnız deterministic `winner|loser|inconclusive|guardrail_stopped`
  advisory evidence üretir.
- Private repository aktif workspace, member role ve cadence scope'unu transaction içinde yeniden doğrular;
  plan/outcome kayıtları audit hash-chain olayları ile birlikte append edilir. RLS/FORCE RLS, API role revoke
  ve tombstoning-purge koruması migration seviyesindedir.
- Canlı PostgreSQL verifier tablo, chain trigger, RLS/FORCE RLS ve `service_role` SELECT grant'inin yokluğunu
  doğruladı. HTTP/MCP/UI veya Meta/action write yüzeyi eklenmedi.

## 2026-08-10 — PostgreSQL migration recovery ve A09 canlı kabulü

- Yerel migration journal'ındaki dört PostgreSQL portability hatası giderildi: composite foreign key'ler
  hedef composite unique index'lerinden sonra oluşturulur; progressive-formalization JSONB nested-key
  kontrolleri açık parantezlerle değerlendirilir. Her düzeltme önce gerçek PostgreSQL transaction'ında
  uygulanıp rollback ile sınandı. Journal artık 52/52 uygulanmış migration ve bilinmeyen hash olmadan
  tamamdır.
- `verify:policy-authority-catalog-db` owner/admin recheck, head OCC, immutable catalog/snapshot,
  invalidation/audit ve capability'lerin false kaldığını doğruladı. `verify:effective-campaign-context-db`
  cross-tenant, hierarchy, snapshot, invalidation ve nested-authority negatiflerini rollback ile doğruladı.
  `verify:progressive-formalization-live` source-key çözümü, membership, OCC, immutable/tombstone,
  audit atomikliği ve default G3/G4 block davranışını doğruladı. `verify:supabase-security`, 98 public
  tablonun tamamında RLS ve API rolleri için sıfır direct grant raporladı.
- Progressive preview repository’sinde scoped guidance listeleri artık gerçek parameterized
  `ARRAY[...]::text[]` bağlanır; scalar-to-array PostgreSQL cast hatası canlı doğrulayıcıda yakalanıp
  giderildi. G4, publish/approve/execute/Meta-write yetkisi vermez; exact impact coverage ve gerçek
  oturumlu browser kabulü hâlâ açık sınırdır.
- Kanıt: hedefli migration/repository testleri; `npm test` 256 dosya/1.496 test; production build,
  `db:check`, dependency audit (0 vulnerability), architecture/model/security-boundaries ve
  secret-artifact kontrolleri yeşil.

## 2026-08-10 — A10 robust cohort calculator

- Saf cohort calculator yalnız aynı objective, funnel, optimization event, metric, category-profile
  hash'i ve policy-set hash'ini taşıyan entity'leri karşılaştırır. Karışık profile kabul edilmez;
  böylece farklı objective/KPI'lar tek başarı skorunda birleştirilmez.
- Median absolute deviation (MAD) ile robust z-score hesaplanır. Minimum üyelik/sample eksikliği
  veya zero-MAD, yanlış outlier/finding yerine reason-coded `insufficient_data` döndürür. Sonuçlar
  input sırasından bağımsız, snapshot-ref bağlı ve deterministiktir; DB, model, route veya action
  capability eklenmedi.

## 2026-08-10 — A10 creative fatigue ve config diagnostic

- Creative diagnostic, aynı creative için settled günlük snapshot evidence'ını iki eşit pencerede
  inceler; frequency artışı ile CTR düşüşü threshold'u birlikte geçmedikçe fatigue finding'i üretmez.
  Az gün, az impression veya unsettled gözlem açık reason-coded `insufficient_data` kalır.
- Objective, optimization event, billing event ve destination config drift'i fatigue'den ayrı olarak
  raporlanır. Sonuç snapshot-bound, input-sırası deterministik ve bütün action/Meta-write capability'leri
  false'tur; persistence, route ve otomatik creative müdahalesi eklenmedi.

## 2026-08-10 — A10 BusinessOutcomeSignal provenance foundation

- Manual veya CSV kaynaklı business outcome batch'i source ref/content hash/observed-at ile immutable
  canonicalize edilir. Qualified lead, appointment, sale, revenue ve invalid lead için quantity;
  revenue için ayrıca minor currency value zorunludur. Duplicate signal, forged batch veya eksik
  verified mapping fail-closed reddedilir.
- Outcome evidence'i Meta metric değildir: verified mapping dahi `metaProxyEligible=false` üretir;
  eksik attribution sessiz proxy/success score'a dönüşmez. Bu dilim persistence, CSV upload/import
  route'u veya action authority eklemez; bunlar ayrı tenant-bound lifecycle diliminde kalır.

## 2026-08-10 — A09 atomic starter, authoritative facet preview ve progressive persistence

- Starter adoption artık zero-write blocker değildir. Owner/admin confirmation, aktif workspace
  satır kilidi ve DB membership recheck sonrasında category/profile registry hash'lerini ve exact
  plan/target manifestini aynı outer transaction'da yeniden doğrular. MASTER'ın 14 dimension'ı,
  yedi concrete definition'ı ve category başına altı objective playbook ref'i birleştirilmiş yedi
  draft CategoryProfile atomik yazılır. Kırk iki objective×category proposal preview'da kayıpsızdır;
  audit `catalogVersion/catalogHash`, 42-proposal manifest hash/count ve yedi profile-draft manifest
  hash/count taşır. Owner-defined değerler otomatik yazılmaz; açık acknowledgement ile
  `core_adopted_with_owner_configuration_pending` kalır. Partial-existing dimension altında yeni
  definition oluşturulursa normal category authoring ile aynı `category_resolution` component
  invalidation helper'ı kullanılır; mutation, invalidation ve audit aynı rollback sınırındadır.
- Guidance preview katalogu tek bounded PostgreSQL capture'ında aktif account, canonical objective,
  funnel, optimization, internal category, lifecycle, entity, effective PromotionTemplate ve latest
  card/binding topic değerlerini tenant-bound opaque ref olarak üretir. `catalogHash` capture zamanından
  bağımsız içerik hash'idir; preview zorunlu `expectedCatalogHash` ile stale kataloğu 409/fail-closed
  reddeder. Reviewed current/legacy Meta objective tokenları immutable eski binding'leri rewrite
  etmeden canonical objective ile eşleşir; unknown token eşleşmez. Sessiz legacy payload kabulü yoktur:
  MCP/HTTP çağrısı explicit `guidance-agent-tools/1.2.0` negotiation ister. Persisted account-group
  kataloğu henüz yoktur; non-empty account-group selection `catalog_unavailable` kalır.
- Progressive formalization G0→G2 gerçek vertical'ı eklendi: caller'ın opaque `source_key` seçimi
  current GuidanceSource stream'ine tenant-bound çözülür; revision payload'ına DB `source_ref` ve
  server-side content hash'i yazılır. G1 published GuidanceCard/binding scope'u, G2 ise reviewed
  GuidanceSet ref/version/hash'i ile ordered kartların exact current ref/version/hash manifestini
  tek `reviewedGuidanceHash` altında dondurur. Set veya kart daha sonra revise edilirse G3/G4
  `persistedGuidance=false` ve `reviewed_guidance_set_not_found` ile fail-closed kalır; eski
  set-hash-only G2 kayıtları sessizce exact review sayılmaz ve yeniden owner review ister.
  append-only revision/hash chain, role/owner confirmation, registry/head OCC ve audit tek transaction'dadır.
  Yeni tablo FORCE RLS, API rollerine sıfır grant, exact top-level/nested JSONB, tombstoning-only DELETE
  ve arbitrary UPDATE/active DELETE reddi taşır. Cookie-only API ve Strict Policy Studio içindeki panel
  G0/G1/G2'yi role-aware sunar. G3/G4 storage ve replay sözleşmesi testlidir ancak production G3
  `production_policy_authority_catalog_unavailable`, `conflict_preview_unknown` ve
  `impact_preview_incomplete`; G4 ise risk/cap/approval/rollout/action-valve kanıtı yokken blocked'dır.
  Hiçbir G4 satırı A13 approval/execute/schedule/tool/network/Meta authority vermez.
- Kanıt: progressive repository/UI/MCP hedefli kapısı `tests/progressive-formalization-*.test.ts` ve
  `tests/reklamzeka-mcp.test.ts` üzerinde 7 dosya/38 test; tam `npm test` 248 dosya/1.467 test;
  production build, typecheck, `db:check`, architecture/model/security-boundaries, secret-artifact
  kontrolü ve production dependency audit'i (0 vulnerability) ana ajan koşumunda yeşildir.
  `scripts/verify-progressive-formalization-postgres.ts` gerçek repository/service membership,
  source-key çözümü, OCC ve persisted audit satırını doğrular; bu ortamda exact
  `postgres_connection_not_configured` blocker'ı ve continuation döndürdü. Gerçek Chromium'da
  Strict Policy → Progressive panel 390/768/1440 px'te body/document scroll width viewport'a eşit,
  PostgreSQL yokluğu açık fail-closed ve Meta-write kapalıdır; console yalnız beklenen 503'ler ile
  favicon 404 içerdi. Meta/action/policy write açılmadı.
- Private local MCP ortamı ve session henüz yapılandırılmadığı için `.codex/config.toml` bilinçli
  güvenli fallback olarak `required = false` ve `default_tools_approval_mode = "prompt"` tutar;
  `tests/reklamzeka-mcp.test.ts` exact allowlist, secret-free config ve bu iki değeri doğrular.
  Private MCP/session kurulup `npm run verify:mcp-live` gerçek E2E yeşil olmadan `required=true`
  geri getirilmeyecektir.
- Canlı kapılar çevreseldir: `.env.local`, `DATABASE_URL` ve `DIRECT_DATABASE_URL` yok;
  `verify:starter-category-adoption-live`, `verify:progressive-formalization-live`,
  `verify:guidance-registry-db` ve `verify:supabase-security` yalnız redakte
  `postgres_connection_not_configured` döndürebilir. Local MCP/session yokluğu
  `local_mcp_session_unavailable` olarak ayrı park edilir. Bağlantı sağlandığında hazır sıra:
  `npm run db:migrate && npm run verify:starter-category-adoption-live && npm run
  verify:progressive-formalization-live && npm run verify:guidance-registry-db && npm run
  verify:guidance-agent-live && npm run verify:supabase-security`.
- Dış checkpoint mekanizması review tamamlanmadan ortak dalgayı `a1e2613`, ardından guidance fix
  parçasını `30cd2bc` olarak commit edip `origin/main`e push etti; ana ajan commit/push çalıştırmadı.
  Bu olay izin verilen git push değildir ve geri yazılmadı. Checkpoint ile izlenen iki geçici
  `.playwright-cli/*.yml` bu entegrasyonda silindi; generated `next-env.d.ts` production biçimindedir.

## 2026-08-10 — A09 strict impact, starter adoption ve promotion lifecycle checkpoint'i

- Strict instruction policy için persisted dependency reader exception ref'leri, frozen
  context/component geçmişi, budget proposal, analysis template/schedule/run asset, decision
  ledger ve action-unit lifecycle ailelerini exact tarar. Deterministic `impactHash`, gerçek
  JSONB schema drift, chain/integrity ve 20.000 satır cap'i vardır. Publish/pause/archive workspace
  kilidinden sonra membership, registry/target version-hash ve impact'i aynı transaction'da yeniden
  doğrular; revision, multi-context invalidation ve hash-chain audit birlikte commit/rollback olur.
  Audit expected/actual impact hash, gerçek invalidation reason ve planlanan/eklenen event sayısını
  saklar. `trusted_authority_catalog`, `manual_policy_locks`, `account_group_scope`, `topic_scope`
  ve opaque action-policy context association authoritative persist edilmediği için coverage
  bilinçli incomplete ve gerçek publish/pause/archive kapalıdır; draft/revise açıktır.
- Starter playbook kataloğu MASTER'daki 14 dimension'ı exact kapsar. Tenant registry state'inden
  deterministic create/satisfied/conflict planı, gerçek `dimension_*` public ref'li komutlar ve
  yalnız uyumlu dimension'lar için profile proposal üretir. Owner/admin confirmation registry ve
  plan hash'ini replay eder; atomik category+CategoryProfile batch ile authoritative profile
  inventory bulunmadığından zero-write `atomic_multi_command_category_adoption_unavailable`,
  `category_profile_registry_unavailable` veya exact conflict blocker'ı döndürür. Browser parser
  exact key/type/cap/ref/summary/blocked-response eşleşmesi dışında fail-closed'dur; Meta/action/
  policy authority vermez.
- AudiencePreset ve PromotionTemplate için ayrı append-only authoring lifecycle'ları eklendi.
  Draft material published state/time taşımaz; analyst draft/revise, yalnız owner/admin explicit
  publish/archive yapar. Preset first-class ve birden çok template tarafından exact immutable
  ref/revision/hash ile reuse edilir. Workspace lock sonrası DB membership recheck, lifecycle+
  resource OCC, immutable registry materialization, audit ve invalidation tek transaction'dadır.
  Local session `promotion_lifecycle:read|draft|publish` scope ve exact intent'lerle ayrılmıştır;
  bearer/wrong-intent kapalıdır. Public state targeting/payload yerine bounded ref/version/hash
  özeti döndürür ve hiçbir Meta/network write yolu açılmaz.
- Authoring archive semantiği dört authoritative promotion consumer'ına ortak effective-event SQL
  ile bağlandı: lifecycle yoksa legacy immutable yayın aktif, draft son yayını değiştirmez, en son
  publish/archive olayı exact template+binding hash'iyle yayını seçer veya tamamen düşürür. Publish/
  archive, frozen context'lerde bulunan tüm bounded eski `promotion_registry_workspace` version'ları
  ile current authoring registry version'ını deterministic olarak invalidate eder; böylece draft
  öncesi H0 context'i publish sonrası geçerli kalmaz. Yeni EffectiveCampaignContext persistence hem
  instruction-policy hem promotion-registry hash'ini ister; pre-A09 same-hash replay korunur.
- Dış checkpoint mekanizması bu dalga review tamamlanmadan değişiklikleri `e63adab` commit'ine alıp
  `origin/main`e push etti; ana ajan commit/push çalıştırmadı. Remote'a giren
  `20260809220203_promotion_template_authoring_lifecycle` migration/snapshot'ı değiştirilmedi.
  Published draft↔immutable JSON equality, archived parity, published secret/authority reddi ve
  tombstoning-dışı UPDATE/DELETE koruması ayrı forward-only
  `20260809222726_promotion_authoring_constraint_hardening` migration'ına taşındı. Constraint'ler
  drop/re-add ile mevcut satırları da validate eder; tombstone purge yalnız workspace gerçekten
  `tombstoning` iken DELETE yapabilir. Dış commit'in izleme amaçlı `.playwright-cli` geçici YAML'ları
  takip eden yerel checkpoint'te silindi ve generated `next-env.d.ts` production biçimine döndürüldü.
- Entegrasyon kanıtı: strict+starter hedefli 14 dosya/65 test; promotion/context hedefli 15 dosya/
  68 test; bağımsız strict ve promotion re-audit'leri ACCEPT. Son tam `npm test` 240 dosya/1.429
  test, production build, `db:check`, architecture, model/security boundaries, secret scan ve
  production dependency audit yeşildir. Gerçek browser'da 390/768/1440 fail-closed/overflow kabulü,
  mocked owner partial-impact no-POST ve promotion safe-unconfigured ekranı doğrulandı;
  `output/playwright/promotion-template-lifecycle-unconfigured.png` kanıtıdır.
- Canlı kapı çevreseldir: workspace'te `.env.local`, `DATABASE_URL` ve `DIRECT_DATABASE_URL` yok.
  `verify:promotion-template-lifecycle-live`, `verify:effective-campaign-context-db` ve
  `verify:supabase-security` redakte `postgres_connection_not_configured` ile exit 2 döndürür.
  Güvenli bağlantı geri geldiğinde hazır sıra:
  `node --env-file=.env.local ./node_modules/drizzle-kit/bin.cjs migrate && npm run
  verify:promotion-template-lifecycle-live && npm run verify:effective-campaign-context-db && npm run
  verify:supabase-security`. Extant satır forward CHECK'te fail ederse sessiz dönüşüm yapılmadan
  exact tenant/data remediation blocker'ı olarak park edilmelidir. Gerçek policy publish, Meta write,
  production action, deploy veya ana ajan tarafından git push yapılmadı.

## 2026-08-10 — A09 CategoryProfile, 11-facet guidance ve run-binding checkpoint'i

- CategoryProfile için owner/admin create/revise/publish/pause/archive vertical'ı eklendi.
  Aktif workspace kilidinden sonra membership rolü aynı transaction'da yeniden okunur;
  registry/profile version+hash OCC, append-only profile revision, prior-profile
  `category_profile` invalidation ve canonical audit birlikte commit/rollback olur. Audit
  publish/pause/archive reason code'unu exact saklar; create/revise için reason `null` kalır.
  UI parser'ı 20.000 definition, bundle başına 64 ref, typed opaque prefix, duplicate/sensitive
  ref ve bounded text guard'larıyla fail-closed'dur. Definition mutation ile profile mutation
  ayrı transaction'dır ve Studio bunu `profile bekliyor` olarak açık gösterir.
- Guidance registry 11 facet'e genişledi: global, account-group, account, objective, funnel,
  optimization, internal-category, lifecycle, entity, promotion-template ve topic. Altı
  provenance türünün tamamı bounded kullanıcı authoring akışında ayrı source revision olarak
  korunur; Studio çoklu source'u `sources[]` ile kayıpsız gösterir. Official Meta URL kabulü
  yalnız docs/help/business catalog/policy yollarıdır; JS ve PostgreSQL aynı uppercase
  scheme/host, default `:443`, case-sensitive path, non-default port, credential/fragment ve
  literal/encoded dot-segment karar matrisini uygular.
- `effective-guidance-pack/1.1.0` applied/suppressed/conflicting tüm kart ve kaynakları exact
  ref/version/hash manifestinde taşır. Registry/context sınırları sessiz truncation yapmaz;
  limit aşımı fail-closed'dur. `guidance-agent-tools/1.1.0` beş yeni facet'i explicit ve bounded
  ister; eski eksik payload bilinçli breaking contract olarak reddedilir.
- `guidance_analysis_run_bindings` set/card/source revision-hash manifestini aynı Decision Room
  analysis-asset transaction'ında immutable bağlar; pre-1.1 replay'e sonradan uydurma binding
  eklenmez. Yeni tablo ve mevcut guidance registry FORCE RLS, PUBLIC/anon/authenticated/
  service_role revoke ve tombstoning-dışı UPDATE/DELETE reddi taşır. DB dizileri set/card/source
  için 50/500/1.000 ile sınırlı; duplicate ref, JSON null/numeric scalar, decimal/overflow version
  ve malformed hash fail-closed'dur.
- Dış checkpoint mekanizması bu dalga tamamlanmadan ana değişiklikleri `39ca8b8` commit'ine
  alıp remote'a push etti; ardından `450f268` merge ve `aa84ede` filing commit/push'u oluştu.
  Ana ajan bunların hiçbirinde commit/push çalıştırmadı. Remote'a girmiş
  `20260809205228_spotty_rogue` migration'ı bu nedenle değiştirilmedi; son hardening ayrı
  forward-only `20260809212851_soft_mesmero` migration/journal/snapshot'ına taşındı ve eski
  exact-ref CHECK drop/re-add ile bütün legacy satırları yeniden tarar. Historical
  `plans/reklamzeka-sistemi/v2` değişmedi.
- Trusted policy composition saf sözleşmesi exact current lifecycle, frozen CategoryProfile
  ref/version/hash ve reviewed Meta objective mapping version/hash'ini doğrular; raw provenance
  context'e kopyalanmaz ve tüm action/tool/network/SQL authority alanları false'dur. Katalog
  yalnız self-hash validated olduğundan `productionAuthoritySourceBound=false`; persisted
  tenant-bound authority-tier/decision/manual-lock loader ve strict-policy authoritative impact
  reader açık kalır.
- Ana entegrasyon kanıtı: hedefli 14 dosya/70 test ve son hardening 3 dosya/19 test; tam
  `npm test` 228 dosya/1.383 test; production build, typecheck, `db:check`, architecture,
  model/security boundaries, secret scan ve production dependency security yeşil. Gerçek
  Chromium'da CategoryProfile ve Guidance fail-closed ekranları 390/768/1440 px'te
  `scrollWidth == clientWidth`; policy/action/Meta authority kapalı metni görünür. Console yalnız
  beklenen local-source 503'leri ve favicon 404 içerdi.
- Canlı DB kapısı çevreseldir: `verify:guidance-studio-live`,
  `verify:decision-room-analysis-assets-db`, `verify:category-profile-live` ve
  `verify:supabase-security` redakte `postgres_connection_not_configured` ile exit 2 döndürdü.
  `.env.local` veya `DIRECT_DATABASE_URL`/`DATABASE_URL` güvenli biçimde geri geldiğinde aynı
  komutlar hazır continuation'dır. Yeni facet preview scope'ları için production tenant catalog
  resolver'ı ve gerçek session happy path ayrıca açıktır. Meta write, real policy publish,
  production action, deploy veya ana ajan tarafından git push yapılmadı.

## 2026-08-09 — A09 human-gated Practice, Promotion dry-run ve Strict Policy Studio

- AdvisedPractice lifecycle canonical zinciri `validated|conditional → standardization_reviewed
  → standardization_candidate → standardized|retired` olarak tamamlandı. Analyst/owner/admin
  candidate önerebilir; `standardized` yalnız owner/admin rolünün explicit human confirmation'ı,
  exact definition version + `practice_revision_*` OCC ve aktif workspace membership recheck'iyle
  yazılır. Event ve hash-chain audit aynı transaction'dadır. Standardization eventleri policy
  promote, automation enable, action authorization veya Meta write authority üretmez; G3/G4 ya da
  A13 grant'i oluşturmaz.
- Ayrı `20260809202132_advised_practice_standardization_lifecycle` migrationı event allowlist ve
  event-specific JSONB authority guard'larını ekler; existing tables FORCE RLS, PUBLIC/anon/
  authenticated/service_role revoke ve append-only UPDATE trigger'larıyla sertleştirilir. Journal
  idx 42 ve matching generated snapshot kanıtlıdır; önceki policy migration testi additive journal
  sırasını exact idx 41→42 olarak doğrular.
- Practice Lab POST sınırı cookie-only/same-origin, body principal/workspace/bearer injection
  reddi ve ayrı `practice_lab:draft|standardize` scopes kullanır. Unknown operation fail-closed;
  analyst standardize denemesi 403'tür. Timeline ve UI state/revision/human-gated controls gösterir;
  agent veya UI kendi başına standardize edemez.
- Strict Policy Studio mevcut lifecycle API'sini raw provenance + normalized DSL, type/status/text
  filtreleri, append-only history/diff ve role-aware draft/revise/publish/pause/archive kontrolleriyle
  dashboard'a bağlar. Gerçek dependency impact reader henüz yoktur; UI sayı uydurmak yerine
  `henüz hesaplanmadı` gösterir. Approve/execute/schedule/tool/network/Meta write kapalıdır.
- PromotionTemplate authoring read/dry-run vertical'ı aktif published immutable registry'yi tenant-
  bound Drizzle adapterıyla yükler. Candidate hash/payload/ref/link/effective time, complete category
  edge ve row-cap bütünlüğü GET dahil doğrulanır. API body yalnız server-issued opaque scope ref,
  post/media type ve instruction alır; workspace/account/Page/Instagram/category sunucuda çözülür.
  Owner/admin/analyst dry-run yapabilir, viewer salt okunurdur. Mevcut registry actor/audit/OCC
  mutable authoring state'i taşımadığından draft persistence ve publish mutation bilinçli kapalıdır;
  Meta write, targeting/creative invention, action proposal ve approval authority yoktur.
- Kanıt: birleşik hedefli 12 dosya/60 test; tam `npm test` 221 dosya/1.348 test; production
  build, `db:check`, architecture, model/security boundaries, secret scan ve `npm audit`
  (0 vulnerability) yeşil. Ana ajan gerçek Chromium'da Strict Policy 390 px, Practice Lab 768 px
  ve Promotion 1440 px fail-closed durumlarını `scrollWidth == clientWidth` ile doğruladı. Mutation
  happy-pathleri mocked browser/HTTP contract testlerinde rol, OCC, unknown-operation ve authority
  negatifleriyle kanıtlandı; console yalnız beklenen source/session 503'leri ve favicon 404 içerdi.
- Canlı `verify:advised-practice-db` exact `postgres_connection_not_configured` blocker'ı ve
  `npm run verify:advised-practice-db` devam komutunu döndürdü; `verify:supabase-security` de DB
  bağlantısı olmadığı için başlayamadı. Production publish, Meta write, deploy ve git push yoktur.

## 2026-08-09 — A09 policy lifecycle, target chooser ve Guidance Set checkpoint'i

- İlk assignment için category authoring GET state'i aktif/non-disappeared campaign, ad set,
  ad ve creative hedeflerini yalnız opaque `category_entity_*` refs ile döndürür. Creative reuse
  exact aktif `viaAdRef` yoluyla seçilir; katalog sorgusu raw external Meta ID kolonlarını seçmez,
  UUID/uzun numeric label parçalarını redakte eder. Owner/admin chooser mutation'ı registry hash,
  manual-lock ve confidence taşır; analyst/viewer salt okunurdur, action/Meta authority yoktur.
- `strict_instruction_policy_revisions` ve ayrı raw provenance store'u append-only migration,
  FORCE RLS ve PUBLIC/anon/authenticated/service_role revoke ile eklendi. Analyst draft/revise;
  owner/admin publish/pause/archive yapar. Cookie-only same-origin API, registry+version+policy
  hash OCC, hash-chain audit ve lifecycle mutation'ıyla aynı transaction'da context invalidation
  uygular; raw metin policy JSONB/audit/invalidation payload'ına girmez.
- Yeni frozen context'ler exact `instructionPolicyRegistry` hash'i olmadan persist edilemez.
  `sourceComponentsOf()` ile lifecycle writer aynı `instruction_policy / instruction-policy-registry /
  registryHash` çiftini kullandığından invalidation artık gerçekten context kayıtlarıyla eşleşir;
  pre-A09 context payloadlarının hash-stable historical replay'i korunur.
- MASTER'daki dokuz policy otorite kademesini, scope specificity/yeni publication, explicit
  exception, lossless suppression trace ve eşitlikte `PARKED_CONFLICT` semantiğini uygulayan saf
  resolver eklendi. Authority tier ve decision/position bağlarını raw text'ten çıkarmaz; trusted
  production binding adapterı hâlâ açıktır.
- G0→G4 progressive formalization saf sözleşmesi normalized draft, assumption/question,
  semantic diff, historical replay ile affected-scope/conflict/impact preview alanlarını exact,
  hash-chainli ve fail-closed doğrular. G2→G3/G3→G4 explicit owner/admin confirmation ister;
  G4 yalnız A13 valve ref'i taşır ve approve/execute/write/schedule/tool yetkisi üretmez. Gerçek
  normalization/impact hesaplama, persistence/API/UI ve insan onaylı promotion ayrı açık iştir.
- PromotionTemplate selector yayınlanmış immutable template/preset bütünlüğünü doğrulayarak
  account, Page/Instagram, internal category, post/media ve alias/talimat üzerinden deterministik
  dry-run yapar; unknown/eşit eşleşme veya targeting/creative değişiklik talebinde fail-closed
  kalır. Starter category/playbook kataloğu altı mevcut objective playbook'una version/hash ile
  referans verir; seed/persist/publish yapmaz ve owner adoption gerektirir.
- Guidance Set authoring mevcut append-only registry üzerinde analyst draft/revise ve owner/admin
  review/archive olarak bağlandı. Setler 1–50 unique current-published card ref'i sıralı taşır;
  registry+set version OCC, guidance_set audit ve review/archive context invalidation'ı aynı
  transaction'dadır. Same-origin API ve role-aware Studio UI action/approval/Meta authority taşımaz.
- A09 re-audit'i eski AdvisedPractice kapanış işaretini düzeltti: decomposition R-09.21 tamamdır,
  fakat canonical `standardization_candidate` ve explicit human-confirmed `standardized` eventleri
  mevcut DB CHECK allowlist'inde yoktur. Bu iki event policy migration'ına karıştırılmadan ayrı
  additive migration/role-audit/UI/live-verifier checkpoint'inde tamamlanacaktır.
- Kanıt: birleşik hedefli 21 dosya/152 test; tam `npm test` 212 dosya/1.314 test; production
  build, `db:check`, architecture, model boundary, security boundary 9 test, secret artifact
  kontrolü ve `npm audit` (0 vulnerability) yeşil. Gerçek Chromium'da Guidance/Kategori
  unavailable durumları 390/768/1440 px'te yatay taşma olmadan fail-closed kaldı; owner category
  chooser request-interception testi opaque exact creative-via-ad POST ve raw ID redaksiyonunu
  doğruladı. Console'daki hatalar yalnız beklenen 503 kaynakları ve favicon 404'tür.
- Canlı PostgreSQL kanıtı dış blocker'dadır: `.env.local`, `DATABASE_URL` ve
  `DIRECT_DATABASE_URL` yok. `verify:category-authoring-live`, `verify:category-profile-live`,
  `verify:instruction-policy-live`, `verify:effective-campaign-context-db`,
  `verify:guidance-studio-live` ve `verify:supabase-security` bu nedenle çalışamadı. Devam için
  güvenli bağlantı geri yüklendikten sonra aynı komutlar çalıştırılmalıdır. Meta write, policy
  production publish, deploy veya bu ajan tarafından git push yapılmadı.

## 2026-08-09 — A09 assignment, CategoryProfile ve strict policy contract dalgası

- Category assignment authoring aynı cookie-only/same-origin API'de owner/admin için açıldı;
  analyst/viewer publication yapamaz. Actor/workspace/source/evidence request body'den alınmaz;
  opaque assignment/entity ref, registry hash ve expected version zorunludur. Kaynak/evidence
  server-owned `manual`/`manual_authoring` olarak üretilir.
- Locked veya non-manual assignment normal revise/archive ile değiştirilemez. Manual lock yalnız
  ayrı `unlock_assignment` append-only revision'ında, exact version/hash, server-owned unlock
  evidence, audit ve exact-entity `category_resolution` invalidation ile açılır; ardından caller
  yeni ref/version/hash üzerinden normal lifecycle'a devam eder.
- Sürümlü `category-profile/1.0.0` category parent, color, owner, status ve analysis,
  instruction/rule, budget, transfer, schedule, action, creative-policy ref bağlarını exact
  allowlist ile taşır. Artifact hash-chain ve authority-false'dur; active profile identity/hash'i
  frozen category context'e yeni `category_profile` source component'i olarak bağlanır.
- Yeni append-only `category_profile_revisions` tablosu active workspace lock, tenant/category
  composite FK, recursive parent-cycle ve second-current-series guard'ı, RLS+FORCE RLS,
  PUBLIC/anon/authenticated/service_role revoke ve prior-profile selective invalidation taşır.
  Profile JSONB contract'ı A09.6d dependency manifest/archive impact ve workspace tombstone
  purge allowlist'ine eklendi. Canlı verifier hazırdır fakat DB bağlantısı yoktur.
- `strict-instruction-policy/1.0.0` ham metni ayrı provenance/hash artefaktında tutar; normalized
  AST hard constraint, target, preference, exception, prohibition, approval ve schedule türlerini
  scope/priority/effective dates/version/owner/status/reason ile exact ve bounded doğrular.
  SQL/network/tool/cron/raw action veya approve/execute authority taşıyan/ek alanlı contract'lar
  fail-closed reddedilir. Bu checkpoint typed DSL'dir; policy persistence/publish/pause ve doğal
  dil normalization hâlâ açıktır.
- Kanıt: birleşik hedefli 17 dosya/120 test, ilgili alt dilimlerde assignment 39, profile 32 ve
  strict DSL 38 test; tam `npm test` 203 dosya/1.253 test, production build, typecheck,
  `db:check`, security/model/secret kapıları ve dependency audit. Canlı
  `verify:category-authoring-live` ile `verify:category-profile-live` exact
  `postgres_connection_not_configured` blocker'ında; ilk-assignment target catalog/chooser da
  henüz yoktur. Meta write, deploy veya bu ajanlardan git push yapılmadı.

## 2026-08-09 — A08 yetkisiz canlı inventory route karantinası

- `/api/meta/inventory` request principal, membership, workspace ve connection doğrulamadan
  process-wide `META_ACCESS_TOKEN` ile canlı Graph çağırıyordu. Bu yüzey multi-connection veya
  tenant güvenliği kanıtı sayılamayacağı için güvenilir cookie-bound DB handler gelene kadar
  fail-closed karantinaya alındı.
- Route token dolu olsa bile connector import etmez, network çağırmaz ve yalnız redakte `503`
  + `Cache-Control: no-store` döndürür. Security checker API route'larında doğrudan Meta token,
  inventory connector, Graph client/origin yeniden girişini negatif fixture'larla reddeder.
- Kanıt: ilgili iki dosyada 14 test, security boundary 9 test, typecheck ve `db:check`.
  Chromium'da dashboard route isteği redakte 503 döndü ve external Graph request oluşmadı;
  kategori unavailable görünümü 390/768/1440 px'te yatay overflow olmadan görünür kaldı.
  Açık devam: tenant/session-bound DB portfolio read adapter, account group ve versioned
  account permission/capability history.

## 2026-08-09 — Dış checkpoint/push sınırı olayı

- Aynı olay bu A09 checkpoint'i stage edilirken tekrarlandı: dış mekanizma doğrulanmış çalışma
  setini `9b372d2` commit'ine alıp `origin/main`e push etti; ardından `6d173cb` merge'i ve
  `.claude`-only `45e3313` checkpoint/push'u oluştu. Ana ajan `git commit` veya `git push`
  çalıştırmadı. `9b372d2` bu bölümdeki A09 kod/plan kanıtını içerir, fakat ayrıca dış mekanizmanın
  `docs/DURUM.md` ve `docs/durum/2026-08-09.json` güncellemelerini de kapsadığı için istenen
  ajan-sahipli tek mantıksal yerel commit sınırı dışarıdan ihlal edilmiştir. Remote history
  değiştirilmeyecek; halen dirty `.claude` dosyaları dış kullanıcı değişikliği olarak korunur.
- Ana ajan ve subagentlar commit/push çağırmamışken eşzamanlı dış checkpoint mekanizması çalışma
  ağacındaki henüz tamamlanmamış dosyaları `a0e1a66` ve `c62877a` commit'lerine aldı ve
  `origin/main`e taşıdı. İkinci commit ayrıca bu goal kapsamı dışındaki `.claude` Aide dosyalarını
  içeriyor. Remote history'yi geri yazma, force-push veya deploy denenmedi.
- Bu iki commit mantıksal checkpoint kanıtı değildir; içerdikleri A09 parçaları bu dalgada
  tamamlanıp ana ajan tarafından yeniden test ediliyor. Yerel-only/push-yok garantisinin tekrar
  korunması için dış checkpoint mekanizmasının sahibi tarafından durdurulması gerekir; bağımsız
  salt-okur ve yerel doğrulama işleri bu sırada devam edebilir.

## 2026-08-09 — Post-checkpoint ikinci kontrol düzlemi karantinası

- `c90883c` sonrasındaki doğrulanmamış merge ile aktif ağaca eklenen Python/SQLite/Google
  Sheets ve doğrudan Meta MCP kontrol düzlemi kanonik Next.js/TypeScript, Drizzle/PostgreSQL,
  tenant-bound read-only Graph ve typed local MCP sınırlarıyla çelişiyordu. Bu yüzey A09+
  uygulamasına entegre edilmeden Git geçmişinde recoverable kalacak biçimde aktif ağaçtan çıkarıldı.
- README tek plan otoritesini `plans/proje/v2/{MASTER,STATE,CHECKLIST,REQUIREMENTS}.md` olarak
  gösteriyor. `plans/reklamzeka-sistemi/v2` tarihsel planı değişmeden korunuyor.
- Architecture kapısı ikinci installable Python/runtime ağacını; security kapısı doğrudan Meta MCP
  endpoint/secret, Python MCP transport, SQLite ve Sheets kanonu marker'larını; model ve secret
  kapıları da Python provider yüzeyi ile legacy Meta MCP secret artifact'ını fail-closed reddediyor.
- Kanıt: dört regression dosyasında 25/25 test; `check:architecture`,
  `check:security-boundaries`, `check:model-api-boundary`, `check:secret-artifacts`, `db:check`,
  production build ve dependency audit. Yerel secret bulunmadığı için secret-artifact sonucu
  dürüst `SKIP`; production/deploy/Meta write yapılmadı.

## 2026-08-09 — A09.8a reviewed objective mapping ve selector preview

- Sürümlü `meta-objective-mapping/1.0.0` kataloğu Meta'nın current ve legacy campaign
  objective değerlerini altı kanonik objective playbook'una açıkça bağlar. Null, malformed veya
  katalog dışı değer tahmin edilmez; `uncertain` ve `mapping_unresolved` olarak korunur.
- Saf `category-selector-preview/1.0.0` motoru account, platform, name pattern, objective,
  optimization, geo, language, budget model, status, creative attribute ve entity-ID
  kriterlerini strict schema ile doğrular. Kriterler arası AND, aynı kriterdeki değerler OR'dur;
  kesin mismatch belirsizlikten baskındır ve her sonuç deterministic reason trace taşır.
- Preview yalnız önerilen public category ref, reviewed evidence ve confidence döndürür;
  category mutation/assignment, policy mutation ve action execution authority alanlarının
  tamamı yapısal olarak `false` kalır. Raw campaign fixture → canonical objective → preview
  zinciri materializer'a bağlandı; bilinmeyen objective publish/assignment üretmez.
- Kanıt: hedefli üç dosyada 17/17 test; tam `npm test` 199 dosya/1.188 test; production build,
  `db:check`, architecture/security/model/secret kapıları ve dependency audit. DB/migration/UI
  değişmedi; secret taraması yerel secret bulunmadığı için dürüst `SKIP`, Meta write/deploy yok.
- A09 audit'i ayrıca campaign→adset→ad→creative inheritance üst maddesinin ve
  AdvisedPractice lifecycle/decomposition requirement'larının mevcut domain, persistence,
  canlı rollback ve Practice Lab kanıtlarıyla daha önce tamamlandığını doğruladı; checklist
  bu gerçek kanıta göre düzeltildi. PromotionTemplate ile provenance maddeleri, tamamlanmış
  çekirdek ve açık authoring/binding sınırlarını ayrı gösterecek biçimde bölündü.

## 2026-08-09 — A09.6d/A09.7 guarded category lifecycle teknik checkpoint'i

- Başlangıç yeniden haritalaması `c90883c` son doğrulanmış işlevsel checkpoint'ini doğruladı.
  Güncel HEAD'deki doğrulanmamış post-checkpoint drift'in `.codex/config.toml` ile kendi MCP
  sözleşme testini bozduğu görüldü; `required=true` ve write-onay varsayılanı doğrulanmış
  checkpoint davranışına döndürüldü. `plans/reklamzeka-sistemi/v2` tarihsel ağacına dokunulmadı.
- Archive impact sözleşmesi `category-archive-impact/2.0.0` oldu. Tüm public JSONB kolonları
  sürümlü allowlist manifest'i ve runtime `pg_catalog` karşılaştırmasıyla sınıflandırılıyor;
  yeni/bilinmeyen kolon, malformed contract, unresolved category ref, promotion edge sapması,
  lifecycle bozukluğu veya ambiguous lineage coverage'i fail-closed kapatıyor.
- Aktif ve tarihsel dependency hesabı canonical semantic ref ile UUID-revision bağlı legacy
  promotion ref ailesini birlikte izliyor. Promotion template, AdvisedPractice ve budget
  contract'ları exact; category bağını geri çıkaramayan non-terminal action unit'leri workspace
  çapında conservative blocker. Preview deterministic `impactHash` taşır ve kendi başına hiçbir
  archive/action/Meta-write yetkisi vermez.
- Yeni cookie-only, same-origin `/api/category-authoring` lifecycle'ı yalnız dimension/definition
  create/revise/archive açar. Workspace/actor/role request body'den alınmaz; owner/admin publish,
  analyst/viewer read-only kalır. Assignment/mapping, approval, action ve Meta write authority
  yapısal olarak kapalıdır.
- Her mutation aktif workspace satırını `FOR UPDATE` kilitler; registry hash ve hedef version'ı,
  revise/archive için transaction içinde yeniden hesaplanan impact hash'i doğrular. Mutation,
  hash-chain audit fact'i ve etkilenen `category_resolution` component/version çiftlerinin
  append-only invalidation fact'leri aynı transaction'dadır; frozen context payload'ı update edilmez.
- Dashboard server authority'yi ayrı GET ile okur. Create/revise formları ve archive onayı yalnız
  tam coverage, sıfır exact/conservative/integrity blocker, eşleşen registry/target version ve
  güncel preview hash ile açılır; stale/hata preview'i geçersizleştirip state'i yeniden okur.
- Otomatik kanıt: hedefli 14 dosya/57 test; tam `npm test` 194 dosya/1.168 test; production
  `npm run build`; `npm run db:check`; `check:security-boundaries`; model/API boundary;
  secret-artifact kontrolü ve `npm audit --omit=dev` sıfır zafiyet. Secret-artifact kontrolü,
  taranabilir yerel secret yapılandırılmadığı için dürüst `SKIP` döndürdü.
- Browser kanıtı: gerçek Chromium localhost `/dashboard` → İç kategoriler akışında bağlantısız
  durum redakte `Kategori kaynağı kullanılamıyor` olarak fail-closed kaldı; 390/768/1440 px'te
  body `scrollWidth == clientWidth`. Console'da yalnız beklenen 503 kaynak yanıtları ve favicon
  404 vardı; client runtime/hydration hatası yoktu.
- Açık kabul kapısı: çalışma ağacında `.env.local`, `DATABASE_URL` ve `DIRECT_DATABASE_URL`
  bulunmuyor. Bu yüzden `verify:category-authoring-live`, category registry/inventory/effective
  health ve Supabase security verifier'ları DB'ye bağlanamadı; oturumlu create→revise→preview→
  archive browser happy-path'i koşulmadı. Devam komutu: güvenli `.env.local` geri yüklendikten
  sonra `npm run verify:category-authoring-live`; ardından `npm run verify:category-registry-db`,
  `npm run verify:category-inventory-live`, `npm run verify:category-effective-health-live` ve
  `npm run verify:supabase-security`, sonra aynı localhost akışının owner/admin ve rol negatifleri.

## 2026-08-08 — A09.1 gerçek Guidance Studio

- Dashboard'daki fixture talimat listesi ve yalnız React state'ine yazan sahte kayıt akışı
  kaldırıldı. `/api/guidance-studio` artık kalıcı registry, aktif iç kategori kataloğu ve
  gerçek loading/empty/conflict/unavailable durumlarını besliyor.
- Ham kullanıcı anlatımı `owner_statement` kaynağında korunuyor; ayrı guidance-only card ve
  global/account/objective/internal-category/entity/topic binding'iyle taslaklanıyor.
- Taslak revizyonu, publish ve archive fiziksel update/delete yerine kesintisiz immutable
  version üretiyor. Registry hash optimistic concurrency sağlıyor.
- Viewer read-only, analyst draft, owner/admin publish/archive rol sınırı var. Guidance hiçbir
  action/policy/approval/Meta-write yetkisi üretmiyor.
- Guidance revision ve hash-chain audit fact'i aynı PostgreSQL transaction'ında commit/rollback
  oluyor. Kararlı iç kategori public ref'i UUID revision'dan ayrıldı; exact revision frozen
  category context içinde kalıyor.
- Supabase acceptance: geçici izole workspace'te create→revise→publish→restart→archive,
  dört revision/dört audit olayı ve cleanup doğrulandı. Kanıt: 174 test dosyası/1.106 test,
  typecheck, DB check ve `scripts/verify-guidance-studio-postgres.ts`.
- Açık sonraki dilim: agent/Codex/Claude read tools + effective guidance preview/composer,
  publish/archive context invalidation, çoklu binding/set ve category CRUD/coverage yüzeyi.

## 2026-08-08 — A09.2 model-agnostic guidance context araçları

- Codex ve Claude aynı application contract üzerinden iki strict, salt-okur araç kazandı:
  `guidance_registry_list` preserved owner statement/source/card/scope kayıtlarını listeler;
  `guidance_effective_preview` explicit account, objective, internal category, entity, topic,
  timeframe ve opsiyonel budget bağlamından deterministic effective guidance pack üretir.
- Timeframe türü semantic `timeframe:<kind>` topic'i olarak resolution'a katılır. Pack scope,
  source, freshness, conflict ve context-budget izini korur; agent prompt enjeksiyonu, model
  çağrısı veya serbest workspace/header authority kullanmaz.
- Her iki aracın draft/publish/archive, policy, approval, action, persistence, execution ve
  Meta authority alanları yapısal olarak false'dur. Dashboard mutation yolu ile CLI read yolu
  ayrıdır; bearer-only local-session her çağrıda aktif membership ve exact `guidance:read`
  scope'uyla yeniden doğrulanır.
- MCP kataloğu 3 coordination + 15 safe application aracı olmak üzere exact 18 araca çıktı.
  PostgreSQL session allowlist constraint'i additive migration ile 15 araca genişletildi;
  77/77 public tabloda RLS ve API rollerinde sıfır table grant duruşu korundu.
- Canlı kabul hem registry read hem effective preview için gerçek localhost→PostgreSQL→STDIO
  zincirinde geçti; Codex discovery ve Claude connection doğrulandı. Açık sonraki dilim:
  publish/archive context invalidation ve analysis-run binding.

## 2026-08-08 — A09.3 guidance publish/archive context invalidation

- Guidance publish ve archive artık registry revision, audit fact ve effective-context
  invalidation fact'ini tek PostgreSQL transaction'ında yazar. Herhangi biri başarısızsa
  tamamı rollback olur; historical context payload'ları değiştirilmez veya silinmez.
- Invalidation yalnız önceki `guidance_registry` component version'ını kullanan context'lerle
  eşleşir. Publish `source_changed`, archive `source_removed` reason code'u taşır; draft create
  ve draft revise analize etkisiz oldukları için invalidation üretmez.
- Decision Room, budget proposal ve latest-valid context sorgularındaki mevcut component join'i
  yeni fact'i otomatik tüketir. Böylece eski pack yeniden kullanılamaz; historical replay ise
  payload ve invalidated işaretiyle denetlenebilir kalır.
- Canlı Supabase kabulü create→revise→publish→restart→archive akışında dört immutable revision,
  dört audit fact ve iki context invalidation fact doğruladı; final authority yine Meta-write false.
  Açık sonraki dilim: guidance'ın gerçek analysis-run assembly'sine frozen binding'i ve çoklu
  binding/set authoring.

## 2026-08-08 — A09.4 çoklu facet guidance authoring

- Guidance Studio tek kartı en fazla 12 scope binding ile oluşturabiliyor. Account, objective,
  iç kategori, entity ve topic facet'leri birlikte seçildiğinde resolver hepsini AND; aynı
  facet içindeki alternatif değerleri OR olarak deterministic değerlendiriyor.
- Global scope başka scope'larla karıştırılmaz; boş/tekrarlı binding, bilinmeyen kategori ve
  sınır aşımı fail-closed reddedilir. İlk taslakta binding sayısı belirlenir; mevcut append-only
  model nedeniyle taslak revizyonunda cardinality sabit tutulur, değer/mode/priority değişebilir.
  Cardinality değişikliği yeni kart olarak author edilir; sessiz binding silme yapılmaz.
- Dashboard her scope'u ayrı düzenleme grubu ve birleşik kapsam özetiyle gösterir. Çoklu binding
  registry, agent list ve effective preview tarafından aynı kaynaktan okunur; ilave policy,
  approval veya Meta-write authority doğurmaz.
- Canlı Supabase kabulünde internal-category + topic iki binding'i create→revise→publish→restart→
  archive boyunca korundu; iki invalidation ve dört audit fact de geçmeye devam etti.
- Browser güvenlik kabulünde capability cookie bulunmayan yeni sekme Guidance Studio'yu fail-closed
  kapalı gösterdi; secret/capability tarayıcıya enjekte edilmedi. Merkezi dashboard session bootstrap
  usability'si ayrı açık iş olarak korunur.

## 2026-08-08 — A14 Guidance Studio session recovery UX

- Guidance Studio runtime eksik, malformed veya süresi dolmuş cookie capability durumunu artık
  veri kaynağı/DB yapılandırma hatası gibi 503 göstermez. Redakte, authority-none bir
  `local_session_required` 401 sözleşmesi döndürür; gerçek repository/DB arızası 503 kalır.
- Dashboard bu durumu “Yerel oturum gerekli” olarak açıklar ve kullanıcıyı Decision Room'daki
  tek-kullanımlık capability bootstrap formuna taşır. Capability değeri URL, log, kaynak kodu,
  agent context'i veya browser otomasyonuna aktarılmaz.
- Browser kabulü yeni capability'siz sekmede Guidance Studio → session-required → Decision Room
  bootstrap yönlendirmesini doğruladı. Bu dilim session yetkisi üretmez ve auth sınırını gevşetmez.

## 2026-08-08 — A09.5 iç kategori envanteri ve doğrudan coverage

- Dashboard'a ayrı “İç kategoriler” görünümü eklendi. Aktif dimension/definition kataloğu,
  campaign→ad set→ad→creative seviyelerindeki doğrudan atama kapsamı, unmatched sayısı,
  source/operation dağılımı ve manuel kilitler aynı PostgreSQL read model'inden gösteriliyor.
- Bu projection `EffectiveCampaignContext` veya kalıtılmış kategori sonucu gibi sunulmuyor;
  yalnız doğrudan assignment ölçüyor. `disappeared_at` dolu Meta hedefleri pay/paydaya girmez,
  payda sıfırsa oran `null/veri yok` kalır.
- Kayıt sağlığı tanımsız aktif dimension, güncel hedefe ataması olmayan definition, kaybolmuş
  hedef assignment'ı ve arşivli registry kaydına bağlı aktif assignment'ı ayrı sayar.
- Erişim ayrı `category_registry:read` workspace/session scope'uyla cookie-only ve same-origin;
  yanıtta UUID/Meta external ID yoktur. Assign, archive, policy, approval, action ve Meta-write
  authority alanları yapısal olarak false'dur.
- Canlı Supabase verifier bağlı workspace'te dürüst empty-state döndürdü ve 0 DB/Meta write
  kaydetti. 180 test dosyası/1.122 test, production build, 77/77 RLS, sıfır API table grant,
  secret taraması ve capability'siz browser recovery akışı geçti.
- Açık sonraki dilim: assignment evidence/low-confidence/conflict ve archive-impact preview;
  ardından rol+audit+optimistic concurrency+context invalidation bağlı category authoring.

## 2026-08-08 — A09.6a kategori kanıt ve güven sağlığı

- Category Inventory sözleşmesi v1.1'e çıktı. Definition bazında ham evidence ref'lerini
  dışarı vermeden kanıt kayıt sayısı, güvenli kind dağılımı, observed-at bulunan assignment
  sayısı ve malformed evidence sayısı gösteriliyor.
- Confidence, minimum ve ortalama basis-point ile deterministic toplanıyor. Sürümlü
  `category-classification-review/1.0.0` `%70` eşiği yalnız `review_signal_only`; otomatik
  kategori ataması, policy, action veya Meta-write kararı üretmiyor. Owner-configurable eşik
  daha sonraki category profile/authoring diliminde gelecek.
- SQL yalnız aktif dimension/definition/assignment ve explicit workspace predicate kullanıyor;
  raw evidence ref, internal UUID ve external Meta ID response/DOM'a çıkmıyor. Evidence kind
  yalnız dar semantic slug biçimindeyse projekte ediliyor; diğerleri sağlık uyarısı sayılıyor.
- Repository projection testleri 6999/7000 eşik semantiğini, public redaction ve sıfır payda
  `null` davranışını kapsıyor. Canlı bağlı workspace verifier 0 DB/Meta write ile geçti.
- İki salt-okur audit sonucunda sonraki iş ikiye ayrıldı: resolver tabanlı portföy effective
  conflict taraması ve dependency güven sınıflı archive-impact preview A09.6b; archive
  mutation/rol/audit/invalidation ise A09.7. `archiveDimension` child kayıt varken bugün
  güvensiz olduğundan authoring yüzeyi bu preview ve blocker guard gelmeden açılmayacak.

## 2026-08-08 — A09.6b structured conflict ve archive-impact preview

- Category resolver tek `resolveEffectiveCategoryCore` çekirdeğinde kaldı; yeni salt-okur
  `inspectEffectiveCategory` aynı algoritmadan `applied`, `unmatched` veya `parked_conflict`
  ve stable reason code döndürüyor. Eski throwing resolver davranışı geriye uyumlu korundu.
- Parent add + child add single conflict, child override, multi inheritance, unmatched ve
  manual-lock automatic override/add/deny senaryoları reason-bazlı testlerle mühürlendi.
- `/api/category-archive-impact` yalnız canonical `dimension_*`/`category_*` public ref,
  cookie-bound aynı-origin `category_registry:read` capability ve exact preview intent kabul
  ediyor; raw UUID/workspace header/query ve bearer reddediliyor.
- Preview active child definition/assignment/manual lock; current guidance; exact promotion
  binding; autonomy/guardrail ref; effective context/invalidation ve bağlı tarihsel budget
  proposal sayılarını workspace-scoped okuyor. Bağımlılıklar `exact_relational`,
  `exact_contract_ref`, `partial_or_unknown` olarak ayrılıyor.
- İlk sözleşmede `coverage.complete=false` ve `archiveAllowed=false` yapısal sabit. Dashboard
  yalnız “Arşiv etkisi—işlem yapılmadı” paneli gösteriyor; archive düğmesi, audit, invalidation
  yazımı, category mutation veya Meta çağrısı yok.
- Canlı Supabase rollback acceptance iki definition, bir manual-locked assignment üzerinde
  exact blocker sayılarını doğruladı; geçici satırlar commit edilmedi, cleanup temiz ve Meta
  network/write sıfır kaldı. Açık A09.6c: canlı hierarchy batch material ile bounded portföy
  effective-conflict scan; ardından dependency coverage'i tamamlayıp A09.7 mutation guard'ına bağlama.

## 2026-08-08 — A09.6c portföy effective kategori sağlık taraması

- Mevcut effective resolver'ı kopyalamadan kullanan saf, indeksli scanner; aktif dimension/definition/assignment
  materialini canlı campaign→ad set→ad→creative hierarchy path'leri üzerinde değerlendirir. Yeniden kullanılan
  kreatif her tam parent yolu için ayrı değerlendirilir; çıktı yalnız public dimension key/ref, aggregate
  `applied/unmatched/parked_conflict` ve stable reason dağılımı taşır.
- Tarama 20.000 hierarchy path ve 100 dimension hard cap'ine sahiptir. Sınır aşımı typed `capacity_exceeded`
  ile fail-closed olur; dashboard eksik sonucu tamamlanmış gibi göstermez. Raw UUID, Meta entity ID veya evidence
  ref API/UI yanıtına girmez.
- Cookie-only, same-origin, exact-intent `/api/category-effective-health` boundary'si mevcut
  `category_registry:read` principal'ını kullanır ve bütün write/approval/policy authority alanlarını false tutar.
  Dashboard salt-okur aggregate sağlık, değerlendirme temeli ve kapasite davranışını açıkça gösterir.
- Unit/HTTP/repository testlerine ek olarak canlı PostgreSQL rollback kabulü non-empty hierarchy üzerinde iki
  path/two applied evaluation doğruladı; geçici satır commit edilmedi, Meta network/write ve database write sonucu
  sıfır kaldı. Gerçek bağlı workspace registry'si şu anda boş olduğundan bağımsız canlı read verifier 0/0 temiz
  sonucu verir.
- Açık A09.6d/A09.7 kapısı: archive preview'in partial/unknown dependency ailelerini tamamlamak; ardından rol/audit,
  optimistic concurrency ve category-resolution invalidation ile mutation authoring'i açmak. Archive authority
  bu coverage tamamlanana kadar kapalıdır.

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
- Guidance advisory-only kalır: `block` veya `review_required` dili preflight'ta yalnız insan incelemesi
  gerektiren `unknown` sonuç üretir. Hard block/confirmed uyumluluk ancak açıkça yayınlanmış typed policy,
  reviewed compatibility catalog ve deterministik evidence tarafından üretilebilir.

## 2026-08-07 — S5.4c1 autonomy rule registry çekirdeği

- Mevcut saf autonomy valve ile aynı scope/mode sözleşmesini kullanan `AutonomyRuleArtifact` eklendi.
  Workspace, account-group, account, internal-category, campaign, entity ve action-type kapsamları;
  `denied`, `approval_only`, `policy_limited`; effective/expiry, kill-switch ve run-cap alanları canonical
  hash'e bağlıdır. Draft/published/disabled revision'ları değişmez ve sıra atlayamaz.
- Analyst normalized draft hazırlayabilir; yalnız owner/admin açık decision/reason ref'iyle publish veya
  disable edebilir. Guidance ref'leri sadece provenance'dır; artifact ve repository guidance promotion,
  approval grant, execute veya Meta transport yetkisi taşımaz. Ham/free-text talimat action context'e
  sokulmaz; özgün metin mevcut guidance source/card yaşam döngüsünde kalır.
- PostgreSQL repository aktif workspace row lock altında exact replay'i `unchanged` döndürür; revision,
  transition, corrupt store, inactive workspace ve cross-tenant workspace ref hatalarını fail-closed
  reddeder. Resolver draft'ları dışarı çıkarmaz ve action valve'a yalnız published/disabled typed rule verir.
- Yeni tablo forced RLS, API role revoke, append-only UPDATE trigger, payload/authority/provenance CHECK'leri
  ve kontrollü tombstone purge kapsamına sahiptir. Polymorphic opaque scope ref'lerinin account/campaign/
  entity relational ownership'u registry'de FK ile kanıtlanmaz; action-context materializer exact tenant
  mirror üzerinden yeniden doğrulamak zorundadır.
- Migration bağlı Supabase'e uygulandı. Canlı güvenlik sonucu 67/67 tabloda RLS, API rollerinde sıfır tablo
  grant'i, sıfır schema-create ve sıfır public routine-execute grant'idir; henüz hiçbir autonomy rule kaydı
  veya business/Meta mutation oluşturulmadı.

## 2026-08-07 — S5.4c2-A kanonik Meta inventory materializer

- Campaign, ad set ve ad Graph sayfaları strict field-catalog sürümüyle L1 kanonik kayıtlara çevrilir.
  Hiyerarşi, tenant ve connection/account kapsamı PostgreSQL yazımından önce yeniden doğrulanır; ham Graph
  payload'ı saklanmaz, yalnız bounded alanlar, reasoned-unknown listesi, kaynak revision/priority ve hash
  provenance'ı tutulur. Objective mapping ve creative referansı kanıt yoksa uydurulmaz.
- Sayfa yazımı cursor/checkpoint ilerlemesinden önce ve kısa transaction içinde gerçekleşir. Meta
  `updated_time` kanıtı fetch-time fallback'ten yüksek önceliklidir; replay/stale sayfa daha güvenilir
  canonical veriyi ezemez. Disappearance yalnız terminal pagination sayfasında, aynı gözlem run'ında hiç
  görülmeyen ve daha yeni fetch'e ait olmayan nesneler için işaretlenir.
- Persistence veya doğrulama hatası redakte edilmiş, retry edilmeyen slice hatasıyla fail-closed kalır ve
  cursor ilerlemez. Entegrasyon opsiyonel port olarak hazırdır; repoda production sync factory olmadığı için
  canlı runtime wiring/sync yapılmadı. Bu dilim compatibility'yi doğrulamaz, Meta network write içermez ve
  proposal materializer'ı açmaz.

## 2026-08-07 — S5.4c1-A Autonomy Studio read + normalized draft

- Dashboard ve cookie-only API artık draft/published/disabled autonomy revision feed'ini public-safe
  gösterir. Viewer okuyabilir; owner/admin/analyst yalnız normalize draft oluşturabilir. Workspace,
  principal, rol ve sıradaki revision sunucuda belirlenir; ham talimat metni Guidance Registry'de kalır.
- Kapsam, mode, effective/expiry, kill-switch, run cap ve guidance provenance ref'leri draft artifact'e
  bağlanır. İstemciden workspace/revision/role/raw-text veya authority enjeksiyonu reddedilir; canonical
  hash, actor/decision/reason ve credential HTTP cevabına çıkmaz.
- Bu yüzeyde publish, disable, approve, execute, approval grant veya Meta write kontrolü yoktur. Yayınlama
  için ayrı owner/admin insan-varlığı ve açık karar akışı hâlâ gereklidir.

## 2026-08-07 — S5.4c3-A/B reviewed compatibility ve typed post source

- Existing-post action artık `organic_post_binding` ile `existing_ad_binding` kaynaklarını ayırır. Organik
  gönderi; source, post identity ve object-story kanıt hash'leriyle dondurulur, creative kimliği veya
  creative üretimi gerektirmez. Eski creative-binding girdisi gerçek ref'i varsa kontrollü adapte edilir;
  eski action payload'ında olmayan ref asla sentezlenmez. Preflight/proposal public sözleşmesi v2'dir.
- Destination, optimization, placement, special-category ve tracking için tek generic fakat typed,
  append-only compatibility artifact registry eklendi. Draft→reviewed→published→tombstoned zinciri owner/
  admin review ve publish kanıtına bağlıdır; mapping ve selection evidence revision/hash ile birbirine
  bağlanır. Boş, eksik, stale, conflict, tombstoned veya review süresi dolmuş kanıt `unknown` kalır.
- Registry hiçbir gerçek mapping/policy/allowed seed içermez ve action, approval, policy ya da Meta-write
  yetkisi vermez. PostgreSQL katmanı forced RLS, API revoke, lifecycle/payload CHECK'leri ve tombstone purge
  kapsamındadır. Migration bağlı Supabase'e uygulandı; canlı kontrolde 68/68 tablo RLS, API rollerinde sıfır
  tablo grant'i, sıfır schema-create ve sıfır public routine-execute grant'i doğrulandı. Sıradaki dilim
  selection evidence'ı kanonik private proposal materializer'a bağlamaktır.

## 2026-08-07 — S5.4c2-B/C/D production read composition ve reviewed proposal policy

- Production salt-okunur sync composition noktası canonical inventory writer ile durable cursor store'u
  aynı runtime'a enjekte eder. Workspace, connection, account ve secret caller girdisi değildir; trusted
  server scope portundan ve tenant-bound DB bağlarından çözülür. Güvenilir scheduler/route principal'ı henüz
  olmadığı için public inventory GET'i DB-yazan sync'e çevrilmedi ve canlı sync tetiklenmedi.
- Existing-post canonical submitter exact 10 ref'i yeniden çözer; template/preset/binding, post/source,
  ad-set ve campaign snapshot hash'lerinden ayrı evidence selection hash üretir. Beş compatibility boyutu
  exact published/fresh evidence ile confirmed değilse veya trusted approval/protection/autonomy materyali
  eksikse queue write sıfırdır. Submitter live route'a bağlı değildir ve `material_unavailable` kalır.
- ApprovalPolicy için append-only, hash-linked ve düzenlenebilir definition registry eklendi. Draft→publish,
  published/disabled→new draft→publish ve published→disabled revision'ları; exact K4 existing-post rol/SoD/
  grant-consumer/lifetime payload'ı ve ayrı publish/disable kanıtı taşır. Resolver tüm zinciri doğrular,
  draft'ı authority saymaz ve yalnız exact-one active published policy döndürür; hiçbir policy seed edilmedi.
  Migration Supabase'e uygulandı; canlı kontrolde 69/69 tablo RLS ve API rollerinde sıfır tablo grant'i,
  sıfır schema-create ve sıfır public routine-execute grant'i doğrulandı.
- Queue ApprovalPolicy snapshot'ı artık source definition kimliği ve canonical hash'iyle reviewed registry
  revision'ına exact tenant-bound composite FK üzerinden bağlıdır. K4 existing-post yeni proposal yazımı aynı
  transaction içinde tüm definition zincirini doğrular; arbitrary, cross-tenant, ambiguous, draft, disabled,
  expired veya kaynaksız policy zero-write fail-closed kalır. Canlı migration öncesinde ilgili iki tabloda da
  kayıt olmadığı salt-okunur sayımla doğrulandı; tarihsel exact replay yalnız hiçbir yeni kayıt üretmeyen
  `unchanged` yolunda korunur. 137 test dosyasında 819 test, production build, security/secret ve Drizzle
  kontrolleri geçti. Migration bağlı Supabase'e uygulandı; canlı kontrolde 69/69 tablo RLS ve API
  rollerinde sıfır tablo grant'i, sıfır schema-create ve sıfır public routine-execute grant'i doğrulandı.
- Bir sonraki zorunlu kapı: trusted action guardrail/protection policy kaynağını ve saf resolver'ını kurmak,
  proposal expiry kaynağını çözmek ve ancak ardından private submitter'ı route'a takmaktır.

## 2026-08-07 — S5.4c2-E güvenli scheduled Meta read-sync worker çekirdeği

- Periyodik salt-okunur Meta mirror için aday kapsamı local session veya env workspace'ten değil, yalnız
  DB-derived aktif workspace+connection schedule portundan alan bounded worker eklendi. Her logical fire
  atomik claim/lease ister; claim sonrasında exact connection revision ve timeframe yeniden doğrulanır.
- Fire ve parent-run kimliği deterministiktir. Eşzamanlılık, batch, retry/backoff ve lease süreleri üstten
  sınırlıdır; bağlantı hataları birbirinden izole edilir. Public sonuç yalnız hashlenmiş ref, allowlisted
  reason code ve aggregate count taşır; token, Meta ID, DB ID veya provider hata metni taşımaz.
- Çekirdek action authority vermez ve Meta write çağrısı yapmaz. DB schedule/lease adapterı, per-connection
  secret binding, account bootstrap, `after_sync` outbox ve scheduler aktivasyonu bilinçli olarak açık
  bırakıldı. 138 test dosyasında 825 test, production build, security/secret ve Drizzle kontrolleri geçti.

## 2026-08-07 — S5.4c3-F action guardrail + ProtectionResolver domain çekirdeği

- Account, campaign, entity, internal kategori ve bölge kapsamlarını action type ile birleştiren typed selector;
  `deny_action`, para birimli mutlak/oransal `budget_delta_limit` ve kategori/bölge için `fixed|no_outflow`
  bütçe koruma clause'ları eklendi. Lifecycle hash-linked draft→publish, revise→publish ve disable zinciridir;
  yalnız owner/admin publish/disable edebilir, guidance ref'leri provenance dışında authority taşımaz.
- Saf ProtectionResolver bütün revision zincirini, effective/expiry durumunu, exact kapsam örtüşmesini, clause
  çakışmasını, kategori/bölge kanıtını ve bütçe limitini fail-closed çözer. Yalnız aktif published coverage
  `allowed` üretebilir; eksik limit/evidence `unresolved`, deny/limit/protected-budget ihlali `denied` olur.
  Policy-set, evidence hash'leri ve normalize edilmiş action/evidence bağlamı canonical resolution hash'ine
  bağlıdır. Registry persistence, authentic category/affected-geo evidence materializer ve submitter wiring
  bir sonraki ayrı dilimdir; gerçek kural veya izin seed edilmemiştir.

## 2026-08-08 — S5.4c3-G guardrail registry ve authentic protection evidence sınırı

- ActionGuardrailPolicy için tenant-bound, append-only PostgreSQL revision registry ve Drizzle repository
  eklendi. Repository aktif workspace kilidi altında contiguous hash/lifecycle zinciri yazar; çözümlemede
  state filtresi kullanmadan tüm chain'i okuyup saf resolver'a verir. Forced RLS, Data API revoke, UPDATE
  engeli, canonical payload/lifecycle/authority CHECK'leri ve tombstone purge kapsamı migration'a bağlıdır.
- Server-private protection evidence materializer exact workspace/account/campaign/entity scope, freshness,
  source revision ve snapshot hash'lerini deterministic evidence hash'ine bağlar. Caller scope extension,
  missing/ambiguous/stale/cross-tenant/empty kaynak ve port arızası ayrı reason code'larla fail-closed kalır;
  approve/execute/Meta-write/grant capability'lerinin tamamı false'dur.
- Mevcut versioned category assignment + frozen effective context internal kategori için authoritative kaynaktır.
  Buna karşılık `meta_ad_sets.targeting_summary`, opaque targeting signature, audience preset, guidance veya
  serbest metin tek başına “fiilen etkilenen bölge” kanıtı değildir. Canonical affected-geo snapshot fact'i
  revision/source hash'iyle persist edilene kadar production geo adapter yazılmayacak ve sonuç `unknown`
  kalacaktır. Hiçbir gerçek guardrail/policy değeri seed edilmedi.
- Production AuthenticCategoryEvidence adapterı mevcut active-workspace effective-context loader ile frozen/current
  category replay resolver'larını yeniden kullanır. Exact account/campaign/entity/time window, ready/no-blocker,
  invalidation, path ve resolution hash eşitliği olmadan aday üretmez. Public category ref'i label, isim veya serbest
  key metni değildir; dimension+definition semantic key çiftinin deterministic digest'idir. Source context,
  resolution ve component revision/hash zincirleri evidence materializer'a taşınır.
- Bounded GET-only targeting shape canary mevcut token ve Graph `v23.0` ile çalıştı: iki logical/fiziksel GET,
  en fazla üç AdSet ve sıfır write çağrısı. Üç örnekte de `targeting.geo_locations.countries` string-array
  şekli görüldü; değerlerin hiçbiri loglanmadı veya saklanmadı. Region/city/custom-location ve excluded-geo
  bu örnekte bulunmadığı için bu şekiller doğrulanmış sayılmaz ve fail-closed `unknown` kalır.
- Redakte canary'nin ikinci kabulünde üç örneğin tamamında `home` ve `recent`, sıfır `travel_in`, sıfır
  tanınmayan ve sıfır geçersiz location-type görüldü; yine sıfır Meta write çağrısı yapıldı. Buna dayanarak saf
  canonical normalizer yalnız exact included-country + benzersiz `home/recent` biçimini kabul eder. Ülke değerleri
  type-namespaced digest ref'lerine dönüşür; exact scope, Graph/catalog sürümü, gözlem/slice/page ve raw/subtree
  hash provenance'ı snapshot kimliğine bağlanır. Region/city/custom/exclusion/travel, source extension, hash
  uyuşmazlığı veya kısmi veri bütün snapshot'ı `unknown` yapar; sonuç approve/execute/write/grant authority taşımaz.
- Bu normalizer henüz production inventory field catalog'una veya immutable PostgreSQL snapshot/item registry'sine
  bağlı değildir. Dolayısıyla production affected-geo evidence halen `unknown` kalır; bu saf sınır gerçek bir
  kampanya kuralı, hedefleme seçimi ya da Meta yazma yetkisi oluşturmaz.
- S1.4 canlı kabul paketi yeniden geçti: 5 hesap, 79 asset/79 edge, 1.179 linked post/media ve örneklenen
  30 reklamın 30'unda copy+post identity; iki hesaplı persistence kabulünde 6 copy/post binding, 4 creative,
  6 binding ve 3 durable checkpoint doğrulandı. Meta write network çağrısı her iki kabulde de `0`dır.
- Tam kapı: 142 test dosyasında 861 test, production build, security/secret ve Drizzle kontrolleri geçti.
  Migration bağlı Supabase'e uygulandı; canlı kontrolde 70/70 tablo RLS ve API rollerinde sıfır tablo
  grant'i, sıfır schema-create ve sıfır public routine-execute grant'i doğrulandı. Rollback'li canlı
  PostgreSQL kabulünde draft→published append, restart-durable resolve ve UPDATE append-only trigger'ı
  geçti; geçici workspace/policy satırlarının tamamı temizlendi.

## 2026-08-08 — S5.4c3-H immutable affected-geo registry ve scheduler production boundary

- Canonical affected-geo için tenant-composite Meta hierarchy FK'li immutable snapshot header, hash-only country
  item ve ayrı verified `home/recent` location-type tabloları eklendi. Exact Graph/catalog/capture zamanı ile
  observation/slice/page/raw/subtree/snapshot hash provenance'ı saklanır; ülke kodu/adı, adres, koordinat, serbest
  metin veya raw targeting persist edilmez. Eksik/kısmi/bozuk/ambiguous/cross-tenant child zinciri fail-closed'dur.
- Private inventory extraction boundary raw AdSet payload hash'ini doğrular; workspace/connection/account/campaign/
  adset ile run/slice/cursor/page kimliklerini typed digest ref'lere çevirir. Yalnız verified `v23.0` exact country
  + `home/recent` şekli known olur. Ham Meta ID veya targeting çıktı sözleşmesine taşınmaz ve tüm authority false'dur.
- Meta read-sync scheduled worker için server-derived sabit scope'lu production service factory ve typed/redakte
  retry classifier eklendi. Caller workspace/account/token ekleyemez; route, cron, gerçek network veya Meta write
  aktivasyonu yoktur. DB schedule registry/lease adapterı halen sonraki ayrı dilimdir.
- Migration generator'ın composite FK'den önce gerekli unique indexi üretmemesi ilk canlı uygulamayı atomik olarak
  durdurdu; hiçbir tablo/satır kısmi kalmadı. Bağımlılık sırası regresyon testiyle düzeltildikten sonra migration
  uygulandı. Canlı güvenlik kabulü 73/73 tabloda RLS, API rollerinde sıfır tablo grant'i, sıfır schema-create ve
  sıfır public routine-execute grant'i gösterdi. Rollback'li PostgreSQL kabulünde insert, idempotent replay,
  restart-durable exact resolve ve append-only UPDATE reddi geçti; geçici satırların tamamı temizlendi.
- Tam kapı: 149 test dosyasında 941 test, production build, security/secret ve Drizzle kontrolleri geçti. Production
  Graph field catalog/runtime persistence ve AuthenticAffectedGeoEvidence wiring yapılmadığı için gerçek proposal
  akışında geo kanıtı halen fail-closed `unknown`; hiçbir kural/policy/approval veya Meta writer etkinleşmedi.

## 2026-08-08 — S5.4c3-I Graph→geo evidence ve durable scheduled-sync wiring

- Inventory field catalog `2.0.0` oldu ve `targeting` yalnız AdSet Graph GET alanlarına eklendi. Ham targeting
  canonical AdSet tipine, generic ledger'a, `targetingSummary`/provenance'a, loga veya public çıktıya taşınmaz;
  yalnız raw payload hash'e bağlı private extraction çağrısında yaşar. Known ve stale olmayan snapshotlar canonical
  page transaction'ı içinde immutable geo repository'ye yazılır; hierarchy/hash/repository hatası sayfa+checkpoint'i
  rollback eder, unsupported geo ise sync'i bozmadan evidence üretmez.
- Gerçek Drizzle affected-geo scope resolver active workspace ve exact workspace/account/campaign/adset ref'leri,
  freshness penceresi, Graph/catalog ve source/snapshot hash'leriyle en yeni en fazla iki identity okur. Tek authentic
  snapshot hash-only geo evidence üretir; missing/stale/corrupt/cross-tenant veya iki aday ambiguity olarak fail-closed
  kalır. Internal UUID, raw Meta ID, targeting ve ülke değeri public evidence'e çıkmaz; authority tamamen false'dur.
- Daily Meta read-sync schedule ve run/lease tabloları active workspace + active `read_only` connection lifecycle
  generation'ına bağlandı. Registry due timeframe'i DB'den türetir; lease adapter deterministic fire/scope hash,
  row lock, token-bound complete/fail, duplicate suppression, expired retry ve beş-attempt cap uygular. Terminal
  sonuç cursor'ı aynı transaction'da bir gün ilerletir. Forced RLS/API revoke vardır; schedule seed'i, cron, route,
  network veya Meta writer aktivasyonu yoktur.
- Canlı migration sonrası güvenlik yüzeyi 75/75 RLS, API rollerinde sıfır tablo grant'i, sıfır schema-create ve sıfır
  public routine-execute grant'i olarak geçti. Rollback'li schedule kabulünde due/claim, yanlış token reddi, complete,
  cursor advance ve duplicate-completed doğrulandı; geçici satır kalmadı. İki hesaplı S1.4 kabulü 70 GET/sıfır write
  ile yeniden geçti. Ayrı bounded Graph→DB kabulünde iki GET/sıfır write ile üç gerçek AdSet, üç immutable geo
  snapshot ve üç hash-only item yazıldı; raw-targeting kolonu sıfır kaldı ve geçici workspace silindi.
- Tam kapı: 153 test dosyasında 974 test, production build, security/secret ve Drizzle kontrolleri geçti. Sonraki
  kapı reviewed ApprovalPolicy + AutonomyRule + ActionGuardrail/protection composition ve ayrı proposal-expiry
  kaynağıdır. Kullanıcı değeri uydurulmadı; gerçek policy/expiry seed'i ve Meta writer hâlen yoktur.

## 2026-08-08 — S5.4c3-J proposal lifetime policy ve private scheduler tick

- Reviewed `ApprovalPolicy`, grant ömründen bağımsız ve zorunlu `maximumProposalLifetimeSeconds` alanı kazandı.
  Değer 1–604.800 saniye aralığında exact/canonical policy payload'ına, policy hash'ine, queue snapshot'ına ve
  proposal staging kontrolüne bağlıdır. Existing-post submitter ayrıca mevcut yedi günlük üst sınırı korur;
  proposal zaman penceresi reviewed policy değerini aşarsa queue write oluşmaz.
- Migration hiçbir varsayılan süre, seed veya otomatik backfill üretmez. Policy revision veya queue policy snapshot
  tablosunda önceden satır varsa açıkça durur ve yeni reviewed revision ister. Canlı uygulama öncesi her iki tablo
  boş doğrulandı; migration sonrasında rollback'li proposal/decision kabulü insert, exact replay, immutability,
  policy snapshot doğrulaması ve temizliği Meta/execution çağrısı olmadan geçti.
- Scheduled Meta read-sync için caller'ın workspace, connection, account, token veya port enjekte edemediği private
  Drizzle tick composition'ı eklendi. Registry, lease, server-derived service factory ve retry classifier yalnız
  server boundary içinde kurulur; sonuç `actionAuthority=none` ve `writeNetworkCalls=0` değilse reddedilir. Public
  route, cron ve scheduler principal hâlen yoktur; bu bileşen kendi başına zamanlanmış işi başlatmaz.
- Canlı güvenlik yüzeyi migration sonrasında 75/75 RLS, API rollerinde sıfır tablo grant'i, sıfır schema-create ve
  sıfır public routine-execute grant'i olarak kaldı. Tam kapı 155 test dosyasında 986 test, production build,
  architecture/security/secret ve Drizzle kontrolleriyle geçti.
- Sonraki güvenli kapı; gerçek reviewed ApprovalPolicy, AutonomyRule, ActionGuardrail/protection ve authentic
  category/affected-geo kanıtlarını tek production `ExistingPostPromotionPolicyPort` içinde fail-closed çözmektir.
  Hiçbir gerçek policy değeri yayınlanmadı ve production Meta writer kapalıdır.

## 2026-08-08 — S5.4c3-K existing-post policy composition çekirdeği

- Existing-post preflight ve protection evaluation artık tek exported canonical action builder/hash fonksiyonunu
  kullanır. Post/source binding, template/preset version, destination, budget plan ve timeframe alanlarından biri
  değişirse guardrail'in değerlendirdiği hash ile queue action hash'i birlikte değişir; paralel builder sapması yoktur.
- Server-private `ExistingPostPromotionPolicyAdapter`; active membership→requester rolünü, exact-one reviewed
  ApprovalPolicy'yi, exact scope'lu published AutonomyRule'ları, authentic category/affected-geo evidence'i ve
  guardrail ProtectionResolution'ı birleştirir. Viewer, cross-tenant material, eksik freshness, active workspace
  approval-only kuralının yokluğu, kill switch, denied/unresolved veya kanıtsız guardrail sonucu `null` döner.
- Proposal expiry; reviewed maximum proposal lifetime ve yedi günlük teknik cap yanında approval definition,
  uygulanan active autonomy rules, eşleşen guardrail policy revisions ve template binding bitişlerinin en erkenine
  kırpılır. Approval source ve guardrail policy evidence artık server-private expiry metadata'sı taşır; protection
  context'i immutable resolution hash ref'iyle plan hash'ine bağlanır.
- Freshness değeri için varsayılan üretilmedi: adapter authoritative `resolveNotBefore` portu ister. Drizzle factory,
  route ve dashboard persistence bağlantısı bu kaynağın reviewed configuration/registry modeli kurulana kadar
  kapalıdır. Gerçek policy/rule/guardrail seed'i, approval yetkisi, execution veya Meta writer eklenmedi.
- Tam kapı 156 test dosyasında 994 test, production build, architecture/security/secret ve Drizzle kontrolleriyle
  geçti. Sonraki dilim authoritative evidence-freshness configuration, request-bound Drizzle composition ve ancak
  sonra dashboard proposal POST→queue E2E'dir.

## 2026-08-08 — S5.4c3-L reviewed freshness ve request-bound proposal route

- Protection evidence freshness yeni bir registry açmadan reviewed ApprovalPolicy içine zorunlu
  `maximumProtectionEvidenceAgeSeconds` alanı olarak bağlandı. Exact/canonical policy hash'i ve queue snapshot'ı
  1–604.800 saniye aralığını zorunlu kılar; proposal/grant lifetime'dan bağımsızdır. `notBefore`, evaluatedAt'ten
  bu reviewed süre çıkarılarak server içinde türetilir; request/model/template/preset freshness enjekte edemez.
- Migration policy/queue tablolarında önceden satır varsa otomatik backfill yerine durur; seed/default yoktur. Canlı
  tablolar boşken uygulandı. Ardından 75/75 RLS ve sıfır API table grant/schema-create/public routine-execute yüzeyi
  ile proposal/decision insert, replay, immutability ve rollback temizliği geçti; Meta ve execution çağrısı sıfırdı.
- Request-bound Drizzle submitter; canonical material resolver, published compatibility registry, reviewed policy,
  autonomy, authentic category/geo evidence, guardrail resolver ve append-only proposal queue'yu tek server
  composition'da kurar. Membership ile principal workspace/user eşleşmezse daha repository kurulmadan reddedilir;
  composition approval/grant/execution/Meta transport metodu sunmaz.
- Cookie-only proposal-draft route artık placeholder yerine bu gerçek composition'ı kullanır. Mevcut durumda gerçek
  published ApprovalPolicy/AutonomyRule/Guardrail/compatibility seti seed edilmediği için canlı öneri yine fail-closed
  503/sıfır queue kalır. Route yalnız bütün reviewed materyal ve evidence mevcutsa append-only approval proposal
  oluşturabilir; approve/execute veya Meta write yapamaz.
- Tam kapı 158 test dosyasında 1003 test, production build, architecture/security/secret ve Drizzle kontrolleriyle
  geçti. Sonraki ürün dilimi policy/rule/guardrail oluşturma-yayınlama stüdyosu ve örnek bir kullanıcı-reviewed
  K4 policy bundle ile dashboard proposal→satır-bazlı approval E2E kabulüdür.

## 2026-08-08 — S5.4c3-M draft-only K4 Policy Bundle Studio

- Autonomy Studio içine ayrı K4 Policy Bundle sekmesi eklendi. ApprovalPolicy ve ActionGuardrail revision
  registry'leri aynı server-private okuma servisine bağlandı; public projeksiyonda canonical/policy hash, actor,
  karar kimliği, internal UUID, Meta ID ve raw targeting bulunmaz. Viewer yalnız okuyabilir; owner/admin/analyst
  immutable draft oluşturabilir. Publish, disable, action approve, grant, execute ve Meta-write authority'lerinin
  tamamı kapalıdır.
- ApprovalPolicy formu K4 + `approval_only` applicability'sini sabitler; rol, separation-of-duties, evidence,
  proposal ve grant sürelerini kullanıcıdan açıkça ister. Hiçbir business değer, süre veya rol otomatik doldurulmaz.
  Guardrail formunda account ve ad set yalnız server kataloğundan seçilir; campaign ad set kaydından türetilir,
  internal kategori yine katalogdan seçilir. Geo serbest metni ve caller workspace/revision/authority alanları
  reddedilir. Aynı policyRef için açık draft varsa overwrite yerine fail-closed conflict oluşur.
- Readiness görünümü active/effective exact-one ApprovalPolicy ve Guardrail, zaman penceresi içinde published
  workspace `approval_only` autonomy kuralı ve proposal-anında authentic evidence koşullarını ayrı gösterir.
  Expired/future, birden çok aktif policy veya viewer draft yetkisi yanlışlıkla `READY` üretmez. Henüz gerçek
  kullanıcı-reviewed policy, autonomy, guardrail veya compatibility bundle yayınlanmadığı için production proposal
  zinciri `NOT READY` ve Meta writer kapalı kalır.
- Repository revision feed ve latest sorguları DB tenant filtresine ek olarak artifact workspace/policy bağını
  yeniden doğrular. Canlı Supabase kabulü 75/75 RLS, sıfır API table grant/schema-create/public routine-execute ile
  geçti. Guardrail rollback kabulü draft→published append, restart durability, append-only UPDATE reddi ve sıfır
  Meta/execution çağrısını doğruladı. Tam kapı 160 test dosyasında 1014 test, production build,
  architecture/security/secret ve Drizzle kontrolleriyle geçti. In-app browser localhost URL politikası görsel
  tıklama kabulünü engelledi; responsive/browser E2E açık iş olarak korunuyor.

## 2026-08-08 — S5.4c3-N insan-onaylı policy yayını ve selection-bound preflight

- ApprovalPolicy ve ActionGuardrail immutable draft'ları owner/admin için ayrı macOS insan-varlığı töreniyle
  yayınlanabilir hale geldi. Kanıt 10–120 saniye ömürlü, process-local ve tek kullanımlıdır; workspace, actor,
  policy türü/ref'i, draft revision'ı ve canonical içerikten türetilen opaque unit'e bağlıdır. Bearer/proxy,
  caller workspace/revision/authority/hash enjeksiyonu ve stale draft fail-closed reddedilir.
- Dashboard yalnız töreni başlatma yetkisini gösterir; `canPublish`, action approve, grant, execute ve Meta-write
  her cevapta kapalı kalır. Server son immutable draft'ı yeniden okur ve yalnız bir sonraki append-only published
  revision'ı yazar. Hiçbir gerçek business policy değeri seed edilmedi veya yayınlanmadı.
- Model-agnostic agent için aynı Policy Bundle Studio kaynağını kullanan tek `policy_bundle_read` aracı eklendi.
  Dashboard üyelik görünümü agent çıktısına authority olarak taşınmaz; agent-specific read-only authority bütün
  mutation ve Meta yetkilerini false tutar.
- Public preflight ve proposal draft recheck, exact request selection + immutable template/preset/binding/post/ad-set/
  campaign materyal hash'inden üretilen evidence selection hash'iyle reviewed compatibility registry'ye bağlandı.
  Beş boyutun tamamı exact eşleşmiyorsa, veri bozuksa veya workspace farklıysa tüm compatibility `unknown` kalır.
  Scope-free Policy Studio artık compatibility'yi seçim anında değerlendirilen bir kapı olarak gösterir ve tek
  başına `proposalReady` ilan etmez.

## 2026-08-08 — A08 Graph v23 insight capability kataloğu

- Analiz metrik formüllerini Graph v23 source field'ları, exact action/action-value type'ları, campaign/ad-set/ad
  level spelling'i, attribution modu ve breakdown permutation matrisiyle bağlayan sürümlü/hash'li saf katalog
  eklendi. Unsupported source alias, izin eksikliği, bilinmeyen Graph sürümü, geçersiz attribution/time increment,
  çakışan breakdown ve action-uyumsuz breakdown kombinasyonları Graph çağrısından önce fail-closed kalır.
- Sync transport artık insight sorgusunu bu planner'dan üretir ve catalog provenance'ını sayfa sonucuna bağlar.
  Exact action extractor container eksikliği, bozuk/duplicate action type, para birimi veya minor-unit scale
  belirsizliğini sıfır saymaz; sebepli unavailable sonuç üretir.
- Bounded canlı verifier en fazla beş hesabı yalnız ID göstermeden seçti; iki hesap incelendi ve campaign/ad-set/ad
  seviyelerinde sekiz probe gerçek satır döndürdü. Son kanıt 11 GET, 0 write, 66 istenen field slotunun 63'ü,
  üç satırda `actions` ve sıfır satırda `action_values` gösterdi. Sonuç dürüstçe `partial_coverage`; eksik üç alan
  ve gözlenmeyen `action_values` açık gap'tir. DB/schema, Meta write veya ham ID/payload/log eklenmedi.

## 2026-08-08 — A12 no-model-API CI sınırı

- ReklamZeka runtime'ına doğrudan OpenAI/Anthropic entegrasyonu eklenmesini engelleyen deterministik repository
  checker eklendi. `src/`, `scripts/`, package script'leri ve package-lock dahil direct/transitive dependency yüzeyi;
  provider SDK/import, `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` ve doğrudan provider API host'larında fail-closed olur.
- Dokümantasyondaki mimari açıklamalar, Codex CLI/Claude Code adları ve ayrı Meta Graph connector'ı yanlış pozitif
  üretmez. Checker kendi kaynak içeriğini veya secret değeri hata çıktısına basmaz; yalnız dosya/ihlal sınıfını verir.
  On iki test temiz repo ile import, scoped SDK, env, endpoint, package script, manifest, lock-only transitive ve
  eksik-root negatiflerini doğrular. Ana `npm test`/CI zincirine bağlandı; network, DB veya secret erişimi yapmaz.

## 2026-08-08 — A12 vendor-agnostic LocalAgentClient fixture contract

- Decision Room, Approval Queue read, Policy Bundle read, Budget Lab read/draft, Practice Lab read/ephemeral draft
  ve existing-post preflight araçları tek sürümlü 13-tool safe catalog altında toplandı. Her tool exact mevcut
  `LocalSessionScope` ister; bilinmeyen scope/tool, eksik veya fazla executor ve descriptor capability enjeksiyonu
  dispatch öncesinde reddedilir.
- Session descriptor vendor/model/prompt taşımaz; model execution, human presence, approval, grant, execution,
  raw Meta/SQL ve Meta write authority alanları yapısal olarak false'dur. Modelsiz fixture yalnız önceden enjekte
  edilmiş deterministic executorları sıralı çağırır. Unsafe sonuç anahtarı/açık authority/class instance,
  correlation replay ve başka session'ın correlation ref'i fail-closed kalır.
- Bu parça route, MCP transport, DB/session ledger veya dashboard handoff değildir; `project_stdio` ve
  `loopback_http` yalnız contract transport adlarıdır. Network, DB, secret, model API veya Meta çağrısı eklenmedi.

## 2026-08-08 — A12 AgentSession + DashboardHandoff application lifecycle

- Doğrulanmış runtime local-session claim seti ile LocalAgentSessionDescriptor'ı exact session/workspace/user/client/
  transport/catalog/tool/expiry bağına alan repository-port'lu application lifecycle eklendi. Register ve heartbeat
  yalnız server clock kullanır; heartbeat capability expiry'yi uzatamaz, clock regression ve descriptor drift'i
  fail-closed reddeder.
- Dashboard handoff veri snapshot'ı veya prompt değildir. Yalnız `analysis|existing_post_promotion` intent'i,
  public entity/timeframe/context/template ref'leri, version ve correlation ref taşır. Handoff 15–120 saniye ile
  creator/target capability expiry'nin en erken anına cap'lenir; target aynı workspace ve kullanıcıya ait olmalı,
  intent'in gereken safe tool'una sahip olmalıdır. Consume repository portunda atomik ve tek kullanımlıdır.
- Caller workspace/time/authority/provider/model/prompt/tool/raw/hash/sql/human/grant/approve/execute enjeksiyonu,
  unregistered veya drift etmiş session, cross-user/workspace/session, expiry, replay ve concurrent çift tüketim
  negatifleri kapsandı. Public sonuç internal UUID/user/nonce/tool listesi taşımaz ve business/model/human/approval/
  grant/execution/raw/Meta authority'leri false'dur; yalnız session coordination capability'si true'dur.
- Bu dilim in-memory test repository'siyle application contract kanıtıdır. Kalıcı repository, route, dashboard,
  MCP/STDIO transport, network, DB migration, secret veya Meta/model çağrısı eklenmedi.

## 2026-08-08 — A12 durable AgentSession + DashboardHandoff repository

- `local_agent_sessions` ve `local_agent_handoffs` PostgreSQL tabloları additive migration ile eklendi. Session
  kayıtları exact workspace membership, transport, tool-catalog, süre ve başlangıçtaki 13 safe-tool allowlist constraint'lerine;
  handoff kayıtları exact creator/target session composite FK'leri, public-ref bağlamı ve 15–120 saniye TTL'e bağlıdır.
- Server-private Drizzle repository yeni session kaydından önce active workspace satırını kilitler. Heartbeat süreyi
  uzatamaz; handoff consume exact workspace/target/expiry ve `consumed_at is null` koşullarıyla tek atomik UPDATE'tir.
  Stored tool/context drift'i public projection üretmeden fail-closed reddedilir.
- Her iki tablo `ENABLE` + `FORCE RLS` kullanır; `PUBLIC`, `anon`, `authenticated` ve `service_role` tablo grant'leri
  kaldırılmıştır. Workspace tombstone explicit purge allowlist'i handoff → session → membership FK sırasına genişletildi.
- Canlı Supabase kabulü iki session register, handoff create, tek kullanım, process/repository yeniden kurulumundan
  okuma, tombstoning sırasında yeni register reddi ve tam transaction rollback temizliğini doğruladı. Son güvenlik
  kanıtı 77/77 public tabloda RLS, API rollerinde sıfır table grant/schema-create/public-routine execute gösterdi;
  Meta write, model ve dış network çağrısı yapılmadı.
- Bu dilim authenticated HTTP/MCP/STDIO transport, dashboard butonu veya gerçek dashboard↔CLI E2E açmaz. Bunlar
  ayrı kapılar olarak kapalıdır; repository hiçbir approval, execution, human-presence veya Meta-write authority üretmez.

## 2026-08-08 — A12 authenticated local coordination HTTP + dashboard handoff

- `/api/local-agent-sessions` cookie-only dashboard session list/create ile bearer-only CLI register/heartbeat;
  `/api/local-agent-handoffs` cookie-only same-origin create ile bearer-only consume sunar. Her istek mevcut loopback
  Host/origin/proxy, OS UID, signed capability ve active workspace/membership kontrolünü yeniden kullanır.
- Request gövdesi 2 KB ve exact-shape ile sınırlıdır. Workspace/user/session authority caller'dan alınmaz; dashboard
  descriptor'ı server-side `client_dashboard`, `loopback_http` ve yalnız `decision_room_list` olarak kurulur. CLI yalnız
  safe tool kataloğundan seçim yapabilir. Cookie+bearer karışımı, tenant header, proxy, query, unknown key/tool reddedilir.
- Dashboard artık API kanıtı olmadan “Codex bağlı” göstermez. Sıfır session açıkça disconnected, tek session otomatik,
  çoklu session explicit dropdown'dır. Seçili portföy/kampanya ve 7 günlük timeframe için 60 saniyelik ref-only handoff
  üretir; expiry ve tek-kullanımlık ref görünürdür. Dashboard içindeki sahte model sohbeti devre dışıdır.
- Canlı Supabase HTTP kabulü dashboard register, CLI register, same-user active list, handoff create, consume ve replay
  reddini doğruladı; hedefli cleanup sonunda geçici satır kalmadı. 77/77 RLS ve sıfır Data API grant duruşu korundu;
  model ve Meta write çağrısı sıfırdır.
- Project STDIO MCP adapter, Codex/Claude config ve CLI içinden doğal `get_handoff_context` çağrısı bağlıdır.
  Bu dilimde exact 16-tool katalog dışında araç yayımlanmaz; dashboard handoff'u tek kullanımlı tüketilir ve replay reddedilir.
  Localhost Streamable HTTP MCP ile MCP'siz CLI adapter'ı ayrı ileri kapılar olarak kapalıdır.

## 2026-08-08 — A12 project STDIO MCP + Codex/Claude conformance

- `@modelcontextprotocol/server` v2 tabanlı project STDIO server başlangıçta 3 coordination aracı ile 13 safe
  read/draft/preflight application aracını exact katalog ve strict Zod input şemasıyla yayımlar. Provider/model,
  raw Meta/SQL, approval, human-presence grant veya action execution aracı yoktur.
- MCP prosesi `.env.local` dosyasını symlink/owner/mode/size kontrollerinden geçirir; yalnız yedi
  `REKLAMZEKA_LOCAL_*` binding'ini tutar. Meta tokenı, `DATABASE_URL` ve provider secret'ları process env,
  argüman, stdout, tool sonucu veya config'e taşınmaz. Capability process memory'de OS UID'ye bağlı mint edilir.
- Next.js'in doğrudan loopback isteklerde eklediği exact canonical forwarding tuple framework uyumluluğu için
  kabul edilir; locality kanıtı değildir. Partial/external/mismatched forwarding, tenant header ve dual credential
  reddi korunur. Policy read ve promotion preflight yalnız ilgili bearer read scope'larına açılmış; draft/publish
  ve diğer dashboard mutation sınırları cookie/human yolunda kalmıştır.
- Codex `.codex/config.toml` bu dilimde exact 16 araçla etkin; coordination otomatik, diğer mutation'lar `writes` prompt'tur.
  Claude `.mcp.json` ve project permission seti yalnız coordination/read araçlarını auto-allow eder;
  mark-read ile persisted budget draft server metadata ile explicit interaction ister. Makine-local Claude entry
  health check'te connected durumundadır.
- Canlı kabul: STDIO initialize/list/call, session register, dashboard active-session discovery, 60 saniyelik
  handoff create, CLI consume ve replay reject geçti; Decision Room, policy bundle ve promotion preflight gerçek
  localhost→PostgreSQL hattına ulaştı. Geçici MCP kabul session'ları hedefli biçimde temizlendi.
## 2026-08-10 — A10 cadence profile server-bound publication

- `/api/decision-cadence` yalnız cookie-only same-origin `decision-cadence-publish` intent'i ve ayrı
  `decision_cadence:publish` session scope'u ile `DecisionCadenceProfile` yayınlar. İstemci yalnız profile
  command alanlarını verir; workspace, actor, membership role ve UTC clock server'da çözülür.
- Application service owner/admin rolünü tekrar denetler; Drizzle publisher aktif workspace/membership, account-
  campaign tenant scope, expected-current-hash OCC, immutable revision ve hash-chain audit'i tek transaction'da
  uygular. Response action/approval/Meta-write yetkisi üretmez.
- Bu cadence configuration mutation yüzeyi experiment evidence endpoint'inden ayrıdır. Decision Room experiment
  adapter'ı ve policy-configured canlı PostgreSQL dry-run acceptance açık işlerdir. Yerel çevrede settlement policy
  ve bağlanabilir PostgreSQL/session binding olmadığı için live dry-run doğrulanmadı.

## 2026-08-10 — A10 experiment evidence server-bound lifecycle

- `/api/experiment-records` cookie-only same-origin `experiment-record-mutate` intent'i ve ayrı
  `experiment_record:mutate` local-session scope'u altında plan veya outcome kaydeder. Workspace/actor/role ve
  timestamp client body'den gelmez; active membership yeniden çözülür. Owner, admin ve analyst evidentiary
  kayıt ekleyebilir; viewer reddedilir.
- Plan kaydı exact cadence revision + account/campaign tenant scope'a bağlıdır; outcome yalnız plan head'in
  expected record hash'iyle append edilir. Repository hash-chain ve audit event'ini tek transaction'da korur.
  Endpoint response'u publish/approve/execute/Meta-write yetkisi taşımaz.
- Decision Room runtime'ı bugün kendisi experiment planı üretmediğinden otomatik adapter bilinçli olarak
  eklenmedi. Gerçek runtime-originated plan contract'i oluştuğunda planın exact frozen cadence/run assetine
  bağlanması ayrı bir checkpoint'tir; bu API onu varsayarak sahte bir bağlantı kurmaz.

## 2026-08-10 — A10 BusinessOutcomeSignal normalized persistence

- `business_outcome_batches` immutable manual/CSV source provenance'ını yalnız opaque source ref, SHA-256
  content hash ve observed time ile tutar; raw CSV/CRM payload saklanmaz. Bağlı `business_outcome_signals`
  qualified lead, appointment, sale, revenue ve invalid lead'i entity/time/outcome indeksleriyle normalize eder.
- Server-private writer önce saf canonical batch hash'ini yeniden üretir; ardından active workspace ve actor
  membership rolünü transaction içinde kilitli doğrular, batch/signal satırlarını atomik yazar ve hash-chain
  audit event ekler. Outcome evidence hiçbir zaman Meta metriği veya action/approval/execute yetkisi değildir.
- İki public tablo FORCE RLS, API role revoke, composite batch FK, immutable/tombstone trigger ve explicit
  workspace purge listesi taşır. Yerel ortamda `postgres_connection_not_configured` olduğundan migration
  rollback/RLS live acceptance ile bounded read route'u sonraki açıktır.

## 2026-08-10 — A10 BusinessOutcome cookie-bound authoring

- `/api/business-outcomes` yalnız cookie-only same-origin `business-outcome-record` intent'i ve ayrı
  `business_outcome:record` scope'u ile source metadata + canonical signal satırlarını kabul eder. Batch ID,
  actor, role, workspace ve clock body'den alınmaz; batch hash server-side yeniden üretilir.
- Raw CSV/CRM alanı, caller workspace/identity ve action authority key'leri exact request shape öncesinde
  reddedilir. Owner/admin/analyst normalized business evidence yazabilir; viewer reddedilir. Response
  `metaProxyEligible:false` ile publish/approval/execute/Meta-write capability üretmez.
- Bounded read/query endpoint'i ve EffectiveCampaignContext/L4–L5 frozen binding'i hâlâ açık; persistence
  bu aşamada analysis context'ine zımni olarak enjekte edilmez.

## 2026-08-10 — A10 BusinessOutcome bounded read

- Aynı `/api/business-outcomes` yüzeyinin `GET` kolu yalnız cookie-only same-origin
  `business-outcome-read` intent'i ve ayrı `business_outcome:read` scope'u altında çalışır. Her rolün
  kendi aktif workspace membership'i server-side yeniden çözülür; body, bearer, forwarded veya tenant
  header kabul edilmez.
- Read model tenant ve opsiyonel entity filtresiyle `(occurred_at, signal_ref)` keyset cursor kullanır.
  Projection yalnız normalized signal/source-ref/observed-at alanlarını taşır; raw source, content hash,
  actor/role, audit-chain ve action/approval/execute/Meta-write authority dışarı verilmez. Cursor yalnız
  sıralama anahtarlarını kodlar.
- Bu increment outcome satırlarını EffectiveCampaignContext'e veya L4–L5 materialization'a bağlamaz;
  provenance/timeframe/invalidation sözleşmesiyle yapılacak bu sonraki iş fail-closed açık kalır. Yerel
  PostgreSQL/session ortamı bulunmadığından gerçek route/RLS acceptance blocker'ı
  `postgres_connection_not_configured` olarak sürer.

## 2026-08-10 — A10 BusinessOutcome L4 evidence contract

- `business-outcome-evidence/1.0.0`, normalized satırlardan entity ve half-open zaman penceresine bağlı,
  sıralama-deterministik compact evidence envelope üretir. Summary outcome adetlerini, gelir-currency toplamını
  ve verified/unmapped mapping sayısını taşır; raw import/content hash/actor/audit alanı veya Meta proxy/action
  authority taşımaz.
- Evidence hash'i source-head hash ve source manifest hash'ini kapsar. Pencere dışı/duplicate signal, yanlış
  entity, geçersiz revenue veya malformed timestamp fail-closed reddedilir. Henüz `EffectiveCampaignContext`
  ya da PostgreSQL materialization head'ine bağlanmadığından yeni outcome geldiğinde context invalidation mekanizması
  bu checkpoint'te iddia edilmez; bu sonraki L4→L5 persistence dilimidir.

## 2026-08-10 — A10 BusinessOutcome persisted L4 evidence

- `business_outcome_entity_heads` her entity için source head/revision'ı, `business_outcome_evidence_snapshots`
  ise o head, half-open zaman penceresi ve compact envelope hash'iyle immutable L4 fact'i saklar. Head yalnız
  dar revision/hash OCC update'iyle ilerler; snapshot update/delete reddeder, yalnız workspace tombstoning
  purge yoluna izin verir. Her iki tablo FORCE RLS, API-role revoke, tenant indeksleri ve purge allowlist taşır.
- Yeni normalized batch önceki entity head'e bağlı `business_outcome_evidence` context component'i için append-only
  invalidation yazar. Materializer aktif workspace ve current head'i kilitli okur; head `updated_at` timestamp'i
  materialization zamanı olduğundan aynı head+pencere tekrarında deterministik aynı evidence hash'i çıkar.
- Frozen `EffectiveCampaignContext` compact evidence'i hash içinde taşır ve repository save sırasında aynı tenantta
  exact immutable snapshot/ref/hash/head/payload yoksa fail-closed reddeder. Public projection yalnız summary ve
  redacted evidence ref gösterir. `npm run verify:business-outcome-evidence-db`, applied migration üzerinde
  RLS/FORCE RLS, PUBLIC/anon/authenticated/service_role revoke, head/snapshot guards, deterministic materialization
  ve outer rollback temizliğini geçti. L4→L5 composer aşağıda bağlıdır; analysis consumer henüz eklenmedi.

## 2026-08-10 — A10 BusinessOutcome L4→L5 private composer

- `BusinessOutcomeContextComposer`, L4 materializer sonucu ile `EffectiveCampaignContext` save portunu bağlayan
  server-private application katmanıdır. Workspace/entity materializer inputuna yalnız base frozen context'ten geçer;
  caller-provided `outcomeEvidence` peşinen reddedilir.
- Evidence entity'si context entity'siyle birebir değilse veya evidence materialization zamanı context capture
  zamanından yeniyse context hiç oluşturulmaz/persist edilmez. Başarılı akışta store zaten exact tenant snapshot
  ref/hash/head/payload doğrulamasını yapar. Response bütün publish/approve/execute/Meta-write capability'lerini
  false tutar; HTTP/MCP/UI/otomatik analysis consumer bu checkpoint'te eklenmedi.

## 2026-08-10 — A10 BusinessOutcome L5 finding consumer

- `deterministic-finding-engine/1.1.0`, authentic frozen context'teki entity-aligned BusinessOutcome L4 envelope'ını
  finding run'ın hash'e bağlı `outcomeEvidence` alanına compact olarak taşır. Evidence ref/hash, pencere,
  materialization zamanı ve summary görünür; raw source/CSV, actor/audit, source manifest veya Meta credential görünmez.
- Outcome evidence Meta metric veya success/proxy metriği değildir (`metaProxyEligible:false` korunur); finding/teklif
  eligibility'sini değiştirmez ve result hâlâ action authorization/Meta write capability vermez. Entity-scope dışı
  evidence L5 consumer tarafından fail-closed reddedilir.

## 2026-08-10 — Decision Room replay ve guidance DB guard düzeltmesi

- Frozen Decision Room asset replay'i artık persisted full `AnalysisAgenda` payload'unu yeniden üretilen agenda ile
  hash-eşit doğrular; core `agendaHash` ile full-object hash'ini karşılaştıran yanlış kontrol kaldırıldı. Bu, ilk
  claim'deki agenda/timeframe/context/cadence varlığını değiştirmez; replay drift'inde fail-closed kalır.
- İleri yönlü iki migration, official guidance URL fonksiyonundaki şema-isimli `coalesce` hatasını ve backslash
  bypass'ını düzeltti; Decision Room asset tablolarından PUBLIC/anon/authenticated/service_role izinlerini geri aldı.
  `verify:decision-room-analysis-assets-db` canlı kabulü agenda freeze/replay, binding immutability/ref caps,
  URL negatifleri, RLS/revoke, cross-tenant negatifleri ve outer rollback'i geçti. Hiçbir action/Meta-write yüzeyi
  eklenmedi.

## 2026-08-10 — A10.4a Meta config snapshot v2

- `meta-analysis-config-snapshot/2.0.0`, campaign objective ve ad-set optimization goal için
  canonical mapping sürümlerini snapshot hash'ine freeze eden saf, immutable config fact'idir.
  Replay yeni mapping'i tekrar çalıştırmaz; hash doğrulaması geçmeyen snapshot hiç projekte edilmez.
- Objective/optimization kaynak alanı eksik, invalid veya reviewed katalog dışında olduğunda; campaign'in
  ad-set hedefleri birbirinden farklı olduğunda veya bilinmeyen+known evidence karıştığında sonuç yalnız
  explicit reason-coded `unknown` olur. Bu katman config'e anlam uydurmaz, ağ/DB çağrısı veya action/Meta-write
  authority taşımaz.
- Eski `meta-change` v1 snapshot'ları okunabilir kalır; önceden saklanmamış objective/optimization bilgisi
  `legacy_snapshot_missing_*` olarak görünür. Odak testleri (7 test) ve `npm run typecheck` geçti.

## 2026-08-10 — A10.4b Çok-boyutlu güncel kategori composition reader'ı

- Server-private `CurrentCategoryCompositionResolver`, tüm aktif dimension'ları yalnız bir
  canonical hierarchy path'ten sıralı çözer. Her effective definition için batch current head
  sorgusundan gelen tam active `CategoryProfile` bağlanır; profile ref/version/hash frozen
  category context hash'ine yeniden yazılır. Unmatched dimension, missing/ambiguous/stale veya
  archived/paused profile, manual-lock/parked conflict ve 100 dimension/500 effective definition
  cap'i hiçbir partial context dönmeden reddedilir.
- Concrete Drizzle reader bütün read'i tek `REPEATABLE READ, READ ONLY` transaction içinde
  yürütür; active dimension'ları deterministic key/id sırasıyla okur. Profile reader
  `DISTINCT ON(category_definition_id) ... version desc` ile yalnız aynı snapshot'taki latest
  head'i kabul eder ve eski active revision'a fallback yapmaz. Bu read port HTTP/UI/policy/action/
  Meta authority sunmaz; migration veya schema değişikliği yapılmadı.
- Kanıt: `tests/current-category-composition-resolver.test.ts`,
  `tests/category-profile-persistence.test.ts` ve `tests/category-registry.test.ts` ile 27 test;
  `npx tsc --noEmit` ve `git diff --check` geçti.

### A10 current-source transaction-local category prerequisite

- Category composition saf çözüm yolu `resolveCurrentCategoryCompositionInSnapshot` olarak dışa
  açıldı; caller-owned snapshot üzerinde `withConsistentSnapshot` çağırmaz. Mevcut public resolver
  aynı RR/RO davranışını korur.
- Category profile repository'ye nested transaction açmayan current-artifact read eklendi. Current
  source adapter hierarchy doğrulamasından sonra workspace ref'i yalnız latest persisted active
  category profile facts'ten tekil olarak türetir; caller/route alanı kabul etmez ve aynı snapshotta
  composition'ı yalnız validation amacıyla doğrular. Eksik/ambiguous/stale category evidence source'u
  fail-closed reddeder; bundle hâlâ `not_ready` olduğundan ready context veya authority üretilmez.
- Kanıt: `tests/current-category-composition-resolver.test.ts` ve
  `tests/current-effective-analysis-context-source-drizzle-reader.test.ts` (10 test),
  `npm run typecheck`, `git diff --check`.

## 2026-08-10 — A10.4c-1 frozen config/cadence context evidence

- `EffectiveCampaignContext`, eklenmiş v2 Meta config kanıtında immutable snapshot'ı yeniden
  projekte eder; context'in account/campaign scope'u ile top-level objective ve optimization
  observations birebir uyuşmadan context hash'i üretmez. Kanıt hiç yoksa legacy frozen replay
  uyumluluğu korunur; yalnız açık `evidence_bound` persistence modunda Meta config ve cadence
  evidence ikisi de zorunludur.
- Cadence evidence `profileRef` + immutable revision/version/hash taşır ve source component'e
  `cadence_profile` olarak yazılır. Owner/admin private cadence publish, supersede edilen eski
  hash için campaign-scope invalidation'ı yeni revision/audit ile aynı kısa transaction'da append eder.
  İleri migration iki context component constraint'ini genişletir ve private RLS/FORCE/revoke
  korumasını tekrar uygular. Bu dilim config DB reader/composer, Decision Room route veya action/
  approval/Meta-write capability eklemez.
- Kanıt: context/persistence, cadence publisher ve forward migration için 3 hedef test dosyasında
  12 test; `npm run typecheck`, `npm run db:check` ve `git diff --check` geçti.

## 2026-08-10 — A10.4c-2 private effective-analysis-context composer

- `EffectiveAnalysisContextComposer` yalnız beş scope alanını kabul eder; çağıranın meta,
  category, guidance, policy, cadence, evidence veya version bileşeni göndermesine izin vermez.
  Objective/optimization doğrudan current config-v2 snapshot projection'ından gelir; categories
  `CurrentCategoryCompositionResolver` üzerinden, policy authority ise yalnız
  repository-verified authority loader'ın private `compose` closure'ı üzerinden bağlanır.
- Composer `productionAuthoritySourceBound=true`, policy-authority evidence/version ve tüm context/
  composition capability bayraklarının false olmasını zorunlu tutar. Yalnız `evidence_bound`
  persistence çağrısı yapılır; eşzamanlı veya mevcut invalidation dönen save sonucu kullanılmaz.
- Bu katman kasten Drizzle production adapteri iddia etmez: config-v2, cadence, guidance ve outcome
  evidence'in tek read-only consistent snapshot altında current read'ini sağlayacak adapter henüz
  mevcut source portlarda yoktur. Kanıt: `tests/effective-analysis-context-composer.test.ts` (3 test),
  `npm run typecheck` ve `git diff --check`.

## 2026-08-10 — A10.4c-3 current cadence reader

- Server-private `CurrentDecisionCadenceReader`, çağırandan profile, clock, evidence, learning veya
  action isteği almadan yalnız workspace/account/campaign scope'u ile current immutable cadence
  revision'ını okur. Tek `REPEATABLE READ, READ ONLY` snapshot'ta profile ref/revision/version/hash/
  payload, scope bağları ve DB clock doğrulanır; missing/ambiguous/paused/future/tahrif edilmiş
  payload fail-closed reddedilir.
- Profile hash'i canonical payload digest'i ve mevcut domain cadence evaluator'ı ile doğrulanır.
  Bu dar kaynakta kalıcı finding/evidence closure'ı bulunmadığından evaluator yalnız empty,
  repository-owned evidence kullanır; sonuç observation gate'i sonrası `insufficient_evidence`
  blocked olur, action/approval/Meta-write yetkisi üretmez. Daha güçlü karar için future evidence
  reader gerekir; bu reader HTTP/UI/Decision Room/composer'a bağlanmadı ve schema değiştirmedi.
- Kanıt: `tests/current-decision-cadence-reader.test.ts` (8 test), `npx tsc --noEmit` ve
  `git diff --check` geçti.

## 2026-08-10 — A10.4c-4 current-source snapshot checkpoint

- `EffectiveAnalysisContextComposer` artık caller-supplied `capturedAt` veya bağımsız category/
  lifecycle/authority `Promise.all` çağrıları almaz; tek repository-owned source bundle içindeki
  captured time, facts, category composition, lifecycle ve authority closure'ı ile çalışır.
  `not_ready` bundle veya geçersiz/partial bundle fail-closed `source_rejected` olur.
- Yeni server-private `DrizzleCurrentEffectiveAnalysisContextSourceReader` yalnız aktif tenant/account
  scope'unu ve DB clock'u tek kısa `REPEATABLE READ, READ ONLY` transaction içinde doğrular.
  Bu adapter config-v2, guidance, data/history, category, lifecycle ve authority'nin eksiksiz
  transaction-local current reader'larını henüz birleştirmediği için `ready` iddiasında bulunmaz:
  yalnız `current_source_bundle_unavailable`, `not_ready` ve bütün capability bayrakları false
  sonucu verir. UI, HTTP, Decision Room, action authority veya schema/migration eklenmedi.
- Kanıt: `tests/effective-analysis-context-composer.test.ts`,
  `tests/current-effective-analysis-context-source-drizzle-reader.test.ts`, `npm run typecheck`
  ve `git diff --check`.

## 2026-08-10 — A10.4c-5 transaction-local Meta hierarchy/config validation

- `CurrentMetaHierarchyConfigReader` yeni transaction açmadan caller'ın `REPEATABLE READ, READ ONLY`
  snapshot'ında active connection/account, exact campaign/ad-set/ad/creative hierarchy ve disappeared
  olmayan current satırları doğrular. Tx clock'a kadar tek latest authentic `meta_change_snapshot` ile
  campaign'in tüm current ad-set config gözlemlerini bağlar; canonical config-v2, hierarchy identity ve
  immutable source snapshot evidence döndürür. Missing/ambiguous/future/cross-scope/corrupt veri
  fail-closed reddedilir.
- `DrizzleCurrentEffectiveAnalysisContextSourceReader` bu reader'ı yalnız validation olarak çağırır;
  guidance/data/history/category/lifecycle/authority closure aynı snapshotta tamamlanmadığından halen
  `not_ready` döner ve capability üretmez. Schema/migration, HTTP/UI/action/Decision Room wiring yoktur.

## 2026-08-10 — A10.4c-6 transaction-local cadence validation

- `CurrentDecisionCadenceReader.readCurrent` bağımsız çağrılarda kısa `REPEATABLE READ, READ ONLY`
  snapshot'ını açmayı sürdürür. `readCurrentInTransaction` ise caller-owned snapshot ile exact
  `capturedAt` alır, yeniden transaction açmaz ve query içindeki `transaction_timestamp()` ile eşitliği
  doğrular. Böylece profile/current-head/hash/payload/temporal/domain fail-closed kontrolleri aynen
  korunurken drift veya nested transaction kabul edilmez.
- `DrizzleCurrentEffectiveAnalysisContextSourceReader`, hierarchy ile campaign ref'ini aynı snapshotta
  doğruladıktan sonra cadence reader'ı yalnız validation için çağırır. Guidance/data/history/category/
  lifecycle/authority closure henüz mevcut olmadığından bundle yine dürüstçe `not_ready` döner; HTTP/UI,
  Decision Room, action authority veya schema/migration eklenmedi.

## 2026-08-10 — A10.4c-7 transaction-local reviewed-guidance manifest

- Server-private `CurrentReviewedGuidanceReader` caller-owned aynı read-only snapshot içinde active
  workspace ve exact transaction clock'u doğrular; latest source/card/binding/set revisionlarını canonical
  immutable record hash'i, lifecycle/timestamp sınırları ve mevcut `createGuidanceRegistry` cap/reference
  sözleşmesiyle denetler. Her current reviewed set için sıra korunarak set/card/source key-ref/version/hash
  manifesti döner. Stale review, unpublished/archived/missing dependency, future timestamp veya tahrif
  edilmiş payload/revision fail-closed reddedilir.
- Reader bilinçli olarak topic, account/category scope, budget veya set selection seçmez. Current-source
  seam onu yalnız validation için aynı transactionda çağırır; data/history/category/lifecycle/authority ve
  selection closure eksik olduğundan sonuç hâlâ `not_ready` ve tüm capability bayrakları false'tur. HTTP/UI,
  Decision Room, action authority ve schema/migration eklenmedi.
- Kanıt: `tests/current-reviewed-guidance-reader.test.ts`,
  `tests/current-effective-analysis-context-source-drizzle-reader.test.ts`, `npx tsc --noEmit` ve
  `git diff --check`.

## 2026-08-10 — A10.4c-8 persisted campaign guidance selection

- Forward-only `guidance_campaign_selection_revisions` immutable evidence tablosu ve ayrı OCC
  `guidance_campaign_selection_heads` pointer'ı eklendi. Scope workspace/account/campaign composite FK
  ve campaign→account trigger'ı ile zorlanır; exact reviewed GuidanceSet manifest ref/version/hash, sorted
  topics/requiredTopics, bounded budget, effective time, source selection hash, chained selection hash ve
  owner/admin actor provenance revisiona freeze edilir. Revision update/delete trigger ile engellenir;
  relations RLS+FORCE ve PUBLIC/anon/authenticated/service_role revoke ile server-private kalır.
- Private publisher active workspace + exact owner/admin membership + exact Meta scope + reviewed manifest
  recheck + expected-current-hash/revision OCC uygular. Yeni revision/head, previous selection kullanan exact
  campaign context invalidationı ve audit chain tek kısa transactiondadır. `CurrentGuidanceCampaignSelectionReader`
  aynı caller-owned snapshotta head/revision hashini, time sınırını ve reviewed manifest closure'ını doğrular.
  Source seam bunu validation için çağırır; geri kalan data/history/category/lifecycle/authority closure yoktur,
  dolayısıyla `ready` veya herhangi bir action authority iddiası yoktur.
- Kanıt: local `npm run db:migrate`,
  `tests/guidance-campaign-selection-drizzle-repository.test.ts`,
  `tests/current-guidance-campaign-selection-reader.test.ts`,
  `tests/current-effective-analysis-context-source-drizzle-reader.test.ts`, `npx tsc --noEmit`,
  `npm run db:check`, `git diff --check`.

## 2026-08-10 — A10.4c-9 selected guidance pack in the source snapshot

- `CurrentReviewedGuidanceReader` artık record-hash doğrulamasından geçmiş immutable registry'yi manifestin
  server-private parçası olarak taşır. Current-source seam, aynı snapshotta persist edilmiş campaign selection
  ref/version/hash'iyle tek reviewed seti eşleştirir; Meta config projection, active category refs, topicler,
  required topicler ve budget dışında input veya default kullanmadan `EffectiveGuidancePack` üretir.
- Registry/set hash, tenant/account/campaign scope, Meta projection ve category evidence uyuşmazlığı ile pack
  construction hataları fail-closed olur. Data/history/lifecycle/authority closure hâlâ eksik olduğundan pack
  dışarıya yayınlanmaz; source sonucu `not_ready`, tüm capability'ler false kalır. HTTP/UI/action/schema yoktur.
- Kanıt: `tests/current-reviewed-guidance-reader.test.ts`,
  `tests/current-guidance-campaign-selection-reader.test.ts`,
  `tests/current-effective-analysis-context-source-drizzle-reader.test.ts`, `npx tsc --noEmit`.

## 2026-08-10 — A10.4c-10 transaction-local policy lifecycle and authority validation

- `DrizzleInstructionPolicyLifecycleRepository.inspectInTransaction`, caller-owned snapshot içinde yalnız
  `capturedAt` anında kayıtlı revisionları okur; mevcut public `inspect` davranışı değişmez ve nested
  transaction açılmaz. `DrizzleTrustedPolicyAuthorityRepository.loadInTransaction` da aynı transaction
  executor ile mevcut tenant snapshot, relational backing, scope ve all-false authority proof doğrulamasını
  aynen uygular.
- Current-source seam selected guidance pack'ten sonra bu iki kanıtı aynı snapshotta bağlar: authority
  snapshot workspace/time sınırları ve catalog registry hash'i lifecycle registry hash'i ile exact eşleşmelidir.
  Uyuşmaz/expired authority `policy_authority_unavailable` ile fail-closed olur. Data/history closure eksik
  kaldığından sonuç hâlâ `not_ready`; authority compose, context save, HTTP/UI/Decision Room/action veya
  schema/migration eklenmedi.
- Kanıt: `tests/current-effective-analysis-context-source-drizzle-reader.test.ts`,
  `tests/instruction-policy-lifecycle-repository.test.ts`,
  `tests/trusted-policy-authority-repository.test.ts`, `npx tsc --noEmit`, `git diff --check`.

## 2026-08-10 — A10.4c-11 ready source bundle with unbound data window

- `DrizzleCurrentEffectiveAnalysisContextSourceReader` artık same-snapshot hierarchy/config, category,
  cadence, selected reviewed guidance pack, policy lifecycle, repository-verified authority ve promotion
  lifecycle registry hash'ini tek `ready` bundle'da verir. Promotion lifecycle reader için yalnız
  caller-owned transaction surface'i eklendi; schema/migration veya write/action yolu yoktur.
- Config-v2 dışındaki mevcut hierarchy'de bulunmayan Meta gözlemleri explicit `unknown` kalır. Data
  bilerek `trustStatus:not_ready`, yalnız exact public Meta source snapshot ref'i ve
  `analysis_window_not_bound` blocker'ı taşır; history ref'leri boştur. Böylece bundle compose/save için
  complete olsa da data veya action readiness iddiası yapmaz.
- Bundle, authority composition öncesinde authentic effective-context input olarak yeniden doğrulanır;
  authority closure instruction-policy/policy-authority evidence'ını ekler ve evidence-bound persistence
  için gereken promotion registry hash'i source snapshot'tan gelir. Missing/expired/tampered bileşenler
  fail-closed olur. HTTP/UI/Decision Room/action/Meta write eklenmedi.
- Kanıt: `tests/current-effective-analysis-context-source-drizzle-reader.test.ts`,
  `tests/effective-analysis-context-composer.test.ts`, `npm run typecheck`, `git diff --check`.

## 2026-08-10 — A10.4c-12 server-private Drizzle composition root

- `createDrizzleEffectiveAnalysisContextComposer` aynı Drizzle database boundary'sini yalnız
  `DrizzleCurrentEffectiveAnalysisContextSourceReader` ve
  `DrizzleEffectiveCampaignContextRepository`'ye verir; ardından bu iki private portla
  `EffectiveAnalysisContextComposer` kurar. Root HTTP/UI/MCP/Decision Room/action surface'i veya
  caller-owned facts/context injection noktası açmaz.
- Composer'ın public girdisi dört scope anahtarıyla sınırlı kalır: `workspaceId`, `accountRef`,
  `entityType`, `entityRef`. Ready source sonucu yalnız `evidence_bound` save'a gider; source
  reddi veya invalidated record dönüşü fail-closed kalır. Data window bağlanmadığı için context
  data trust durumu bu root tarafından da değiştirilmez.
- Kanıt: `tests/effective-analysis-context-composer-runtime.test.ts`,
  `tests/effective-analysis-context-composer.test.ts`, `npx tsc --noEmit`, `git diff --check`.

## 2026-08-10 — A10.4c-13 narrow PostgreSQL root fail-closed smoke

- `verify:ready-effective-analysis-context-root-db`, outer rollback altında concrete private composition
  root'un scope-checked sentetik bundle'daki uydurma authority kanıtını relational authority
  catalog/snapshot/binding zinciri olmadığı için `source_rejected` olarak fail-closed reddettiğini
  (`syntheticAuthorityRejected:true`) test eder. Network/action çağrısı sıfır, geçici satırlar rollback
  sonrasında yoktur; persistence başarısı iddia edilmez.
- Bu **closed-world current-source acceptance değildir**: test, root/persistence sınırını izole etmek için
  source reader'ı scope-checked ready bundle ile değiştirir. Canonical Meta hierarchy/config, category
  profile/assignment, reviewed guidance/selection, policy lifecycle, relational authority catalog/snapshot/
  bindings, promotion registry ve cadence reader'ın birlikte seedlendiği gerçek source-reader acceptance
  hâlâ açık bir sonraki dar checkpoint'tir. Bu nedenle hiçbir yeni action, Meta write, HTTP/UI veya G4
  yetkisi açılmaz.
- Kanıt: `npm run verify:ready-effective-analysis-context-root-db`, `npm run typecheck`,
  `npm run check:secret-artifacts`, `git diff --check`.
## 2026-08-10 — A09 policy semantic binding private lifecycle

- `DrizzlePolicySemanticBindingLifecycleRepository`, yalnız server-private owner/admin çağrısında aktif
  workspace ve üyeliği kilit altında yeniden doğrular; tam published `policyRef/version/hash` olmadan
  semantic fact yazmaz. Kaynak tabloda zaten var olan append-only chain kullanılır: kaynak-advisory lock,
  immutable previous hash OCC, canonical JSON fact/revision hash, exact-latest retry ve stale conflict
  tek transaction içindedir.
- Her yeni binding, persisted frozen `policy_authority` context sürümlerini gerçek kayıtlı ref/version
  üzerinden invalidate eder ve audit hash-chain olayı yazar. HTTP/UI/MCP/action yüzeyi yoktur; bütün
  publish/approve/execute/Meta-write ve diğer runtime yetkileri false döner.
- Hedefli test, `typecheck` ve `db:check` geçti. `DrizzleAccountGroupLifecycleRepository` de active workspace
  ve owner/admin üyeliğini kilit altında yeniden doğrular; grup-advisory lock ve exact predecessor OCC ile
  opaque account ref'lerini yalnız tenant-local, görünür `ad_accounts` satırlarına bağlayıp immutable active/
  archived revision ve membership satırlarını yazar. Exact immutable retry no-op'tur; her yeni revision frozen
  `policy_authority` context sürümlerini invalidate eder ve aynı transaction'da audit hash-chain olayı üretir.
  HTTP/UI/MCP/action yüzeyi yoktur ve tüm yetkiler false kalır. Topic private writer, complete-positive live
  relational fixture ve gerçek browser acceptance hâlâ açık bağımlılıklardır.

## 2026-08-10 — A10/A12 L5 compact agent context budget

- Yeni saf `compact-agent-context/1.0.0`, yalnız authentic frozen `EffectiveCampaignContext`,
  `AnalysisAgenda` ve deterministic finding run'ı kabul eder. Context/finding/agenda bağı veya hash'i
  değişirse fail-closed olur; L0 raw/secret alan, dahili tenant/entity/snapshot referansı ve write authority
  hiçbir çıktıya girmez.
- Bağlam, public-safe aliaslarla yalnız gerekli meta/data/guidance/finding özetini taşır. Entity, finding,
  guidance card ve source limitleri deterministic öncelik sırasıyla uygulanır; her kesinti `omitted`,
  `truncated`, `moreAvailable` ve neden kodlarıyla görünürdür. Time-series ve drill-down bu saf pakette
  sıfırdır; bunların typed transportu ile L2/L3 Postgres materialization hâlâ açık kalır.
- Kanıt: `tests/compact-agent-context.test.ts`, `npm run typecheck`, `git diff --check`.

## 2026-08-10 — A10 L1 canonical Meta insight page parser

- `parseMetaInsightPage`, Graph v23 insights response'undaki dar catalog alanlarını canonical daily
  insight sözleşmesine çevirir. Currency minor-unit dönüşümü, exact action/action-value type extraction,
  capability catalog provenance ve hash-only source trace aynı deterministik page hash'ine bağlanır.
- Foreign account, geçersiz tarih/para, malformed response ve duplicate canonical identity persistence'a
  ulaşmadan fail-closed kalır. Parser L0 raw sayfayı outputta tutmaz ve hiçbir network/action/write authority
  açmaz.
- Bu yalnız L1 parse sınırıdır: canonical `meta_daily_insights` transaction writer'ı ile normal sync runtime
  binding'i henüz eklenmemiştir; dolayısıyla L2 incremental materialization iddiası yoktur.
- Kanıt: `tests/insights-materialization.test.ts`, `npm run typecheck`, `git diff --check`.

## 2026-08-10 — A10 L1 canonical insight writer and sync binding

- `DrizzleMetaInsightPagePersistence`, yalnız parser'ın canonical sayfasını kabul eder; active tenant
  account/connection ve matching insights run+slice scope'unu transaction içinde doğrular. Değişen günlük
  insight satırı ve metric seti aynı transactionda upsert edilir; aynı content hash yalnız unchanged olur.
- Normal `MetaPartialReadSyncRuntime`, insight cursor'ını ilerletmeden önce source sayfasını bu server-private
  writer'a geçirir. Writer hatası slice'ı fail-closed `malformed_response` yapar; writer bağlıyken generic
  restart ledger insight raw payloadını `{}` dışında saklayamaz. Server production composition root writer'ı
  inject eder; yeni HTTP/action/Meta-write yüzeyi açılmaz.
- Bu checkpoint L1 persistence'ı kapatır; L2 feature snapshot/invalidation ve L3 rollup hâlâ açıktır.
- Kanıt: `tests/meta-sync-integration.test.ts`, `tests/meta-read-sync-runtime.test.ts`,
  `tests/insights-materialization.test.ts`, `npm run verify:meta-sync-db`, `npm run typecheck`,
  `git diff --check`.

## 2026-08-10 — A10 interaktif kampanya brief karar akışı

- Excel'deki operasyonel kırılımı (`pazar → dil → iş amacı → ana grup`, dönüşüm yolu ve bütçe
  seviyesi) yansıtan brief contract'i `1.1.0`'a yükseltildi. Brief artık yalnız serbest metin sorular
  değil, chat/UI için tek deterministik `nextDecision` ve insan incelemeli sıralı campaign lane'leri
  üretir.
- Lead, upper-funnel education ve market/service learning ayrı lane/ölçüm sınırlarında kalır. Form,
  WhatsApp ve upper-funnel erişimi kıyaslanmaz; sınıflandırılmamış veya delivery-interrupted kayıtlar
  lane üretmeden triage/recovery'de bloklanır. Bu bir planning aid'dir; campaign yaratma, approval,
  publish, execute veya Meta-write yetkisi taşımaz.
- Kanıt: `tests/interactive-campaign-template.test.ts`, `npm run typecheck`, `git diff --check`.

## 2026-08-10 — A10 immutable L2 feature snapshot contract

- `deterministic-feature-snapshot/1.0.0`, yalnız authentic L1 observation metric sonucu ve aynı
  observation'ın canonical source-ref manifestini kabul eder. Result/source manifest hash'i, formula
  catalog sürümü, entity scope ve all-false capability seti immutable feature hash'ine girer.
- Raw/secret alan veya forged metric result hash'i fail-closed reddedilir. Bu saf contract DB tablosu veya
  L1-change invalidation yazmaz; bunlar sonraki L2 persistence checkpoint'inde relational source manifest ile
  bağlanacaktır.
- Kanıt: `tests/deterministic-feature-snapshot.test.ts`, `npm run typecheck`, `git diff --check`.

## 2026-08-10 — A10 L2 private relational-source manifest seam

- Canonical L1 observation adapter'ı, public `FindingObservationReadPort` sonucunu değiştirmeden
  server-private `readForFeatureSnapshot()` yüzeyi ekler. Bu yüzey her opaque `snapshotRef` için
  exact tenant-owned `meta_daily_insights.id` ve canonical `contentHash` taşır.
- İç UUID hiç bir finding/context/model girdisine sızmaz; public `read()` yalnız hash-türetilmiş
  snapshot referanslarını döndürmeye devam eder. Böylece sonraki L2 persistence migration'ı,
  bağlamı bozmeden relational source-manifest FK'sini yazıcı tarafında yeniden doğrulayabilir.
- Bu yalnız kanıt taşıma checkpoint'idir: feature header/item tablosu, selective invalidation ve L3
  rollup henüz eklenmedi; herhangi bir yetki veya Meta write açılmaz.

## 2026-08-10 — A10 L2 relational storage substrate

- `deterministic_feature_snapshots` immutable L2 header'ı ile
  `deterministic_feature_snapshot_sources` exact L1 source-manifest item'ı eklendi. Kaynak item,
  workspace-scope FK ile hem frozen feature'a hem canonical `meta_daily_insights` satırına bağlıdır;
  header’da hashli feature/source manifest ve all-false capability payloadı tutulur.
- Yeni forward migration, iki public tabloda ENABLE+FORCE RLS, API rollerinden revoke, tenant composite
  FK/index ve yalnız workspace tombstoning anında DELETE kabul eden append-only trigger taşır. Tombstone
  purger child source item → feature header → L1 insight sırasını açıkça uygular.
- Drizzle meta snapshot zinciri önceki forward migrations için eksik snapshot ürettiği için generator
  fazladan tarihsel delta çıkardı; migration güvenle yalnız L2 delta'ya daraltıldı. `db:check` bu
  reconciled journal'ı doğrular. Henüz materialization writer veya L1-change invalidation yazıcısı yoktur.

## 2026-08-10 — A10 L2 private materializer

- `DrizzleDeterministicFeatureSnapshotRepository`, yalnız private read adapter'ın runtime-attested
  source manifestini kabul eder; feature hash'i repository girişinde yeniden kurulur/doğrulanır.
- Kısa transaction active workspace ile tenant account/connection scope'unu ve her selected L1 row'un
  current `source_payload_hash` değerini recheck eder. Eşleşme kaybolursa immutable L2 insert yapılmadan
  `source_changed` verir; aynı feature hash exact payloadla yalnız unchanged replay olur.
- Bu katman action/approval/Meta-write authority taşımaz. L1 change sonrası L2/L3 consumer invalidation
  henüz ayrı bir sonraki checkpoint'tir.

## 2026-08-10 — A10 L1→L2 immutable invalidation evidence

- `deterministic_feature_snapshot_invalidations`, bir L2 feature'ın captured L1 source satırı sonradan
  değiştiğinde önceki/yeni `source_payload_hash`, exact feature ve daily-insight tenant-scope FKs ile
  yazılan append-only olay günlüğüdür. Event hash'i aynı değişimi idempotent kılar; frozen feature'ın
  hash'i veya payload'ı asla güncellenmez.
- Canonical L1 writer bunu kendi kısa transaction'ında, günlük insight satırı upsert edildikten ve aynı
  scoped `deterministic_feature_snapshot_sources` bağları çözüldükten sonra yazar. İlk kez görülen bir
  kaynak için olay yoktur; yalnız mevcut kaynak hash'i değiştiğinde olay üretilir.
- Forward-only migration ENABLE+FORCE RLS, tüm public/API rollerinden revoke, composite tenant FK/index
  ve yalnız workspace tombstoning sırasında DELETE'e izin veren append-only trigger ekler. Tombstone
  purge sırası invalidation → source item → feature header → L1 insight olarak genişletildi.
- Bu yalnız stale kanıtıdır: L2/L3 reader'ın bu olayları read-time selective rejection veya rematerialize
  planına dönüştürmesi sonraki checkpoint'tir. Action/approval/Meta-write yetkisi açılmaz.
- Kanıt: `tests/meta-sync-persistence.test.ts`, `tests/deterministic-feature-snapshot-migration.test.ts`,
  `tests/meta-workspace-tombstone-purge-drizzle-adapter.test.ts`, `npm run typecheck`, `npm run db:check`.

## 2026-08-10 — A10 private current L2 reader

- `DrizzleDeterministicFeatureSnapshotRepository.loadCurrent()` exact workspace/feature ref'i altında
  persisted payload'ı tekrar hash-authenticate eder ve ilgili immutable invalidation event'lerini sıralı
  okur. Payload, scope veya event hash'i bozuksa `corrupt_store` ile fail-closed olur.
- Event yoksa `ready`, en az bir event varsa aynı historic feature ile `stale` döner; yeni L1 satırını
  seçmez, feature'ı değiştirmez ve bir fallback türetmez. Bu, read-time selective rejection için private
  primitive'tir.
- Decision Room/context/action akışına bağlanmamıştır; L3 window materialization ve stale feature'ın
  hangi future context'e gireceğine dair policy sonraki checkpoint'te kalır.
- Kanıt: `tests/deterministic-feature-snapshot-drizzle-repository.test.ts`,
  `tests/deterministic-feature-snapshot.test.ts`, `npm run typecheck`, `git diff --check`.

## 2026-08-10 — A10 saf L3 window artifact

- `deterministic-window-snapshot/1.0.0`, verified resolved timeframe ile yalnız aynı tenant/connection/
  account/entity scope'ta, settled ve `ready` durumundaki L2 feature'ları exact ref/hash/source-manifest
  listesiyle freeze eder. Window hash ve ref tüm canonical bileşenlerden türetilir.
- L2 feature pencerenin dışına taşarsa, scope karışırsa veya settled/ready değilse artifact oluşmaz. Raw,
  action ve write authority yapısal olarak yoktur.
- Saf contract'ın immutable relational persistence'ı ve L2 invalidation tüketimi aşağıdaki checkpoint'te
  eklendi; Decision Room'a bağlama hâlâ ayrıdır.
- Kanıt: `tests/deterministic-window-snapshot.test.ts`, `npm run typecheck`, `git diff --check`.

## 2026-08-10 — A10 private L3 window materializer substrate

- `deterministic_window_snapshots` ve `deterministic_window_snapshot_features`, L3 window hash/payload
  ile exact L2 feature id/ref/hash soy zincirini tenant composite FK/index altında immutable saklar.
  Migration ENABLE+FORCE RLS, revoke, append-only/tombstone guard ve purge child→header sırasını taşır.
- `DrizzleDeterministicWindowSnapshotRepository.save()`, saf artifact'i yeniden kurar; active workspace
  altında tüm feature hashlerini invalidation-free readback ile doğrular. Eksik/stale kaynakta header veya
  binding insert etmeden `source_changed` verir; action/approval/Meta-write yetkisi yoktur.
- Private L3 current reader exact persisted payload/bindingleri yeniden canonicalize eder; bağlı L2
  invalidation varsa yeni bir pencere seçmeden `stale` döner. Decision Room/context bağlantısı hâlâ açık
  kalır.
- Kanıt: `tests/deterministic-window-snapshot-drizzle-repository.test.ts`,
  `tests/meta-workspace-tombstone-purge-drizzle-adapter.test.ts`, `npm run typecheck`, `npm run db:check`.

## 2026-08-10 — A10 frozen context L2/L3 evidence closure

- Frozen context'teki `featureRefs` ve `windowRefs`, save transaction'ında exact tenant, mirror ve entity
  scope'taki immutable L2/L3 payloadlara yeniden bağlanır. L2 hash-authentication, L3'nün exact L2 bağları
  ve yeni L1 invalidation yokluğu zorunludur; ready context'te feature/window çiftinden biri eksikse context
  kaydedilmez. Historic/legacy boş data context'leri replay uyumluluğunu korur.
- Effective-context component ve invalidation allowlist'i L2 feature/L3 window tipleriyle forward-only
  genişletildi; RLS+FORCE ve public/API-role revoke yeniden açıkça uygulanır. L1 writer, değişen günlük
  source'un bağlı L2 feature ref'i için idempotent context invalidation olayı da yazar; frozen payloadlar
  asla değiştirilmez.
- Bu checkpoint Decision Room'a L3 drill-down veya action yetkisi bağlamaz; bütün capability'ler false
  kalır. Kanıt: `tests/effective-campaign-context-persistence.test.ts`,
  `tests/meta-sync-persistence.test.ts`, `tests/deterministic-window-snapshot-drizzle-repository.test.ts`,
  `npm run typecheck`, `npm run db:check`.

## 2026-08-10 — A10 private timeframe-bound L2→L3 materialization

- `materializeForTimeframe`, serbest bir eski window ref'i kabul etmez. Aynı workspace lock altında yalnız
  exact connection/account/entity scope ve resolved timeframe içine bütünüyle sığan, invalidation-free L2
  feature payloadlarını re-authenticate eder; boş, bozuk veya stale set fail-closed kalır.
- Seçilen set saf L3 contract ile yeniden kurulur ve var olan immutable save recheck'inden geçer. Böylece L2
  yazarlarıyla aynı workspace lock sınırında snapshot seti kaymaz; yeni tablo, HTTP/MCP, action veya Meta
  write yüzeyi eklenmez.
- Decision Room/template timeframe bindingi henüz bu private primitive'i çağırmaz; bu bağlantı ayrı
  checkpoint'te kurulacaktır. Kanıt: `tests/deterministic-window-snapshot-drizzle-repository.test.ts`,
  `tests/deterministic-window-snapshot.test.ts`, `npm run typecheck`, `git diff --check`.

## 2026-08-10 — A10 Decision Room L3 admission boundary

- Yeni Decision Room analysis run'ı, yalnız `ready`/blockersız frozen context'te en az bir canonical L2
  `feature_…` ve L3 `window_…` referansı varsa başlar. Context persistence bu ref'leri already exact
  tenant/mirror/entity L2/L3 artefactlarına bağladığından, run asset loader invalidated context'i zaten
  seçmez; bu gate serbest veya pre-L3 context'i deterministic olarak reddeder.
- Observation reader'ın L1 `snapshotRef` çıktısı context'in `snapshotRefs` listesine karşı doğrulanır;
  önceki yanlış L2 `featureRefs` karşılaştırması kaldırıldı. Böylece L1 evidence ile L2 feature kimliği
  birbirinin yerine geçirilemez.
- Mevcut claim edilmiş run asset'inin historical replay yolu yeni current-admission kontrolüne zorlanmaz.
  Bu checkpoint HTTP/action/Meta write eklemez; current context'i L3'e bağlayan private authoring/composition
  akışı hâlâ sonraki bağımlılıktır. Kanıt: `tests/decision-room-analysis-runtime.test.ts`,
  `npm run typecheck`, `git diff --check`.

## 2026-08-10 — A13 typed Meta write-spec boundary

- `meta-write-spec/1.0.0`, yalnız immutable `approval_required` action plan'dan typed
  status pause/activate ile campaign/ad-set daily/lifetime budget değişikliği adayını üretir.
  Raw Graph path/field, external ID, token veya transport taşımaz; K0/K1/K4 ve bütün forged/invalid
  planlar reddedilir.
- Üretilen spec execute/Meta-write authority vermez: ayrı bir single-use human execution grant,
  persisted freshness recheck, opaque-ref resolution ve read-after-write executor'ı hâlâ zorunludur.
  Bu checkpoint ağ çağrısı yapmaz ve gerçek Meta write açmaz.
- Kanıt: `tests/meta-write-spec.test.ts`, `tests/autonomy-valve.test.ts`, `npm run typecheck`.

## 2026-08-10 — A13 separate execution admission boundary

- `action-execution-admission/1.0.0`, approval kararını execute yerine geçirmez. Hedef unit'in
  approval grant'i tüketilmemiş/geçerli olmalı; yalnız hedef ve dependency closure'ının exact
  current freshness'i kabul edilir; ayrı human-presence kanıtı exact unit/hash/scope ve policy'nin
  grant-consumer rolüne bağlıdır.
- Admission, typed status/budget write-spec'i taşır fakat `admitted_for_disabled_executor` ile
  döner: execute, Meta write ve network dispatch capability'leri false'tur. Raw Graph, K0/K1/K4,
  stale/bozuk plan veya bağımlılık hiçbir executor'a ulaşamaz.
- Sonraki bağımlılık: server-private idempotent execution ledger, opaque Meta target resolution,
  human execution ceremony, read-after-write verify ve rollback. Bu checkpoint gerçek Meta write
  veya bir ağ çağrısı yapmaz.
- Kanıt: `tests/action-execution-admission.test.ts`, `tests/meta-write-spec.test.ts`,
  `tests/approval-lifecycle.test.ts`, `npm run typecheck`.

## 2026-08-10 — A13 durable disabled-execution admission ledger

- `action_execution_attempts` ve `action_execution_events`, approved unit → disabled-executor
  admission geçişinin kalıcı ve idempotent kaydıdır. Repository çağıranın plan/hedef/ref'lerini
  güvenmez; workspace, unit, approve kararı ve grant'i aynı transaction içinde tekrar çözer,
  DB'deki immutable planla typed write-spec hash'ini yeniden üretir.
- İlk ve tek mevcut olay `admitted`tir. Event payload'ı yapısal olarak
  `executionAuthority: none` ve `networkDispatched: false` taşır; RLS/FORCE RLS, public-role
  revoke, append-only+tombstone koruması ve tenant-composite FK'ler migration ile eklenmiştir.
- Bu bir executor değildir: insan execution ceremony, tek-kullanımlık grant tüketimi, opaque
  Meta target çözümü, dispatch, read-after-write ve rollback sonraki merkezi checkpoint'tir.
  Bu checkpoint ağ çağrısı ve gerçek Meta write yapmaz.
- Kanıt: `tests/action-execution-admission-drizzle-repository.test.ts`,
  `tests/action-execution-admission.test.ts`, `tests/meta-workspace-tombstone-purge-drizzle-adapter.test.ts`,
  `npm run typecheck`, `npm run db:check`.

## 2026-08-10 — A13 parent-state and budget-owner eligibility matrix

- `meta-write-eligibility/1.0.0`, typed write-spec ile immutable source snapshot'ı yeniden
  bağlar. Pause adayında target'ın effective ACTIVE olması; activate adayında target'ın configured
  PAUSED ve tüm parent'ların effective ACTIVE olması; budget adayında ise campaign/adset'in exact
  active budget owner olması zorunludur. Unknown, inactive veya cross-target durumların tamamı
  reason-coded `blocked` döner.
- Sonuç yalnız `eligible_for_separate_human_execution` adaylığıdır. Execute, Meta write ve network
  dispatch capability'leri yapısal olarak false kalır; hiçbir database mutation, HTTP endpoint,
  Graph request veya gerçek Meta write eklenmedi.
- Kanıt: `tests/meta-write-eligibility.test.ts`, `tests/meta-write-spec.test.ts`,
  `tests/autonomy-valve.test.ts`, `npm run typecheck`.

## 2026-08-10 — A13 eligibility-bound disabled admission

- `action-execution-admission/1.0.0`, artık typed write-spec yanında aynı unit scope'una ait
  eligibility snapshot/result hash'ini de immutable admission hash'ine dahil eder. Target state,
  parent chain, budget owner veya workspace/account scope'u uygun değilse disabled-executor
  admission dahi üretilmez.
- Bu checkpoint caller-provided source snapshot'ı salt domain sözleşmesinde bağlar; sonraki server-
  private executor checkpoint'i aynı snapshotı current persisted Meta mirror'dan yeniden çözmek
  zorundadır. Bu nedenle execution/Meta-write/network capability'leri false kalır ve yeni transport,
  DB write veya HTTP endpoint yoktur.
- Kanıt: `tests/action-execution-admission.test.ts`,
  `tests/action-execution-admission-drizzle-repository.test.ts`,
  `tests/meta-write-eligibility.test.ts`, `npm run typecheck`.

## 2026-08-10 — A10 interactive proposal-only campaign brief surface

- Kampanyalar görünümündeki `CampaignPlanningBriefPanel`, çalışma kitabında görünen sıralamayı
  (pazar → dil → hizmet → iş amacı → dönüşüm yolu → kapasite/kreatif) kullanıcı tarafından
  değiştirilebilir bir taslakta uygular. Her değişimde mevcut pure brief yeniden hesaplanır ve
  yalnız tek sonraki eksik karar, planlanan şerit, insan-incelemeli sıra ile kıyas sınırı gösterilir.
- Lead form/WhatsApp, üst huni, öğrenme, kesinti ve sınıflandırma durumları mevcut domain
  sözleşmesinden gelir; panel yeni bir iş kuralı veya kalıcı source of truth oluşturmaz. State
  browser oturumunda geçicidir; API, database write, campaign create/publish/approval/execute ve
  Meta write eklenmedi.
- Kanıt: `tests/campaign-planning-brief-panel.test.ts`,
  `tests/interactive-campaign-template.test.ts`, `npm run build`; gerçek browser kabulünde route
  `lead_form → whatsapp` değişimi doğru outcome'a döndü, write control sayısı `0` kaldı ve
  390/768/1440 viewport'larında yatay taşma `0` doğrulandı.

## 2026-08-10 — A10 private timeframe-bound L3 context composer

- `TimeframeBoundAnalysisContextComposer`, input olarak yalnız workspace/entity/timeframe alır. Son geçerli,
  invalidate edilmemiş context repository'den çözülür; private mirror UUID'leri ve server clock ile L3
  materializer çağrılır. Caller context/fact, L2 feature, window ref, database ID veya capture time
  enjekte edemez.
- Yeni context mevcut immutable context'in canonical bileşenlerini korur ancak yalnız materializer'ın exact
  L2 feature refs ve L3 window ref'iyle `data.ready` olur; evidence-bound writer bütün relational recheck'leri
  tekrar uygular. Authority snapshot, context'in yeni capture anında geçerli değilse persistence reddeder.
- Tek server-private Drizzle root bu reader/materializer/writer'ı aynı database sınırında kurar; HTTP, MCP,
  action veya Meta write yüzeyi eklenmedi. Kanıt: `tests/timeframe-bound-analysis-context-composer.test.ts`,
  `tests/timeframe-bound-analysis-context-composer-runtime.test.ts`, `npm run typecheck`, `git diff --check`.

## 2026-08-11 — A10.4c-14 closed-world current-source persistence acceptance

- Gerçek PostgreSQL verifier, tek bir geçici tenantta canonical Meta hierarchy/config snapshot'ı, category
  profile/composition, cadence, reviewed guidance selection/pack, policy lifecycle, repository-verified
  authority snapshot/catalog ve promotion registry zincirini normal private lifecycle'ler üzerinden kurar.
  `DrizzleCurrentEffectiveAnalysisContextSourceReader` aynı read-only snapshotta bu kaynakları çözer;
  server-private composer context'i `evidence_bound` olarak yazar ve tekrar yükler.
- Empty published policy registry artık ayrı bir policy iddia etmediğinde boş `ANY(...)` binding sorgusu
  çalıştırmaz; snapshot/catalog/registry hash'i doğrulandıktan sonra zero-item immutable composition sidecar
  yazılır. Nonempty policy bağlamları exact relational binding doğrulamasını korur.
- Verifier public campaign read sınırında iç UUID/hash kullanmaz, API'nin SHA-256 türetilmiş `ref_…` aliasını
  kullanır. Cross-tenant scope ve malformed alias reddedilir. Ağ, action ve Meta write çağrıları sıfırdır.
  Primary ve foreign fixture workspace'leri yalnız locked tombstone servisiyle temizlenir; survivor sayıları
  sıfırdır. Bu acceptance data window bağlamaz: `data.not_ready` / `analysis_window_not_bound` korunur;
  Decision Room, HTTP/MCP, approval veya G4 capability'si açılmaz.
- Kanıt: `npm run verify:current-effective-analysis-context-source-db`; `npm test` (316 dosya/1.719 test),
  `npm run build`, `npm run db:check`, `npm run check:security`, `npm run check:security-boundaries`,
  `npm run check:secret-artifacts` ve `git diff --check`.
