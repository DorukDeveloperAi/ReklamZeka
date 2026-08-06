# ReklamZeka uçtan uca gap review ve kademeli teslim kararı

## Sonuç

Ana kapsam doğru; ancak uygulanabilir ve güvenli bir dikey ürün için aşağıdaki sözleşmeler
eklenmeden A08–A14'ü tek seferde geliştirmek verimsiz olur. Çözüm yeni büyük servisler değil,
altı küçük vertical slice ve birkaç net boundary'dir.

## Bulunan boşluklar ve karar

| boşluk | risk | karar | zaman |
|---|---|---|---|
| ham veri→agent context pipeline'ı | token/hata/replay | L0–L5 Postgres pipeline | Slice 1–2 |
| effective campaign context | farklı motorlarda farklı bağlam | frozen resolver/hash | Slice 2 |
| sohbet→tekrar kullanılabilir yöntem | konuşma kaybolur | AdvisedPractice lifecycle | Slice 2 |
| practice→algoritma standardizasyonu | erken katılık veya sessiz öğrenme | explicit StandardizationReview | Slice 2–6 |
| gerçek iş sonucu | Meta proxy'ye aşırı güven | optional manual/CSV OutcomeSignal | Slice 2–3 |
| Meta async review/delivery | write verified ama reklam yayınlanmamış olabilir | review/delivery states | Slice 4–5 |
| best-practice güncelliği | model hafızası/eskime | manual curated official source registry | Slice 2 |
| scheduled sonucun teslimi | run var ama kullanıcı görmüyor | in-app inbox önce | Slice 2 |
| disconnect/retention | veri/credential yaşam döngüsü | revoke, retention ve export/delete runbook | Slice 1 |

## Vertical slice teslim sırası

### Slice 0 — Mevcut güvenli temel — tamam

Read-only fixture/CSV, tenant, audit, dashboard, deterministic insights ve rapor.

### Slice 1 — Meta Read Mirror

A08'in minimumu: secret reference, account/campaign/adset/ad/creative/post, budget owner,
günlük insights, live ad text, data quality ve L0/L1. Write yok. Tek gerçek hesapla başlayıp
ikinci hesap isolation kanıtıyla kapanır.

### Slice 2 — Decision Room

L2–L5, EffectiveCampaignContext, internal categories, GuidanceCard/Set, AdvisedPractice,
AnalysisAgenda, cadence, experiment/outcome signal, local CLI MCP read/draft ve in-app
analysis inbox. Meta write 0. Bu slice ürün değerini write riskinden önce doğrular.

### Slice 3 — Budget Lab

Envelope/targets/protected allocation, optional business outcomes, pacing/forecast ve en
fazla üç simulation. Proposal/approval queue vardır; Meta write hâlâ 0.

### Slice 4 — Approval-only Operations

Tek hesap, tek action type ile başlar: pause veya düşük riskli budget update; atomik
approval, human presence, execute, read-after-write, async delivery state, rollback ve
external intervention. Sonra diğer status/budget action'larına genişler.

### Slice 5 — Existing-post Promotion

Yayınlanmış PromotionTemplate+AudiencePreset, linked post preflight, K4 ActionBundle,
platform review/delivery takibi. Yeni creative/targeting üretimi yok.

### Slice 6 — Selective Standardization

Yalnız validated AdvisedPractice'lerden standardization candidate çıkarılır. Önce analysis
agenda/feature/guardrail/playbook; en son açık kanıt varsa typed policy ve yalnız K1/K2
policy-limited. Approval-only varsayılan kalır.

## Bilerek ertelenenler

- vector database/knowledge graph;
- ClickHouse/data warehouse ve event bus;
- ayrı microservice ağı;
- canlı CRM entegrasyonları (manual/CSV outcome önce);
- otomatik external notification kanalları (in-app önce);
- otomatik creative/targeting üretimi;
- K3/K4 otomasyonu;
- kara-kutu ML budget optimizer;
- agent konuşmalarından sessiz kural öğrenme.

## Ölçek/karmaşıklık kapıları

Yeni altyapı ancak ölçülen gereksinimle açılır: Postgres sorgu/rollup latency, entity-day
hacmi, context retrieval latency, job backlog, source count veya full-text relevance
hedefi karşılanamıyorsa ADR açılır. “İleride lazım olabilir” gerekçe değildir.

## Tamlık değerlendirmesi

Bu eklerle ana uçtan uca akışta kritik ürün boşluğu kalmıyor: connect→sync→quality→context→
guidance/practice→analysis→experiment/decision→budget proposal→approval→execute→review/
delivery→outcome→standardization. Kalan başlıklar uygulama, saha doğrulaması ve bilinçli
olarak ertelenmiş connector/ölçek yatırımlarıdır.
