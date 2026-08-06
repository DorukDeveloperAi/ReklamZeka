# 2 — Meta reklam işletim sistemi

<!-- uy:analiz-platformu/meta-dijital-ikiz -->
## Meta hiyerarşisi ve dijital ikiz

- Hesap → kampanya → reklam seti → reklam → mevcut kreatif ilişkisi korunur.
- Objective, optimization/billing, CBO/ABO budget owner, bid/attribution, targeting özeti,
  delivery durumu/issues ve kreatif spec performans bağlamının parçasıdır.
- Legacy ve yeni Meta objective'leri kaynak değeri kaybolmadan kanonik profile eşlenir.
- Inventory, creative ve insights payload/rate-limit nedeniyle ayrı stream ve date slice koşar.
- Bir workspace birden fazla business connection/reklam hesabı ve Facebook Page, Instagram,
  pixel/dataset, app/WhatsApp destination asset'iyle; account-group ve account-level izinle çalışır.
- Yayındaki reklamların primary text/headline/description/caption, CTA/destination, actor,
  post/media identity ve dynamic creative varyantları alan-provenance ile okunur.

**Kabul:** Aktif bir kampanya doğru ad set/reklam/kreatiflere, budget owner'a ve günlük
insights'a iner; Page/Instagram actor bağı görünür; duplicate sync çoğalmaz, bir hesap
hatası diğerini durdurmaz ve external config değişikliği timeline olayı olur. Active ad
metni kaynak creative/post spec'e izlenir; eksik alan model tarafından tamamlanmaz.

▸ bugün nerede: yan projede real Meta read client ve cache var; ReklamZeka modeli henüz
campaign toplamıyla sınırlı, A08 portu açık.

<!-- uy:analiz-platformu/kampanya-baglami -->
## Kampanya amacı ve değerlendirme bağlamı

- Her analiz `objective`, funnel aşaması, optimizasyon olayı ve sınıflandırma kaynağı taşır.
- Platform objective eşlemesi belirsizse kullanıcı onayı olmadan kesin KPI hükmü verilmez.
- Awareness, trafik, etkileşim, lead, app ve satış amaçları ayrı KPI/guardrail profilleriyle değerlendirilir.
- Farklı amaçlar ancak bütçe dağılımı düzeyinde yan yana gösterilir; başarı KPI'ları doğrudan sıralanmaz.

**Kabul:** Aynı metrik snapshot'ı awareness ve sales profillerinde farklı, amacı doğru
değerlendirme soruları ve karar kılavuzu üretir; eksik zorunlu metrik yayın kapısını durdurur.

▸ bugün nerede: objective context ve altı playbook temeli kodlandı; Meta/internal category
composition ve tam metrik kataloğu henüz yok.

<!-- uy:analiz-platformu/ic-kategori-talimat -->
## Çoklu iç kategori ve editable talimat registry

- Meta objective ile kullanıcının hizmet, doktor, şube, bölge, dil, funnel, promo,
  prospecting/retargeting ve korunan-bütçe kategorileri ayrı ve birlikte saklanır.
- Atama isim deseni, hesap, objective, optimization, geo/dil, budget model, CTA/link,
  creative özelliği veya entity kimliğiyle; evidence/confidence/manual lock ile yapılır.
- Düz metin talimat ham haliyle saklanır, strict politika taslağına çevrilir; etki ve
  conflict önizlemesi olmadan yayınlanmaz.
- Kullanıcı talimatı görür, filtreler, düzenler, yeni sürüm yayınlar, durdurur ve arşivler.
- Kategori basit etiket değil; analiz playbook'u, rule/talimat bundle'ı, bütçe havuzu ve
  transfer kuralı, schedule, action izni ve creative expectation bağlayabilen policy taşıyıcısıdır.
- Kullanıcı kendi kategori dimension'ını, single/multi cardinality'sini ve uygulanabildiği
  campaign/adset/ad/creative seviyelerini tanımlayabilir.
- Campaign kategorileri child bağlamına miras olur; explicit child override/addition izli ve sürümlüdür.

**Kabul:** “X bölgesi pahalı olsa da bütçesini taşıma” talimatı korunan tahsis
politikasına dönüşür; genel verimlilik kuralı bunu ezemez ve conflict kayıpsız görünür.
Effective kategori/profile sürümleri her run'da snapshot olur; sonraki edit tarihi değiştirmez.

▸ bugün nerede: normatif model ve ana plan hazır; kalıcı kategori/policy motoru yok.

<!-- uy:analiz-platformu/sablon-ve-kural -->
## Analiz şablonu ve güvenli kural DSL

- Kullanıcı workspace içinde taslak şablon oluşturur, dry-run görür ve immutable sürüm yayınlar.
- Kural yalnız allowlist metrik/operator/eşik/minimum hacim alanlarını taşır; kod ve SQL çalıştırmaz.
- Sistem amaç profilinin ana KPI, tanı metriği, guardrail ve veri yeterliliği varsayılanlarını sunar.
- Kullanıcı varsayılanı genişletebilir; tenant ve güvenlik sınırlarını kaldıramaz.

**Kabul:** Geçersiz metric/operator, kullanıcı kodu, eksik objective veya desteklenmeyen zorunlu
metrik yayınlanamaz; geçerli taslak geçmiş snapshot'ta deterministik dry-run üretir.

▸ bugün nerede: güvenli analiz tanım sözleşmesi ve negatif test temeli var; lifecycle,
policy composition ve dry-run kalıcılığı açık.

<!-- uy:analiz-platformu/timeframe-ve-schedule -->
## Timeframe, karşılaştırma ve scheduled analysis

- Timeframe hangi verinin analiz edildiğini; schedule ne zaman çalıştırıldığını ayrı tanımlar.
- Rolling, fixed ve calendar dönemleri; previous-period, previous-year ve none karşılaştırmaları desteklenir.
- Schedule IANA timezone, hourly/daily/weekly/monthly sıklık, misfire ve concurrency politikası taşır.
- Aynı logical fire iki kez teslim edilirse tek run oluşur; resolved window ve snapshot run kaydına yazılır.

**Kabul:** DST boş/çift saat, retry ve eşzamanlı teslim golden testleri yinelenen run üretmez;
run geçmişi definition sürümü, snapshot, timeframe, durum ve hata sınıfını gösterir.

▸ bugün nerede: yalnız manuel 7/30/90 görünümü var; scheduler ve run ledger yok.

<!-- uy:analiz-platformu/prompt-eklentisi -->
## Kanıt bağlı prompt eklentisi

- Kullanıcı anlatım tonu, odak soruları ve rapor bölüm tercihlerini tanımlayabilir.
- Kullanıcı metni sistem prompt'una enjekte edilmez; yapılandırılmış `userGuidance` verisi olarak taşınır.
- Model yalnız deterministik bulguları `findingId` referansıyla açıklar; yeni metrik, kaynak veya aksiyon uyduramaz.
- Model kapalı veya başarısız olduğunda deterministik analiz ve schedule sonucu korunur.

**Kabul:** Prompt injection, cross-tenant veri, tool/SQL talebi ve kanıtsız iddia negatif
matrisinin tamamı reddedilir; model/prompt/sampling sürümü audit kaydında görünür.

▸ bugün nerede: güvenli narrative envelope ve findingId validator temeli uygulandı;
policy translator, advisor ledger ve model entegrasyonu açık.

<!-- uy:analiz-platformu/zamansal-karar -->
## Zamansal ve hiyerarşik karar analizi

- Trend/anomali/pacing/target/guardrail; previous/weekday-matched/cohort ve action-relative
  pre/post analiz campaign→adset→ad→creative driver'larıyla çalışır.
- Freshness, coverage, attribution lag, learning, cooldown, minimum sample ve external
  intervention karar uygunluğunu bastırabilir; eksik veri sessiz sıfır değildir.
- Reach/frequency non-additive; ratio metrikleri toplam numerator/denominator'dan hesaplanır.
- Korelasyon ve nedensellik ayrı etiketlenir.

**Kabul:** Aynı performans farkı kampanya objective'i, internal kategori, Meta config ve
kilitli talimata göre farklı uygunluk hükmü verir; her hüküm snapshot/formül/policy izi taşır.

▸ bugün nerede: dört sabit rule ve objective playbook temeli var; tam zaman/driver motoru yok.

<!-- uy:analiz-platformu/butce-orchestrasyonu -->
## Bütçe hedefi, korunan tahsis ve simülasyon

- Hesap/kategori/bölge/kampanya/adset kapsamında period/currency/total/floor/cap/fixed/reserve
  ve transfer allow/deny politikaları tanımlanır.
- CBO/ABO ve gerçek budget owner resolve edilmeden delta üretilmez.
- Planned/committed/actual/forecast ayrı tutulur; pacing, hedef KPI, min sample, learning,
  cooldown ve max-change planı sınırlar.
- Keep-current, conservative ve target-seeking alternatifleri constraint trace ile simüle edilir.

**Kabul:** Korunan bölge sabit kalırken kalan bütçe uygun havuzda dağıtılır;
parent-child toplam, reserve, floor/cap ve rounding uzlaşır; artış onaysız uygulanmaz.

▸ bugün nerede: gereksinim ve A11 planı hazır; bütçe motoru uygulanmadı.

<!-- uy:analiz-platformu/eylem-valfi-ve-timeline -->
## Kontrollü eylem, otomasyon ve tek timeline

- Pause/activate ve doğru seviyede budget değişikliği tek typed executor ve K0–K4 risk
  valfinden geçer; varsayılan dry-run, approval execute değildir.
- K3/K4 açık onay, cap, account allowlist, config+secret+execute çift anahtarı ve
  read-after-write ister; rollback yeni denetimli action'dır.
- Manual ve scheduled rutin aynı executor'la sync→analyze→plan→approval queue yapar;
  agent kendi kendine execute etmez.
- Planlama modu ile execution autonomy ayrıdır; default/ilk rollout `approval_only`dır ve
  K1–K4 her action unit ayrı insan onayı ister. Expiry/child scope kilidi genişletemez.
- Bundle yalnız gruplamadır; creative/post, hedef yapı, bütçe, publish/create ve activate
  satırları ayrı approve/reject/request-changes alır, dependency eksikse downstream durur.
- Sync/config/policy/finding/plan/approval/action/verify/external-change/outcome tek timeline'dır.

**Kabul:** Duplicate action Meta'ya tek update yapar; unexpected manual değişiklik
otomasyonu park eder; kullanıcı önce/sonra ve outcome penceresini timeline'da izler.
Approval-only açıkken schedule proposal üretir fakat Meta write 0'dır; bir satırın onayı
bundle'daki diğer satırları onaylamaz.

▸ bugün nerede: v1 read-only; write valfi ve scheduler A13'e kadar kapalı.

<!-- uy:analiz-platformu/kontrol-merkezi -->
## Sade reklam kontrol merkezi

- Bugün, Portföy, Talimatlar, Analizler, Bütçe, Onaylar, Timeline, Kreatifler ve
  Otomasyon/Ayarlar yüzeyleri tek rol-bazlı dashboardda bulunur.
- Kreatifler yüzeyi yayındaki reklam metnini ve post kaynağını okur; bağlı Instagram/Page
  gönderisini yayınlanmış PromotionTemplate ve ön ayarlı AudiencePreset ile promotion
  taslağına dönüştürür. Yeni metin/görsel/video/creative üretimi yoktur.
- Varsayılanlar ve playbook'lar sade form sunar; ileri selector/DSL progressive disclosure'dır.
- Raw ve normalized talimat, inheritance/conflict, affected entities, version history,
  simulation, approval ve verify/rollback görünür.

**Kabul:** Kullanıcı bir kampanyayı kategorize eder, talimat yayınlar, dry-run analiz ve
bütçe simülasyonu görür, schedule eder ve onay sonucunu timeline'da izler; rol negatifleri
ve 1280/820/390 browser E2E geçer.
Kullanıcı existing-post bundle'ında metin/kimlik, yapı, bütçe, create ve activate satırlarını
ayrı yönetebilir; creative spec değişince eski onay stale olur.

▸ bugün nerede: dashboard/pilot yüzeyi var; birleşik kontrol merkezi A14'te açık.

<!-- uy:analiz-platformu/model-agnostic-agent -->
## Model-agnostic agent, Codex/Claude ve hibrit otomasyon

- Sync, classification, policy, analysis, budget ve action motorları model SDK'sı import etmez.
- Embedded dashboard agent'i OpenAI/Anthropic adapter'larını ortak structured envelope,
  tool broker, output validator, maliyet ve run ledger sözleşmesiyle kullanır.
- ReklamZeka Streamable HTTP MCP server sunar; Codex ve Claude aynı tenant-scoped read ve
  draft/proposal tools'a bağlanır, raw Meta writer veya execute tool alamaz.
- ReklamZeka OpenAI/Anthropic model API'si veya API key'i kullanmaz; Codex CLI/VS Code ve
  Claude Code kendi açık yerel login/session'ıyla localhost/STDIO MCP'ye bağlanır.
- Dashboard local session hub olarak config/health, selected-context handoff, proposal ve
  action queue correlation gösterir; aynı iş session içinden sürdürülebilir.
- Manual, assisted, automated-read ve scheduled-plan planlama modları execution autonomy'den
  ayrıdır; approval-only varsayılandır. Yalnız explicit policy-limited profilde cap'li K1/K2
  otomatik olabilir, K3/K4 insan onaylı kalır.
- Campaign/adset/ad pause/activate; campaign/adset budget action'ları doğru entity ve parent/
  budget-owner eligibility ile aynı dashboard/valf/timeline zincirinden geçer.

**Kabul:** Codex, Claude ve dashboard agent'i aynı frozen contextte aynı proposal şemasını
kullanır; provider değişimi deterministic finding/budget/action eligibility'yi değiştirmez;
hiçbir agent onay/valf olmadan Meta write gerçekleştiremez.

▸ bugün nerede: model-agnostic local CLI/MCP mimarisi ve gereksinimler tanımlı; local MCP,
session handoff/hub, companion human-presence ve hybrid-mode executor henüz uygulanmadı.
