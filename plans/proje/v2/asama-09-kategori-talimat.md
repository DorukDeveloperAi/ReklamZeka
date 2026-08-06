---
kosum: tek-ajan
---
# Aşama 09 — İç kategori ve kullanıcı talimat sistemi

## SONUÇ

Kullanıcı kampanya/adset/ad/kreatifleri birden çok iç kategoriyle tanımlar; isim ve
Meta özellikleriyle otomatik eşleme kurar. Düz metin talimatı ham haliyle korunur,
strict politika taslağına çevrilir, etki/çatışma önizlemesinden sonra yayınlanır.

## Normatif model

- `CategoryDimension`: id/label/cardinality(single|multi)/allowedEntityTypes/status/version.
- `CategoryDefinition`: id/dimension/label/description/parent/owner/status/version/profile.
- `CategoryAssignment`: entity/category/source/evidence/confidence/locked/effective interval.
- `CategoryProfile`: analysis/rule/instruction/budget/transfer/schedule/action/creative bundle refs.
- `Selector`: AND grupları, sınırlı OR; raw regex yerine güvenli glob/name pattern.
- `Instruction`: rawText + normalizedPolicy + scope + priority + reason + lifecycle.
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
Agent raw talimatı değiştirmeden normalize eder; varsayım, ambiguity, missing unit/scope,
conflict ve affected-entity preview döner. Kullanıcı onayı olmadan published olmaz.

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
