# İNSAN HAKİMİYETİ — yazma ve onay şartnamesi
### bölüm 3 · AI vardır ama otonom değildir; Meta'ya dokunan her el insan elidir

Amaç: sistemin hiçbir bileşeni kullanıcı onayı olmadan reklam gerçekliğini değiştiremez;
her müdahale izlenebilir ve geri alınabilirdir.

<!-- uy:insan-hakimiyeti/diff-onay-hatti -->
## G3.1 — Her yazma bir diff'tir, onay işlem-bazlıdır

Gereksinimler:
1. Okuma serbesttir; her yazma işlemi alan-bazında `current → proposed` diff'i olarak
   onay kuyruğuna düşer (gerekçe: brief · metrik · eşik · ölçülen).
2. Onay tek seferlik ve işlem-bazlıdır; toplu onay yoktur. 7 gün onaylanmayan öneri
   `expired` olur — bayat veriyle yazma yapılmaz.
3. Onay eylemi yalnız yönetim paneli ve CLI'da yaşar; bildirim kanalları (Telegram vb.)
   yalnız habercidir, onay alamaz.

Kabul ölçütü: uçtan uca testte onaysız hiçbir MCP yazma çağrısı çıkmaz; expired öneri
uygulanmaya çalışıldığında reddedilir.

▸ bugün nerede — `change_proposal` şeması ve durum makinesi tanımlı; kuyruk/panel/
uygulama akışı yazılmadı.

<!-- uy:insan-hakimiyeti/paused-garantisi -->
## G3.2 — PAUSED garantisi koddadır, platforma güvenilmez

Gereksinimler:
1. Yeni Meta nesnesi her zaman AÇIKÇA `status=PAUSED` parametresiyle üretilir; MCP'nin
   varsayılanına güvenilmez.
2. `ACTIVE` status'lü create/geçiş çağrısı kod seviyesinde engellidir; aktivasyon
   kullanıcının sistem dışı/ayrı-onaylı insan eylemidir.
3. Her yazma sonrası geri-okuma ile nesnenin gerçek durumu doğrulanır; sapma alarm
   üretir.

Kabul ölçütü: guardrail testleri (ACTIVE engeli, PAUSED zorunluluğu) sürekli yeşil;
canlı provada create edilen nesne geri-okumada PAUSED'dır.

▸ bugün nerede — `guardrails.assert_paused_create` yazıldı ve 5 birim testi yeşil;
geri-okuma doğrulaması ve canlı prova yok.

<!-- uy:insan-hakimiyeti/karar-gunlugu -->
## G3.3 — Append-only karar günlüğü + geri alma

Gereksinimler:
1. Her onay/red/uygulama kararı kim·ne·hangi gerekçe·MCP yanıtı ile append-only
   günlüğe çift yazılır (SQLite + Sheets); silme/düzeltme yoktur.
2. Her uygulanmış diff'in önceki değerleri saklanır; "geri al" ters diff olarak yine
   onaydan geçip uygulanır.

Kabul ölçütü: rastgele seçilen bir uygulama kaydından tam zincir (öneri → onay →
MCP çağrısı → geri-okuma → [rollback]) yeniden kurulabilir.

▸ bugün nerede — `decision_log` şeması var; yazan akış yok.

<!-- uy:insan-hakimiyeti/digest-urun -->
## G3.4 — Digest bir üründür, kanal değil

Gereksinimler:
1. Her koşu tek bir digest artefaktı üretir (markdown + yapılandırılmış JSON; ambara
   ve dosyaya kaydedilir, geçmişi okunabilir).
2. Kanallar artefaktın abonesidir (sink kayıt defteri): Telegram mesajı, panelde
   yapışık son-digest görünümü, ileride başka kanallar — sink eklemek konfigürasyondur.
3. Digest salt-okunur bilgidir; hiçbir sink'ten yazma/onay eylemi tetiklenemez.

Kabul ölçütü: aynı digest içeriği iki farklı sink'te bayt-eş kaynaktan görünür; yeni
bir sink kod mimarisine dokunmadan (konfig + ince adaptör) eklenir.

▸ bugün nerede — kavram bu şartnameyle doğdu; üretim/dağıtım kodu yok.
