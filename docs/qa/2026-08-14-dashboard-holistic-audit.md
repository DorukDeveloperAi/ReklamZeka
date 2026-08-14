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

## 16. Bütçeler + Onay kuyruğu + Autonomy Studio audit ve dar karar kapısı

### Ortak kullanıcı yolculuğu

```text
bütçe sınırı / havuz
→ deterministik öneri ve alternatif
→ öneriden eylem satırları
→ otonomi/policy değerlendirmesi
→ tekil insan kararı
→ ayrı execution admission (şu anda kapalı)
```

Üç yüzey aynı yolculuğun parçalarıdır; ancak aynı kullanıcı işi değildir. Bütçe planlama uzun süreli çalışma alanı, Onay kuyruğu domainler-arası insan inbox'ı, Autonomy ise seyrek kullanılan yönetim/configuration işidir.

### View ve element survival matrisi

| View / element | Gerçek kaynak veya davranış | Capability | Karar önerisi | Gerekçe |
|---|---|---|---|---|
| `Bütçeler` view | PostgreSQL budget proposal ledger + public-safe detail | `READ_ONLY`, draft API mevcut | `KEEP · STANDALONE_VIEW` | Envelope, havuz, alternatif, before/after ve constraint incelemesi bağımsız çalışma alanını hak eder. |
| Proposal listesi | Gerçek version/revision repository | `VERIFIED_REAL` kod yolu, session-blocked browser | `KEEP + IMPROVE` | Kullanıcı önerileri karşılaştırır; gerçek veri yokken boş/unavailable kalır. |
| Proposal detail | Mapping, alternatif, before/after, pacing, constraint, trace | `READ_ONLY` | `KEEP · DETAIL_PANEL` | Karar için gerekli kanıtı taşır; teknik ref'ler ileride daha anlaşılır label ister. |
| Budget dry-run/save-draft POST | `budget-lab-dry-run` / `budget-lab-save-draft` | `REAL_BUT_ENV_BLOCKED` | `HIDE_UNTIL_READY` | Exact command input ve gerçek scope seçimi olmadan buton eklenmez. |
| Bütçe Havuzları | Gerçek immutable hierarchy draft repository | `VERIFIED_REAL` draft yolu | `MOVE → Bütçeler / ADVANCED_SECTION` | Şu anda `Kurallar & akışlar` altında; kullanıcının bütçe zihinsel modeline aittir. |
| Bütçe Havuzları frontend örneği | Sabit yerli/yabancı 500000 TRY JSON | `MISLEADING` | `REMOVE` | Gerçek snapshot yokken operasyonel limit öneriyordu; kaldırıldı ve `[]` gösteriliyor. |
| `Onay kuyruğu` view | Cross-domain ActionUnit read/detail + macOS human-presence decision | `VERIFIED_REAL` karar kaydı, execute yok | `KEEP · STANDALONE_VIEW` | Bütçe, status ve promotion gibi farklı domainlerden tek insan inbox'ı olması ayrı view'i hak eder. |
| Onay list/detail | before/after, risk, expiry, evidence, dependency, history | `VERIFIED_REAL` kod yolu, session-blocked browser | `KEEP + IMPROVE` | Temel kullanıcı işi “benden hangi karar bekleniyor?” sorusunu karşılar. |
| Statik authority şeridi | Hero ile aynı üç ifadeyi tekrar ediyordu | `UNNECESSARY` | `REMOVE` | Karar bilgisi üretmiyordu; kaldırıldı. |
| Beş adımlı execution safety vitrini | 5 sabit teknik adım | `UNNECESSARY` | `REMOVE` | Kuyruğu 192 px aşağı itiyor, gerçek satır/kanıt yerine mimari anlatıyordu; kaldırıldı. |
| Approve/reject/request changes | Exact unit + checkbox + OS human presence | `VERIFIED_REAL`, no-execute | `KEEP` | Görünür kontrol gerçek ve kalıcı karar kaydı üretir; Meta write yapmaz. |
| `Autonomy Studio` view | Autonomy revision read + normalized draft; nested policy bundle | `VERIFIED_REAL` draft yolu, publish ayrı | `MOVE_DEEPER / MERGE` | Seyrek yönetim işidir; primary nav'da çalışma yüzeyi gibi görünmesi feature spam yaratır. |
| Autonomy revision feed | Gerçek immutable revisions | `READ_ONLY` | `KEEP · ADVANCED_SETTINGS` | Effective mode/kill switch/scope yönetim kanıtıdır. |
| Autonomy draft form | Gerçek cookie-only normalized draft | `VERIFIED_REAL` draft, no publish | `KEEP + IMPROVE` | Serbest ref ve teknik dil yüksek; catalog seçimleri ve açıklayıcı label gerekir. |
| K2/K3/K4 Policy Bundle tab | ApprovalPolicy/Guardrail draft ve human publication ceremony | `VERIFIED_REAL` | `MERGE → Kurallar & Yetkiler` | Autonomy'nin alt sekmesi değil, guidance→rule→policy→authority yaşam döngüsünün advanced parçasıdır. |

### Uygulanan ortak UX düzeltmeleri

- Bütçeler, Onay ve Autonomy `session_required` durumunda ortak `LocalSessionConnector`'ı kendi kaynak panelinde gösteriyor; Decision Room'a navigasyon ve bağlam kaybı kaldırıldı.
- Autonomy local runtime artık bozuk/eksik cookie için `401 local_session_required`, gerçek source configuration eksikliği için `503 source_not_configured` döndürüyor.
- Autonomy'de Policy Bundle sekmesine geçilse bile session recovery tek ve tutarlı kalıyor; nested ikinci unavailable paneli açılmıyor.
- Bütçe Havuzları frontend'deki sabit iki pazar kökü, tarih ve `500000 TRY` tavanı kaldırıldı.
- Onay kuyruğundaki tekrarlı safety strip ve beş adımlı execution vitrini kaldırıldı; kaynak/recovery veya gerçek kuyruk 192 px yukarı taşındı.
- Varsayılan kullanıcı metninde `ActionUnit` yerine `eylem satırı` kullanıldı; domain kontrat adı kod/API'de korunuyor.
- Bütçeler, Onay ve Autonomy async yüklemeleri mount yaşam döngüsüne bağlandı; hızlı görünüm geçişindeki geç state-update yarışı kapatıldı.

### Doğrulama

| Kapı | Sonuç |
|---|---|
| TypeScript | PASS |
| Odak testler | PASS · 8 dosya / 29 test; sadeleştirme sonrası 5 dosya / 20 test |
| Desktop 1280×720 | PASS · 3/3 bağlamsal connector, tek H1, taşma yok |
| Mobile 390×844 | PASS · 3/3 connector, content 375 px, taşma yok |
| Hızlı nav `Bütçeler → Autonomy → Onay` | PASS · 40 ms aralık, product error/warn 0/0 |
| Agent/browser proof mint | Yapılmadı |

Kanıt dosyası: `docs/qa/2026-08-14-dashboard-budget-approval-autonomy-browser-evidence.json`

### Dar bilgi mimarisi karar kapısı

#### Seçenek A — Görev frekansına göre ayır (`ÖNERİLEN`)

- `Bütçeler` ayrı view olarak kalır; `BudgetPoolHierarchyPanel` buraya advanced section olarak taşınır.
- `Onay kuyruğu` cross-domain insan inbox'ı olarak ayrı kalır.
- `Autonomy Studio` primary nav'dan çıkar; `Kurallar & Yetkiler` altında advanced `Yetki & Onay` alanına taşınır.
- K2/K3/K4 Policy Bundle aynı advanced yönetim alanında Autonomy ile yan yana, fakat Guidance/Strict Policy yaşam döngüsünden kopmadan sunulur.

Artı: Günlük çalışma ile seyrek yönetim ayrılır; iki güçlü kullanıcı işi korunurken primary nav azalır.

Eksi: Kurallar & Yetkiler birleşimi sonraki incrementte kendi iç bilgi mimarisi kararını gerektirir.

#### Seçenek B — Üçünü ayrı tut

Yalnız mevcut ekranlar sadeleştirilir; nav değişmez.

Artı: En az yerleşim değişikliği.

Eksi: Autonomy/Policy teknik modülleri primary nav'ı şişirmeye ve Rules/Strict Policies ile tekrar etmeye devam eder.

#### Seçenek C — Tek `Kararlar` workspace'inde birleştir

Bütçe önerileri, bütün onay satırları ve autonomy ayarları tek view olur.

Artı: Proposal→approval geçişi kısa olabilir.

Eksi: Günlük inbox, bütçe planlama ve admin ayarları aynı ekranda karışır; yüksek bilişsel yük ve rol karmaşası yaratır.

**Önerilen kullanıcı kararı: Seçenek A.** Geniş navigasyon/yerleşim değişikliği bu karar onaylanmadan uygulanmayacak.

## 17. Kurallar, strict policy, iç kategoriler ve Practice Lab audit

### Veri ve capability haritası

| Yüzey / parça | Kanonik API ve kaynak | Capability | Varlık / yerleşim önerisi |
|---|---|---|---|
| Guidance Studio | `/api/guidance-studio` → immutable guidance registry | Draft/revise/publish/archive gerçek; action ve Meta write yok | `KEEP · PARENT_SECTION` |
| Guidance setleri | Aynı registry; yalnız yayınlanmış kartların sıralı seti | Draft/review/archive gerçek | `KEEP · PROGRESSIVE_DISCLOSURE` |
| Normalization Workbench | `/api/normalization-workbench` + guidance choices | Draft-only structured normalization; publish/G3/action yok | `MOVE_DEEPER` · seçili guidance kaydının sonraki adımı |
| Slice Rule Workspace | `/api/slice-rule-workspace`, scope/readiness/temporal/budget-impact API'leri | Advisory draft ve impact preview gerçek; authority none | `KEEP · PARENT_SECTION` · birleşik kural yaşam döngüsü içinde |
| Strict Policy Studio | `/api/instruction-policies` + `/api/instruction-policy-impact` | Append-only draft/publish/pause/archive ve exact impact gate gerçek | `MERGE → Kurallar & Yetkiler` · advanced binding stage |
| Progressive Formalization | `/api/progressive-formalization` | G2→G3/G4 preview ve guarded mutation gerçek | `MERGE` · strict policy editöründe bağlamsal dönüşüm adımı |
| Kampanya künye inceleme | `/api/campaign-classification-review` + canonical Meta mirror | Read/review signal; assignment/action/Meta write yok | `MOVE → Kampanyalar / INLINE_CONTEXT` |
| Category Inventory | `/api/category-inventory`, authoring, effective-health, archive-impact | Registry create/revise/assign/archive gerçek ve guarded | `KEEP · ADVANCED_SETTINGS` · ayrı admin amacı var |
| Starter adoption | `/api/starter-category-adoption` | Preview/confirm gerçek; registry hash ve human confirmation gated | `MOVE_DEEPER` · ilk kurulum veya boş registry durumunda |
| Category Profile Studio | `/api/category-profiles` | Profile lifecycle mutation gerçek | `KEEP · DETAIL_PANEL` · seçili kategori bağlamında |
| Practice Lab | `/api/practice-lab` + advised-practice append-only repository | Read/detail/ephemeral draft; human-gated standardization event gerçek | `MOVE_DEEPER` · kural/analiz öğrenim alanı, primary nav değil |

### Holistik bulgular

1. `Kurallar & akışlar`, `Strict policies`, Autonomy içindeki Policy Bundle ve `Practice Lab` teknik lifecycle sınırlarını primary navigasyona yansıtıyor. Kullanıcı açısından bunlar ayrı ürünler değil, **ham yaklaşım → guidance → normalize kural → bağlayıcı policy → yetki → öğrenim** zincirinin aşamalarıdır.
2. `Kurallar & akışlar` içinde Budget Pool, Guidance, Normalization ve Slice Rule aynı seviyede art arda render ediliyor. Budget Pool bütçe zihinsel modeline aittir; kalan üç parça tek kaydın aşamalı yaşam döngüsü olarak sunulmalıdır.
3. `Strict policies` ayrı ve uzun süreli bir editör capability'sine sahip olsa da ana kullanıcı amacı Guidance/Rules'tan kopuk değildir. Deep link korunabilir; primary nav'da ayrı ürün gibi görünmesi önerilmez.
4. `İç kategoriler` iki farklı işi karıştırıyor: günlük kampanya sınıflandırma incelemesi ve seyrek registry yönetimi. İnceleme kuyruğu Campaigns bağlamına taşınmalı; registry yönetimi admin/advanced alanında kalmalıdır.
5. `Practice Lab` gerçek, persisted ve insan kapılı bir lifecycle taşır; placeholder değildir. Ancak seyrek kullanım, advisory authority ve standardization çıktısının guidance/policy zincirine yakınlığı nedeniyle primary nav'da ayrı sayfa olmayı hak etmiyor.
6. Session yokken alt panellerin her biri ayrı hata üretip feature vitrini yaratıyordu. Bu dört view artık birer bağlamsal connector ve tek ana hata gösteriyor; alt capability'ler kaynak doğrulandıktan sonra açılıyor.

### Uygulanan karar gerektirmeyen düzeltmeler

- Guidance ve Category Inventory içindeki `Decision Room’da oturumu bağla` yönlendirmeleri kaldırıldı; ortak `LocalSessionConnector` ilgili sayfaya yedirildi.
- Strict Policy Studio 401 `local_session_required` yanıtını ayırıyor ve kendi bağlamsal connector'ını gösteriyor.
- Practice Lab runtime bozuk/eksik cookie için artık `401 local_session_required`, gerçek environment/source eksikliği için `503 source_not_configured` döndürüyor.
- Practice Lab empty/unavailable metnindeki tekrarlı `demo/fixture fallback` anlatısı kaldırıldı; kaynak durumu ve gerçek boşluk doğrudan anlatılıyor.
- Rules blocked durumda Normalization ve Slice Rule; Strict blocked durumda Progressive Formalization; Categories blocked durumda Starter Adoption ve Category Profile hata panelleri erteleniyor. Capability'ler yalnız ana kaynak doğrulandıktan sonra render ediliyor.
- Rules, Strict, Categories ve Practice blocked/loading durumlarının her birinde tek `h1` sağlandı.

### Doğrulama

| Kapı | Sonuç |
|---|---|
| TypeScript | PASS |
| Odak testler | PASS · 8 dosya / 27 test |
| Desktop 1280 | PASS · 4/4 tek connector, tek H1, taşma yok |
| Mobile 390×844 | PASS · maksimum scroll width 390 px, 4/4 tek connector ve tek H1 |
| Görünür `demo` / `fixture` metni | 0 / 4 view |
| Hızlı nav `Rules → Strict → Categories → Practice` | PASS · 40 ms aralık, product error/warn 0/0 |
| Agent/browser proof mint veya storage inceleme | Yapılmadı |

Kanıt dosyası: `docs/qa/2026-08-14-dashboard-rules-categories-practice-browser-evidence.json`

### Açık bilgi mimarisi kararı

Bu audit önceki **Seçenek A** önerisini güçlendirir:

```text
Bütçeler (Budget Pool dahil)          → ayrı çalışma yüzeyi
Onay kuyruğu                          → ayrı cross-domain insan inbox'ı
Kurallar & Yetkiler                   → Guidance + normalization + slice rule
                                      + strict policy + policy bundle + autonomy
İç kategori registry                 → advanced settings
Kampanya künye inceleme               → Campaigns içinde inline
Practice Lab                          → Kurallar/Analiz altında progressive disclosure
```

Bu yerleşim değişiklikleri kullanıcı A/B/C kararını vermeden uygulanmadı.

## 18. Meta, Orchestrator, teslimat alarmı, gönderi öne çıkarma ve Timeline audit

### Veri ve capability haritası

| Yüzey / parça | Kanonik API ve kaynak | Capability | Varlık / yerleşim önerisi |
|---|---|---|---|
| Meta inventory ve bağlantı hazırlığı | `/api/meta/inventory`, `/api/meta/read-mirror`, `/api/meta/bootstrap-status`, `/api/meta/portfolio-capability` | Kanonik salt-okunur ayna, readiness ve bootstrap gerçek; session/environment ile bloklanabilir | `KEEP · ADVANCED_SETTINGS`; portföy hiyerarşisini `Kampanyalar`a taşı |
| Meta trust/readiness ve Graph tanısı | Aynı server-bound Meta kaynakları | `REAL_BUT_ENV_BLOCKED`, no Meta write | `KEEP · PROGRESSIVE_DISCLOSURE`; yalnız tanı gerektiğinde aç |
| Orchestrator konuşması | `/api/orchestrator-conversation` | Persisted konuşma read/post gerçek; local session gerekli | `MOVE → GLOBAL CONTEXTUAL ASSISTANT` |
| CLI Session Hub ve handoff | `/api/local-agent-sessions`, `/api/local-agent-handoffs` | Kısa ömürlü, aynı kimlikli handoff gerçek | `MOVE_DEEPER · ADVANCED_SETTINGS` |
| Statik skill pack / autonomy seçicileri / fallback mesaj | Frontend sabiti veya persist edilmeyen local state | `PLACEHOLDER / MISLEADING` | `REMOVE` |
| Teslimat alarm ledger'ı | `/api/delivery-health-alerts` | Read/detail ve typed recommendation davranışı gerçek; session ile bloklanabilir | `MERGE → Bugün + Kampanya detayı`; derin triage URL'si korunabilir |
| Gönderi öne çıkarma katalog + preflight | `/api/existing-post-promotion-preflight` | Kanonik katalog, ephemeral preflight ve ayrı K4 taslak komutu gerçek; approval/execute/Meta write kapalı | `MOVE → Kampanya / Kreatif akışı` |
| Promotion template authoring | `/api/promotion-template-authoring` | Draft/lifecycle mutation gerçek | `MOVE_DEEPER · ADVANCED_SETTINGS` |
| Operasyon izi | `/api/operational-timeline` | Salt-okunur persisted event listesi; exact opaque campaign alias filtresi | `MERGE → ilgili kampanya/karar/alarm detayı`; global audit log advanced olarak kalabilir |
| Temporal recommendations | `/api/temporal-recommendations` | İkinci salt-okunur temporal kaynak | `INLINE_CONTEXT`; Timeline kaynağı hazır değilken ertelenir |

### Holistik varlık ve entegrasyon kararı

1. **Meta Bağlantısı** bağımsız bir günlük çalışma yüzeyi değil, bağlantı ve güven yönetimi alanıdır. Meta inventory, bootstrap ve readiness korunmalıdır; ancak aynı account→campaign hiyerarşisini hem burada hem `Kampanyalar`da göstermek tekrar yaratır. Ana hiyerarşi `Kampanyalar`da, teknik tanı ise Settings içindeki Meta alanında kalmalıdır.
2. **Orchestrator Agent** kullanıcının bağlamdan çıkıp ayrı bir ürün açmasını gerektirmemelidir. Persisted konuşma capability'si global drawer/panel olarak kullanıcı bulunduğu campaign, karar veya alarm bağlamını devralmalı; CLI Session Hub ve manual handoff seyrek kullanılan advanced kontroller olmalıdır.
3. **Teslimat Alarmları** ayrı teknik ledger olarak gerçek bir kaynağa sahiptir; fakat ana kullanıcı işi “bugün neye bakmalıyım?” ve “bu kampanyada ne bozuldu?” sorularına aittir. Özet `Bugün`e, ilgili kayıt kampanya detayına inline yedirilmeli; ayrı URL yalnız derin triage ve paylaşılabilir bağlantı için korunmalıdır.
4. **Gönderi Öne Çıkarma** bağımsız ürün değildir. Kullanıcı mevcut gönderi veya kampanya bağlamından başlar; katalog seçimi, preflight ve K4 taslağı aynı akışta ilerlemelidir. Şablon yaşam döngüsü bu akışı şişirmeden advanced settings'e taşınmalıdır.
5. **Timeline** tek başına amaç değil, başka bir kararın kanıtı ve geçmişidir. Campaign, approval, alert ve decision detayında ilgili kayıtlarla filtreli inline history daha anlamlıdır. Domainler-arası global audit ihtiyacı advanced log olarak deep-link ile korunabilir; primary nav'da bulunmamalıdır.

Bu öneriler mevcut A/B/C karar kapısını değiştirmez. Önceki **Seçenek A** seçilirse sade hedef mimari şu yerleşimle tamamlanabilir:

```text
Bugün                    → önemli teslimat alarmı özeti
Kampanyalar              → Meta hiyerarşisi + sınıflandırma + alarm + promotion + timeline context
Analiz & Kararlar        → kanıt + karar + ilgili timeline context
Bütçeler                 → Budget Pool + proposal
Onay kuyruğu             → cross-domain insan inbox'ı + ilgili timeline context
Kurallar & Yetkiler      → guidance + policy + autonomy + deeper Practice Lab
Global yardımcı          → Orchestrator konuşması
Settings / Advanced      → Meta bağlantısı + kategori registry + promotion template + session/handoff
```

### Uygulanan karar gerektirmeyen düzeltmeler

- Meta, Orchestrator, Teslimat Alarmları, Gönderi Öne Çıkarma ve Timeline kendi kaynak durumunda ortak `LocalSessionConnector` gösteriyor; başka bir sayfaya yönlendirme gerekmiyor.
- Beş yüzeyde `401 local_session_required` ile gerçek `503 unavailable/source_not_configured` ayrıldı. Timeline ve promotion catalog local runtime'ları da bu ayrımı fail-closed biçimde yapıyor.
- Meta blocked durumunda trust, Graph ve portfolio tekrar panelleri; Promotion blocked durumunda authoring; Timeline blocked durumunda temporal alt kaynağı erteleniyor. Kullanıcı tek recovery noktası görüyor.
- Meta hesap, kampanya, Page ve Instagram özetlerinden kullanıcıya değer katmayan raw identifier'lar kaldırıldı.
- Orchestrator'daki altı sabit rol, sahte “6 active” skill pack, persist edilmeyen autonomy seçicileri ve fallback assistant mesajı kaldırıldı. Konuşma artık yalnız persisted kayıt, gerçek empty, loading veya unavailable/session state gösteriyor.
- Delivery Alerts'teki hero'yu tekrar eden statik safety strip kaldırıldı; gerçek boşluk “ledger okundu, kayıt yok” diye ayrıldı.
- Promotion sonucunda post/template/preset teknik ref'leri yerine katalog label'ları gösteriliyor; kullanıcı metnindeki `ActionUnit` adı `eylem satırı` olarak sadeleştirildi.
- Timeline tek satırlı belirsiz sonuç yerine loading, session-required, unavailable, error, empty ve ready durumlarını ayrı gösteriyor; sahte “demo event” anlatısı kaldırıldı.

### Açık P2 ve canlı kabul

- Teslimat alarmı satırlarında public-safe `accountRef` ve `assigneeRef` hâlâ kullanıcı etiketi yerine görünebilir. Backend label/catalog kaynağı doğrulanmadan sahte eşleme eklenmedi; gerçek hesap ve aktör label'larıyla zenginleştirme P2'dir.
- Meta hazır durumda bağlantı yönetimi ile portföy hiyerarşisi hâlâ aynı view içinde bulunur. Campaigns'a fiziksel taşıma hedef bilgi mimarisi onayı sonrasına bırakıldı.
- Orchestrator global drawer, alert/promotion/timeline inline entegrasyonları geniş yerleşim değişikliğidir; kullanıcı A/B/C kararından sonra uygulanacaktır.
- Gerçek kayıtların browser kabulü operator tarafından mint edilen local session gerektirir. Agent/browser proof üretmedi, cookie/storage incelemedi.

### Doğrulama

| Kapı | Sonuç |
|---|---|
| TypeScript | PASS |
| Odak testler | PASS · 11 dosya / 44 test |
| Tam unit suite + mimari kapılar | PASS · 429 dosya / 2111 test |
| Experience sözleşmesi | PASS |
| Security boundary + schema | PASS · 2 dosya / 9 test; `drizzle-kit check` temiz |
| Production build + secret artifact kontrolü | PASS · tracked/build/cache secret 0/0/0 |
| Odak browser desktop `1280` | PASS · 5/5 tek H1, tek bağlamsal form, taşma yok |
| Odak browser mobile `390×844` | PASS · maksimum body scroll width 375 px, 5/5 tek form |
| Görünür demo/fixture ve raw Meta ID | 0 / 5 view |
| Hızlı nav `Meta → Orchestrator → Alerts → Promotion → Timeline` | PASS · 40 ms aralık, product error/warn 0/0 |
| Agent/browser proof mint veya storage inceleme | Yapılmadı |

Kanıt dosyası: `docs/qa/2026-08-14-dashboard-meta-orchestrator-operations-browser-evidence.json`

## 19. Kullanıcı kararı A ve hedef bilgi mimarisi implementation increment'i

### Kullanıcı kararı

Kullanıcının önerilen A/B/C kapısına verdiği “tamam” yanıtı, önerilen **Seçenek A — görev frekansına göre ayır** onayı olarak kaydedildi. Geniş yerleşim değişikliği bu karar sonrasında uygulandı.

```text
Önce: 15 primary navigasyon hedefi
Sonra: 7 kullanıcı amacı

Çalışma
├── Bugün
├── Kampanyalar
├── Analiz & Kararlar
├── Bütçeler
└── Onay kuyruğu

Yönetim
├── Kurallar & Yetkiler
└── Ayarlar

Global yardımcı
└── Orchestrator dialog
```

### Uygulanan yerleşimler

| Önceki ayrı görünüm / parça | Yeni yerleşim | Korunan gerçek capability |
|---|---|---|
| Budget Pool | `Bütçeler → Bütçe havuzları` | Immutable hierarchy read/draft yolu |
| Strict Policies | `Kurallar & Yetkiler → Bağlayıcı politikalar` | Policy lifecycle + impact |
| Autonomy Studio | `Kurallar & Yetkiler → Yetki & onay` | Autonomy revision + Policy Bundle |
| Practice Lab | `Kurallar & Yetkiler → Öğrenim` | Append-only, insan kapılı lifecycle |
| Campaign Classification Review | `Kampanyalar → Künye inceleme` | Canonical review queue |
| Existing-post Promotion | `Kampanyalar → Gönderi öne çıkarma` | Server catalog + K4 preflight + approval draft sınırı |
| Timeline | `Kampanyalar → Geçmiş` | Operational timeline + temporal read |
| Delivery Alerts | `Bugün` içinde; ortak session doğrulandıktan sonra | Alert ledger + human workflow |
| Meta Connection | `Ayarlar → Meta bağlantısı` | Inventory, mirror, readiness, bootstrap ve portfolio capability |
| Category Registry | `Ayarlar → Kategori registry` | Registry authoring/profile/adoption |
| PromotionTemplate authoring | `Ayarlar → Promotion şablonları` | Authoring dry-run + lifecycle |
| Orchestrator Agent | Global `Asistan` dialog | Persisted conversation + short-lived CLI handoff |

### Bağlam ve capability devamlılığı

- Legacy `initialView` girişleri silinmedi; `normalizeDashboardLocation` ile doğru parent/alt alana yönlendiriliyor.
- Kampanya künye incelemesindeki “Manuel atamayı hazırla” browser event'ine bağımlı bırakılmadı. Explicit handoff state, kullanıcıyı `Ayarlar → Kategori registry` içindeki guarded forma taşır; tanım seçimi ve onay yine kullanıcıdadır.
- Promotion preflight ile PromotionTemplate authoring ayrıldı. Preflight artık şablon yönetimini aynı ekranda render etmez; authoring yalnız Ayarlar'da bulunur.
- Today blocked durumda Meta ve Delivery Alerts için iki connector üretmiyor. Delivery ledger ortak session doğrulanana kadar mount edilmez; tek recovery korunur.
- Orchestrator sayfa olmaktan çıktı. Dialog kaynak ekranı korur; açılışta close kontrolüne focus verir, `Escape` ile kapanır ve focus'u global tetikleyiciye döndürür.
- Orchestrator konuşma guide allowlist'ine yeni kanonik `settings` bağlamı eklendi; backend bilinmeyen page ID'lerde fail-closed kalır.

### Global shell sadeleştirmesi

- Sonucu olmayan arama, bildirim ve profil kontrolleri kaldırıldı.
- `Codex'e aktar`, `Asistan`, workspace/Meta settings girişi ve gerçek navigation kontrolleri korundu.
- Sidebar ve mobil navigation aynı 7 hedefi kullanıyor.
- Teknik `approval_only` gösterge butonu global assistant tetikleyicisi gibi davranmaktan çıkarıldı; kullanıcıya doğru adıyla `Asistan` sunuluyor.

### Doğrulama ve açık kanıt

| Kapı | Sonuç |
|---|---|
| TypeScript | PASS |
| Yeni IA odak testleri | PASS · 9 dosya / 45 test + 1 dosya / 3 yerleşim testi |
| Desktop browser `1280×720` | PASS · 7 primary hedef; bütün incelenen alt alanlarda tek H1; taşma yok |
| Campaign alt alanları | PASS · 4/4 bağlamsal yerleşim ve tek recovery |
| Bütçe / Rules / Settings alt alanları | PASS · 9/9 tek H1 ve görünür demo/fixture 0 |
| Global Asistan | PASS · dialog, focus, Escape ve focus-return |
| Mobile browser | AÇIK · viewport override browser URL güvenlik politikası tarafından reddedildi; başka browser/raw automation ile dolanılmadı |
| Console kabulü | AÇIK · güvenlik politikası blokundan sonra tamamlanamadı |
| Agent/browser proof veya storage inceleme | Yapılmadı |

Kanıt dosyası: `docs/qa/2026-08-14-dashboard-approved-ia-browser-evidence.json`
