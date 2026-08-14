# Goal — ReklamZeka Dashboard Holistik UX, Sadeleştirme ve İşlevsellik

> Tarih: 2026-08-14  
> Tür: İnteraktif ürün/UX denetimi, sadeleştirme, uygulama ve doğrulama goal'ü  
> Kapsam: `/dashboard` altındaki bütün görünüm, section, element, durum, capability ve kullanıcı yolculukları  
> Çalışma biçimi: High-level'dan low-level'a, kullanıcıyla karar vererek, küçük ve doğrulanabilir increment'lerle  
> Plan otoritesi: Bu belge bir oturum yürütme goal'üdür. Kanonik proje otoritesi `plans/proje/v2` altındaki `MASTER`, `STATE`, `CHECKLIST` ve `REQUIREMENTS` dosyalarıdır.

## 1. Goal

ReklamZeka Operating Dashboard'u birbirinden kopuk sayfa ve feature toplamı olarak değil, baştan sona tek bir kullanıcı deneyimi ve reklam karar sistemi olarak incele.

Ürünü şu seviyelerin tamamında değerlendir:

1. Ürünün bütünü ve değer önerisi
2. Hedef kullanıcılar ve gerçek kullanıcı işleri
3. Uçtan uca kullanıcı yolculukları
4. Bilgi mimarisi ve navigasyon
5. Her görünümün/sayfanın varlık gerekçesi
6. Her görünüm içindeki section ve panellerin varlık gerekçesi
7. Her section içindeki elementlerin varlık gerekçesi
8. İçerik, UI, UX ve etkileşim kalitesi
9. Veri kaynağı, capability ve authority doğruluğu
10. Loading, empty, unavailable, partial, stale, unauthorized, validation, conflict, success ve recovery durumları
11. Görünümler arası bağlam ve state devamlılığı
12. Kullanıcının ulaştığı karar, eylem ve izlenebilir sonuç

Amaç mevcut bütün feature'ları koruyup parlatmak değildir. Amaç ürünü gerektiği yerde küçültmek, tekrarları birleştirmek, yanlış yerleşmiş parçaları doğru akışa yedirmek, anlamsız veya hazır olmayan özellikleri kaldırmak/gizlemek ve kalan temel kullanıcı işlerini gerçek verilerle uçtan uca çalışır hale getirmektir.

## 2. Başarı tanımı

“Fully functional” aşağıdaki koşulların birlikte sağlanmasıdır:

- Her görünür kontrolün gerçek ve anlaşılır bir sonucu vardır veya neden kullanılamadığı açıkça gösterilir.
- Operasyonel veriler frontend'deki hardcoded array, sahte kart veya statik demo anlatısından gelmez.
- Demo workspace kullanılsa bile veri backend/database üzerinden, production ile aynı API ve application yollarından çekilir.
- UI'ın iddia ettiği capability API, application service, repository, rol/authority sınırı ve testlerle gerçekten desteklenir.
- Demo, persisted sample, tarihsel import, canlı veri ve unavailable durumları birbirine karıştırılmaz.
- Kullanıcı ilk bakışta veri güvenilirliğini, dikkat isteyen konuyu ve bir sonraki mantıklı adımı anlayabilir.
- Her görünüm ayrı bir navigasyon hedefi olmayı hak eder; etmiyorsa birleştirilir, başka bir akışa yedirilir, derine taşınır, gizlenir veya kaldırılır.
- Her section görünümün kullanıcı amacına hizmet eder.
- Her element somut bir kullanıcı işine bağlanır.
- Gereksiz tablo, panel, kart, KPI, badge, filtre ve teknik bilgi kaldırılır.
- Loading, empty, partial, stale, unavailable, error, forbidden, conflict ve success durumları tasarlanmış ve doğrulanmıştır.
- Kritik yolculuklar masaüstü, tablet ve mobilde; klavye ve temel erişilebilirlik şartlarıyla çalışır.
- P0/P1 sorunları çözülmüş veya gerçek bir dış bağımlılıkla kanıtlı biçimde park edilmiştir.
- Tamamlanan her increment ilgili test, typecheck/build ve mümkünse gerçek browser kanıtıyla kapanır.

Başarı daha fazla feature, daha fazla navigasyon maddesi, daha fazla tablo veya daha dolu ekran değildir. Başarı daha az bilişsel yükle daha hızlı, güvenilir ve anlaşılır karar alınabilmesidir.

## 3. Değiştirilemez ürün ilkeleri

### 3.1 Statik demo operasyon verisi yok

Dashboard'da hardcoded kampanya, hesap, performans metriği, karar, alarm, kategori/policy/experiment sayısı, agent cevabı veya benzeri operasyonel içerik gerçek ürün verisi gibi gösterilmez.

Demo çalışma alanı kullanılacaksa:

- Veriler database veya gerçek backend repository içinde tutulur.
- Production ile aynı API, application service, validation, authorization ve UI yolu kullanılır.
- Demo tenant yalnız seeded/persisted veri taşıyabilir; ayrı ve sahte bir frontend davranışı taşımaz.
- Kayıtların provenance, capturedAt, observedAt ve freshness bilgisi bulunur.
- İzin verilen mutation'lar aynı backend akışında kalıcı ve yeniden okunabilir olmalıdır.
- Frontend fixture'ı veya statik array dashboard içeriği olarak render edilmez.

Kabul edilen veri durumları:

| Durum | Anlam |
|---|---|
| `LIVE` | Gerçek entegrasyondan çekilmiş ve freshness'i bilinen veri |
| `PERSISTED_SAMPLE` | Backend/database içindeki açıkça tanımlı örnek tenant verisi |
| `HISTORICAL_IMPORT` | Kaynağı ve tarihi belli import edilmiş veri |
| `EMPTY` | Gerçek kaynak çalışıyor fakat kayıt yok |
| `UNAVAILABLE` | Kaynak, session, bağlantı veya environment kullanılamıyor |

`EMPTY` veya `UNAVAILABLE` durumunda ekranı sahte sayılarla doldurma. Kullanıcıya şunları göster:

- Veri neden yok?
- Hangi kaynak veya bağlantı eksik?
- Veri getirmek için ne yapılmalı?
- Hangi özellikler bu nedenle kullanılamıyor?
- Son başarılı veri ne zaman görüldü?

“Demo” kelimesini kartların her yerinde tekrarlama. Workspace'in veri türünü tek ve anlaşılır bir global göstergeyle belirt. İçerik seviyesinde yalnız provenance veya güven kararını etkilediğinde tekrar göster.

### 3.2 Feature spam yok

Daha fazla sekme, tablo, panel, metrik veya kontrol eklemek varsayılan çözüm değildir. Yeni bir feature ancak doğrulanmış kullanıcı işi, gerçek veri kaynağı, açık çıktı ve ölçülebilir değer taşıyorsa değerlendirilebilir.

Audit tamamlanmadan yeni görünüm, section, panel, tablo veya metrik ekleme.

Önce:

1. Kullanıcı işini tanımla.
2. Gerçek veri kaynağını doğrula.
3. Mevcut tekrarları ve gereksiz parçaları bul.
4. Bilgi mimarisini sadeleştir.
5. Eksik temel UX durumlarını tamamla.
6. Mevcut capability'yi çalışır hale getir.
7. Ancak sonra yeni feature gerekip gerekmediğini tartış.

### 3.3 Teknik mimari UI bilgi mimarisi değildir

Farklı backend servisi, domain modeli veya repository bulunduğu için ayrı sayfa/section oluşturma. Kullanıcının zihinsel modeli ve işi, teknik modül sınırından önceliklidir.

### 3.4 Önce varlık kararı, sonra polish

Kaldırılabilecek veya başka yere taşınabilecek bir parçanın renk, spacing, ikon, responsive veya mikro metin detayını önce düzeltme.

Çalışma sırası:

```text
Ürün amacı
→ kullanıcı yolculuğu
→ görünümün gerekliliği
→ section'ın gerekliliği
→ elementin gerekliliği
→ doğru yerleşim
→ içerik
→ UI
→ UX
→ veri ve capability
→ durumlar
→ uçtan uca sonuç
```

## 4. Temel kullanıcı işleri

Dashboard en az şu soruları mümkün olan en kısa ve güvenilir yoldan cevaplamalıdır:

1. Verim güncel ve güvenilir mi?
2. Bugün dikkat etmem gereken durum nedir?
3. Ne değişti veya ne yanlış gidiyor?
4. Bunun nedeni ve kanıtı nedir?
5. Hangi hesap, kampanya, ad set, reklam veya yaratıcı etkileniyor?
6. Sistem ne öneriyor; no-change seçeneği değerlendirildi mi?
7. Önerinin riski, bütçe etkisi, constraint'i ve belirsizliği nedir?
8. Benden hangi karar bekleniyor?
9. Onaylar, reddeder veya değişiklik istersem ne olur?
10. Kararın sonucu daha sonra nasıl izlenir?

İlk audit sırasında bu liste kullanıcıyla birlikte doğrulanmalı, gerekiyorsa sadeleştirilmeli ve 3–5 birincil yolculuk seçilmelidir.

## 5. İnceleme hiyerarşisi

Her parça aşağıdaki izlenebilir hiyerarşide ele alınır:

```text
User Job
└── Journey
    └── View
        └── Section
            └── Element
                ├── Content
                ├── Data source
                ├── Capability
                ├── Authority
                ├── States
                ├── UI/UX finding
                ├── Existence decision
                ├── Placement decision
                ├── Improvement decision
                └── Verification evidence
```

Hiçbir kullanıcı işi veya yolculuğuna bağlanamayan görünüm, section veya element otomatik olarak `REMOVE`, `MERGE`, `MOVE_DEEPER` ya da `HIDE_UNTIL_RELEVANT` adayıdır.

## 6. Karar sistemleri

### 6.1 Feature survival kararı

Her görünüm, section ve önemli element için aşağıdaki kararlardan biri verilir:

| Karar | Anlam |
|---|---|
| `KEEP` | Yararlı, kullanılabilir ve doğru yerde |
| `IMPROVE` | Gerekli fakat içerik, UI, UX veya işlev yetersiz |
| `MERGE` | Başka bir yüzeyle birleştirilmeli |
| `MOVE_DEEPER` | Ana akıştan detay/advanced seviyesine taşınmalı |
| `HIDE_UNTIL_READY` | Capability tamamlanana kadar görünmemeli |
| `HIDE_UNTIL_RELEVANT` | Yalnız ilgili veri, rol veya durumda gösterilmeli |
| `REMOVE` | Yeterli kullanıcı değeri üretmiyor |
| `BACKLOG` | Değerli olabilir fakat mevcut temel ürün için gerekli değil |

“Belki ileride gerekir” tek başına `KEEP` gerekçesi değildir.

### 6.2 Yerleşim kararı

Her korunacak parça için doğru sunum seviyesi ayrıca seçilir:

| Yerleşim | Ne zaman kullanılır? |
|---|---|
| `STANDALONE_VIEW` | Bağımsız kullanıcı amacı ve çalışma alanı varsa |
| `PARENT_SECTION` | Daha güçlü bir ana görünümün doğal parçasıysa |
| `INLINE_CONTEXT` | Karar anında bağlam içinde gerekli ise |
| `PROGRESSIVE_DISCLOSURE` | Özet gerekli, ayrıntı isteğe bağlı ise |
| `DETAIL_PANEL` | Seçili kayıt veya kararın ayrıntısıysa |
| `DRAWER_OR_MODAL` | Kısa ve bağlamsal yardımcı işlemse |
| `ADVANCED_SETTINGS` | Nadir kullanılan teknik/yönetimsel ayarsa |
| `MERGE` | Aynı veri ve amacı taşıyan başka bir yüzey varsa |
| `REMOVE` | Entegre edildiğinde bile değer üretmiyorsa |

“Başka yere yedirmek”, parçayı rastgele başka bir sayfanın altına taşımak değildir. Entegrasyon ana görünümün amacını netleştirmeli, bağlam kaybını azaltmalı, tekrarları kaldırmalı ve içerik yoğunluğunu kontrol altında tutmalıdır.

### 6.3 Capability sınıfı

| Sınıf | Anlam |
|---|---|
| `VERIFIED_REAL` | Gerçek kaynak ve uçtan uca kanıt mevcut |
| `REAL_BUT_ENV_BLOCKED` | Kod yolu gerçek fakat environment/session/data bağımlılığı eksik |
| `READ_ONLY` | Bilinçli ve doğru biçimde salt-okunur |
| `PERSISTED_SAMPLE` | Gerçek backend yolundaki seeded örnek veri |
| `PLACEHOLDER` | Gerçek davranışı olmayan yer tutucu |
| `MISLEADING` | UI iddiası gerçek capability'den geniş |
| `BROKEN` | Beklenen davranış çalışmıyor |
| `UNNECESSARY` | Kullanıcı değerine katkısı yok veya tekrar |
| `MISSING` | Temel yolculuk için gerekli fakat mevcut değil |

### 6.4 Öncelik

| Öncelik | Anlam |
|---|---|
| `P0` | Güvenlik, yanlış authority, yanlış canlı veri veya yanlış aksiyon iddiası |
| `P1` | Temel yolculuğu engelleyen bozuk/eksik davranış |
| `P2` | Belirgin UX, içerik, responsive veya erişilebilirlik sorunu |
| `P3` | Görsel tutarlılık, temizlik ve optimizasyon |

## 7. Ayrı görünüm, section ve element testleri

### 7.1 Ayrı görünüm olma testi

Bir görünümün ayrı navigasyon hedefi olarak kalması için aşağıdaki gerekçelerden birkaçı güçlü biçimde bulunmalıdır:

- Kendine ait bağımsız kullanıcı amacı vardır.
- Kullanıcı doğrudan bu işi yapmak için görünümü açar.
- Anlamlı ve uzun süreli bir çalışma alanıdır.
- Kendine ait filtre, seçim, state veya lifecycle taşır.
- Doğrudan URL, deep-link veya bookmark ihtiyacı vardır.
- Farklı rol veya authority sınırı vardır.
- Başka bir sayfaya gömülmesi ana akışı aşırı kalabalıklaştırır.
- Başka bir görünümün alt parçası olduğunda anlam kaybeder.
- Kullanım sıklığı ve iş değeri navigasyonda yer kaplamayı hak eder.

Bunlar yoksa görünüm `PARENT_SECTION`, `INLINE_CONTEXT`, `DETAIL_PANEL`, `ADVANCED_SETTINGS`, `MERGE` veya `REMOVE` adayıdır.

### 7.2 Section olma testi

Bir section ayrı blok olarak kalacaksa:

- Görünümün ana amacına doğrudan hizmet etmelidir.
- Kullanıcının ayrı ve anlamlı bir sorusunu cevaplamalıdır.
- Kendi başına anlaşılır bilgi veya kontrol grubu olmalıdır.
- Komşu section'lardan farklı fakat tamamlayıcı bir iş yapmalıdır.
- Görsel ayrım kullanıcıya anlam kazandırmalıdır.

Yalnız görsel doluluk veya teknik mimariyi sergilemek section gerekçesi değildir.

### 7.3 Element olma testi

Her kart, KPI, tablo, satır, filtre, buton, badge, metin, tooltip, grafik, form alanı ve kontrol için sor:

- Hangi kullanıcı işini destekliyor?
- Kullanıcı bu bilgiden sonra ne anlayacak veya yapacak?
- Gerçek veri kaynağı nedir?
- Aynı bilgi başka yerde gösteriliyor mu?
- Kullanılmaması durumunda hangi değer kaybolur?
- Varsayılan görünümde olması şart mı?
- Daha sade bir sunum aynı işi yapabilir mi?
- Teknik ayrıntı kullanıcı kararına katkı sağlıyor mu?

Somut cevabı olmayan element korunmaz.

## 8. Tablo ve dashboard yoğunluğu kuralı

Tablo yalnız kullanıcı kayıtları karşılaştıracak, sıralayacak, filtreleyecek, tarayacak veya seçim yapacaksa kullanılmalıdır.

Tablo varsa:

- En önemli sütunlar ilk bakışta görünür olmalıdır.
- Karara katkısı olmayan sütun kaldırılmalıdır.
- Teknik ID ve iç sistem alanları varsayılan görünümde bulunmamalıdır.
- Satıra tıklamanın sonucu anlaşılır olmalıdır.
- Mobilde anlamsız yatay kaydırma yerine uygun alternatif değerlendirilmelidir.
- Tek kayıt, açıklama, workflow veya karar için tablo kullanılmamalıdır.

Bir ekranın dashboard görünmesi için çok sayıda kart ve KPI ile doldurulması gerekmez.

## 9. Görünüm ve element audit şablonları

### 9.1 Görünüm audit kaydı

Her görünüm için şu kayıt oluşturulur:

- Görünüm ID ve adı
- Hedef kullanıcı
- Ana kullanıcı işi
- Kullanıcının görünümü açma nedeni
- Ayrı görünüm olma gerekçesi
- Önceki adım ve geliş yolu
- Sonraki adım veya tamamlanan sonuç
- Veri kaynakları ve freshness
- Capability ve authority sınırı
- İçindeki section'lar
- Diğer görünümlerle tekrarlar
- Eksik temel işler
- Bilişsel yük
- Genel usefulness
- Genel usability
- Feature survival kararı
- Yerleşim kararı
- Kullanıcı kararı
- Kabul kriterleri
- Doğrulama kanıtı

### 9.2 Section/element audit kaydı

- Element ID ve adı
- Parent görünüm ve section
- Kullanıcı amacı
- Mevcut içerik
- Veri kaynağı
- Capability sınıfı
- Authority
- Etkileşim ve beklenen sonuç
- Loading/empty/error/success/recovery durumları
- UI değerlendirmesi
- UX değerlendirmesi
- Erişilebilirlik ve responsive değerlendirmesi
- Güvenlik değerlendirmesi
- Feature survival kararı
- Yerleşim kararı
- Önerilen değişiklik
- Öncelik
- Kullanıcı kararı
- Kabul kriterleri
- Test ve browser kanıtı
- Son durum

## 10. İnteraktif çalışma protokolü

Ana session ürün kararlarının ve kullanıcıyla müzakerenin merkezidir.

Her görünümde şu döngüyü uygula:

1. Görünümün amacını ve mevcut gerçekliğini açıkla.
2. Görünüm ve içindeki bütün section/elementleri envanterle.
3. Varlık, yerleşim, usefulness, usability, veri ve capability bulgularını çıkar.
4. Benzer veya tekrar eden parçaların entegrasyon seçeneklerini göster.
5. Ürün tercihi gerektiren noktada kullanıcıya kısa, somut ve karşılaştırılabilir seçenekler sun.
6. Kullanıcı kararı alınmadan geniş redesign veya bilgi mimarisi değişikliği yapma.
7. Karardan sonra küçük, geri alınabilir bir implementation increment'i tanımla.
8. Increment'i uygula.
9. İlgili testleri ve browser kabulünü çalıştır.
10. Sonucu, kalan açıkları ve bir sonraki kararı kaydet.

Aynı anda çok sayıda ürün kararı isteme. Birbiriyle ilişkili tek karar kümesi üzerinde ilerle.

## 11. Mevcut dashboard yüzeyleri

Başlangıç envanteri en az aşağıdaki 16 görünümü kapsar; audit sonucu bunların sayısı azalabilir veya gruplanması değişebilir:

### Çalışma yüzeyleri

1. Bugün
2. Kampanyalar
3. Analizler
4. Decision Room
5. Bütçeler

### Yönetim ve operasyon yüzeyleri

6. Kurallar & Akışlar
7. Strict Policies
8. İç Kategoriler
9. Autonomy Studio
10. Practice Lab
11. Meta Bağlantısı
12. Orchestrator Agent
13. Onay Kuyruğu
14. Teslimat Alarmları
15. Gönderi Öne Çıkarma
16. Timeline

Bu liste korunacak hedef bilgi mimarisi değildir; denetlenecek başlangıç durumudur.

## 12. Yürütme aşamaları

### Aşama 0 — Preflight ve baseline

- `README.md` ile kanonik `MASTER`, `STATE`, `CHECKLIST` ve `REQUIREMENTS` dosyalarını oku.
- Git durumunu kontrol et ve kullanıcı değişikliklerini koru.
- Dashboardu çalıştır.
- Local session, PostgreSQL, Meta bağlantısı ve gerekli environment durumlarını belirle.
- Baseline test, typecheck, build ve browser durumunu kaydet.
- `LIVE`, `PERSISTED_SAMPLE`, `HISTORICAL_IMPORT`, `EMPTY` ve `UNAVAILABLE` kaynakları ayır.
- Çevresel olarak doğrulanamayan capability'leri dürüstçe park et.

### Aşama 1 — Statik demo ve veri doğruluğu envanteri

- Frontend içindeki bütün hardcoded operasyon verilerini bul.
- Statik kampanya, metrik, karar, alarm, agent anlatısı, sayı ve tarihleri listele.
- Her birinin gerçek API/repository karşılığını belirle.
- Gerçek karşılığı olanları gerçek hatta bağlama planı çıkar.
- Örnek veri gerekiyorsa aynı backend yolunda persisted sample tasarla.
- Karşılığı olmayanları `HIDE`, `REMOVE` veya `BACKLOG` olarak sınıflandır.
- Demo verinin canlı veri gibi görünmesine neden olan bütün UI iddialarını P0/P1 olarak değerlendir.

Bu aşama kapanmadan statik demo elementlerini görsel olarak parlatma.

### Aşama 2 — Kullanıcı işleri ve sadeleştirilmiş bilgi mimarisi

- Hedef kullanıcı rollerini ve en önemli 3–5 işi kullanıcıyla doğrula.
- 16 görünüm için ayrı görünüm olma testi yap.
- Her görünüm için `KEEP/IMPROVE/MERGE/MOVE/HIDE/REMOVE/BACKLOG` kararı öner.
- Birbirini tekrar eden yüzeyleri belirle.
- Section olarak başka akışa yedirilebilecek görünüm ve özellikleri göster.
- Sadeleştirilmiş navigasyon ve görünüm hiyerarşisi öner.
- Before/after kullanıcı yolculuklarıyla değişikliğin nedenini açıkla.
- Kullanıcı kararıyla hedef bilgi mimarisini dondur.

### Aşama 3 — Global shell

Şunları varlık, yerleşim ve işlev açısından incele:

- Sidebar ve mobil navigasyon
- Topbar
- Workspace seçici
- Arama
- Bildirimler
- Codex'e aktar
- Otonomi göstergesi
- Profil kontrolü
- Meta Mirror/global source durumu
- Toast, modal, focus ve scroll davranışı
- URL, history, deep-link ve geri dönüş
- Global context/state korunması
- Terminoloji ve dil tutarlılığı

Shell, hedef bilgi mimarisine göre sadeleştirilmeden tekil görünümlerde geniş polish yapma.

### Aşama 4 — Bugün

“Bugün” bir feature vitrini değil, karar özeti olmalıdır. İlk bakışta yalnız şunları cevaplamalıdır:

- Veri güvenilir mi?
- Şu anda dikkat isteyen ne var?
- En önemli risk/değişiklik nedir?
- Kullanıcıdan karar bekleniyor mu?
- Sonraki mantıklı adım nedir?

Hero, sistem durumu, performans, kararlar, portföy ve Orchestrator bölümlerini ayrı ayrı varlık ve entegrasyon açısından incele. Başka sayfalara ait ayrıntıları progressive disclosure veya context link ile sun.

### Aşama 5 — Kampanya ve portföy yolculuğu

- Hesap ve portföy seçimi
- Gerçek canonical portfolio
- Objective/category filtreleri
- Persisted frozen context
- Campaign → ad set → ad → creative drill-down
- Kampanya detayları
- Planlama brief'i
- Approval, Analysis ve Orchestrator geçişleri
- Offline/historical import içeriğinin doğru konumu
- Empty/partial/stale/unavailable durumları

Offline workbook, demo portföy ve canonical portföyün aynı ekranda bilişsel yük yaratıp yaratmadığını özellikle değerlendir.

### Aşama 6 — Analiz ve Decision Room

- Analysis builder
- Timeframe/comparison
- Frozen context
- Finding/evidence
- Dry-run
- Run history ve schedule
- No-change gerekçesi
- Decision Room kayıtları
- Session recovery
- Proposal/onay akışına geçiş

Analiz, kanıt, öneri, karar ve action kavramlarının birbirine karışmadığını doğrula. `Analizler` ve `Decision Room` ayrı görünüm olmayı gerçekten hak ediyor mu, yoksa tek yolculuğun iki section'ı mı, kullanıcıyla karar ver.

### Aşama 7 — Bütçe

- Budget Lab
- Proposal ledger
- Before/after dağılım
- Constraint, pacing ve suppression
- Budget pool hierarchy
- Para birimi ve minor-unit doğruluğu
- Draft/approval/execute ayrımı
- Empty/unavailable/session-required durumları

Budget pool, proposal listesi ve detayların tek bir anlaşılır çalışma alanına entegre edilip edilemeyeceğini değerlendir.

### Aşama 8 — Guidance, kurallar ve strict policies

- Guidance Studio
- Normalization Workbench
- Slice Rule Workspace
- Policy Bundle
- Progressive Formalization
- Strict Policy Studio
- Scope, inheritance, conflict, impact ve revision
- İnsan onayı ve yayınlama sınırı

Bu yüzeylerin teknik lifecycle adımlarını ayrı sayfalara bölmek yerine kullanıcıya tek anlaşılır “ham fikir → rehber → yapılandırılmış kural → bağlayıcı policy” yolculuğu olarak sunulup sunulamayacağını incele.

### Aşama 9 — İç kategoriler

- Campaign classification review
- Category inventory
- Category profile
- Starter category adoption
- Dimension/definition/binding
- Coverage/conflict/archive impact

Kategorilerin ayrı bir yönetim merkezi olma gerekçesini ve kampanya bağlamına inline yedirilmesi gereken parçaları ayır.

### Aşama 10 — Autonomy ve Practice Lab

- Planlama modu ile execution autonomy ayrımı
- `approval_only` kilidi
- Scope override ve kill switch
- Role/authority
- Candidate → trial → outcome → standardization
- İnsan onayı ve sessiz promotion engelleri

Practice Lab'in ayrı görünüm olma gerekçesini özellikle sorgula. Nadir kullanılan deney/öğrenim yaşam döngüsünün Analysis veya Rules içinde progressive disclosure olarak daha anlamlı olup olmadığını değerlendir.

### Aşama 11 — Orchestrator Agent

- Session hub
- Client/session health
- Context seçimi
- Dashboard → CLI handoff
- Aynı-ID devamlılığı
- Chat composer ve geçmiş
- Tool/citation trace
- Manual Codex task
- Disconnected, multiple-session, expired ve error durumları

Agent deneyiminin ayrı bir ana görünüm mü, yoksa kullanıcının bulunduğu her bağlamda açılan ortak bir yardımcı katman mı olması gerektiğini değerlendir.

### Aşama 12 — Onay ve operasyon

Sırayla incele:

1. Onay Kuyruğu
2. Gönderi Öne Çıkarma
3. Teslimat Alarmları
4. Timeline
5. Meta Bağlantısı ve Trust Readiness

Her birinde typed action, before/after, risk, dependency, stale/expiry, role, approval, execute, verify ve recovery sınırlarını doğrula.

Özellikle değerlendir:

- Teslimat alarmı Today ve Campaign detayına yedirilebilir mi?
- Timeline ayrı sayfa yerine ilgili campaign/decision/alarm detayında context olarak gösterilebilir mi?
- Promotion preflight kampanya veya creative akışının section'ı olabilir mi?
- Meta Bağlantısı bağımsız kurulum/yönetim amacı nedeniyle ayrı kalmalı mı?

### Aşama 13 — Cross-cutting UX ve kalite

- İçerik ve mikro metin
- Görsel hiyerarşi
- Tasarım token'ları ve ortak component'ler
- Klavye dolaşımı ve focus
- Semantik HTML ve accessible name
- Kontrast ve durumun yalnız renkle anlatılmaması
- 390, 480, 768, 1120, 1280 ve 1440 px davranışı
- Yatay taşma, sticky alanlar ve uzun içerik
- Loading performansı ve gereksiz fetch/polling
- State kaybı ve yarış koşulları
- API parsing ve fail-closed davranış
- Tenant, role, session ve secret sınırları
- Demo/persisted/live veri ayrımı
- Test kapsamındaki sahte güven ve eksik browser kabulü

### Aşama 14 — Uçtan uca kabul

Hedef bilgi mimarisine göre en az şu kullanıcı yolculuklarını doğrula:

- Today → dikkat isteyen konu → kanıt → karar
- Campaign → context → analysis → decision
- Campaign context → brief → proposal/onay sınırı
- Guidance → normalization → rule/policy
- Category classification → campaign context
- Budget proposal → before/after → approval sınırı
- Alert → recommendation hold → ilgili timeline → recovery
- Meta readiness → canonical portfolio
- Dashboard → local agent handoff → dashboard continuation
- Existing-post promotion → preflight → approval-ready sınırı

Her yolculukta şunları ölç:

- Kaç adım sürdü?
- Bağlam korundu mu?
- Aynı seçim tekrarlandı mı?
- Kullanıcı ne olduğunu anlayabildi mi?
- Gerçek veri ve authority açık mıydı?
- Sonucun başarı/başarısızlığı görünür müydü?

## 13. Subagent ve alt session kullanımı

- Ürün kararı ve kullanıcıyla müzakere ana sessionda kalır.
- Subagent yalnız bağımsız, sınırları belli ve çakışmayan işler için kullanılabilir: API/capability izi, test coverage, accessibility audit veya belirli bir panelin teknik incelemesi.
- Aynı görünüm veya element üzerinde paralel ve çakışan implementasyon yapılmaz.
- Yeni kullanıcıya ait Codex task/session yalnız kullanıcı açıkça istediğinde açılır.
- Büyük veya bağlamı taşan iş yeni sessiona devredilecekse handoff paketi hazırlanır.

Handoff paketi:

- Amaç
- Dahil/dışarıda kapsam
- Alınmış kullanıcı kararları
- İlgili görünüm, section ve element ID'leri
- İlgili dosyalar, API'ler ve repository'ler
- Veri ve authority sınırları
- Açık bulgular
- Kabul kriterleri
- Çalıştırılacak testler
- Son doğrulama kanıtı
- Ana sessiona dönecek kararlar

## 14. Çalışma kısıtları

- Kullanıcının mevcut değişikliklerini ezme.
- UI metnine bakarak capability var kabul etme.
- Fixture veya mocked test başarısını canlı/persisted başarı olarak etiketleme.
- Kullanıcı kararı olmadan destructive işlem, production write veya authority genişletmesi yapma.
- Güvenlik sınırlarını UX kolaylığı adına gevşetme.
- Sorunda yalnız semptomu değil data → repository → application → API → UI zincirini incele.
- Her increment küçük, geri alınabilir ve bağımsız doğrulanabilir olsun.
- Fail-closed davranışı koru.
- Teknik ID, secret, raw Meta identifier veya tenant-private veriyi UI'a taşıma.
- Tamamlanmamış capability'yi sahte UI state ile başarılı gösterme.
- Kullanıcının karar vermediği geniş redesign'ı uygulama.

## 15. Tutulacak artefaktlar

Goal yürütülürken tek bir izlenebilir audit/karar kaydı tutulmalıdır. En az şunları içermelidir:

- Kullanıcı işleri ve öncelikleri
- Mevcut ve hedef bilgi mimarisi
- View → section → element envanteri
- Hardcoded/demo veri envanteri
- Veri source-of-truth haritası
- Feature survival kararları
- Yerleşim/entegrasyon kararları
- P0–P3 bulguları
- Kullanıcı karar günlüğü
- Implementation increment'leri
- Test ve browser kanıtları
- Park edilen environment bağımlılıkları
- Kapanış ve handoff özeti

Kanonik proje durumunu etkileyen doğrulanmış kararlar yalnız uygun increment tamamlandıktan sonra `plans/proje/v2/STATE.md` ve gerekiyorsa `CHECKLIST.md` ile uyumlu hale getirilir.

## 16. İlk çıktı ve ilk karar kapısı

Kod değiştirmeden önce şu çıktıyı üret:

1. Mevcut 16 görünümün amacı ve ayrı görünüm olma gerekçesi.
2. Her görünümün ana section envanteri.
3. Hardcoded/statik demo veri envanteri.
4. Gerçek API/repository karşılık haritası.
5. En yüksek riskli beş yanıltıcı veya gereksiz alan.
6. İlk `KEEP/MERGE/MOVE/HIDE/REMOVE` önerileri.
7. Önerilen sadeleştirilmiş bilgi mimarisinin ilk taslağı.
8. Mevcut ve önerilen ana kullanıcı yolculukları.
9. İlk implementation increment'i için 2–3 seçenek.
10. Kullanıcıdan alınması gereken ilk dar karar.

Kullanıcı bu ilk karar paketini değerlendirmeden geniş UI değişikliği veya yeni feature implementasyonu başlatma.

## 17. Definition of Done

Goal ancak aşağıdaki koşullarla tamamlanabilir:

- Başlangıçtaki 16/16 görünüm audit edilmiştir.
- Hedef bilgi mimarisindeki bütün görünümler için varlık ve yerleşim kararı vardır.
- Bütün önemli section ve elementler kullanıcı işine bağlanmıştır.
- Kararsız `PLACEHOLDER`, `MISLEADING` veya statik demo operasyon elementi kalmamıştır.
- Frontend hardcoded operasyon verileri kaldırılmış, gizlenmiş veya gerçek backend yoluna taşınmıştır.
- Demo tenant varsa production ile aynı API/application/repository yolunu kullanmaktadır.
- P0 ve P1 bulguları çözülmüş veya gerçek dış bağımlılıkla kanıtlı biçimde park edilmiştir.
- Gereksiz/tekrarlı görünüm, section ve elementler kaldırılmış veya birleştirilmiştir.
- Başka akışa yedirilen parçalar before/after kullanıcı yolculuğuyla doğrulanmıştır.
- Loading, empty, partial, stale, unavailable, forbidden, conflict, success ve recovery durumları kapsanmıştır.
- Seçilen temel yolculuklar uçtan uca çalışmaktadır.
- İlgili unit, integration, HTTP ve browser testleri geçmektedir.
- Typecheck ve production build geçmektedir.
- Responsive ve erişilebilirlik kanıtları kaydedilmiştir.
- Kalan P2/P3 backlog'u önceliklendirilmiştir.
- Kullanıcıya tamamlananlar, kaldırılanlar/birleştirilenler, park edilenler ve sonraki önerilen increment açıklanmıştır.

## 18. Goal yürütme komutu

Bu belge goal olarak verildiğinde agent şu talimatla başlamalıdır:

> Bu Markdown belgesini eksiksiz oku ve ReklamZeka Dashboard holistik UX goal'ü olarak yürüt. Önce kanonik proje belgelerini ve mevcut kod gerçekliğini incele. Kod değiştirmeden Aşama 0–2 için başlangıç envanteri, veri doğruluğu haritası, görünüm/section varlık değerlendirmesi ve sadeleştirilmiş bilgi mimarisi önerisini hazırla. Ürün kararı gereken ilk dar karar paketini bana getir. Benim kararım olmadan geniş redesign veya feature implementasyonu başlatma. Kararlardan sonra küçük, doğrulanabilir increment'lerle devam et; her increment'te içerik, UI, UX, veri, capability, authority, responsive, erişilebilirlik ve uçtan uca kullanıcı sonucunu birlikte doğrula.
