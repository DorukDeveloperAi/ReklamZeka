# Etkileşimli guidance, analitik müzakere ve kademeli katılaştırma

## Amaç

Kullanıcının şahsi reklam yaklaşımı, istisnaları ve anlatımı; kaynaklı Meta best-practice
bilgisi ve gerçek kampanya kanıtıyla agent eşliğinde birlikte değerlendirilir. Başlangıçta
her fikir strict DSL alanına zorlanmaz. Sistem önce usable, sürümlü ve kolay bulunan
guidance üretir; yalnız tekrarlandığı, test edildiği ve eylem yetkisini etkilemesi gerektiği
kanıtlanan maddeler deterministik policy/rule'a yükseltilir.

Bu esneklik yalnız analiz, tartışma, hipotez ve proposal hazırlama içindir. Metrik hesabı,
tenant güvenliği, bütçe uzlaşması, approval, action eligibility ve Meta write valfi
deterministik kalır.

## 1. İki ayrı talimat yolu

### Guidance yolu — başlangıç varsayılanı

Doğal dil, not, örnek, prensip, best-practice, tercih ve analitik soru saklanabilir.
Agent bunları analiz sırasında getirir, karşılaştırır, çelişkileri gösterir ve kaynak ID ile
atıf yapar. Guidance doğrudan Meta write yetkisi veya hard constraint değildir.

### Enforceable policy yolu — gerektiğinde

“Bu bölgenin bütçesini asla taşıma”, “%20'den fazla artırma” veya “aktivasyon mutlaka benim
onayımla” gibi yürütmeyi sınırlayan maddeler typed, test edilebilir ve published policy olur.
Yalnız bu yol action valve/budget constraint'e normatif girdi olabilir.

## 2. Olgunluk merdiveni

| seviye | nesne | kullanım |
|---|---|---|
| G0 | conversation/raw note | kullanıcının sözü ve kaynak materyal; düzenlenmemiş |
| G1 | scoped guidance card | kapsam/başlık/otorite bağlarıyla analize getirilebilir |
| G2 | reviewed guidance set/playbook | birlikte kararlaştırılmış, sıralı analiz/karar yaklaşımı |
| G3 | typed policy/rule/template | deterministik dry-run ve conflict/impact testi |
| G4 | automation-eligible policy | ayrıca risk, cap, approval ve rollout kanıtı geçmiş |

G0→G1→G2 agent ve kullanıcı etkileşimiyle kolaydır. G2→G3 otomatik olmaz; sistem hangi
cümlelerin katılaştırılacağını, anlam kaybını ve etki alanını gösterir. G4 ayrı güvenlik
kararıdır; approval-only varsayılanını kendiliğinden gevşetmez.

## 3. Bilgi nesneleri

- `GuidanceSource`: `owner_statement`, `official_meta_guidance`, `business_strategy`,
  `observed_result`, `experiment_outcome`, `operating_note`; raw content/ref, author,
  source URL/file, captured/reviewed date ve provenance.
- `GuidanceCard`: kısa başlık, doğal dil gövde, `must/should/consider/avoid/question`
  derecesi, scope facets, topic headings, rationale, examples/counterexamples, source refs,
  effective interval, owner ve lifecycle.
- `GuidanceSetVersion`: sıralı card grubu, analiz gündemi, karar temposu, bağlı kategori/
  objective/group ve review status.
- `GuidanceBinding`: global, account group/account, internal category, Meta objective,
  funnel/optimization, lifecycle, campaign/adset/ad/creative/post, PromotionTemplate veya
  topic heading'e çoklu bağ.
- `DeliberationSession`: kullanıcı mesajları, agent soruları, getirilen kaynaklar, çatışma,
  varsayım, alternatif ve kabul/red kararları.
- `DecisionCadenceProfile`: settle delay, observation window, learning/cooldown, max
  decision/action frequency, evidence threshold, emergency exception ve review cadence.
- `ExperimentRecord`: soru/hipotez, baseline, tek ana değişken, primary metric, guardrails,
  min sample/window, stop condition, sonuç ve `winner/loser/inconclusive` hükmü.
- `AdvisedPractice`: agentic müzakerede owner yaklaşımı + sourced practice + deterministic
  evidence'dan çıkan tekrar kullanılabilir yöntem; problem, scope, required inputs, sıralı
  steps, rationale, expected signals, cadence, exceptions, evidence ve confidence taşır.
- `StandardizationReview`: practice'in hangi parçasının deterministic feature/formül,
  analysis agenda, playbook, policy, human judgment veya approval olarak kalacağını inceler.

İlk sürüm PostgreSQL metadata + JSON + full-text search kullanır. Ayrı vector database veya
karmaşık knowledge graph gerekmez. Semantic ranking ancak hacim kanıtlanırsa eklenir.

## 4. Kritik analitik etkileşim

Kullanıcı yeni analiz/strateji/promotion şablonu veya kategori guidance'ı oluştururken agent:

1. Amacı, karar sorusunu ve başarı/koruma önceliklerini sorar.
2. Kullanıcının ilgili eski anlatımlarını ve locked istisnalarını getirir.
3. Kaynaklı Meta best-practice card'larını default tavsiye olarak getirir.
4. Uyuşma, çatışma, bilinmeyen ve uygulanmayan alanları açıklar.
5. Veri eşiği, observation window, cooldown ve “ne zaman hiçbir şey yapmamalıyız?”ı sorar.
6. Sade bir guidance set + analiz agenda + test/karar temposu önerir.
7. Geçmiş snapshot üzerinde rehearsal/dry-run yapar; aşırı uyarı/hamle sayısını gösterir.
8. Kullanıcı kartları düzenler, kabul eder, bekletir veya G3 policy'ye yükseltir.

Agent kullanıcının sözünü sessizce “Meta best practice” adına ezmez. Resmi pratik default
ve kaynaklı görüş; kullanıcının business-specific tercihi ayrı otorite olarak görünür.
Platform/hukuk ve hard safety her ikisinin üstündedir.

## 5. Kolay erişim ve analysis context assembly

Önce deterministik scope filtresi çalışır, sonra relevance ranking yapılır. Candidate sırası:

1. workspace genel doctrine ve karar temposu;
2. account group/account guidance;
3. Meta objective/funnel/optimization guidance;
4. iç kampanya category profile/guidance;
5. entity-specific exception ve locked user note;
6. topic/heading guidance (`budget`, `pacing`, `geo`, `creative`, `learning`, `testing`,
   `promotion`, `decision` vb.);
7. ilgili experiment/outcome ve önceki decision records.

Sonuç `EffectiveGuidancePack`tır: applied/suppressed/conflicting/missing cards, source refs,
scope reason, freshness/review state ve context-budget özeti. Semantic search guidance
keşfi/ranking için kullanılabilir; enforceable policy seçimi veya action authorization için
kullanılamaz.

## 6. Sıralı analiz gündemi

`AnalysisAgendaVersion` kullanıcı tarafından düzenlenebilir başlık sırası taşır. Varsayılan:

1. genel portföy ve veri sağlığı;
2. account group/account;
3. amaç/funnel/optimization;
4. internal category'ler, kategori kategori;
5. campaign;
6. ad set ve hedef kitle/bütçe yapısı;
7. ad/creative/post metni;
8. bütçe, pacing ve korumalar;
9. önceki karar/test sonuçları;
10. karar: değiştir, test et, izle veya hiçbir şey yapma.

Agent top-down ana turu izler, bulgu varsa bounded bottom-up drill-down yapar. Kullanıcı
“sadece bölge kategorileri” veya “bütçe başlığı” diyerek agenda subset'i seçebilir.

## 7. Hiperaktiviteyi engelleyen karar temposu

- Eksik/settle olmamış veriyle karar yok.
- Learning/cooldown içindeki entity için acil guardrail dışında tekrar hamle yok.
- Aynı entity'de bir observation window içinde sınırlı sayıda temel değişiklik.
- Testlerde mümkünse tek ana değişken; birden çok değişiklik açık contamination etiketi.
- Her proposal `act / test / observe / no-change` seçeneklerini birlikte değerlendirir.
- “No change” geçerli ve ölçülen bir karardır; agent öneri üretmek zorunda değildir.
- Aynı öneriyi yeni kanıt olmadan tekrarlama cooldown'u vardır.
- Acil spend/safety istisnası normal optimizasyon temposundan ayrıdır.

Başlangıçta tempo card'ları guidance olabilir; write'a sınır koyan max-change/cooldown/cap
maddeleri action açılmadan önce G3 policy olarak yayınlanır.

## 8. Best-practice yönetişimi

Meta best-practice içeriği `official_meta_guidance` kaynağıyla, link/doküman adı, captured
date, applicable objective/entity, review-by tarihi ve platform/API version notuyla saklanır.
Agent model hafızasını “resmi best practice” diye sunamaz. Kaynak süresi geçmişse card
`needs_review` olur; sessizce normatifleşmez. Kullanıcı kendi istisnasını ve gerekçesini
yanına ekleyebilir. Güncelleme eski decision run'larını geriye dönük değiştirmez.

## 9. Kullanılabilirlik

- Sol tarafta kritik sohbet, sağda canlı guidance kartları ve scope breadcrumb.
- “Bu analizde ne uygulandı?” paneli; guidance/policy/source/conflict ayrı renk ve tipte.
- Tek tıkla “global yap”, “bu kategoriye bağla”, “bu başlığa bağla”, “sonra gözden geçir”.
- “Guidance olarak kaydet” kolay; “hard rule'a yükselt” etki preview/test ister.
- Kart edit/version/archive; ham kullanıcı sözü ve agent sentezi yan yana korunur.
- Varsayılan ekran kısa; ayrıntılı scope ve precedence progressive disclosure'dır.

## 10. AdvisedPractice ve standardizasyon keşfi

`AdvisedPractice`, official Meta best-practice değildir ve bağlayıcı policy değildir. Bizim
birlikte geliştirdiğimiz, belirli kapsamta izlenmeye ve denenmeye değer operasyon yöntemidir.

Yaşam döngüsü:

`candidate → reviewed → trial → validated | conditional | rejected → standardization_candidate → standardized | retired`

Her trial hangi deterministic inputs/findings'e baktığını, agent/human muhakemesini, verilen
kararı ve outcome'u kaydeder. Sistem sessizce “öğrenip” kural değiştirmez. Standardization
candidate için en az şu değerlendirilir:

- benzer vakalarda tekrar sayısı ve karar tutarlılığı;
- outcome quality/non-inferiority ve false-positive/false-negative;
- kategori/hesap/objective'ler arasında stabilite ve bilinen exceptions;
- veri alanlarının güvenilirliği ve hesaplanabilirliği;
- operator effort/time saved ve açıklanabilirlik;
- yanlış standardizasyonun spend/brand risk seviyesi.

StandardizationReview practice'i parçalara ayırabilir. Örneğin data sufficiency check ve
cooldown deterministik guard olur; teşhis soruları playbook/agenda olur; business nuance
guidance olarak kalır; nihai budget decision insan onayında kalır. Bir practice'in tamamını
tek rule'a çevirmek zorunlu değildir.

Önce en düşük riskli standardizasyon yapılır: context feature, checklist, AnalysisAgenda,
decision cadence, test template ve warning. Enforceable policy daha sonra; policy-limited
automation en son ve ayrı kanıtla gelir.

## Kabul değişmezleri

1. Kullanıcı doğal dille guidance kaydedebilir; strict DSL doldurması gerekmez.
2. Bir kampanya analizinde kullanılan her guidance card neden seçildiği ve kaynağıyla görünür.
3. Genel→group→objective→internal category→entity→topic sıralı retrieval tekrar üretilebilir.
4. Soft guidance Meta write yetkisi veya hard budget constraint olamaz.
5. Agent en az `no-change` seçeneğini ve karar temposu ihlalini değerlendirir.
6. Best-practice kaynaksız/eskimişse resmi gerçek gibi sunulmaz.
7. G2→G3 dönüşümü kullanıcı onayı, semantic diff, historical replay ve impact preview ister.
8. AdvisedPractice outcome görmeden standardized/automation-eligible olamaz; rejected veya
   conditional sonuçlar da kayıpsız tutulur.
