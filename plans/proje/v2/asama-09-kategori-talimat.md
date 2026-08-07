---
kosum: tek-ajan
---
# Aşama 09 — İç kategori ve kullanıcı talimat sistemi

## SONUÇ

Kullanıcı kampanya/adset/ad/kreatifleri birden çok iç kategoriyle tanımlar; isim ve
Meta özellikleriyle otomatik eşleme kurar. Düz metin talimatı önce esnek, scoped ve
retrievable guidance olarak kullanılabilir; yalnız yürütmeyi bağlayacak maddeler strict
policy'ye etki/çatışma/replay önizlemesiyle yükseltilir.

## Normatif model

- `CategoryDimension`: id/label/cardinality(single|multi)/allowedEntityTypes/status/version.
- `CategoryDefinition`: id/dimension/label/description/parent/owner/status/version/profile.
- `CategoryAssignment`: entity/category/source/evidence/confidence/locked/effective interval.
- `CategoryProfile`: analysis/rule/instruction/budget/transfer/schedule/action/creative bundle refs.
- `Selector`: AND grupları, sınırlı OR; raw regex yerine güvenli glob/name pattern.
- `Instruction`: rawText + normalizedPolicy + scope + priority + reason + lifecycle.
- `GuidanceSource/Card/Set/Binding`: raw owner statement, sourced Meta guidance,
  strategy/observation/experiment; topic/scope/version/review ve analysis agenda bağları.
- `Policy`: hard_constraint/target/preference/exception/prohibition/approval/schedule.
- `PromotionTemplate`: selector/alias + Meta objective/optimization + actor/destination +
  placement + naming/tracking + reuse/create policy + budget/schedule + AudiencePresetVersion.
- `AudiencePresetVersion`: immutable targeting spec veya izinli Meta saved/custom audience
  referansı; geo/language/age/audience inclusions-exclusions ve provenance hash.
- Scope: workspace→account→category→campaign→adset→ad; creative read-only bağlam.
- Precedence MASTER'daki sıra; suppression ve conflict kayıpsız.

## Task'lar

### T09.1 — Boyut, kategori ve atama şeması
Kullanıcı tanımlı dimension, single/multi cardinality, entity-level; çoklu kategori,
parent guard, renk/ikon opsiyonel, version lifecycle ve soft archive.

### T09.2 — Meta/internal mapping motoru
Legacy/yeni objective; name pattern; optimization event; CBO/ABO; Advantage+; geo/dil;
promoted object; CTA/link ve explicit entity list selector'ları. Manual lock en yüksek kaynak.

### T09.3 — Talimat DSL'i
Metric/value/unit/window/operator, allocation/transfer/cap/floor, protect/fix, action permission,
schedule ve effective dates. Kod/SQL/raw Graph/raw cron alanları negatif parser'da reddedilir.

### T09.4 — Doğal dil → taslak politika
Agent raw talimatı değiştirmeden önce G0/G1 guidance card/set taslağı oluşturabilir; scope,
topic, source, must/should/consider/avoid/question, varsayım ve conflict gösterir. Hard
constraint/action yetkisi istenirse ayrı G3 typed policy taslağı, missing unit/scope,
affected-entity, historical replay ve impact preview döner. G2→G3 kullanıcı onaysız olmaz.

### T09.5 — Policy resolver
Inheritance, specificity, priority, version, effective time; satisfied/violated/suppressed/
parked trace. “Pahalı olsa da X bölgesinden bütçe taşıma” golden kuralı.

### T09.6 — API ve rol matrisi
Owner/admin publish/archive; analyst draft/preview; operator action policy okuyabilir;
viewer read-only. Her mutasyon audit ve optimistic concurrency taşır.

### T09.7 — Başlangıç playbook/kategori seti
Objective'ler + prospecting/retargeting + promo/evergreen + region/language + lead-form/
WhatsApp/sales + protected-budget. Bunlar örnek; kullanıcı silebilir/türetebilir.

### T09.8 — Kategori profile ve policy bundle
Kategoriye analysis playbook, rule/instruction set, budget pool/transfer matrix, schedule,
action permission ve creative expectation bağlanır. Bağlar sürümlü referanstır; profile
değişikliği affected-entity/run preview ister.

### T09.9 — Hiyerarşi mirası ve effective context
Campaign assignment child adset/ad/creative'e default iner; child add/override/deny kuralları
dimension cardinality ve precedence ile resolve edilir. Analysis/action run effective category
ve bundle sürümlerini immutable snapshot'lar.

### T09.10 — Kategori katalog/coverage yüzeyi
Dimension/category/profile/assignment listesi; coverage, unmatched, low-confidence, single-
dimension conflict ve archive impact. Kullanıcı “neden bu kategoride” evidence'ini görür.

### T09.11 — Promotion template ve ön ayarlı hedef kitle
Kullanıcı mevcut gönderi promotion şablonunu düz metin alias'larıyla veya formdan tanımlar:
uygulanabilir account/Page/Instagram/internal category/post type; objective/optimization,
actor/destination, placement, naming/tracking, mevcut ad set'i kullan/yeni oluştur politikası,
budget/schedule varsayılanları ve zorunlu immutable audience preset. Publish dry-run,
affected entity ve Meta capability preview ister. Agent targeting üretmez; yalnız uygun
yayınlanmış template/preset sürümünü sebepli önerir, belirsizde kullanıcı seçimi ister.

### T09.12 — Guidance registry ve çoklu binding
GuidanceSource/Card/Set/Binding şemaları; global→account-group/account→objective/funnel/
optimization→internal category/lifecycle→campaign/adset/ad/creative/post→PromotionTemplate
→topic. Raw kullanıcı sözü ile agent sentezi ve official source ayrı, versioned ve aranabilir.

### T09.13 — Best-practice source governance
Official Meta card'ı source URL/doküman ref, captured/reviewed/review-by date, applicable
scope ve platform/API version note olmadan official yayınlanamaz. Stale card needs-review;
güncelleme tarihsel decision run'ını değiştirmez. Kullanıcı exception/rationale yanına bağlanır.

### T09.14 — Progressive formalization
G0 raw note→G1 scoped guidance→G2 reviewed set/playbook→G3 typed policy/rule/template→G4
automation eligibility. Promotion wizard semantic diff, kaybolan nüans, historical replay,
affected entities/conflicts ve rollback gösterir. Guidance kolay publish edilir; G3/G4 zor kapıdır.

### T09.15 — AdvisedPractice ve StandardizationReview
Agentic müzakereden problem/scope/required inputs/steps/rationale/cadence/exceptions/evidence/
confidence taşıyan practice candidate çıkar. `candidate→reviewed→trial→validated|conditional|
rejected→standardization_candidate→standardized|retired`. Review practice'i feature,
AnalysisAgenda, playbook, cadence, guidance, typed policy ve human-judgment parçalarına
ayırır; outcome olmadan standardize/automation-eligible olamaz.

## Kabul ve kanıt

- Aynı entity üç kategori taşır; isim değişse manual lock korunur.
- Single dimension iki kategoriyle eşleşirse biri sessiz seçilmez; conflict park edilir.
- Kategori profile'ı analiz, bütçe, schedule ve action eligibility'yi aynı effective context'te etkiler.
- Child override tarihsel run'ı değiştirmez; kategori archive öncesi etki sayıları görünür.
- Legacy objective doğru canonical profile'a gider; bilinmeyen publish'i engeller.
- Düz metin talimat raw/normalized/impact üçlüsüyle UI/API'de görünür.
- Genel optimize kuralı, protected-region transfer yasağını ezemez.
- Conflict deterministik `PARKED_CONFLICT`; prompt sonucu policy'yi değiştiremez.
- “Bu gönderiyi X bölge lead şablonuyla öne çıkar” aynı template+audience sürümünü resolve
  eder; iki eş template veya eksik preset varsa proposal publish-ready değildir.
- Kullanıcı uzun bir doğal dil stratejisini strict form doldurmadan kategori+başlık guidance'ı
  olarak kaydeder; analizde kaynak/scope reason ile geri gelir, action yetkisi vermez.
- Official Meta best-practice ve owner exception birleşip kaybolmaz; agent çatışmayı yan yana gösterir.
- Trial sonucu olmayan AdvisedPractice yalnız candidate/reviewed kalır; sistem sohbetten
  sessizce rule oluşturmaz.
