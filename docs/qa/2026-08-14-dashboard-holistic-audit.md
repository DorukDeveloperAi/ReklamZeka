# ReklamZeka Dashboard — Holistik UX Başlangıç Auditi

> Tarih: 2026-08-14  
> Goal: `plans/oturumlar/2026-08-14-dashboard-holistik-ux-goal.md`  
> Durum: İlk karar uygulandı — Today/Campaigns kanonik-only increment doğrulandı  
> Kapsam: Aşama 0–2 + ilk dar implementation increment; 16 görünüm, ana section'lar, veri kaynağı, capability ve ilk bilgi mimarisi önerisi

## 1. Sonuç özeti

Mevcut dashboard iki zıt problemi aynı anda taşıyor:

1. **Sahte doluluk:** Today, Kampanyalar ve Analizler yüzeyleri hardcoded kampanya, metrik, karar, tarih, agent anlatısı ve analiz rutinleriyle dolu görünüyor.
2. **İşlevsiz feature kalabalığı:** Gerçek backend yolu bulunan birçok yönetim görünümü aktif workspace'te sıfır kayda sahip veya browser session bağlı olmadığı için yalnız “oturum bağla / kaynak etkin değil” gösteriyor.

Aktif workspace'te gerçek Meta verisi güçlü biçimde mevcut:

| Veri ailesi | Aktif workspace kaydı |
|---|---:|
| Meta bağlantısı | 1 |
| Reklam hesabı | 5 |
| Kampanya | 422 |
| Ad set | 1.108 |
| Reklam | 1.336 |
| Creative | 417 |
| Post | 1.193 |
| Günlük canonical insight | 759 |
| Local agent session | 10 |

Aynı workspace'te aşağıdaki ürün kayıtları **0**:

- category dimension/definition/assignment
- guidance card/set
- strict policy revision
- effective campaign context
- budget pool/proposal
- Decision Room run/inbox
- advised practice
- promotion template
- autonomy rule
- action proposal unit
- delivery alert
- operational event
- orchestrator conversation

Bu nedenle önerilen ürün yönü:

- Ana deneyimi gerçek Meta portföyü ve canonical insight üzerine kur.
- Sıfır kayıtlı teknik modülleri ayrı ana sayfalar gibi sergileme.
- Yönetim ve karar yaşam döngülerini kullanıcı işi etrafında birleştir.
- Statik fallback yerine gerçek `EMPTY` / `UNAVAILABLE` durumları göster.
- Orchestrator'ı ayrı bir feature vitrini değil, bağlamsal global yardımcı yap.

## 2. Kanıt ve baseline

### Çalışma ortamı

- `/dashboard`: HTTP 200
- `/api/health`: HTTP 200
- Node: 22.9.0
- Veritabanı, Meta ve local-session environment değişkenleri yapılandırılmış
- Browser ile 16/16 görünüm açıldı
- Browser console error/warn: 0

### Doğrulama kapıları

| Kapı | Sonuç | Yorum |
|---|---|---|
| `npm run typecheck` | PASS | TypeScript temiz |
| `npm run build` | PASS | Production build ve secret artifact taraması temiz |
| 10 dashboard odak test dosyası / 40 test | PASS | Mevcut kontratları doğruluyor |
| `npm run check:experience` | PASS | Today/Campaigns kanonik-only sözleşmesi ve 1280/390 browser kanıtı bağlı |

Başlangıçta `check:experience` şu eski metinleri `operating-dashboard.tsx` içinde zorunlu tutuyordu:

- `Taslağı kaydet`
- `Onaylandı · execute bekliyor`
- `Demo modunda Meta execute kapalı`

Bu bağımlılık ilk increment'te quality gate'ten çıkarıldı. `tests/performance-experience.test.ts` hâlâ legacy `/api/dashboard` ve rapor/insight fixture zincirini doğruluyor; ana `/dashboard` runtime'ı artık bu zinciri import etmiyor. Legacy zincirin kaldırılması ayrı veri-mimarisi increment'idir.

## 3. Önerilen birincil kullanıcı işleri

İlk kullanıcı doğrulamasına sunulan öncelik sırası:

1. **Güveni doğrula:** Meta bağlantısı, freshness, coverage ve eksik veri durumunu anla.
2. **Dikkat isteyen konuyu bul:** Gerçek değişiklik, risk, alarm veya bekleyen kararı gör.
3. **Kanıta in:** Hesap → kampanya → ad set → reklam → creative/post ve performans bağlamını incele.
4. **Karar ver:** Öneri/no-change, bütçe etkisi, constraint ve onay gereğini değerlendir.
5. **Sonucu izle:** Karar, action, verification ve outcome izini aynı bağlamda takip et.

Guidance, kategori, policy, autonomy ve practice bu işler için destekleyici bağlamdır; tek başına ürünün ana günlük işi değildir.

## 4. Mevcut görünüm envanteri ve ilk kararlar

Kararlar henüz kullanıcı tarafından onaylanmadı.

| # | Görünüm | Browser'da görünen ana section'lar | Veri/capability gerçeği | İlk survival önerisi | İlk yerleşim önerisi |
|---:|---|---|---|---|---|
| 1 | Bugün | Hero, sistem durumu, canonical KPI, demo karar masası, agent kartı, demo portföy tablosu | KPI endpoint'i gerçek; karar/agent/portföyün çoğu statik | `IMPROVE` | `STANDALONE_VIEW` |
| 2 | Kampanyalar | Offline workbook, şablon kütüphanesi, demo/canonical portfolio, persisted context, detay, hierarchy, brief | Canonical read mirror gerçek ve dolu; session yoksa statik fallback | `IMPROVE` | `STANDALONE_VIEW` |
| 3 | Analizler | Hero, analiz builder, üç rutin kartı | Rutinler hardcoded; gerçek Decision Room run sayısı 0 | `MERGE` | Decisions içinde `PARENT_SECTION` |
| 4 | Decision Room | Inbox/runs/schedules tabları, session recovery | Gerçek API; aktif workspace run/inbox 0 | `MERGE` | Birleşik `Decisions` workspace |
| 5 | Bütçeler | Proposal ledger/detail veya session state | Gerçek API; budget proposal 0 | `MERGE` | Decisions/Campaign detail içinde context |
| 6 | Kurallar & akışlar | Budget pools, Guidance Studio, Normalization, Slice Rule | Gerçek endpoint'ler; aktif workspace kayıtları büyük ölçüde 0 | `MERGE` | `Rules & Context` lifecycle |
| 7 | Strict policies | Policy studio ve impact/promotion alt akışları | Gerçek API; strict policy 0; browser'da anlamlı içerik oluşmadı | `MERGE` | Rules lifecycle içinde ileri seviye |
| 8 | İç kategoriler | Künye review, inventory/authoring, starter adoption | Gerçek API; aktif workspace category kaydı 0 | `MERGE` | Portfolio context + Rules management |
| 9 | Autonomy Studio | K2/K3/K4 policy bundle/autonomy taslağı | Gerçek API; autonomy revision 0 | `MOVE_DEEPER` | Rules/Settings altında advanced |
| 10 | Practice Lab | Practice list/detail/lifecycle veya unavailable | Gerçek API; practice 0 | `HIDE_UNTIL_RELEVANT` | Rules/Analysis detail içinde progressive disclosure |
| 11 | Meta bağlantısı | Canonical mirror, veri kalitesi, bootstrap, portfolio capability | Gerçek ve dolu Meta verisi | `KEEP` | `SETTINGS_VIEW`; trust özeti Today'de inline |
| 12 | Orchestrator Agent | Chat, handoff, roller, hareket özgürlüğü | Session gerçek; conversation 0; önemli anlatılar statik | `MERGE` | Global contextual assistant/drawer |
| 13 | Onay kuyruğu | Authority sınırları, execution safety, queue | Gerçek API; action proposal 0 | `MERGE` | Birleşik Decisions içinde queue tabı |
| 14 | Teslimat alarmları | Authority sınırı, alarm ledger/session state | Gerçek API; alert 0 | `HIDE_UNTIL_RELEVANT` | Today + Campaign detail inline; archive derinde |
| 15 | Gönderi öne çıkarma | Template authoring/lifecycle, preflight/catalog | Gerçek API; template 0 | `MOVE_DEEPER` | Campaign/creative contextual action |
| 16 | Timeline | Operational timeline ve temporal öneriler | Gerçek API; operational event 0 | `MERGE` | İlgili campaign/decision/alarm detail |

## 5. Görünüm → section kırılımı

### 5.1 Bugün

1. Workspace/topbar
2. Gün/tarih hero'su
3. Sistem durumu şeridi
4. Canonical performans kartları
5. “Karar Masası · Demo”
6. Orchestrator durum/anlatı kartı
7. “Portföy · Demo” kampanya tablosu
8. Source/provenance footer

İlk hüküm: Canonical KPI section'ı korunabilir; hardcoded karar masası, agent cevabı ve demo portföy kaldırılmalı veya gerçek endpoint'e bağlanmalı.

### 5.2 Kampanyalar

1. Hero ve “Yeni analiz” CTA
2. Offline çalışma kitabı snapshot'ı
3. Pazar/rota tabloları
4. Brief senaryo kütüphanesi
5. Canonical portfolio veya demo fallback
6. Persisted frozen-context picker
7. Kampanya listesi ve filtreler
8. Kampanya detail/context
9. Demo hierarchy drill-down
10. Planning brief
11. Context-bound approval/timeline bağlantıları

İlk hüküm: Bu görünüm birden fazla eski prototipi üst üste taşıyor. Canonical portfolio merkez olmalı; historical import ve planning brief seçili campaign detail'e progressive disclosure olarak taşınmalı.

### 5.3 Analizler + Decision Room

- Analiz builder
- Statik rutin kartları
- Inbox
- Runs
- Schedules
- Session recovery

İlk hüküm: Kullanıcı açısından aynı “analiz et → sonucu gör → karar ver” yolculuğunun parçalarıdır. Ayrı ana navigasyon hedefleri gereksiz bağlam geçişi yaratıyor.

### 5.4 Bütçeler

- Proposal listesi
- Proposal detail
- Before/after allocation
- Constraint/pacing/trace
- Session/empty/error state

İlk hüküm: Bağımsız dashboard yerine campaign/decision bağlamında anlamlı. Global bütçe planlama ileride gerçekten kullanılırsa ayrı workspace olma kararı yeniden değerlendirilebilir.

### 5.5 Rules ailesi

- Budget Pool Hierarchy
- Guidance Studio
- Normalization Workbench
- Slice Rule Workspace
- Strict Policy Studio
- Policy Bundle
- Progressive Formalization
- Category review/inventory/profile/adoption
- Autonomy
- Practice lifecycle

İlk hüküm: Teknik lifecycle ve domain modülleri navigasyona yansımış. Kullanıcıya tek bir “bağlam ve işletim kuralları” yaşam döngüsü olarak sunulmalı.

### 5.6 Operasyon ailesi

- Approval Queue
- Alerts
- Promotion preflight
- Timeline

İlk hüküm: Bunların üçü seçili campaign/decision bağlamına bağımlı; ayrı sayfa olarak açıldığında çoğu boş veya session state gösteriyor. Approval birleşik Decisions içinde kalabilir; diğerleri contextual olmalı.

## 6. Hardcoded/statik demo veri envanteri

### P0/P1 adayları

| Kaynak | Statik içerik | Neden sorun? | Öneri |
|---|---|---|---|
| `src/app/dashboard/page.tsx` | Server modelini `dashboardResponse()` demo snapshot'ından kuruyor | Dashboardun kök modeli gerçek veriye bağlı değil | Kök modeli gerçek trust/read-mirror summary'ye bağla veya kaldır |
| `src/app/dashboard/demo-data.ts` | 4 golden demo metric, demo workspace/account/campaign | Test fixture'ı doğrudan ürün görünümünü besliyor | UI runtime'dan çıkar; yalnız test fixture olarak tut veya sil |
| `src/app/dashboard/fixture-state.ts` | Ready/partial/delayed/error durumları demo metric kopyalarıyla | Gerçek state değil, URL ile canlandırılan prototip | Gerçek API state union'ına geçir |
| `operating-dashboard.tsx: campaigns` | 3 kampanya, KPI, bütçe, kategori | Gerçek 422 kampanya varken sahte portföy gösteriyor | Canonical portfolio dışında fallback gösterme |
| `demoHierarchyByCampaignId` | Ad set/ad/creative hiyerarşisi | Gerçek Meta hierarchy varken sahte varlık graph'ı | Tamamen kaldır |
| `analysisRuns` | 3 analiz rutini ve sonuçları | Gerçek run/schedule kayıtları 0 | Gerçek empty state göster |
| `approvalItems` | 3 karar/aksiyon örneği | Gerçek queue 0; kullanıcıya bekleyen karar varmış hissi veriyor | Gerçek queue summary veya empty state |
| Today hero | `7 AĞUSTOS CUMA` | Güncel olmayan sabit tarih | Server/user timezone güncel tarih veya tarihi kaldır |
| Today Orchestrator | `11 kategori · 18 guidance · 7 policy · 4 experiment` ve hazır cevap | Aktif workspace ilgili kayıtları 0 | Gerçek aggregate veya empty/onboarding state |
| Nav badge'leri | Bugün `3`, Analizler `2`, Agent `●` | Gerçek count/state'e bağlı değil | API-derived count veya badge yok |
| Workspace/profile | `Demo Marka`, `DM`, `AY`, global `DEMO` | Gerçek local workspace bağlamından bağımsız | Server-bound public workspace identity veya nötr state |
| Offline workbook snapshot | Tarihsel sabit portföy ve brief şeritleri | Provenance açık olsa da canonical portföyü bastırıyor | Historical import olarak campaign detail'e taşı |

### Statik fakat operasyon verisi olmayan içerik

Aşağıdakiler doğrudan kaldırılmak zorunda değildir; kullanıcı dili ve usefulness açısından ayrıca audit edilmelidir:

- status label map'leri
- checklist tanımları
- risk/kategori enum label'leri
- güvenlik/authority açıklamaları
- agent skill tanımları
- empty/error state mikro metinleri

## 7. Gerçek source-of-truth haritası

| Kullanıcı ihtiyacı | Gerçek UI/API yolu | Repository/veri ailesi | Aktif workspace durumu |
|---|---|---|---|
| Meta hiyerarşisi | `/api/meta/read-mirror` | accounts/campaigns/ad sets/ads/creatives/posts | Dolu |
| Canonical KPI | `/api/meta/canonical-performance` | `meta_daily_insights` | 759 satır, coverage partial olabilir |
| Trust/readiness | `/api/meta/trust-readiness` | mirror/insight coverage kanıtı | Gerçek |
| Portfolio capability | `/api/meta/portfolio-capability` | connection/account capability | 1 connection, 5 account |
| Campaign context | `/api/campaign-context(s)` | `effective_campaign_contexts` | 0 |
| Analiz inbox/run/schedule | `/api/decision-room` | decision room tabloları | 0 |
| Bütçe proposal | `/api/budget-lab` | budget proposal tabloları | 0 |
| Guidance | `/api/guidance-studio` | guidance card/set | 0 |
| Category | category API ailesi | category dimension/definition/assignment | 0 |
| Strict policy | instruction/policy API ailesi | strict policy revisions | 0 |
| Autonomy | `/api/autonomy-rules` | autonomy revisions | 0 |
| Practice | `/api/practice-lab` | advised practice | 0 |
| Approval | `/api/approval-queue` | action proposal units | 0 |
| Delivery alert | `/api/delivery-health-alerts` | delivery alert ledger | 0 |
| Promotion | promotion API ailesi | template/preset/preflight | 0 persisted template |
| Timeline | `/api/operational-timeline` | operational events | 0 |
| Local agent session | `/api/local-agent-sessions` | local agent sessions | 10 kayıt; aktiflik ayrıca resolve edilmeli |
| Orchestrator conversation | `/api/orchestrator-conversation` | orchestrator conversation | 0 |

## 8. En yüksek riskli ilk beş bulgu

### F-01 — Gerçek Meta verisi varken demo portfolio fallback'i gösteriliyor (`P0/P1`)

Browser'da Today ve Campaigns gerçek 422 kampanya yerine üç hardcoded campaign gösterdi. Bu yanlış canlı veri değil diye etiketlense de kullanıcı karar yüzeyinde sahte operasyon bağlamı oluşturuyor.

Öneri: Canonical source hazır değilse gerçek `UNAVAILABLE`/session recovery göster; sahte hierarchy gösterme.

### F-02 — Statik kararlar gerçek queue gibi dikkat çekiyor (`P0/P1`)

Aktif workspace'te action proposal 0 iken Today üç risk/aksiyon örneği gösteriyor ve “Gerçek kuyruğu aç” bağlantısı sunuyor.

Öneri: Gerçek queue summary; kayıt yoksa “bekleyen karar yok”. Örnek karar eğitimi gerekiyorsa ürün dashboardundan ayrı dokümantasyon/onboarding.

### F-03 — Ana navigasyon teknik modül envanterine dönüşmüş (`P1`)

16 ana görünümün çoğu aynı session recovery veya boş state'e düşüyor. Kullanıcı günlük işi yerine Guidance/Normalization/Slice/Policy/Practice gibi iç lifecycle ayrımlarını öğrenmek zorunda kalıyor.

Öneri: 4 birincil çalışma alanı + Settings + global assistant.

### F-04 — Dashboard kök state ve kalite kapısı demo fixture'a bağlı (`P1`)

`page.tsx`, `/api/dashboard`, `fixture-state.ts`, experience testi ve browser evidence eski demo snapshot etrafında kurulmuş.

Öneri: Gerçek data-state contract'ı oluştur; testleri `LIVE/PERSISTED_SAMPLE/HISTORICAL_IMPORT/EMPTY/UNAVAILABLE` durumlarına geçir.

### F-05 — Session bağlantısı merkezi değil (`P1/P2`)

Budget, Decision Room, Practice, Approval, Alerts, Rules ve Categories benzer “oturum bağla” yüzeylerini ayrı ayrı gösteriyor. Kullanıcı aynı environment problemini birçok feature problemi sanıyor.

Öneri: Global session/workspace health gate; tüm child yüzeyler tek recovery kaynağına bağlansın.

## 9. Önerilen hedef bilgi mimarisi

### Birincil navigasyon

1. **Bugün** — trust, dikkat isteyen gerçek sinyaller, bekleyen kararlar, son sonuçlar
2. **Portföy** — account/campaign hierarchy, performance, context, creative, classification
3. **Kararlar** — analysis, evidence, recommendations, budget scenarios, approvals, verification
4. **Kurallar & Bağlam** — guidance, categories, policy, autonomy ve öğrenilmiş practice lifecycle

### İkincil/global yüzeyler

- **Ayarlar / Bağlantılar** — Meta connection, account groups, sync/trust detayları
- **Orchestrator** — her görünümden açılan contextual drawer/panel
- **Timeline** — ilgili campaign/decision/alarm detail içinde; gerekirse global arşiv araması
- **Promotion** — campaign/creative detail içindeki contextual action
- **Alerts** — Today ve Campaign detail'de ilgili olduğunda; geçmiş kayıtlar arşivde

Önerilen ana navigasyon sayısı: **16 → 4 birincil + Settings**.

## 10. Önerilen temel yolculuklar

### J-01 — Günlük güven ve dikkat

```text
Bugün
→ veri güveni/freshness
→ gerçek dikkat sinyali veya “dikkat isteyen konu yok”
→ ilgili campaign detail
→ kanıt
→ karar/no-change
```

### J-02 — Portföyden karara

```text
Portföy
→ account/campaign seçimi
→ performance + context + creative
→ analiz et
→ evidence/recommendation
→ karar veya izle
```

### J-03 — Birleşik karar workspace'i

```text
Kararlar
→ inbox/run seçimi
→ evidence ve before/after
→ budget/constraint
→ approve/reject/request changes
→ verification + contextual timeline
```

### J-04 — Kural yaşam döngüsü

```text
Kurallar & Bağlam
→ owner guidance
→ scope/category
→ normalize/review
→ gerektiğinde strict policy
→ impact/conflict
→ ayrı insan yayını
```

### J-05 — Bağlamsal Orchestrator

```text
Herhangi bir görünüm
→ mevcut account/campaign/decision bağlamıyla Orchestrator'ı aç
→ kaynaklı açıklama/taslak
→ aynı bağlamda dashboard veya CLI devamı
```

## 11. İlk implementation increment seçenekleri

### Seçenek A — Gerçek veri-first temizlik (`ÖNERİLEN`)

İlk increment yalnız Today ve Campaigns'i ele alır:

- `DEMO_METRICS` tabanlı kök dashboard modelini runtime'dan çıkar.
- Today'deki sabit tarih, kararlar, agent cevabı, sayılar ve demo portfolioyu kaldır.
- Campaigns'teki hardcoded campaign/hierarchy fallback'ini kaldır.
- Canonical Meta source/session yoksa gerçek `UNAVAILABLE`/recovery göster.
- Source hazırsa gerçek read-mirror ve canonical performance göster.
- Nav badge'lerini gerçek kaynağa bağla veya kaldır.
- Demo-fixture odaklı experience testini gerçek state contract'ına geçir.

Artısı: Kullanıcıyı hemen yanıltmayan, mevcut gerçek Meta verisini kullanan çekirdek elde edilir.  
Eksisi: Bazı alanlar geçici olarak daha boş görünür; bu goal açısından doğrudur.

### Seçenek B — Persisted sample workspace kur

Önce örnek tenant verisini database'e seed et; sonra Today/Campaigns'i production ile aynı API/repository yoluna bağla.

Artısı: Demo/onboarding ortamı dolu kalır ve gerçek data yolu kullanır.  
Eksisi: Aktif workspace'te zaten gerçek Meta verisi varken ilk kullanıcı değerini geciktirir; seed provenance ve lifecycle tasarımı gerekir.

### Seçenek C — Önce navigasyon sadeleştir

16 görünümü 4+Settings yapısına indir; içerikleri daha sonra gerçek veriye bağla.

Artısı: Feature spam hızlı azalır.  
Eksisi: Hardcoded demo kararları ve portföy daha uzun süre kalır; yanlış öncelik.

## 12. İlk dar kullanıcı kararı

Öneri: **Seçenek A ile başla.**

Karar sorusu:

> Today ve Campaigns'teki bütün frontend hardcoded operasyon fallback'lerini şimdi kaldırıp, kaynak/session yokken daha boş fakat tamamen dürüst `EMPTY/UNAVAILABLE` durumlarına geçelim mi; yoksa önce production yolunu kullanan persisted sample workspace mi tasarlayalım?

Bu karar kullanıcı tarafından **Seçenek A** olarak onaylandı. Geniş navigasyon veya görsel redesign bu dar increment'e dahil edilmedi.

## 13. Karar kaydı ve ilk increment sonucu

### Onaylanan karar

Today ve Campaigns yüzeyleri için frontend hardcoded fallback kaldırıldı. Kural:

```text
Doğrulanmış kanonik kaynak varsa → gerçek tenant-bound veri
Kanonik kaynak yoksa/oturum gerekiyorsa → dürüst loading/session_required/unavailable
Asla → demo kampanya, workbook, örnek karar, statik marka veya statik metrik fallback'i
```

### Yapılan değişiklikler

- `/dashboard`, `dashboardResponse`, `fixture-state` ve `DEMO_METRICS` runtime zincirinden ayrıldı.
- Today'deki statik tarih, demo karar masası, sahte agent anlatısı/sayaçları ve demo portföy tablosu kaldırıldı.
- Today yalnız kanonik read-mirror özeti, canonical performance ve gerçek local-agent session durumunu gösteriyor.
- Campaigns'teki offline workbook, brief şablon kütüphanesi, hardcoded kampanyalar, filtreler, demo hierarchy ve demo creative kaldırıldı.
- Campaigns yalnız `CanonicalCampaignPortfolioPanel` veya açık kaynak/session recovery durumu gösteriyor.
- `Demo Marka`, `DEMO` brand etiketi ve statik navigasyon badge'leri kaldırıldı.
- Source footer Today/Campaigns için kanonik ayna durumunu açıklıyor.
- Experience gate eski demo copy'sini korumak yerine bu yeni veri-doğruluğu sözleşmesini koruyor.

### Doğrulama kanıtı

| Kapı | Sonuç |
|---|---|
| TypeScript | PASS |
| 7 odak test dosyası / 26 test | PASS |
| Desktop browser 1280×720 | PASS; yatay taşma yok, tek H1 |
| Mobile browser 390×844 | PASS; yatay taşma yok, tek H1 |
| Console error/warn | 0 / 0 |
| Yasaklı demo terimleri | 0 |

Browser oturumunda kanonik endpoint `session_required` döndürdü. Bu nedenle gerçek 422 kampanya bu browser bağlamında render edilmedi; sistem bunların yerine fallback üretmedi ve doğru recovery aksiyonlarını gösterdi. Bu, veri doğruluğu açısından beklenen davranıştır; yerel oturumun günlük kullanıcı akışına nasıl yedirileceği sonraki UX kararıdır.

Kanıt dosyası: `docs/qa/2026-08-14-dashboard-first-increment-browser-evidence.json`

### Kalan borç ve bir sonraki karar

- Analizler ve bazı diğer görünümlerde hardcoded operasyon anlatıları hâlâ mevcut; bu increment yalnız Today/Campaigns kapsamındaydı.
- Legacy `/api/dashboard`, `/api/insights`, `/reports/demo` ve bunlara bağlı fixture testleri ayrıca ele alınmalı.
- Mevcut browser'ın `session_required` olması, gerçek verisi bulunan kullanıcının ilk girişte değer görmesini engelliyor. Sonraki dar karar: yerel dashboard session'ını görünmez/güvenli bootstrap ile mi kuracağız, yoksa kullanıcı kontrollü tek bir bağlantı adımıyla mı?

## 14. Yerel session UX kararı ve uygulaması

### Güvenlik/UX kararı

Görünmez otomatik session bootstrap reddedildi. Mevcut kanonik mimari tek-kullanımlık proof'un yalnız aynı OS kullanıcısı tarafından terminalde üretilmesini zorunlu tutuyor; agent veya browser otomasyonu proof üretemez ve cookie mint edemez. Bu sınır session fixation, cross-origin bootstrap ve gizli principal seçimi risklerini kapatıyor.

Seçilen UX:

```text
Today veya Campaigns kanonik kaynak isteği
→ local_session_required
→ aynı source-state paneli içinde tek ortak bağlantı formu
→ kullanıcı terminalde npm run local-session:mint
→ 90 saniyelik proof'u password alanına yapıştırır
→ server proof'u tek kez tüketir ve HttpOnly cookie mint eder
→ UI read-mirror, canonical performance, portfolio capability ve session kaynaklarını yeniler
→ kullanıcı aynı görünümde kalır
```

### Uygulanan iyileştirmeler

- Session formu Decision Room'a gömülü tekil bir parça olmaktan çıkarılıp yeniden kullanılabilir `LocalSessionConnector` yapıldı.
- Today ve Campaigns'teki `session_required` paneline doğrudan yedirildi; kullanıcı artık başka bir görünümde bağlam kaybetmiyor.
- Proof password alanında alınır, submit anında React state'inden temizlenir ve hiçbir client storage/cookie API'sine yazılmaz.
- Proof yalnız `Authorization: Bearer` ile exact same-origin `/api/local-session` endpoint'ine, gövdesiz POST olarak gönderilir.
- Rejected, not-configured, verification-failed ve unavailable durumları ayrı kullanıcı mesajlarına sahip.
- Başarılı cookie mint sonrası kanonik Meta aynası doğrulanır; ardından canonical performance yeniden mount edilir ve portfolio capability, local agent sessions ve Orchestrator conversation kaynakları yenilenir.
- Decision Room aynı ortak connector'ı kullanacak biçimde sadeleştirildi; server bootstrap ve cookie authority sözleşmesi değişmedi.

### Kanıt

| Kapı | Sonuç |
|---|---|
| Session UX + HTTP boundary + conformance testleri | PASS · 6 dosya / 23 test |
| Sahte proof rejection browser etkileşimi | PASS; mesaj görünür, input temiz |
| Desktop 1280×720 | PASS; connector bağlam içinde, taşma yok |
| Mobile 390×844 | PASS; input/button 317 px, tek kolon, taşma yok |
| Console error/warn | 0 / 0 |
| Agent/browser proof mint | Yapılmadı; güvenlik sözleşmesi korundu |

Kanıt dosyası: `docs/qa/2026-08-14-dashboard-session-ux-browser-evidence.json`

### Açık canlı kabul

Happy-path browser kabulü kullanıcı tarafından üretilen gerçek tek-kullanımlık proof gerektiriyor. Bu nedenle şu zincir henüz browser'da kanıtlanmadı:

```text
gerçek proof → HttpOnly cookie → read-mirror ready/partial/empty → gerçek kampanyalar
→ canonical performance ready/partial → aynı görünümde otomatik refresh
```

Bu açık kabul demo fallback'e dönmek için gerekçe değildir. Kullanıcı proof ile bağlantıyı yaptığında bir sonraki interaktif adım gerçek 422 kampanyanın ve insight kapsamının browser kanıtını toplamaktır.

## 15. Analizler + Karar Odası varlık kararı ve birleştirme

### Element-seviyesi audit

| Parça | Önceki durum | Capability | Karar | Gerekçe |
|---|---|---|---|---|
| `Analizler` navigasyon hedefi | Ayrı görünüm | `MISLEADING` | `MERGE` | Görünümün bütün operasyonel içeriği frontend sabitiydi; bağımsız gerçek kullanıcı işi veya veri sözleşmesi yoktu. |
| Analiz hero + `+ Analiz oluştur` | Toast üreten CTA | `PLACEHOLDER` | `REMOVE` | Taslak oluşturma, validasyon veya persistence sonucu yoktu. |
| Kapsam / timeframe / agenda / karar profili | `4 hesap · 32 kampanya`, 7 gün ve 10 pass sabiti | `MISLEADING` | `HIDE_UNTIL_READY` | Exact account/campaign/timeframe/template refs gerçek kaynaktan seçilmeden analiz komutu üretilemez. |
| `Dry-run çalıştır` | Yalnız toast | `MISLEADING` | `HIDE_UNTIL_READY` | Backend dry-run yolu gerçektir; fakat current session, exact refs ve settlement policy config yokken UI capability iddiasında bulunmamalıdır. |
| Üç analiz rutini | Statik array | `PLACEHOLDER` | `REMOVE` | Gerçek schedule/run repository sonucu gibi görünüyordu. |
| `Takvimi yönet` / `Detay` | Sonucu olmayan butonlar | `BROKEN` | `REMOVE` | Görünür kontrollerin hiçbir kullanıcı sonucu yoktu. |
| Decision Room read model | PostgreSQL schedule/run/inbox okumaları | `REAL_BUT_ENV_BLOCKED` | `KEEP + IMPROVE` | Gerçek repository, bounded cursor ve local-session authority sınırı var. |
| Rutinler / Koşumlar / Analiz kutusu | Gerçek read-model sekmeleri | `READ_ONLY` | `KEEP`, `Analiz kutusu → Sonuçlar` | Üçü aynı analiz-karar yolculuğunun farklı yaşam döngüsü kesitleri. |
| Read-only authority badge | Teknik capability sınırı | `VERIFIED_REAL` | `KEEP` | Kullanıcının burada Meta write/onay çalışmadığını bilmesi güven için gerekli. |
| Session recovery | Ortak local session connector | `REAL_BUT_ENV_BLOCKED` | `KEEP` | Canlı kaynağa ulaşmak için gerekli, server-only cookie authority korunuyor. |

### Bilgi mimarisi kararı

```text
Önce: Analizler (statik kurgu) + Decision Room (gerçek read model)
Sonra: Analiz & Kararlar (tek production-backed read model)
```

- Navigasyon hedefi sayısı `16 → 15` oldu.
- Ayrı `Analizler` hedefi ve `renderAnalysis` tamamen kaldırıldı.
- Eski `initialView="analysis"` çağrıları geriye dönük olarak `decision-room` yüzeyine normalize edilir.
- Kullanıcı adı `Analiz & Kararlar`; backend/domain kontrat adı teknik kaynak açıklamalarında `Decision Room` olarak korunur.
- Statik kapsam, sahte rutin, sahte sonuç, sahte dry-run ve sonuçsuz butonların hiçbiri birleşik yüzeye taşınmadı.

### Capability kararı

`POST /api/decision-room` dry-run altyapısı gerçek, advisory-only ve authority-none'dır. Ancak görünür bir dry-run kontrolü için aşağıdaki zincirin tamamı gerekir:

```text
aktif local session
→ gerçek account/campaign seçimi
→ persisted timeframe/template refs
→ explicit settlement policy configuration
→ bounded POST command
→ persisted run + sonuç read-back
```

Bu zincir current browser oturumunda hazır olmadığı için CTA gizli kalır; toast veya uydurma başarı gösterilmez.

### Uygulama ve kanıt

- Desktop `1280×720`: tek H1, tek birleşik nav hedefi, yatay taşma yok.
- Mobile `390×844`: content 390 px, hero/state panel 362 px, tek H1, yatay taşma yok.
- Rutinler/Koşumlar/Sonuçlar sekme geçişi çalışıyor.
- `session_required` durumunda gerçek recovery görünür; örnek kayıt fallback'i yok.
- Statik `4 hesap · 32 kampanya`, rutin, takvim ve dry-run iddiaları bulunmadı.
- Product console error/warning: `0 / 0`; kod düzenleme sırasında oluşan üç Next.js Fast Refresh uyarısı ürün uyarısı olarak sayılmadı.

Kanıt dosyası: `docs/qa/2026-08-14-dashboard-analysis-decisions-browser-evidence.json`

### Açık kabul ve sonraki audit

- Kullanıcı tarafından mint edilen local session current in-app browser'a henüz bağlanmadığı için gerçek schedule/run/inbox satırlarının live browser kabulü açık.
- Bu dış adım başka görünümlerin auditini durdurmaz.
- Sıradaki önerilen holistik dilim: `Bütçeler + Onay kuyruğu + Autonomy Studio`; ayrı varlık gerekçeleri, tekrar eden approval/authority anlatıları ve gerçek proposal/action capability zinciri birlikte incelenmeli.
