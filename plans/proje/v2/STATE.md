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
| 09 | kategori ve talimat | DEVAM | 08 | A09.6c kapalı; A09.6d dependency coverage ve A09.7 guarded category lifecycle kodu hazır, canlı DB+oturumlu browser kabulü açık |
| 10 | zamansal analiz | DEVAM | 06,08,09 | objective schema/playbook temeli var; tam motor sırada |
| 11 | bütçe planlama | KAPALI | 09,10 | Checklist'teki envelope/constraint/forecast/scenario/ledger/target binding dilimleri kanıtlı; upstream context genişlemeleri A09/A10 altında izleniyor |
| 12 | prompt/advisor | DEVAM | 09–11 | narrative envelope/claim guard temeli var; translator/ledger sırada |
| 13 | eylem valfi ve rutin | AÇIK | 04,10–12 | planlandı; write kapalı |
| 14 | kontrol merkezi | AÇIK | 07,09–13 | planlandı |

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
