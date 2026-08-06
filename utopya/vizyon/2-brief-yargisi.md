# BRİEF YARGISI — değerlendirme şartnamesi
### bölüm 2 · her skor ve öneri belgelenmiş bir brief'e, bir metriğe ve bir eşiğe bağlıdır

Amaç: "rastgele AI fikri" sistemde yapısal olarak imkânsızdır; yargı yalnız kullanıcının
beyan ettiği hedefe kıyasla üretilir.

<!-- uy:brief-yargisi/briefsiz-oneri-yok -->
## G2.1 — Brief'siz öneri üretilemez

Gereksinimler:
1. Her değerlendirme kaydı (`evaluation`) ve her değişiklik önerisi (`change_proposal`)
   şema düzeyinde zorunlu bir `brief_id` + `metric_key` + eşik + ölçülen değer gerekçesi
   taşır; bu alanlar boşsa kayıt yazılamaz.
2. Brief'ler insan-okur kanonda (Sheets) yaşar; revizyon numarası taşır; öneri hangi
   brief revizyonuna dayandığını söyler.

Kabul ölçütü: gerekçesiz öneri denemesi testte reddedilir; üretimde karar günlüğündeki
her önerinin brief bağı sorgulanabilir.

▸ bugün nerede — şema kısıtı tanımlı (`evaluation.brief_id NOT NULL`), üretim akışı
(`evaluate.py`/`propose.py`) yazılmadı; henüz hiç brief girilmedi.

<!-- uy:brief-yargisi/iki-duzey-degerlendirme -->
## G2.2 — İki düzey: instance + agrega, delta ile

Gereksinimler:
1. Değerlendirme hem tek birim (Meta nesnesi / boost / dönüşüm birimi) hem portföy
   (bütçesi ortak İç Kampanya Kategorisi/Ailesi) düzeyinde koşar.
2. Zaman içindeki tepki/etkileşim/dönüşüm değişimi (delta/trend) deterministik SQL ile
   ambardan hesaplanır; LLM yalnız yorum katar, sayı üretmez.

Kabul ölçütü: aynı girdiyle iki koşum aynı delta sayılarını verir (determinizm testi);
agrega skor, kategori bütçe tanımı `category` olan her İKK için üretilür durumda.

▸ bugün nerede — taksonomi miras çözücüsü testli; delta SQL'i ve agrega akışı yok.

<!-- uy:brief-yargisi/rubrik-mirasi -->
## G2.3 — Rubrik amaç kapsamından türer, kullanıcı düzenler

Gereksinimler:
1. Rubrik hiçbir dikeye gömülü değildir: amaç kapsamı (bilinirlik/takipçi/lead/satış/
   hibrit — açık uçlu) başına düzenlenebilir varsayılan + Sheets override.
2. Benchmark boşsa ilk 4 haftada sistemin kendi tarihinden önerilir; öneriyi kullanıcı
   onaylar.
3. Hibrit kapsamlar ağırlıklı bileşik skorla tanımlanır; yeni kapsam eklemek kod
   değişikliği gerektirmez.

Kabul ölçütü: yeni bir amaç kapsamı yalnız YAML + Sheets satırıyla eklenip ilk
değerlendirmesini üretir (kod diff'i sıfır).

▸ bugün nerede — 5 rubrik YAML'ı yazıldı (`config/rubrics/`); override ve benchmark
önerici yok.

<!-- uy:brief-yargisi/olculemeyen-durustlugu -->
## G2.4 — Ölçülemeyen "ölçülemedi" diye raporlanır

Gereksinimler:
1. Verisi olmayan metrik (ör. offline satış CPA/ROAS'u, CRM kapısı açılana dek;
   teyitsiz follows alanı) raporda tahminle doldurulmaz; `ölçülemedi` etiketi +
   nedeni yazılır.
2. Düşük güvenli türev metrikler (`derived`) güven etiketi taşır.

Kabul ölçütü: digest'te hiçbir sayı kaynağı bilinmeden görünmez; "ölçülemedi"
satırları kaynağa (hangi eksik) bağlıdır.

▸ bugün nerede — ilke rubrik YAML notlarında; raporlama katmanı henüz yok.
