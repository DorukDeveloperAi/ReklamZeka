# ReklamZeka Meta Reklam İşletim Sistemi — REQUIREMENTS (v2)

> v1 R-G1–R-G7 ve R-01–R-07 aynen mirastır. Aşağıdaki gereksinimler tek ana
> planın ekleyici devamıdır; ölçülemeyen “akıllı/agentic” iddiası kabul edilmez.

## Global ve miras

| id | requirement | doğrulama |
|---|---|---|
| R-G1 | Şartname, plan, kod ve kanıt çıpaları benzersiz ve bağlıdır. | foundation + plan gate |
| R-G2 | Her veri/eylem workspace üyeliği ve role action policy ile sınırlanır. | tenant/role negatif matrisi |
| R-G3 | Sync, run, decision ve action tekrarı kayıt/Meta eylemi çoğaltmaz. | idempotency/concurrency suite |
| R-G4 | Metrik, bulgu, plan ve eylem snapshot + tanım/policy sürüm bağını korur. | trace contract suite |
| R-G5 | Token/sır log, hata, prompt, istemci, audit veya artifact'a sızmaz. | secret scan/redaction suite |
| R-G6 | v1 MVP salt-okunur kalır; write yolu yalnız A13 valfi ve ayrı scope/flag ile açılır. | import/network boundary + scope gate |
| R-G7 | Kritik kullanıcı yolculuğu desktop/tablet/mobile tarayıcı kanıtı taşır. | browser E2E |
| R-G8 | Varsayılan her analiz/plan/rutin dry-run'dır; approval execute değildir. | default/one-key negative tests |
| R-G9 | LLM/agent para harcayan karara ve Meta writer'a import/ağ yoluyla ulaşamaz. | architecture import boundary |
| R-G10 | Aynı snapshot + tanım/policy sürümleri aynı bulgu ve planı byte-eş üretir. | deterministic replay |
| R-G11 | Eksik/uyumsuz veri sessiz sıfır veya generic conversion'a dönüşmez. | undefined/reason matrix |
| R-G12 | Her eylem önceki/yeni değer, onay, policy, Meta request sonucu ve verify kaydı taşır. | append-only action ledger |
| R-G13 | Yeni kategori, mapping, kural, playbook ve schedule kod değişikliği olmadan tanım verisiyle eklenir. | definition-only proof |
| R-G14 | Çözülemeyen policy çatışması veya belirsiz sınıflandırma fail-closed park edilir. | conflict/uncertain suite |
| R-G15 | Para birimleri kur kaynağı olmadan toplanmaz; timezone/attribution her sonuçta görünür. | currency/time/attribution suite |
| R-G16 | Düz metin talimat doğrudan çalışmaz; normalize taslak, etki önizleme ve yayın sürümü ister. | instruction ingestion E2E |
| R-G17 | Core sync/classification/analysis/policy/budget/action motorları model/provider SDK'sı import etmez; modelsiz deterministik koşum tamdır. | import-boundary + no-model E2E |
| R-G18 | Codex CLI/VS Code, Claude Code ve dashboard aynı tenant-scoped MCP/proposal/action state'ini kullanır; hiçbir agent raw Meta write veya kendi başına approval yolu alamaz. | multi-client contract/security suite |
| R-G19 | Bir workspace çok business connection, reklam hesabı, Page, Instagram ve destination asset'iyle account-level izolasyon ve capability snapshot'la çalışır. | multi-account/asset permission matrix |
| R-G20 | Varsayılan execution autonomy `approval_only`dır; her Meta write line item ayrı onaylanabilir/reddedilebilir ve alt scope/süre sonu kendiliğinden otonomiyi genişletemez. | autonomy inheritance/expiry/bypass suite |
| R-G21 | Action bundle yalnız sunum ve dependency kabıdır; authorization, idempotency, stale kontrolü, execute ve audit atomik action unit bazındadır. | partial approval/dependency DAG E2E |
| R-G22 | ReklamZeka OpenAI/Anthropic model API'si veya API key'i kullanmadan; kurulu ve kullanıcı tarafından login edilmiş yerel AI CLI session'larıyla çalışır. Meta Graph bağlantısı bu kısıttan ayrıdır. | no-model-api secret/network boundary |

## A08 — Meta dijital ikizi

| id | requirement | doğrulama |
|---|---|---|
| R-08.1 | Account→campaign→adset→ad→creative ilişkisi external ID, first/last seen ve raw provenance ile kayıpsızdır. | hierarchy golden + orphan test |
| R-08.2 | Campaign objective (legacy dahil), buying type, bid strategy, special category, Advantage+, status/issue, budget ve zaman alanları saklanır. | Meta schema contract |
| R-08.3 | Ad set optimization/billing/bid/attribution/promoted object/targeting/budget owner; ad status/tracking/review; creative text/CTA/link/format/raw spec tutulur. | entity field coverage matrix |
| R-08.4 | Insights campaign/adset/ad seviyesinde günlük; action/action_value ve izinli breakdown'larla, toplamsallık bilgisiyle saklanır. | insights golden + additive guard |
| R-08.5 | Envanter, kreatif ve insights ayrı cursor/run'dır; insights level/date slice; usage header, backoff ve adaptive page size vardır. | payload-500/rate-limit recovery tests |
| R-08.6 | Snapshot diff; external status/budget/config değişikliğini `external_change` timeline olayına çevirir. | diff/replay suite |
| R-08.7 | Token mevcut güvenli kaynaktan secret reference ile alınır; repo/env değeri kopyalanmaz ve read/write scope ayrıdır. | secret provenance + scope test |
| R-08.8 | Workspace çok Meta connection/account taşır; hesap hata/rate-limit'i diğer hesabın sync/run'ını durdurmaz. | multi-account partial-success E2E |
| R-08.9 | Facebook Page, Instagram account, pixel/dataset, app ve WhatsApp/destination asset'leri platform ID/capability/permission ve entity edge'leriyle tekilleşir. | asset graph/orphan suite |
| R-08.10 | Account group ortak analysis/category/budget/schedule uygulayabilir; child account currency/timezone/cap/permission ve action approval ayrı kalır. | group inheritance/isolation tests |
| R-08.11 | Yayındaki her reklamın effective primary text/headline/description/caption, CTA, destination, actor, post/media/creative kimliği ve dinamik varyantları kaynak alan/provenance ve ad bağıyla snapshot'lanır; eksik alan tahmin edilmez. | live-copy/spec extraction golden matrix |
| R-08.12 | Bağlı Instagram/Page gönderi envanteri ownership, permission, promotion capability, media type, lifecycle ve last-seen ile okunur; hassas preview URL'leri sunucu tarafında süreli sunulur. | post inventory/capability/security E2E |

## A09 — Kategori ve talimat sistemi

| id | requirement | doğrulama |
|---|---|---|
| R-09.1 | Bir entity birden fazla iç kategori taşır; kategori parent, renk, açıklama, owner, durum ve sürüm taşır. | category CRUD/lifecycle suite |
| R-09.2 | Selector; hesap/platform/name pattern/Meta objective/optimization/geo/language/budget model/status/creative attribute/entity ID bileşimini destekler. | selector golden/negative matrix |
| R-09.3 | Atama kaynağı, evidence, confidence ve manuel lock saklanır; manuel kilit inference tarafından ezilmez. | precedence test |
| R-09.4 | Legacy ve yeni Meta objective'leri kanonik objective playbook'una açık mapping ile dönüşür; bilinmeyen değer `uncertain` kalır. | mapping fixture matrix |
| R-09.5 | Talimat raw text + normalized policy + scope + priority + effective dates + version + owner + status + reason taşır. | schema/lifecycle suite |
| R-09.6 | Policy türleri hard constraint, target, preference, exception, prohibition, approval ve schedule'dır. | strict DSL parser negatives |
| R-09.7 | Miras/precedence MASTER sırasına uyar; bastırılan kurallar kayıpsız trace'te, çözülemeyen çatışma parked'dır. | conflict/suppression suite |
| R-09.8 | Kullanıcı talimatı görür, filtreler, etkisini önizler, taslaklar, yayınlar, durdurur, yeni sürümle düzenler ve arşivler. | role-aware API/browser E2E |
| R-09.9 | İç kategori kullanıcı tanımlı dimension, cardinality ve entity-level taşır; single boyutta çift etkin atama conflict'tir. | dimension/cardinality matrix |
| R-09.10 | Kategori yalnız label değil; analysis playbook, rule/instruction bundle, budget/transfer, schedule, action ve creative policy referansları taşır. | category-profile contract |
| R-09.11 | Campaign kategorileri tanımlı inheritance ile child adset/ad/creative context'ine iner; explicit child override/addition ve effective-context snapshot kayıpsızdır. | inheritance/history suite |
| R-09.12 | Kategori arşiv/düzenleme öncesi etkilenen entity, policy, budget ve automation sayısı gösterilir; tarihsel run snapshot'ı değişmez. | impact/delete-history E2E |
| R-09.13 | `PromotionTemplate` objective/optimization, actor/destination, placement, naming/tracking, reuse/create policy, budget/schedule defaults ve immutable `AudiencePresetVersion` referansı taşır. | promotion-template schema/lifecycle suite |
| R-09.14 | Agent template'i internal category, account/Page/Instagram, post/media type ve kullanıcı alias/talimatından deterministik selector ile önerir; belirsizde targeting uydurmaz ve publish-ready olmaz. | template resolution/ambiguity matrix |

## A10 — Zamansal analiz motoru

| id | requirement | doğrulama |
|---|---|---|
| R-10.1 | Analiz context'i objective + funnel + optimization event + Meta config + internal categories + policy set taşır. | context snapshot test |
| R-10.2 | Amaç playbook'u primary/diagnostic/guardrail/min sample/default window/evaluation/decision guide taşır. | playbook contract |
| R-10.3 | Trend, robust anomali, threshold, pacing, previous/weekday-matched, target/baseline, cohort ve pre/post action analizleri saf fonksiyonlardır. | golden formula suite |
| R-10.4 | Rolling/fixed/calendar/lifetime/learning/action-relative window ve comparison timezone farkında resolve edilir. | timeframe golden matrix |
| R-10.5 | Reach/frequency gibi non-additive metrik yanlış toplanmaz; ratio toplam bileşenlerinden hesaplanır. | Simpson/non-additive tests |
| R-10.6 | Freshness, coverage, attribution lag, learning/cooldown ve minimum sample kararı bastırabilir; sebep zorunludur. | insufficient-data matrix |
| R-10.7 | Farklı objective/KPI'lar tek başarı skorunda karştırılmaz; cohort yalnız uyumlu profile'da kurulur. | cross-objective negative test |
| R-10.8 | Her finding snapshot ID'leri, metrik formülü, window, threshold, policy/rule sürümü ve confidence reason taşır. | finding schema |

## A11 — Bütçe planlama

| id | requirement | doğrulama |
|---|---|---|
| R-11.1 | Budget envelope account/category/region/campaign/adset scope'unda period, currency, min/max/fixed/reserve taşır. | budget schema suite |
| R-11.2 | Transfer matrisi allow/deny/only-within-group destekler; korunan bölgenin pahalılık nedeniyle bütçesi taşınamaz. | protected-allocation golden test |
| R-11.3 | CBO/ABO ve campaign/adset budget owner doğru resolve edilmeden plan üretilemez. | owner resolution matrix |
| R-11.4 | Allocation fixed/proportional/priority-weighted/ladder olabilir; tümü deterministic constraint resolver'dan geçer. | allocation golden suite |
| R-11.5 | Target KPI, volume, pacing, forecast, min sample, max change, cooldown ve learning koruması planı sınırlar. | cap/cooldown/learning tests |
| R-11.6 | Planned/committed/actual/forecast ayrıdır; toplamlar envelope'la ve child allocations'la uzlaşır. | reconciliation tests |
| R-11.7 | Simülasyon affected entities, before/after, tahmini etki aralığı, risk, violated/satisfied constraints ve suppression taşır. | simulation schema/snapshot |
| R-11.8 | Bütçe artışı ve yeni harcama otonom olamaz; kullanıcı hard constraint'i tavsiye skoruyla ezilemez. | risk/autonomy negatives |

## A12 — Prompt ve advisor

| id | requirement | doğrulama |
|---|---|---|
| R-12.1 | Prompt envelope sabit policy + context + playbook + resolved policies + findings + budget simulation + user guidance verisidir. | envelope snapshot |
| R-12.2 | User guidance `untrusted_data`dır; tenant/tool/SQL/network/timeframe/policy/action yetkisini değiştiremez. | injection negative matrix |
| R-12.3 | Her anlatım/plan ifadesi findingId/policyId/simulationId referansı taşır; yeni metrik veya eylem uyduramaz. | claim validator |
| R-12.4 | Doğal dil talimatı yalnız strict normalize-policy taslağı üretir; bilinmeyen alan, belirsiz scope ve çatışma kullanıcıya sorulur. | NL-to-policy fixture/eval |
| R-12.5 | Advisor salt-okur snapshot/ledger; yalnız kendi run/note/draft alanına yazar ve action/decision/control tablolarına yolu yoktur. | readonly/import attack test |
| R-12.6 | Model/prompt/sampling/sanitization sürümü, input hash, output, token/maliyet, redaksiyon ve durum audit edilir. | advisor ledger suite |
| R-12.7 | Model yok/hata/bütçe aşımında deterministik analiz ve plan çalışmaya devam eder; sebep kaydedilir. | fallback tests |
| R-12.8 | Local agent contract MCP-first'tür; client adı core policy/tool/action semantics'ine girmez ve modelsiz fixture session CI default'udur. | local-client conformance suite |
| R-12.9 | Codex CLI/VS Code ve Claude Code kendi local login/session'ıyla aynı envelope, schema validator, tool broker ve run ledger'a bağlanır; ReklamZeka provider API key'i saklamaz. | no-API local-session E2E |
| R-12.10 | ReklamZeka localhost Streamable HTTP veya project STDIO MCP server'da read/proposal tools'u ayırır; auth workspace/role/accountGroup/tool/expiry'ye bağlıdır. | local MCP auth/tool-scope matrix |
| R-12.11 | Local agent category/instruction/analysis/budget/post-promotion proposal oluşturabilir; approve/execute yalnız application role/valve ve modelin mint edemediği HumanPresenceGrant ile olur. | Codex/Claude human-presence E2E |
| R-12.12 | Dashboard session hub connected CLI/client, health, selected context handoff, citations/tool trace, proposal/run durumunu taşır; CLI conversation memory policy state'in kaynağı değildir. | local-session hub browser E2E |
| R-12.13 | MCP-capable yeni CLI config ile eklenir; MCP'siz CLI yalnız allowlist binary/arg şablonlu LocalCliAdapter kullanır, dashboard arbitrary shell veya existing TTY kontrol edemez. | CLI adapter security negatives |

## A13 — Eylem valfi, scheduler ve rutin

| id | requirement | doğrulama |
|---|---|---|
| R-13.1 | Tek action executor yalnız allowlist pause/activate/budget/schedule alanlarına yazabilir; raw Graph path/field yoktur. | writer allowlist tests |
| R-13.2 | K0–K4 risk, role, account allowlist, enabled policy, caps, cooldown, freshness, conflict, approval ve execute anahtarı sırayla fail-closed valftir. | valve branch matrix |
| R-13.3 | Activation, budget increase ve structural K4 açık onay ister; approve ayrı execute ayrıdır. | state-machine negative tests |
| R-13.4 | Execute decisionId idempotency anahtarıdır; Meta update sonrası read-after-write beklenen değeri doğrular, farkta failed/parked olur. | replay/verify tests |
| R-13.5 | Rollback yeni denetimli eylemdir; eski değer ve Meta kısıtı uygunsa çalışır, aksi halde manuel recovery verir. | rollback matrix |
| R-13.6 | Schedule hourly/daily/weekly/monthly/after_sync; timezone, settle delay, misfire, enabled ve idempotent logical fire taşır. | DST/misfire/concurrency suite |
| R-13.7 | Manuel, scheduled ve agentic rutin aynı executor'la sync→analyze→plan→approval queue çalıştırır; rutin kendiliğinden write yapmaz. | routine E2E/no-write proof |
| R-13.8 | External/manual Meta değişikliği otomasyonu cooldown/park eder ve kullanıcıya reconcile seçeneği sunar. | intervention fixture |
| R-13.9 | Run ledger resolved window/snapshot/definition-policy versions/status/attempt/error/cost/artifacts taşır. | run ledger contract |
| R-13.10 | Campaign/adset/ad pause/activate typed eylemdir; effective parent chain, review/issues, schedule ve stale snapshot doğrulanmadan activate olmaz. | entity-status eligibility matrix |
| R-13.11 | Budget write yalnız resolved campaign/adset budget owner'da olabilir; ad-level budget talebi şema seviyesinde reddedilir. | budget-owner write negatives |
| R-13.12 | Manual/assisted/automated-read/policy-automated modları versioned scope policy'dir; child scope parent'tan daha riskli moda genişleyemez. | hybrid-mode inheritance suite |
| R-13.13 | Policy-automated yalnız K1 ve explicit izinli/cap'li K2; K3/K4 tüm provider/agent/schedule yollarında insan onaylıdır. | autonomy bypass negative matrix |
| R-13.14 | `approval_only` profili K1–K4 tüm write action'larını insan onayına zorlar; kilit yalnız yetkili, versioned explicit değişiklikle gevşer ve zaman aşımı otomatik genişleme yapmaz. | approval-only lock matrix |
| R-13.15 | Bir proposal bundle campaign/adset/creative/ad/budget/status action unit'larına ayrılır; unit approve/reject/request-changes/expire olabilir ve reddedilen dependency downstream execute'u kapatır. | atomic partial-approval DAG suite |
| R-13.16 | Mevcut Instagram/Page gönderisini öne çıkarma; linked actor ownership, promotion eligibility ve versioned PromotionTemplate+AudiencePreset, objective/optimization, destination, placement, budget owner preflight'ından sonra K4 action bundle üretir. | templated existing-post promotion sandbox E2E |
| R-13.17 | Sistem yeni metin/görsel/video/creative varyantı üretmez veya değiştirmez; existing-post promotion yalnız frozen post identity/content hash'ini referanslar. | no-creative-generation/import/network negatives |
| R-13.18 | Creative/post/ad proposal preview'i seçilen son spec hash'ine bağlıdır; copy, asset, actor, destination, ad set veya budget değişince ilgili approval stale olur ve yeniden onay ister. | creative approval invalidation matrix |

## A14 — Kontrol merkezi ve rollout

| id | requirement | doğrulama |
|---|---|---|
| R-14.1 | Portfolio ekranı hesap→campaign→adset→ad→creative drill-down ve filtrelenebilir internal category/Meta context taşır. | hierarchy browser E2E |
| R-14.2 | Talimat/kategori merkezi raw+normalized policy, inheritance, conflict, affected entity ve version history gösterir. | policy UI E2E |
| R-14.3 | Analiz stüdyosu template, timeframe, comparison, dry-run, publish, schedule ve run history akışıdır. | analysis journey E2E |
| R-14.4 | Bütçe merkezi envelope/allocation/transfer lock/forecast/simulation ve before-after plan gösterir. | budget journey E2E |
| R-14.5 | Approval inbox risk, gerekçe, constraints, affected entities ve approve/reject/expire gösterir; execute ayrı yetkidir. | approval role E2E |
| R-14.6 | Timeline sync/config/policy/finding/plan/approval/action/verify/external change/outcome olaylarını tek kronolojide bağlar. | timeline causality test |
| R-14.7 | Kreatif kütüphanesi mevcut asset/varyantı performance ve bağlamla karşılaştırır; üretme/yazma yapmaz. | creative read-only E2E |
| R-14.8 | Owner/admin/analyst/operator/viewer rolleri ayrıdır; production write feature flag, quota, alarm, kill switch ve runbook ister. | role/operations gate |
| R-14.9 | Rollout shadow-read → dry-run → approval-only write → sınırlı policy; aşama başına KPI ve geri dönüş kapısı taşır. | rollout evidence report |
| R-14.10 | Dashboard portfolio/account-group switcher ve Page/Instagram/asset graph/permission/capability durumu taşır. | multi-account dashboard E2E |
| R-14.11 | Agent console Codex/Claude/dashboard-provider kaynaklı oturumları tek trace'te ayırır; model/provider değiştirme proposal semantics'ini değiştirmez. | provider-switch golden E2E |
| R-14.12 | Dashboard campaign/adset/ad status proposal, campaign/adset budget proposal, approval, execute, verify ve rollback'i doğru entity seviyesinde gösterir. | action-control browser E2E |
| R-14.13 | Creative explorer yayındaki reklam metnini, dinamik varyantları, CTA/destination'ı, post/media kaynağını ve performansını reklam/adset/campaign bağlamında gösterir. | live-ad-copy browser E2E |
| R-14.14 | Kullanıcı bağlı Instagram/Page gönderisini ve yayınlanmış promotion template/audience preset'i seçip mevcut veya yeni uygun ad set içinde taslak oluşturabilir; identity/template-audience/bütçe/create/activate ayrı approval unit'larıdır. | templated existing-post journey E2E |
| R-14.15 | Approval inbox bundle'ı satırlara açar; her satırda approve/reject/request-changes, dependency, stale/expiry, before-after, spend etkisi ve ayrı execute durumu gösterir; toplu seçim opsiyoneldir. | partial approval responsive/a11y E2E |
| R-14.16 | Otonomi paneli planlama modunu execution autonomy'den ayırır; default/aktif override/kill switch açık görünür ve approval-only kilidi UI, agent veya schedule tarafından atlanamaz. | autonomy control role/security E2E |
| R-14.17 | Session hub Codex CLI/VS Code, Claude Code ve ek MCP CLI bağlantı/config/health/handoff'unu gösterir; kullanıcı aynı proposal ve atomik onay işini dashboard veya local companion CLI'dan sürdürebilir. | dashboard↔CLI handoff E2E |

## Kapsam dışı / ayrı karar isteyen

- Kampanya/ad set/ad silme ve kontrolsüz toplu kopyalama.
- K4 targeting, bid strategy ve optimization goal serbest düzenleme; yalnız typed plan/approval kontratı.
- Her türlü yeni reklam metni, görseli, videosu veya creative varyantı üretme/değiştirme.
- Agent'in serbest hedef kitle/targeting üretmesi; yalnız yayınlanmış audience preset kullanılır.
- ReklamZeka'nın OpenAI/Anthropic model API'sini veya provider API key'ini yönetmesi.
- Kara-kutu ML budget optimizer ve nedensellik garantisi.
- Kullanıcının kod, SQL, raw cron veya raw Meta Graph request çalıştırması.
- Meta dışı write connector; ortak model hazır olsa da ayrı rollout ister.
