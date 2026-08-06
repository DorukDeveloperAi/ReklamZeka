# ReklamZeka — kanonik ürün distilasyonu

> Tarih: 2026-08-06
> Kaynak: Bu ürün üzerine yapılan bütün kullanıcı görüşmeleri, mevcut kod, v1/v2 planları,
> Meta keşfi ve ADR kararlarının damıtılmış ürün doktrini.
>
> Otorite sınırı: Bu belge ürünün **ne olduğu ve nasıl davranacağı** konusunda kısa kanonik
> referanstır. Teslim sırası `plans/proje/v2/MASTER.md`, test edilebilir hükümler
> `REQUIREMENTS.md`, açık işler `CHECKLIST.md`, gerçek durum `STATE.md` tarafından yönetilir.

## 1. Tek cümlelik ürün

ReklamZeka, birden çok Meta reklam hesabının gerçek platform yapısını kullanıcının kendi
kampanya kategorileri, stratejileri, bütçe taahhütleri ve zaman içindeki karar geçmişiyle
birleştirerek; kanıtlı analiz, sakin karar temposu, izlenebilir bütçe planı ve insan onaylı
reklam operasyonu sağlayan model-agnostic bir reklam işletim sistemidir.

## 2. Çözdüğümüz esas problem

Sorun yalnız metrikleri bir dashboardda göstermek değildir. Gerçek karar şu bağlamların
aynı anda doğru ele alınmasını ister:

- Meta'nın account→campaign→ad set→ad→creative/post gerçeği;
- objective, optimization, CBO/ABO, attribution, audience, actor ve destination ayrıntıları;
- kullanıcının işletmeye özel iç kampanya kategorileri ve isimlendirme mantığı;
- kategori, hesap, kampanya, bölge, bütçe veya başlık bazlı kişisel talimatları;
- kaynaklı Meta best-practice bilgisi ve bunun kullanıcının yaklaşımıyla çatışabileceği yerler;
- anlık durum değil, learning/cooldown/attribution ve önceki hamlelerle birlikte zaman;
- Meta proxy sonuçları ile mümkünse gerçek nitelikli lead/randevu/satış/gelir sonucu;
- bütçe hedefi, sabit tahsis, transfer yasağı ve harcama riskleri;
- önerinin kim tarafından neden verildiği, onaylandığı ve sonrasında ne olduğu.

Ürün bu bağlamları kaybetmeden sade kalmalıdır. Her davranışı ilk günden katı kutulara
çevirmek de, her şeyi serbest bir AI prompt'una bırakmak da hedef değildir.

## 3. Ürün doktrini

1. **Önce gerçeği aynala.** Meta entity/config/insight/creative/post verisi kayıpsız ve
   kaynaklı olmadan analiz veya write açılmaz.
2. **Meta sınıflandırması ile iç kategoriyi karıştırma.** Objective ve optimization
   platform gerçeğidir; hizmet, bölge, dil, kampanya rolü, bütçe havuzu ve koruma sınıfı
   kullanıcının işletme gerçeğidir. Karar ikisinin bileşiminden çıkar.
   Mecra da bağımsız eksendir: ilk derin işletim sistemi Meta içindir; gelecekte başka
   mecralar ortak portföye eklenebilir ama platform-native semantics generic tipe ezilmez.
3. **Esnek düşünce, deterministik sınır.** Agent yorumlar, soru sorar ve plan taslağı
   hazırlar. Metrik, policy precedence, bütçe uzlaşması, yetki, onay ve Meta write valfi
   deterministiktir.
4. **Ham veriyi modele yığma.** Agent kompakt ve kaynaklı kanıtla başlar; gerektiğinde
   sınırlı drill-down yapar.
5. **Hareket etmek zorunlu değildir.** `No-change`, izle ve kontrollü test geçerli karar
   türleridir. Sistem aktivite üretmek için kampanyayı sürekli kurcalamaz.
6. **Kullanıcının iş kuralını koru.** Örneğin pahalılaşsa da korunacak bir bölge bütçesi,
   generic verimlilik önerisiyle başka yere taşınmaz.
7. **Sohbet sessiz öğrenme değildir.** Tekrar kullanılabilir yöntem önce AdvisedPractice
   olur; outcome ve açık review olmadan algoritma veya policy'ye dönüşmez.
8. **Approval execute değildir.** Paket yalnız sunum kolaylığıdır; yetki ve audit birimi
   tek bir atomik ActionUnit'tır.
9. **Karmaşıklık kazanılır.** İlk sistem modular monolith+PostgreSQL+DB worker'dır. Yeni
   veri veya servis altyapısı ancak ölçülen darboğazla gelir.
10. **Kullanıcı tuning yapabilmelidir.** Kategori, guidance, policy, agenda, timeframe,
    cadence, bütçe, template ve otonomi ayarı dashboarddan ve yetkili yerel agent
    session'ından aynı sürümlü state üzerinde yönetilir.

## 4. Sistemin sekiz katmanı

### 4.1 Meta Read Mirror — platform gerçeği

- Birden çok Business connection, ad account, Page, Instagram, pixel/dataset, app,
  WhatsApp/destination asset'i.
- Campaign, ad set, ad, creative ve post; configured/effective status ve ilişki graph'ı.
- Objective/legacy objective, buying/bid strategy, special category, Advantage+, CBO/ABO,
  gerçek budget owner, optimization/billing/attribution/promoted object.
- Geo/language/audience/placement/device özeti; account currency/timezone/capability.
- Günlük insights, action/action-value ve toplamsallık bilgisi.
- Yayındaki effective primary text, headline, description/caption, CTA, destination,
  actor, post/media identity ve dynamic creative varyant provenance'ı.
- Inventory, creative ve insights ayrı, cursor'lı, rate-limit duyarlı ve idempotent sync olur.
- Bizim ledger dışındaki Meta değişikliği `external_change` timeline olayıdır.

### 4.2 Business Context — iç kategori sistemi

Tek bir `campaignType` yoktur. Bir kampanya aynı anda şu gibi bağımsız boyutlar taşır:

`service_line`, `brand_or_clinic`, `geo_market`, `language`, `campaign_role`,
`funnel_intent`, `audience_strategy`, `destination`, `budget_pool`, `operating_mode`,
`lifecycle`, `experiment`, `protection_class` ve kullanıcı tanımlı boyutlar.

Atama; manuel kilit, açık mapping, isim standardı, Meta özelliği veya agent önerisiyle
gelir. Öncelik `manual_locked > published mapping > naming > property rule > agent
suggestion > unknown`dur. Her sonuç evidence/confidence taşır; single-cardinality çatışması
sessiz seçilmez. Campaign bağlamı child entity'lere miras olabilir; override/addition izlenir.

Kategori bir etiket değil, aşağıdakilere versioned referans taşıyan karar profilidir:

- analiz playbook'u ve AnalysisAgenda;
- guidance set ve AdvisedPractice;
- decision cadence ve deney yaklaşımı;
- bütçe pool/floor/cap/transfer kuralı;
- action/approval/schedule policy;
- mevcut creative beklentisi ve PromotionTemplate;
- varsa gerçek business outcome eşlemesi.

### 4.3 Knowledge & Instruction — kullanıcının yöntem hafızası

Bilgi dört farklı otoritede tutulur ve tek bir prompt metninde eritilmez:

- **Guidance:** kullanıcının anlatımı, tercihleri, soruları, örnekleri ve iş nüansı.
- **Sourced practice:** kaynak/tarih/scope/freshness taşıyan official Meta guidance.
- **Policy:** bütçe, yasak, cap, approval veya action eligibility'yi bağlayan typed hüküm.
- **AdvisedPractice:** agent ile birlikte geliştirilen ve denenmeye değer yöntem.

Kullanıcı bunları düz metinle anlatabilir veya yapılandırılmış alanları doğrudan
düzenleyebilir. Raw owner wording ile agent sentezi ayrı korunur. Dashboardda scope,
uygulandığı kampanyalar, sürüm, conflict ve geçmiş etkisi görünür; edit yeni sürüm üretir,
archive tarihsel run'ı silmez. Hard delete yalnız veri yaşam döngüsü politikasına tabidir.

Olgunluk `G0 raw → G1 scoped guidance → G2 reviewed set/playbook → G3 typed
policy/rule/template → G4 automation-eligible`dır. Geçiş otomatik değildir. G2→G3;
semantic diff, historical replay, conflict/impact preview ve kullanıcı yayını ister.

AdvisedPractice yaşam döngüsü:

`candidate → reviewed → trial → validated | conditional | rejected →
standardization_candidate → standardized | retired`

StandardizationReview yöntemi parçalayabilir: hesaplanabilir kısım feature/guardrail,
soru sırası agenda/playbook, iş nüansı guidance, riskli karar insan muhakemesi olarak kalır.

### 4.4 Evidence Engine — L0–L5 veri işleme

1. `L0 source/raw`: payload, hash, API/source version ve provenance; retention kontrollü,
   agent erişimine kapalı.
2. `L1 canonical facts`: entity, config, günlük insights, reklam metni ve post gerçeği.
3. `L2 deterministic features`: KPI, pacing, contribution, freshness, coverage, budget
   owner, config consistency ve action eligibility girdileri.
4. `L3 windows/rollups`: rolling/takvim/lifetime/learning/action-relative trend, cohort,
   volatility ve pre/post.
5. `L4 evidence graph`: finding, driver, blocker, data-quality, guidance/policy/cadence linki.
6. `L5 compact context`: seçili AnalysisAgenda pass'i için agent'a verilen kaynaklı özet.

Her run frozen `EffectiveCampaignContext` taşır: Meta config, effective categories,
guidance pack, enforceable policies, cadence, budget/targets, data quality/features,
decision/action/experiment/practice/outcome history ve resolver/catalog/formula sürümleri.
Bu context aynı girdilerde client veya modelden bağımsızdır.

### 4.5 Decision Engine — analiz ve karar temposu

Varsayılan analiz sırası:

1. veri sağlığı ve portföy;
2. account group/account;
3. Meta objective/funnel/optimization;
4. internal category'ler, kategori kategori;
5. campaign;
6. ad set, audience ve bütçe yapısı;
7. ad/creative/post ve yayındaki metin;
8. bütçe/pacing/korumalar;
9. önceki karar, test, hamle ve outcome;
10. `act / test / observe / no-change`.

Bu top-down ana turdur. Lokal anomali veya fırsat görülürse contribution ile bounded
bottom-up driver path çalışır. Kullanıcı bütün turu, yalnız bir kategori grubunu veya
`budget`, `geo`, `creative`, `learning`, `testing` gibi tek başlığı seçebilir.

Timeframe ile schedule ayrıdır. Timeframe anlık, rolling, takvim, lifetime, learning,
action-relative veya custom pencereyi; schedule analizin ne zaman çalışacağını tanımlar.
Settle delay, minimum sample, attribution lag, learning/cooldown ve repeat suppression
kararı bastırabilir. Scheduled ve anlık analiz aynı executor/context sözleşmesini kullanır.

### 4.6 Budget Engine — hedef ve korumalı tahsis

Bütçe motoru kara-kutu optimizer değildir. Şunları sıralı çözen constraint resolver'dır:

- toplam envelope, para birimi ve dönem;
- category/region/service için sabit tahsis, floor, cap veya reserve;
- transfer allow/deny/within-group;
- CBO/ABO ve gerçek campaign/ad-set budget owner;
- hedef hacim/KPI ve varsa business outcome;
- minimum sample, pacing, forecast, learning/cooldown;
- yüzde/tutar değişim tavanı ve risk sınıfı;
- `keep`, `conservative`, `target-seeking` gibi az sayıda açıklanabilir simülasyon.

`planned`, `committed`, `actual` ve `forecast` ayrıdır. “Bu bölge pahalı olsa da bütçesi
sabit kalsın” bir hard constraint ise verimlilik önerisini bastırır ve nedeni görünürdür.

### 4.7 Operations Engine — kontrollü Meta eylemi

Ana döngü:

`sync → classify → quality → context → analyze → simulate/propose → approve → execute →
read-after-write verify → platform review/delivery → monitor → outcome → rollback/park`

- Varsayılan planlama dry-run, varsayılan execution profili `approval_only`dır.
- Başlangıç write alanları campaign/ad set/ad pause/activate ve yalnız gerçek campaign/ad-set
  budget owner'daki izinli bütçe değişikliğidir.
- Risk K0 read→K1 düşük→K2 azaltma/pause→K3 artış/activate→K4 create/publish/yapısal.
- K3/K4 insan onaylı kalır. Policy-limited ileride yalnız kanıtlı ve cap'li K1/K2 olabilir.
- ActionBundle bir dependency görünümüdür; her ActionUnit ayrı approve/reject/request-changes,
  stale/expiry, execute ve verify durumuna sahiptir.
- Meta API write/read-after-write başarısı, reklamın platform review/delivery başarısı değildir;
  pending/rejected/limited durumları ayrıca izlenir.
- Elle Meta müdahalesi reconcile edilir; planı stale/park veya cooldown yapabilir.

### 4.8 Interaction Layer — dashboard ve yerel agent

Tek backend state'i iki çalışma yüzeyine açılır:

- **Dashboard:** Today/inbox, portfolio, campaign detail, category/guidance studio,
  analysis room, budget lab, creative explorer, Practice Lab, approval/automation ve timeline.
- **Yerel agent:** Codex CLI/VS Code, Claude Code veya başka MCP-capable istemci; aynı
  context, tools, proposals, run ledger ve action queue.

ReklamZeka OpenAI/Anthropic API key'i saklamaz ve model API'si çağırmaz. Yerel CLI kendi
login/session'ıyla localhost Streamable HTTP veya project STDIO MCP'ye bağlanır. Agent read
ve draft/proposal araçlarını kullanır; raw Meta writer, approval grant veya execute aracı
alamaz. Session içi gerçek onay dashboard veya TTY/passkey doğrulamalı companion yoludur.
Dashboarddaki entity/timeframe/category seçimi kısa ömürlü handoff ile session'a geçer;
session'da oluşan taslak aynı ID ile dashboard inbox ve timeline'da görünür.

## 5. Prompt/context eklentisinin doğru kurgusu

Kullanıcı talimatı ana sistem prompt'una kontrolsüz enjeksiyon değildir. Her agent turu
aşağıdaki sıralı envelope ile kurulur:

1. değişmez tenant/safety/tool/action sınırları;
2. user role, workspace/account/entity/timeframe handoff;
3. frozen EffectiveCampaignContext kimliği ve veri-kalite özeti;
4. seçili AnalysisAgenda pass'i ve karar sorusu;
5. applied/suppressed/conflicting `EffectiveGuidancePack` ve kaynakları;
6. enforceable policy, locked exception ve precedence trace;
7. L4 findings/drivers; gerekirse bütçeli L1–L3 drill-down araçları;
8. decision cadence, learning/cooldown ve experiment history;
9. bütçe durumu/hedef/simülasyon ve business outcome sinyalleri;
10. önceki proposal/action/verify/outcome ve AdvisedPractice geçmişi;
11. kullanıcının o tura ait sorusu/tonu/odak isteği `untrusted_data` olarak;
12. allowed IDs, citation zorunluluğu ve typed output schema.

Agent kaynaksız yeni metrik, “official” best-practice, targeting veya eylem uyduramaz.
Context bütçesi dolarsa `moreAvailable` verir; ham dump istemez. Her iddia uygun finding,
policy, guidance source, experiment, simulation veya outcome referansına bağlıdır.

## 6. AI, kod ve insan arasındaki yetki paylaşımı

| iş | deterministik kod | agent | insan |
|---|---|---|---|
| sync, kimlik, metrik, timeframe | hesaplar/doğrular | açıklar | veri kaynağını yetkilendirir |
| iç kategori | mapping/precedence çözer | aday ve gerekçe önerir | lock/publish eder |
| guidance | scope/retrieval/version saklar | kritik müzakere ve sentez yapar | kabul/düzenleme yapar |
| policy | parse/replay/conflict/eligibility | typed taslak açıklar | publish/istisna kararı verir |
| analiz | feature/finding/driver üretir | bağlamsal teşhis ve anlatım yapar | karar sorusunu/önceliği belirler |
| bütçe | constraint ve simülasyon çözer | alternatifleri kıyaslar | hedef, koruma ve planı seçer |
| eylem | risk/valf/stale/execute/verify | proposal hazırlar | atomik approve ve execute eder |
| practice | trial/outcome ledger tutar | candidate ve decomposition önerir | validate/standardize eder |

## 7. Ana kullanıcı yolculukları

1. **Bağla ve aynala:** Meta bağlantısı→hesap/asset seçimi→read sync→coverage/quality.
2. **İş dilini kur:** iç kategori boyutları→isim/özellik mapping preview→manuel lock.
3. **Yaklaşımı öğret:** agent ile kritik görüşme→GuidanceCard/Set→scope/topic/category bağı.
4. **Analiz et:** kampanya/timeframe/agenda seçimi→kanıt→driver→act/test/observe/no-change.
5. **Zamanla:** aynı analizi schedule et→settle-aware run→in-app Today/inbox→timeline.
6. **Bütçele:** envelope/hedef/koruma→üçten fazla olmayan simülasyon→proposal→onay kuyruğu.
7. **Operasyon yap:** atomik action review→human approval→execute→verify/delivery→outcome.
8. **Gönderi öne çıkar:** uygun mevcut Instagram/Page postu→yayınlanmış PromotionTemplate+
   frozen AudiencePreset→hedef yapı/bütçe/create/activate unit'larını ayrı onayla.
9. **Yöntemi geliştir:** sohbetten AdvisedPractice→trial→outcome→seçici standardizasyon.

## 8. Creative ve promotion sınırı

Sistem yeni reklam metni, görseli, videosu veya creative varyantı üretmez. Yalnız:

- yayındaki reklam metni/spec/post kimliğini okur ve performansla karşılaştırır;
- bağlı Instagram/Page'deki mevcut gönderiyi seçer;
- önceden yayınlanmış PromotionTemplate ve immutable AudiencePreset kullanır;
- ownership, actor, objective/optimization, destination, placement, budget owner ve
  promotion eligibility preflight'ı yapar;
- post identity/content hash değişirse onayı stale yapar.

Agent serbest targeting JSON yazamaz. Birden çok template adayı varsa kullanıcı seçer.
Template'ler ID yanında kullanıcı alias'ı, açıklama, örnek ifade ve category/account/actor
binding'i taşır; “TR saç ekimi remarketing post boost” gibi niyet doğal dille doğru
yayınlanmış şablona resolve edilebilir, belirsizlikte otomatik seçim yapılmaz.

## 9. Çok hesap ve izolasyon

- Workspace birden çok connection, account group, ad account, Page ve Instagram taşıyabilir.
- Currency/timezone/attribution/permission/capability account bazında kalır.
- Account group ortak guidance/category/budget/schedule uygulayabilir; child hard cap ve
  permission'ı ezemez.
- Cross-account plan toplu gösterilebilir fakat approval, execute, hata ve recovery account
  ve ActionUnit bazındadır.
- Bir hesabın rate-limit/hatası diğer hesabın sync veya kararını iptal etmez.

## 10. Kademeli teslim planı

Stage'ler A08–A14 domain sahipliğini, slice'lar gerçek geliştirme sırasını tanımlar.

### S0 — Güvenli temel — tamam

Mevcut kod: Next/TypeScript/PostgreSQL/Drizzle, tenant/role/audit, fixture/CSV ingest,
deterministik insights, dashboard/report, objective playbook ve güvenli narrative envelope.
A07 gerçek 3 workspace/10 account saha kanıtı kapanışa kadar açıktır; S1'i bloke etmez.

### S1 — Meta Read Mirror — şimdi

**Amaç:** Tek gerçek hesapta eksiksiz ve güvenilir read mirror; ardından ikinci hesapta izolasyon.

Güncel uygulanabilir alt plan:
[Slice 01 — Meta Read Mirror](../../plans/proje/v2/slice-01-meta-read-mirror.md).

İncrement sırası:

1. **S1.1 Connection boundary:** token kopyalamadan secret reference, configured Graph
   version doctor, read/management scope ayrımı ve expiry/capability.
2. **S1.2 Digital twin core:** account/campaign/adset/ad/creative şeması, status/config,
   legacy objective ve budget-owner resolver.
3. **S1.3 Read sync:** inventory/creative/insights stream'leri, cursor/resume, adaptive
   page/date slice, usage headroom ve idempotent upsert.
4. **S1.4 Asset/content mirror:** Page/Instagram/destination graph, live ad copy/dynamic
   variants ve promotable post inventory; write yok.
5. **S1.5 Trust layer:** coverage/freshness/orphan/permission raporu, L0 retention,
   disconnect ve external-change snapshot diff.

**Çıkış kapısı:** İki hesapta entity/metric/content coverage kanıtı, tekrar sync'te aynı
sonuç, rate-limit recovery, budget owner resolved/explicit unknown, tenant izolasyonu ve
Meta write network call sayısı `0`.

### S2 — Decision Room

**Amaç:** Write açmadan gerçek ürün değerini kanıtlamak.

- L2–L5 feature/window/evidence/context pipeline;
- EffectiveCampaignContext ve internal category mapping/profile;
- Guidance registry, source governance, G0–G3 promotion ve AdvisedPractice;
- AnalysisAgenda, timeframe, cadence, experiment/decision/outcome ledger;
- top-down + bounded bottom-up analiz;
- local MCP read/draft, dashboard analysis room ve scheduled in-app inbox.

**Çıkış kapısı:** Aynı frozen context deterministik finding üretir; kullanıcı talimatının
neden uygulandığı görünür; protected/no-change senaryoları doğru; agent raw L0/write alamaz.

### S3 — Budget Lab

**Amaç:** Meta'ya yazmadan güvenilir bütçe kararını üretmek.

- envelope, targets, planned/committed/actual/forecast;
- protected floor/fixed allocation ve transfer matrix;
- pacing/forecast, CBO/ABO reconciliation ve business outcome sınırı;
- keep/conservative/target-seeking simülasyon ve versioned proposal.

**Çıkış kapısı:** Korunan bölge bütçesi taşınmaz; tüm satırlar constraint trace taşır;
farklı currency kaynaksız birleşmez; plan kabul/red nedeni replay edilebilir.

### S4 — Approval-only Operations

**Amaç:** En küçük güvenli write dikeyi.

Önce tek account ve tek düşük riskli action type seçilir. Typed writer allowlist, K0–K4
valf, atomik approval, human presence, idempotent execute, read-after-write, platform
delivery, rollback ve external intervention kanıtlanır. Sonra pause/status/budget kapsamı
ayrı ayrı genişletilir.

**Çıkış kapısı:** Agent/schedule approval-only kilidini atlayamaz; stale/expired plan
yürümez; duplicate execute çoğalmaz; başarısız verify write'ı kapatır.

### S5 — Existing-post Promotion

**Amaç:** Yeni creative üretmeden mevcut postu şablonla reklamlaştırmak.

PromotionTemplate+AudiencePreset, linked-actor/post preflight, gerekirse campaign/ad-set
yapısı ve post/template/bütçe/create/activate ActionUnit DAG'ı kurulur.

**Çıkış kapısı:** Serbest creative/targeting yok; her unit ayrı onaylı; değişen post/spec
onayı stale yapar; review/delivery sonucu timeline'a gelir.

### S6 — Selective Standardization

**Amaç:** Gerçek trial/outcome'lardan düşük riskli standardizasyon kazanmak.

Önce context feature, checklist, agenda, cadence, experiment template ve warning;
sonra yeterli kanıt varsa typed policy. Policy-limited K1/K2 en son ve ayrı rollout'tur.

**Çıkış kapısı:** Her standardized artifact practice/outcome/review'e izlenir; rejected ve
conditional sonuçlar korunur; sessiz kural öğrenme veya K3/K4 otomasyonu yoktur.

## 11. Şimdi, sonra, bilinçli olarak değil

### Şimdi

- S1 Meta Read Mirror;
- A07 saha girdisini engel olmadan paralel toplama;
- read-only, data quality ve multi-account isolation.

### Sonraki dilimlerde

- category/guidance/analysis room;
- manual/CSV business outcomes;
- budget simulation;
- approval-only write;
- existing-post promotion;
- seçici standardizasyon.

### Ölçülmüş ihtiyaç olmadan yapılmayacak

- vector DB/knowledge graph, ClickHouse/warehouse, event bus ve mikroservis ağı;
- canlı CRM connector'ı ve dış notification kanalları;
- kara-kutu ML budget optimizer;
- yeni creative/metin/targeting üretimi;
- K3/K4 otomasyonu;
- agent konuşmasından sessiz policy/algoritma öğrenme;
- raw Graph/SQL/cron veya sınırsız ham veri aracı.

## 12. Başarı ölçümü

Ürün başarısı modelin ne kadar konuştuğuyla değil şu sonuçlarla ölçülür:

- sync coverage/freshness, idempotency ve account isolation;
- category coverage, correction ve unresolved conflict oranı;
- finding usefulness, evidence/citation coverage ve no-change doğruluğu;
- öneri tekrarı/hiperaktivite ve gereksiz hamle azalması;
- budget constraint ihlali `0`, forecast/actual sapması ve protected allocation korunması;
- proposal acceptance/rejection reason, prevented unsafe action ve operator time saved;
- execute/verify/delivery/rollback başarısı ve external intervention recovery;
- Meta proxy ile gerçek business outcome arasındaki görünür fark;
- AdvisedPractice trial kalitesi ve yalnız kanıtlı standardizasyon oranı.

## 13. Henüz karar gerektiren fakat bugünü bloke etmeyenler

Bu seçimler ilgili slice başında kullanıcıyla netleştirilir; şimdiden karmaşıklık kurulmaz:

- S1 gerçek pilot account cohort'u ve raw retention varsayılan süresi;
- ilk yayınlanacak iç kategori sözlüğü ve naming convention örnekleri;
- ilk manual/CSV business outcome kolon/eşleme seti;
- S4'te ilk write action'ının pause mı, sınırlı budget decrease mi olacağı;
- S5'te ilk PromotionTemplate, AudiencePreset ve account/actor kapsamı;
- hangi AdvisedPractice için kaç trial/outcome'un yeterli sayılacağı;
- ileride external notification veya canlı CRM için gerçek ihtiyaç ve sağlayıcı.

Bu maddeler karar kaydıdır; S1'in güvenli şema/sync geliştirmesini durdurmaz.

## 14. Tamlık hükmü

Ürün akışı baştan sona tanımlıdır:

`connect → sync → quality → classify → context → guidance/practice → analyze →
test/decide → budget plan → approve → execute → verify/review/delivery → outcome →
selective standardization`

Kritik plan boşluğu kalmamıştır. Kalan iş; bu sözleşmeyi dilim dilim uygulamak, gerçek
hesaplarda kanıtlamak ve yalnız ölçülen ihtiyaç ortaya çıktıkça kapsamı genişletmektir.
