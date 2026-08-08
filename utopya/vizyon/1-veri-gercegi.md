# VERİ GERÇEĞİ — reklam verisi edinimi şartnamesi
### bölüm 1 · Meta reklam gerçekliği kayıpsız, kendi ambarında ve yeniden türetilebilir tutulur

Amaç: sistemin her yargısı ölçülmüş veriye dayanır; veri Meta'nın saklama/alan-adı
politikalarına rehin bırakılmaz. Aşağıdaki gereksinimler sağlandığında bu bölüm
karşılanmış sayılır.

<!-- uy:veri-gercegi/kayipsiz-ambar -->
## G1.1 — Kayıpsız yerel ambar

Gereksinimler:
1. Meta Campaign / Meta Ad Set / Meta Ad seviyelerinde insights günlük kadansla çekilir
   ve ham JSON (`raw_insights`) + türetilmiş metrik (`metric_snapshot`) olarak yerel
   ambara (warehouse.db) yazılır.
2. Meta'nın saklama sınırları (unique/saatlik 13 ay, frequency 6 ay) hiçbir metriğin
   tarihini kaybettirmez: "geçmişi Meta'dan tekrar sorarım" varsayımı sistemde yoktur.
3. Çekim, hesap başına BUC rate-limit kotasına %80 eşikli backoff ile uyar; büyük
   sorgular async job deseniyle koşar.

Kabul ölçütü: 90 gün kesintisiz koşuda hiçbir günün snapshot'ı eksik değildir
(eksik gün varsa alarm kaydı vardır); ambardaki en eski kayıt Meta'nın penceresinden
bağımsız olarak durur.

▸ bugün nerede — Ambar şeması kodda (`src/reklamzeka/schema.py`, 13 tablo) ama tek
satır canlı veri çekilmedi; ingest scripti yok, MCP OAuth tamamlanmadı.

<!-- uy:veri-gercegi/metrik-soyutlama -->
## G1.2 — Metrik adı değişimine dayanıklılık

Gereksinimler:
1. Her metrik `metric_key` soyutlamasıyla tutulur; Meta alan adı değişimi (ör. organik
   reach ailesi → Views/Viewers) yalnız eşleme katmanında bir güncellemedir.
2. Ham JSON saklandığı için geçmiş snapshot'lar yeni eşlemeyle geriye dönük yeniden
   türetilebilir.
3. API sürümü tek konfig noktasında sabitlenir; yıllık sürüm göçü bir bakım task'ıdır,
   sürpriz değildir.

Kabul ölçütü: bir alan adı değişikliği senaryosunda (test) eşleme güncellenince tarihi
veri yeniden türetilir ve delta hesapları kırılmaz.

▸ bugün nerede — `raw_json_ref` bağı şemada var; eşleme katmanı ve yeniden-türetme
aracı yazılmadı.

<!-- uy:veri-gercegi/esleme-butunlugu -->
## G1.3 — Eşleme bütünlüğü (yetim nesne yok)

Gereksinimler:
1. Hesaptaki her canlı Meta nesnesi ya bir İç Kampanyaya eşlidir (`meta_object_mapping`)
   ya da "yetim" raporunda görünür; sessizce kapsam dışı kalan nesne olamaz.
2. Eşleme üç yolla kurulur: isim kuralı (yeni nesnelerde `[İK-<id>]` öneki zorunlu),
   AI önerisi (kullanıcı onaylı), manuel satır.
3. Uygulama-içi boost'ların ürettiği nesneler de eşlenir (boost sınıflandırıcısı canlı
   hesap yapısına göre kalibre edilir).

Kabul ölçütü: haftalık koşuda yetim rapor satır sayısı ölçülür; kullanıcı eşlemeyi
onaylamadan hiçbir yetim nesne değerlendirmeye girmez.

▸ bugün nerede — mapping tablosu şemada; sınıflandırıcı, isim kuralı uygulaması ve
yetim raporu yok; boost'un hesaptaki gerçek yapısı henüz teyitsiz (api-gercekleri #5).
