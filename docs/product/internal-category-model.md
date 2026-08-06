# ReklamZeka iç kategori modeli

## 1. Tanım

**İç kategori**, Meta'nın `objective` veya basit bir UI etiketi değildir. Kullanıcının
reklam portföyünü kendi işletme mantığına göre tanımladığı ve analiz/bütçe/
otomasyon davranışı bağlayabildiği versioned karar nesnesidir.

Bir Meta kampanyası tek objective taşısa da aynı anda farklı iç kategori boyutlarına
ait olabilir. Örneğin aynı campaign:

```text
service_line       = doktor-tanitim
geo_market         = istanbul
language           = arapca
campaign_role      = evergreen
audience_strategy  = prospecting
destination        = whatsapp
budget_pool        = medikal-tr
protection_class   = bolgesel-butce-sabit
```

Bu bileşim; `Meta OUTCOME_LEADS`, ad set optimization goal, geo targeting ve mevcut
kreatif CTA'sıyla birlikte **effective campaign context** olur.

## 2. Boyut kataloğu

Başlangıç boyutları sistem varsayılanıdır; kullanıcı yenisini ekleyebilir.

| dimension | neyi anlatır | cardinality önerisi | örnek |
|---|---|---|---|
| `service_line` | hizmet/ürün hattı | multi | doktor tanıtım, check-up |
| `brand_or_clinic` | marka/şube/klinik | multi | hastane-a, şube-b |
| `geo_market` | işletme bölge/pazarı | multi | İstanbul, GCC |
| `language` | iletişim dili | multi | TR, AR, RU |
| `campaign_role` | portföy rolü | single | evergreen, promo, launch |
| `funnel_intent` | iş hunisi | single | awareness, consideration, conversion |
| `audience_strategy` | kitle yaklaşımı | single | prospecting, retargeting, retention |
| `destination` | sonuç kanalı | multi | form, WhatsApp, web, app |
| `budget_pool` | bütçe kaynağı | single | medikal-tr, brand, test |
| `operating_mode` | işletme biçimi | single | always-on, burst, seasonal |
| `lifecycle` | kampanya olgunluğu | single | test, learning, validated, scale, sunset |
| `experiment` | deney/cohort | multi | creative-test-12, geo-holdout |
| `protection_class` | harcama/aksiyon koruması | multi | fixed-budget, no-pause, no-transfer |
| `custom` | kullanıcı tanımlı eksen | configured | ajans/işletme özelinde |

Boyut `single` ise aynı entity için aynı anda iki kategori sessizce seçilmez;
assignment conflict olarak park edilir. `multi` boyutlar birden çok aktif değer taşır.

## 3. Kategori nesnesi

```text
CategoryDimension
  id, label, cardinality, allowedEntityTypes, status, version

CategoryDefinition
  id, dimensionId, label, description, aliases, parentId?
  ownerId, status(draft|published|archived), version
  profileRef?

CategoryAssignment
  entityType, entityId, categoryVersionId
  source(manual_locked|mapping|name_convention|property_rule|agent_suggestion)
  evidence[], confidence, locked, effectiveFrom, effectiveTo?

CategoryProfile
  analysisPlaybookRefs[]
  ruleAndInstructionRefs[]
  budgetEnvelopeOrPoolRef?
  transferPolicyRefs[]
  scheduleRefs[]
  actionPolicyRefs[]
  creativePolicyRefs[]
```

Kategori profile bağları kopyalanmış prompt metni değil, sürümlü typed referanstır.

## 4. Atama ve eşleme

Mapping selector'ı aşağıdaki özellikleri `all/any/not` gruplarıyla birleştirebilir:

- workspace, Meta account ve explicit campaign/adset/ad kimliği;
- campaign/adset/ad ismi için güvenli pattern ve naming token'ları;
- Meta objective, buying type, special category ve Advantage+;
- CBO/ABO, daily/lifetime budget ve budget owner;
- optimization goal, billing event, promoted object ve attribution;
- geo, language, age band, audience/placement/device özeti;
- status, lifecycle, created/start/stop zamanı;
- creative format, CTA, destination/link domain ve message token'ları;
- daha önce atanmış başka bir iç kategori.

Serbest regex/kod/SQL yoktur. Bir mapping yayınlanmadan önce etkilenen, yeni eşleşen,
çıkan ve conflict'e düşen entity'leri preview eder.

Kaynak önceliği:

```text
manual_locked
> published explicit mapping
> naming convention mapping
> Meta/property rule
> agent suggestion
> uncertain/unmatched
```

Agent suggestion otomatik kilitlenmez; evidence ve confidence ile inceleme kuyruğuna gelir.

## 5. Miras ve effective context

- Campaign kategorisi varsayılan olarak child ad set, ad ve creative bağlamına iner.
- Child `add`, `override` veya tanımlı durumda `deny-inheritance` yapabilir.
- Single dimension child override parent değerini effective context'te bastırır; her ikisi
  trace'te kalır. Multi dimension child addition parent setine eklenir.
- Creative birden fazla ad tarafından kullanılıyorsa entity kategorisi creative asset'e
  kalıcı kimlik diye yazılmaz; ad bağlamında effective olur.
- Her analysis/budget/action run; kategori assignment ve profile/policy version setini
  snapshot'lar. Sonraki düzenleme geçmiş sonucu yeniden yazmaz.

## 6. Kategorinin sisteme etkisi

Bir kategori aşağıdaki davranışların varsayılanı veya hard constraint'i olabilir:

| alan | kategori etkisi |
|---|---|
| analiz | KPI, diagnostic, guardrail, min sample, cohort, timeframe |
| değerlendirme | başarı/hedef, dikkat soruları, karar kılavuzu |
| bütçe | pool, floor/cap/fixed/reserve, transfer allow/deny, allocation weight |
| zaman | data-settle delay, learning/cooldown, schedule ve outcome window |
| aksiyon | pause/activate/increase/decrease izni, cap ve approver |
| kreatif | beklenen dil/format/CTA/destination; mevcut asset karşılaştırması |
| rapor | kategori cohort'u, owner ve öncelikli bölümler |

Kategori profile'ları sistem safety veya locked entity instruction'ı ezemez.

## 7. Somut senaryolar

### Korunan bölge bütçesi

`geo_market=istanbul` + `protection_class=no-transfer` + `budget_pool=medikal-tr`.
CPA başka bölgede daha iyi olsa bile resolver İstanbul floor'unu taşımaz. Analiz
“pahalı” bulgusunu gösterebilir; budget action uygunluğunu kategori constraint'i bastırır.

### Doktor tanıtımı / WhatsApp prospecting

Campaign name + Meta `OUTCOME_LEADS`, ad-set geo/language ve creative CTA'dan
`service_line=doktor-tanitim`, `destination=whatsapp`, `audience_strategy=prospecting`
önerilir. WhatsApp conversation KPI playbook'u seçilir; generic conversion kullanılmaz.

### Evergreen awareness / no-pause

`campaign_role=evergreen`, `funnel_intent=awareness`, `protection_class=no-pause`.
Frequency/freshness analizi yapılır; “performans düştü” diye pause action'ı üretilmez,
kreatif rotasyonu veya inceleme önerisi approval kuyruğuna gider.

## 8. Dashboard

İç kategori merkezinde kullanıcı şunları görür:

- dimension ve kategori kataloğu; draft/published/archived version;
- kategori profile'ına bağlı analiz, bütçe, schedule, action ve creative politikaları;
- coverage, unmatched, low-confidence ve cardinality conflict sayıları;
- assignment listesi ve “neden bu kategoride” evidence'i;
- campaign→child inheritance ve override trace;
- mapping preview ve archive/edit impact;
- bu kategoriyle çalışan analysis/schedule/automation/run'lar.

Arşiv, tarihsel assignment/run kaydını silmez. Aktif policy veya otomasyon bağlıysa
etki preview ve replacement/disable kararı olmadan arşiv tamamlanmaz.

## 9. Kabul ölçütleri

1. Bir campaign en az beş ayrı dimension kategorisiyle analiz edilebilir.
2. Manual lock, name/property mapping ve agent suggestion önceliği deterministiktir.
3. Single-dimension conflict sessiz karar değil `PARKED_CONFLICT` üretir.
4. Category profile aynı run'da analiz, bütçe, schedule ve action eligibility'ye yansır.
5. Parent/child override trace ve effective-context snapshot yeniden üretilebilir.
6. Protected-budget senaryosunda metrik tavsiyesi hard constraint'i ezemez.
7. Kullanıcı kategori/profile/mapping'i görür, preview eder, sürümler ve arşivler.
