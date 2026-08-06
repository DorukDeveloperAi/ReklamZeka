# ADR-0013 — Agentic guidance ve kademeli deterministikleştirme

## Durum

Kabul — 2026-08-06

## Bağlam

Kullanıcının şahsi stratejileri ve Meta best-practice bilgisi birlikte, kritik bir agent
etkileşimiyle şekillenecek. Her analitik düşünceyi ilk günden strict DSL/policy alanına
zorlamak kullanımı ağırlaştırır, nüansı kaybettirir ve gereksiz otomasyon üretir. Öte yandan
soft sohbet metninin para harcayan karara doğrudan dönüşmesi güvenli değildir.

## Karar

- Natural-language guidance ve enforceable policy ayrı yaşam döngüleridir.
- Guidance raw note→scoped card→reviewed set/playbook olarak kullanılabilir; strict DSL
  zorunlu değildir ve analysis/advisor bağlamına kaynak ID ile girer.
- Yalnız hard constraint, action authorization veya otomasyon isteyen madde typed policy'ye
  kullanıcı onayı, impact preview ve replay ile yükseltilir.
- Retrieval global→account group/account→objective→internal category→entity→topic→history
  scope sırasıyla deterministic filter, ardından relevance ranking kullanır.
- Meta best-practice card'ı official source/date/review state olmadan “resmi” sayılamaz.
- DecisionCadenceProfile ve ExperimentRecord; learning/cooldown, observation window,
  max-change, no-change ve inconclusive sonuçlarıyla hiperaktiviteyi bastırır.
- Agentic sohbetten çıkan tekrar kullanılabilir yöntem `AdvisedPractice` olur; official
  best-practice veya enforceable rule etiketi almaz.
- AdvisedPractice ancak trial/outcome ve explicit StandardizationReview sonrasında feature,
  agenda, playbook, cadence, policy veya insan-muhakemesi parçalarına ayrılarak standardize edilir.
- Sistem sohbetten sessiz kural öğrenmez veya tüm practice'i tek algoritmaya çevirmek zorunda değildir.
- İlk sürüm Postgres metadata/JSON/full-text'tir; vector DB ve karmaşık ontology ertelenir.

## Sonuçlar

Kullanıcı agent ile doğal ve eleştirel biçimde çalışırken talimatları tekrar bulunabilir,
sürümlü ve açıklanabilir olur. Sistem erken aşamada aşırı katılaşmaz; action valve güvenliği
korunur. Guidance retrieval, review UI, source yönetişimi ve sonradan policy promotion
akışlarının uygulanması gerekir.
