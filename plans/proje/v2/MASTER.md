# ReklamZeka Meta Reklam İşletim Sistemi — MASTER (v2)

> Üretici: v1 ana planının kümülatif revizyonu · Tarih: 2026-08-06
> Kaynak istek: kampanya türü/mecrası/Meta yapısı, iç kategoriler, kullanıcı
> talimatları, zaman serisi analizi, bütçe planlama, kontrollü aksiyon ve agentic rutin
> Kategori: proje · Üst: —
> Kritiklik: yüksek · Aciliyet: normal · Hacim: epik
> Hedef: ReklamZeka; Meta portföyünü doğru bağlamda anlayan, kullanıcı
> politikalarıyla analiz eden ve onaylı aksiyonları güvenle yöneten sade bir kontrol merkezi olur.
> Oturum: ot:2026-08-06/reklamzeka-baslangic
> Sürüm: v2 · Önceki: [v1](../v1/MASTER.md) · Revizyon: [REVIZYON.md](REVIZYON.md)

## Planın konumu ve kapsamı

Bu dosya projenin **tek kanonik ana planıdır**. v1'in tamamlanan ürün, veri,
güvenlik, dashboard, içgörü ve pilot temelini aynen miras alır; yeni kapsam paralel
bir proje değil, aynı ürünün A08–A14 devamıdır. v1 dosyaları tarihsel kanıt olarak
korunur. A07'nin gerçek saha pilotu beklenirken teknik olarak bağımsız A08 işleri
ilerleyebilir; eksik saha girdisi yeni ürün geliştirmesini bloke etmez.

## Ürün tezi

ReklamZeka yalnız metrik gösteren veya serbest prompt çalıştıran bir pano değildir.
Sistem beş katmanı tek izde birleştirir:

1. **Meta dijital ikizi:** hesap → kampanya → reklam seti → reklam → kreatif/post; yayındaki gerçek metin ve kimlik dahil.
2. **Bağlam:** Meta objective/optimization/budget yapısı + kullanıcının çoklu iç kategorileri.
3. **Politika:** doğal dil ve yapılandırılmış talimatlar, hedefler, istisnalar ve bütçe kuralları.
4. **Zamanlı karar:** tazelik/attribution/learning/cooldown farkında deterministik analiz ve plan.
5. **Kontrollü eylem:** öneri → simülasyon → onay → valf → Meta write → read-after-write → izleme/geri alma.

LLM/agent; talimatı anlamlandırır, bağlamı açıklar ve taslak hareket planı
oluşturur. Para harcayan nihai yol deterministik policy, yetki, tavan, onay ve audit
valfinden geçer. Prompt tek başına Meta yazma yetkisi vermez.

## Başarı tanımı

**BAŞARI =** Aşağıdakilerin tamamı kanıtlıdır:

- Bir Meta portföyü envanter + insights + kreatif + Meta konfigürasyonuyla parçalı,
  idempotent ve rate-limit duyarlı senkronlanır.
- Her kampanya Meta objective'i, legacy objective'i, funnel/optimization bağlamı ve
  sıfır veya daha fazla kullanıcı iç kategorisiyle kanıtlı sınıflandırılır.
- Kullanıcı talimatlarını ham metin + normalize politika olarak görür, etkilediği
  nesneleri önizler, sürümler, yayınlar, durdurur, düzenler ve silebilir/arşivleyebilir.
- Aynı kampanya; amacı, bütçe modeli, bölge/dil/kitle, Meta özellikleri,
  iç kategorileri, mevcut kreatifleri ve zaman içindeki hamleleri birlikte analiz edilir.
- Yayındaki reklamların birincil metin, başlık, açıklama, CTA, hedef URL, post/media
  kimliği ve dinamik varyantları kaynak/provenance ile okunur; kullanıcı bunları reklam
  ve performans bağlamında arayıp karşılaştırabilir.
- Bağlı Instagram/Page hesabındaki uygun mevcut gönderi yeni metin/görsel üretilmeden,
  sürümlü promotion şablonu ve ön ayarlı hedef kitleyle reklam taslağına dönüştürülebilir.
- Bütçe planı hesap/kategori/bölge/kampanya taban-tabana ve tavanlara, sabit tahsis,
  transfer yasağı, hedef KPI, minimum örneklem, pacing ve cooldown'a uyar.
- Zamanlanmış ve anık analiz aynı versioned executor'ı kullanır; duplicate fire tek run'dır.
- Her öneri ve eylem snapshot, kural/talimat, önceki/yeni değer, onay, Meta sonucu ve
  sonrası performans penceresine bağlı timeline kaydı taşır.
- Varsayılan mod dry-run ve workspace genelinde **approval-only autonomy lock**'tır.
  Her action line item ayrı onaylanabilir/reddedilebilir; approval execute değildir.
  Aktivasyon, bütçe artışı, post promotion ve yapısal değişiklikler risk kademesine
  uygun açık onay ve çift anahtar olmadan yürütülemez.
- Kullanıcı tek sade kontrol merkezinde hiyerarşiyi, kategorileri, talimatları,
  analizleri, bütçeyi, onayları, otomasyonları ve timeline'ı yönetebilir.

## Kampanya bağlam modeli

Tek bir `campaignType` yetersizdir; sistem aşağıdaki bağımsız eksenleri saklar:

| eksen | örnek | kaynak |
|---|---|---|
| mecra/hesap | Meta, reklam hesabı, para birimi, timezone | platform |
| Meta campaign | objective, buying type, special category, bid strategy, Advantage+ | platform |
| budget placement | CBO/campaign budget, ABO/ad-set budget, daily/lifetime | platform+türev |
| delivery | configured/effective status, issue, learning, start/stop | platform |
| ad set | optimization goal, billing event, bid/cost cap, attribution, promoted object | platform |
| audience | geo/bölge, dil, yaş, kitle tipi, placement/device | platform+türev |
| creative | source type, primary text, headline, description, CTA, link, post/media/asset kimliği, dinamik varyant | mevcut platform verisi+türev |
| iç kategori | hizmet, doktor, şube, bölge, dil, funnel, promo/evergreen vb. | kullanıcı |
| iş hedefi | lead, nitelikli lead, randevu, mesaj, satış, gelir, sabit varlık | kullanıcı |
| olgunluk | yeni/learning, test, doğrulanmış, scale, doygun, kapatma adayı | türev+onay |

### Çok hesap ve Meta asset graph

Bir workspace birden fazla Meta Business/portfolio, system-user bağlantısı, reklam hesabı,
Facebook Page, Instagram hesabı, pixel/dataset, app ve WhatsApp/destination asset'iyle
çalışabilir. Bağlantı ile asset ayrı nesnedir; aynı Page/Instagram hesabı birden fazla
reklam hesabı bağlamında kullanılsa da platform kimliği tekilleşir, workspace yetkisi
bağlantı/asset grant'iyle resolve edilir.

- Global anahtar: `workspace + platform + connection + account + entityType + externalId`.
- Her reklam hesabı currency, timezone, attribution/capability, spend limit ve permission
  snapshot taşır; farklı hesaplar kur/attribution kaynağı olmadan tek KPI'a toplanmaz.
- Kullanıcı hesapları `account_group/portfolio` altında gruplayıp ortak kategori, bütçe
  envelope, analiz ve schedule uygulayabilir; child account hard cap ve permission her zaman korunur.
- Campaign/adset/ad/creative; Page, Instagram actor, promoted object, pixel/dataset/app ve
  destination ilişkilerini `asset_edges` ile taşır. Silinen/erişilemeyen asset kaybolmaz,
  last-seen/capability durumu olur.
- Creative içerik snapshot'ı “yayında görünen” etkili metni raw spec'ten türetir; primary
  text, headline, description, caption, CTA, destination, actor ve dynamic asset-feed
  varyantlarını kaynak alanı ve reklam bağıyla saklar. Eksik alan tahmin edilmez.
- Sync/run/action account bazında izole ve idempotenttir; bir hesabın rate-limit veya hatası
  diğer hesapları durdurmaz. Cross-account plan satırları ayrı onay/execute olur.

İç kategori çokludur ve hiyerarşik olmak zorunda değildir. **Basit etiket değil,
politika/playbook taşıyıcısıdır.** Bir kampanya aynı anda `doktor-tanıtım`,
`istanbul`, `arapça`, `lead-form`, `prospecting`, `korunan-bütçe` kategorilerini taşıyabilir;
bu kategoriler analiz KPI'ları, bütçe havuzu/transfer kuralı, timeframe/schedule, action
izinleri, kreatif kontrolü ve istisna talimatları bağlayabilir.

İç kategori iki parçalıdır: kullanıcının tanımlayabildiği `dimension` ve o boyuttaki
`category`. Başlangıç boyutları `service_line`, `brand/clinic`, `geo_market`, `language`,
`campaign_role`, `funnel_intent`, `audience_strategy`, `destination`, `budget_pool`,
`operating_mode`, `lifecycle`, `experiment`, `protection_class` ve `custom`dır. Her boyutun
tekli/çoklu cardinality'si ve uygulanabildiği entity seviyeleri tanımlıdır.

Eşleme; kampanya adı deseni, hesap, Meta objective, optimization event, geo/dil, bütçe
modeli, promoted object, creative CTA/link veya açık entity kimliğiyle yapılabilir.
Kaynak önceliği: `manuel kilitli > yayınlanmış mapping > isim standardı > özellik
kuralı > agent önerisi > belirsiz`; her atama evidence ve confidence taşır. Campaign
kategorisi varsayılan olarak child ad set/ad/creative bağlamına miras olur; child explicit
override/addition yapabilir. Her analiz run'ı effective kategori ve bağlı bundle sürümlerini
snapshot'lar; sonraki kategori düzenlemesi tarihsel hükmü değiştirmez.

## Talimat ve politika modeli

Kullanıcı talimatı hem düz metin hem yapılandırılmış form olabilir. Düz metin
doğrudan yürütülmez; agent bunu versioned politika taslağına çevirir, yorumunu ve
etkilenecek nesneleri gösterir, kullanıcı yayınlar. Politika türleri:

- `hard_constraint`: mutlak taban/tavan, sabit tahsis, transfer yasağı.
- `target`: KPI/hedef hacim/hedef maliyet ve zaman ufku.
- `preference`: öncelik/ağırlık; sert kural değildir.
- `exception`: kategori veya entity bazlı genel kural istisnası.
- `prohibition`: durdurma, azaltma, taşıma veya aktivasyon yasağı.
- `approval_policy`: hangi aksiyonun kimden, hangi limitte onay istediği.
- `schedule_policy`: hangi analiz/rutinin ne zaman çalışacağı.

Normatif öncelik: platform/hukuk ve tenant güvenliği → sistem hard safety → kullanıcı
kilitli talimatı → bütçe taahhüdü → entity istisnası → iç kategori playbook'u →
Meta objective playbook'u → metrik kuralı → agent tavsiyesi. Aynı kademede daha
spesifik scope ve sonra daha yeni yayın sürümü kazanır. Çözülemeyen çatışma
`PARKED_CONFLICT` olur; sistem varsayım yapmaz.

## Analiz ve zaman modeli

- **Anlık durum:** son senkron konfigürasyonu, delivery ve bugünün pacing'i.
- **Rolling:** 1/3/7/14/28/30/90 gün veya kullanıcı aralığı.
- **Takvim:** gün/hafta/ay/çeyrek; hesap timezone'unda.
- **Yaşam döngüsü:** kampanya lifetime, learning/test, cooldown ve olgunluk penceresi.
- **Hamle öncesi/sonrası:** action event etrafında eşit veya policy tanımlı pencere.
- **Karşılaştırma:** previous period, weekday-matched, hedef/baseline, kategori cohort'u.
- **Veri gerçeği:** freshness, coverage, attribution etiketi/lag, non-additive reach/frequency,
  minimum sample ve Meta revision gecikmesi görünür; eksik veri sessiz `0` değildir.

Schedule timeframe'den ayrıdır: schedule ne zaman koşulacağını, timeframe hangi
verinin değerlendirileceğini belirler. Raw cron yerine doğrulanmış hourly/daily/weekly/
monthly ve `after_sync` tetikleri; IANA timezone, data-settle delay, DST/misfire ve
idempotency anahtarı taşır.

## Bütçe ve hareket planı

Bütçe motoru bir kara-kutu optimizer değil, izlenebilir constraint resolver'dır:

1. Hesap toplam zarfı, para birimi ve dönem.
2. Kategori/bölge/hizmet için sabit veya minimum tahsis.
3. Transfer allow/deny matrisi (`pahalı olsa da bu bölge sabit` dahil).
4. Kampanya/ad-set CBO/ABO bütçe sahipliği ve Meta minimumları.
5. Hedef hacim/KPI, minimum sample, pacing ve tahmin.
6. Değişim yüzde/adet tavanı, cooldown ve learning koruması.
7. Uygun adaylara fixed, proportional, priority-weighted veya ladder tahsis.
8. Her kabul/bastırma için kural ve önce/sonra bütçe izi.

Sistem `planned / committed / actual / forecast` bütçeyi ayrı tutar. Farklı para
birimleri dönüşüm kaynağı olmadan toplanmaz. Kampanya ve ad-set bütçesi aynı anda
varmış gibi yorumlanmaz; Meta'daki gerçek budget owner belirlenir.

## Eylem ve agentic döngü

```text
sync → classify → validate data → deterministic findings → resolve policies
     → draft plan → impact preview → approval/valve → execute
     → read-after-write verify → monitor → evaluate/rollback-or-park
```

Başlangıç eylemleri mevcut campaign, ad set ve ad nesnelerinde `pause/activate`; gerçek
budget owner olan campaign veya ad set seviyesinde `daily/lifetime budget`; ve izinli
schedule değişiklikleridir. **Ad seviyesinde bütçe yoktur**; ad için yalnız durum ve
izinli metadata/etiket planlanır. Parent pause child effective status'u etkiler; activate
öncesi parent chain, review/issue ve schedule eligibility doğrulanır. Bid/targeting/
optimization/creative bağı değişiklikleri yapısal-yüksek risktir.

Creative/reklam işlemleri iki açık kaynağa ayrılır:

1. `existing_creative`: yayındaki reklamın metin/spec/post bağını okuyup analiz etme; write yok.
2. `existing_post_promotion`: bağlı Page/Instagram'daki mevcut post/media'yı referans alan
   reklam taslağı; sahiplik, actor, promotion eligibility, objective/optimization,
   destination, placement ve sürümlü audience preset preflight'ı zorunlu. Sistem yeni
   primary text, headline, medya veya creative varyantı üretmez.

Bir “gönderiyi öne çıkar” niyeti gerekirse campaign/adset/creative-reference/ad/
budget/status adımlarından oluşan bir `ActionBundle` üretir. Bundle toplu görünür ama her
`ActionUnit` atomiktir: kullanıcı gönderi kimliği/önizlemeyi, promotion template + audience
preset'i, hedef ad seti, bütçeyi, create/publish ve
activate adımlarını ayrı onaylar, reddeder veya değişiklik ister. Dependency DAG nedeniyle
reddedilen/eksik üst adım downstream execute'u fail-closed durdurur. Toplu onay yalnız
kullanıcının açık seçimidir; bundle veya sohbet komutu zımni “hepsini onayla” sayılmaz.

Risk kademesi: K0 read/dry-run → K1 rapor/etiket → K2 azaltma/pause → K3 artış/
activate → K4 create/publish, mevcut post promotion, creative/bid/targeting/yapısal.
K2 politikası workspace tarafından ayarlanabilir; K3/K4 her zaman açık onay, tavan ve
execute anahtarı ister. Approval yürütme değildir.

### Model-agnostic agent ve dashboard bağlantısı

Deterministik sync/classification/analysis/budget/policy/action motorları hiçbir model SDK'sı
import etmez. Model katmanı `AgentProvider` sözleşmesine takılır: structured generation,
tool use, streaming, context/cost limits ve cancellation capability'leri ilan edilir.
OpenAI, Anthropic veya gelecekteki sağlayıcı adapter'ı aynı envelope/output validator/
tool broker/run ledger yolunu kullanır; model değişikliği policy ya da motor sonucunu değiştirmez.

ReklamZeka iki entegrasyon yüzeyi sunar:

1. **Yerel session hub:** açık Codex CLI/VS Code veya Claude Code oturumlarının bağlantı,
   seçili dashboard bağlamı, proposal, run ve handoff durumunu gösterir; ReklamZeka model
   provider API'si çağırmaz veya provider API anahtarı saklamaz.
2. **Vendor-neutral local MCP server:** Codex, Claude Code ve diğer MCP istemcileri
   aynı tenant-scoped resources/tools'a bağlanır. Read tools ve proposal tools ayrı;
   raw Meta writer expose edilmez. Dış agent yalnız proposal/approval-request oluşturur;
   execute yine dashboard/valf/ayrı yetkili worker yoludur.

Codex'in aynı hosttaki desktop, CLI ve VS Code/IDE yüzeyleri ortak MCP konfigürasyonunu
kullanabilir. ReklamZeka öncelikle localhost Streamable HTTP veya proje-scoped STDIO MCP
sunucusu verir. Claude Code aynı MCP sözleşmesine kendi yerel oturumuyla bağlanır. CLI'nın
kendi login/subscription kimliği CLI'da kalır; bu, ReklamZeka'ya model API key vermek değildir.
Meta veri ve eylemleri için Meta Graph bağlantısı ayrıca gereklidir.

Dashboard “AI CLI entegrasyonları” yüzeyi MCP-capable istemciler için kurulum/config,
health, session registration ve context handoff sağlar. MCP'siz bir CLI ancak allowlist
binary/arg şablonu uygulayan ayrı `LocalCliAdapter` ile eklenir; dashboard rastgele shell
komutu veya mevcut TTY'yi ele geçirmez. Dashboarddan başlatılan dedicated CLI ayrı local
process olabilir; zaten açık bir session ise `register_agent_session/get_handoff_context`
araçlarıyla bağlanır.

Codex/Claude Code oturum hafızası sistem kaynağı değildir; kategori, talimat, promotion
template/audience preset, schedule,
karar ve action state'i ReklamZeka veritabanında sürümlüdür. MCP OAuth token'ı workspace,
role, account group, tool scope ve expiry'ye bağlıdır; her tool call agent provider,
model, session, actor ve correlation ID ile audit edilir.

Session içinden dashboardla eşdeğer okuma, analiz, şablon seçimi ve proposal hazırlama
mümkündür. İnsan onayı agent tool çağrısı sayılmaz: dashboard veya yerel `reklamzeka`
companion CLI, TTY/passkey ile kısa ömürlü `HumanPresenceGrant` üretir. Böylece kullanıcı
aynı terminal akışında her `ActionUnit`ı ayrı onaylayıp execute edebilir; model bu grant'i
oluşturamaz, sibling satıra taşıyamaz veya approval-only kilidini gevşetemez.

### Hibrit işletim ve otonomi kilidi

Tetikleme/planlama biçimi ile Meta'ya yazma otonomisi ayrı ayarlardır. Böylece schedule
veya agent öneri hazırlayabilirken workspace aylarca yalnız onayla çalışabilir.

| planlama modu | sistem davranışı | write |
|---|---|---|
| manual | kullanıcı analiz/planı başlatır ve aksiyonu tek tek yönetir | valf+onay |
| assisted | agent bağlamı analiz eder, policy/bütçe/action taslağı hazırlar | insan onayı |
| automated-read | schedule sync/analiz/plan/uyarı çalıştırır | yok |
| scheduled-plan | schedule deterministik öneriyi approval inbox'a koyar | seçili otonomi profiline bağlı |

`autonomy_profile` varsayılan ve ilk canlı rollout'ta `approval_only`dır. Bu profil tüm
K1–K4 write action'larını tek tek insan onayına zorlar; süre dolması veya child scope
otomatik olarak yetkiyi genişletmez. İleride kullanıcı ayrı bir policy sürümü yayınlayıp
kilidi açıkça kaldırırsa `policy_limited` yalnız izinli/cap'li K1/K2'yi çalıştırabilir.
K3/K4 her profilde insan onaylı kalır. Workspace/account/category/entity seviyesinde daha
alt scope yalnız otonomiyi daraltabilir. Global ve hesap bazlı kill switch vardır.

Approval kuyruğu `ActionBundle → ActionUnit[]` gösterir. Her unit before/after, creative/post
preview, hedef entity, bütçe etkisi, kanıt/policy izi, risk, dependency, expiry ve stale
durumu taşır. Kullanıcı her satır için approve/reject/request-changes yapabilir; execute
ayrı rol ve ayrı adımdır.

## Aşamalar ve bağımlılık grafiği

| # | aşama | SONUÇ | bağımlı | dosya |
|---|---|---|---|---|
| 01 | ürün temeli | v1 — KAPALI | — | [v1 A01](../v1/asama-01-urun-temeli.md) |
| 02 | teknik temel | v1 — KAPALI | 01 | [v1 A02](../v1/asama-02-teknik-temel.md) |
| 03 | veri platformu | v1 — KAPALI | 02 | [v1 A03](../v1/asama-03-veri-platformu.md) |
| 04 | kiracı güvenliği | v1 — KAPALI | 02 | [v1 A04](../v1/asama-04-kiraci-guvenligi.md) |
| 05 | performans deneyimi | v1 — KAPALI | 03,04 | [v1 A05](../v1/asama-05-performans-deneyimi.md) |
| 06 | içgörü motoru | v1 — KAPALI | 03,04 | [v1 A06](../v1/asama-06-icgoru-motoru.md) |
| 07 | rapor ve saha pilotu | v1 — DEVAM; fixture hazır, gerçek 3 workspace/10 hesap kanıtı son kapanışta alınacak | 05,06 | [v1 A07](../v1/asama-07-rapor-ve-pilot.md) |
| 08 | Meta dijital ikizi | tam hiyerarşi, config, yayındaki reklam metni/post/kreatif, insights ve timeline snapshot'ları | 03,04 | [asama-08-meta-dijital-ikizi.md](asama-08-meta-dijital-ikizi.md) |
| 09 | kategori ve talimat sistemi | iç kategori, mapping, doğal dil politika taslağı, miras/çatışma | 08 | [asama-09-kategori-talimat.md](asama-09-kategori-talimat.md) |
| 10 | zamansal analiz motoru | objective/category aware trend, anomali, pacing, pre/post ve cohort analizi | 06,08,09 | [asama-10-zamansal-analiz.md](asama-10-zamansal-analiz.md) |
| 11 | bütçe planlama | constraint tabanlı tahsis, korunan bütçe, forecast ve simülasyon | 09,10 | [asama-11-butce-planlama.md](asama-11-butce-planlama.md) |
| 12 | model-agnostic local agent bridge | güvenli talimat çevirisi, yerel CLI/MCP session handoff, kanıt bağlı anlatım ve plan taslağı; model API yok | 09,10,11 | [asama-12-prompt-advisor.md](asama-12-prompt-advisor.md) |
| 13 | eylem valfi ve rutin | atomik onaylı Meta write, şablon+audience preset'li mevcut post promotion, scheduler, verify/rollback | 04,10,11,12 | [asama-13-eylem-otomasyon.md](asama-13-eylem-otomasyon.md) |
| 14 | kontrol merkezi ve rollout | sade dashboard, local CLI session hub, satır-bazlı approval inbox, post-promotion akışı ve timeline | 07,09–13 | [asama-14-kontrol-merkezi.md](asama-14-kontrol-merkezi.md) |

```text
v1 A03+A04 ──► A08 ──► A09 ─┬─► A10 ─► A11 ─┬─► A13 ─► A14
                         └───────► A12 ─┘
v1 A06 ────────────────▲                  v1 A07 ──────▲
```

Uygulama sırası: **A08 → A09 → A10 → A11 → A12 → A13 → A14**.
Gerçek write scope A13'ten önce ReklamZeka'ya taşınmaz.

## /goal komutları

```text
/goal plans/proje/v2/asama-08-meta-dijital-ikizi.md planını uygula; bitince STATE.md ve CHECKLIST.md'yi kanıtla güncelle
/goal plans/proje/v2/asama-09-kategori-talimat.md planını uygula; bitince STATE.md ve CHECKLIST.md'yi kanıtla güncelle
/goal plans/proje/v2/asama-10-zamansal-analiz.md planını uygula; bitince STATE.md ve CHECKLIST.md'yi kanıtla güncelle
/goal plans/proje/v2/asama-11-butce-planlama.md planını uygula; bitince STATE.md ve CHECKLIST.md'yi kanıtla güncelle
/goal plans/proje/v2/asama-12-prompt-advisor.md planını uygula; bitince STATE.md ve CHECKLIST.md'yi kanıtla güncelle
/goal plans/proje/v2/asama-13-eylem-otomasyon.md planını uygula; bitince STATE.md ve CHECKLIST.md'yi kanıtla güncelle
/goal plans/proje/v2/asama-14-kontrol-merkezi.md planını uygula; bitince STATE.md ve CHECKLIST.md'yi kanıtla güncelle
```

## Global güvenlik ve sadelik kuralları

- Tek policy motoru, tek timeline, tek action valve ve tek run executor; paralel karar yolları yok.
- Yeni kategori/kural/şablon kod değişikliği olmadan versioned tanım verisiyle eklenir.
- Kullanıcı serbest kod/SQL/cron çalıştıramaz; düz metin yalnız taslak politikaya dönüşür.
- Prompt/model deterministic finding, bütçe constraint veya action authorization kaynağı değildir.
- Meta sırrı kopyalanmaz/loglanmaz; secret reference ve en az yetki ilkesi kullanılır.
- Büyük Meta sorguları entity/level/date slice olarak ayrılır; cursor, usage ve backoff izlenir.
- Mevcut kreatif ve yayındaki reklam metinleri okunur. Mevcut post promotion desteklenir;
  sistem yeni reklam metni, görseli, videosu veya creative varyantı üretmez.
- Agent hedef kitle uyduramaz veya serbest targeting yazamaz; promotion yalnız yayınlanmış
  template'in immutable audience preset sürümünü kullanır.
- ReklamZeka model-provider API'si kullanmaz; agent deneyimi kullanıcının yerel Codex/
  Claude Code/diğer CLI oturumu ve ortak MCP ile sağlanır.
- Bundle kolaylık yüzeyidir; onay ve audit birimi atomik `ActionUnit`dır. Approval-only
  kilidi yalnız açık, yetkili ve sürümlü kullanıcı kararıyla dar biçimde gevşetilebilir.
- Causal iddia deney veya yeterli pre/post tasarımı olmadan kurulmaz; korelasyon açık etiketlenir.
- Silme yerine arşiv/version tercih edilir; audit ve action timeline append-only'dir.

## Riskler

- **Yanlış sınıflandırma:** evidence/confidence + manuel kilit + belirsizde publish engeli.
- **Talimat çatışması:** normatif öncelik, scope specificity ve PARKED_CONFLICT.
- **Bütçe zararı:** dry-run, protected allocation, tavan/cooldown, açık onay, read-after-write.
- **Meta rate limit/payload:** ayrı sync kuyrukları, adaptive page/date slice, usage headroom.
- **Attribution/lag:** tarihsel snapshot, veri-settle delay ve sonuç penceresi; erken karar bastırılır.
- **Agent yanlış anlaması:** raw talimat + normalize taslak + etki önizleme + insan yayını.
- **Elle Meta müdahalesi:** snapshot diff `external_change` olayı üretir, otomasyon cooldown/park olur.
- **Karmaşık UI:** varsayılanlar ve playbook'lar; ileri ayarlar açılır katmanda, tek iş akışı.
- **Yanlış kreatif/post yayını:** linked-asset capability, preview, içerik+kimlik+destination
  onayı, create ve activate ayrımı; stale spec'te yeniden onay.

## Kanonik ekler

→ [REQUIREMENTS.md](REQUIREMENTS.md) · [CHECKLIST.md](CHECKLIST.md) ·
[STATE.md](STATE.md) · [REVIZYON.md](REVIZYON.md) ·
[Meta keşif raporu](../../../docs/discovery/2026-08-06-meta-operating-system.md) ·
[İç kategori sözleşmesi](../../../docs/product/internal-category-model.md) ·
[Model-agnostic agent mimarisi](../../../docs/architecture/model-agnostic-agent-interface.md) ·
[Creative ve atomik onay sözleşmesi](../../../docs/architecture/creative-and-approval-operations.md) ·
[Yerel CLI session bridge](../../../docs/architecture/local-cli-agent-bridge.md)
