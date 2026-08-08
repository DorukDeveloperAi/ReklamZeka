---
kosum: tek-ajan
getirir:
  - dokunur: modul:src/reklamzeka/meta_gateway.py
  - dokunur: dok:docs/mcp-envanter.md
  - dokunur: dok:docs/api-gercekleri.md
---
# Aşama 02 — META BAĞLANTI DOĞRULAMA (v2)

> Roadmap: [MASTER.md](MASTER.md) · Bağımlı: 01
> Bu dosya KENDİ BAŞINA yeterlidir: taze bir /goal session'ı yalnız bunu okuyarak işi bitirebilmeli.

## Bağlam (bu aşamayı koşan session için)

- Proje: ReklamZeka — brief-temelli, kontrol-öncelikli Meta reklam yardımcı ajanı
  (plan kökü: `plans/reklamzeka-sistemi/v1/MASTER.md`, Faz 0). Plumbing kararı: SADECE resmî
  Meta Ads MCP (`https://mcp.facebook.com/ads`); tüm erişim tek geçiş noktasından:
  `src/reklamzeka/meta_gateway.py` (`MetaGateway`).
- Aşama 01'in bıraktığı durum: repo iskeleti + guardrails + offline testler yeşil (uv/3.12);
  `tests/test_mcp_contract.py`'deki 2 canlı test token yokluğunda SKIP; `docs/mcp-envanter.md`
  BOŞ şablon ("elle tahmin YAZILMAZ" kuralı dosyanın kendisinde); `docs/api-gercekleri.md`
  TEYİTSİZ tablosunda 8 açık madde (⬜). Kanıt profilleri `.claude/kanit.json`'da kurulu:
  `kanit:hizli` (offline test + terminoloji lint) ve `kanit:tam`.
- Bu aşamanın işi CANLI ölçümdür: OAuth bağlantısını kur, araç envanterini canlıdan dök,
  teyitsiz maddeleri gerçek hesapta ölç. Aşağı akış bu ölçümlere bağlı: ingest alan adları
  (madde 2/3/7), "takipçi" rubriğinin kaynağı (madde 2), mapping'in boost ad-kalıbı (madde 5),
  MCP araç yüzeyi ve creative upload boşluğu (madde 1/6), sağlık kategorisi kısıtı (madde 8).
- **Kapanış tanımı:** bir madde, `docs/api-gercekleri.md` tablosunun Sonuç sütununa ölçülmüş
  hüküm + kanıt dosyası yolu yazılıp ⬜ → ✅ çevrilince kapanır. OLUMSUZ bulgu da kapanıştır:
  "alan yok" ölçülmüş bir gerçektir (ör. follows yoksa rubrik `derived` yoluna düşer, MASTER §9.3).
- **Yazma disiplini:** bu aşama SALT-OKUMA. `MetaGateway` yazma yolu kapalıdır (dry_run +
  `guardrails.assert_paused_create` ACTIVE engeli). Ambar (warehouse.db) yazımı ve cron kurulumu
  YAPILMAZ. Madde 4'ün (create'in PAUSED davranış provası) canlı testi test nesnesi
  yaratmayı gerektirir → **aşama 07'ye devirli**; burada yalnız ŞEMA tespiti yapılır
  (create araçlarında `status` parametresi var mı — envanterden okunur).
- Varsayım: tüm sayfalar/reklam hesapları TEK Business Manager altında (MASTER §10 soru 1).
  Nesne dökümünde aksi görünürse `STATE.md`'ye not düşülür; aşamayı durdurmaz.

## SONUÇ

**Bu aşama bitince:** `docs/mcp-envanter.md` canlı araç envanteriyle dolu ve
`docs/api-gercekleri.md`'deki 8 teyitsiz maddeden 7'si canlı ölçümle kapatılmış durumda
(madde 4 PAUSED provası aşama 07'ye devirli); `tests/test_mcp_contract.py` token'la yeşil.

## Önkoşullar

- Aşama 01 tamam — doğrula: `uv run pytest -q` → offline testler passed (2 MCP testi skipped
  kabul) ve `test -s .claude/kanit.json` → exit 0.
- MCP istemcisi kurulu — doğrula: `uv run --extra mcp python -c "import mcp; print('ok')"` → `ok`.
- ✋ İNSAN ADIMI (BLOKLAYICI — T02.1'de yürütülür): Meta reklamveren OAuth iznini tarayıcıda
  KULLANICI verir; headless koşular için `META_MCP_ACCESS_TOKEN` kullanıcıdan gelir. Koşan
  session bu noktada BLOKE olur ve turunu T02.1'deki ✋ SENDEN satırlı DURUM bloğuyla bitirir —
  sessiz bekleme YASAK. Token gelmeden T02.2–T02.5 BAŞLAMAZ.
- Hesapta en az bir (tercihen videolu) boost geçmişi — madde 2/3/5 ölçümleri buna dayanır;
  T02.3 adım 1'de nesne listesinden doğrulanır, yoksa kullanıcıya DURUM bloğuyla sorulur.

## Task'lar

### T02.1 — Reklamveren OAuth bağlantısı + headless token (✋ insan adımlı)
**SONUÇ:** Resmî Meta Ads MCP'ye hem interaktif (Claude Code MCP istemcisi) hem headless
(`META_MCP_ACCESS_TOKEN` ile `MetaGateway`) bağlanılıyor; `list_tools()` boş olmayan liste döndürüyor.
**Subtask'lar:**
1. ✋ İNSAN: kullanıcı çalıştırır: `claude mcp add --transport http meta-ads https://mcp.facebook.com/ads`,
   ardından Claude Code içinde `/mcp` → `meta-ads` → tarayıcıda Meta reklamveren OAuth izni
   (tek Business Manager'ın yetkili kullanıcısıyla).
2. ✋ İNSAN: headless koşular için erişim token'ı ortam değişkenine konur:
   `export META_MCP_ACCESS_TOKEN=...`. Token dosyaya, `config/settings.yaml`'a ve git'e
   YAZILMAZ (`config/settings.example.yaml`'daki kural).
3. Bu iki adım tamamlanana kadar session BLOKE'dir; tur şu DURUM bloğuyla kapatılır:
   ```
   —— DURUM ——  ✋ SENDEN: Meta OAuth izni + token — aşağıdaki komutlar
   ⏸ aşama 02 · bekliyor: Meta reklamveren OAuth (tarayıcı izni) · sahip: SEN
      ✋ senden: `claude mcp add --transport http meta-ads https://mcp.facebook.com/ads` → `/mcp` ile izin;
        sonra `export META_MCP_ACCESS_TOKEN=...`
   ⏭ sonra: T02.2 envanter dökümü · tetikleyen: SEN (token geldiğinde)
   ```
4. Token geldikten sonra duman testi (kabul komutu) koşulur; `MetaGatewayError` / 401 alınırsa
   sorun (token, scope, hesap yetkisi) aynı DURUM kalıbıyla kullanıcıya geri bildirilir.
**Kabul kriteri (kanıt):** `uv run --extra mcp python -c "import sys; sys.path.insert(0,'src'); import asyncio; from reklamzeka.meta_gateway import MetaGateway; t=asyncio.run(MetaGateway().list_tools()); print(len(t),'araç')"` → `N araç` (N ≥ 1), hata yok (env'de `META_MCP_ACCESS_TOKEN` tanımlı).

### T02.2 — Araç envanteri dökümü → docs/mcp-envanter.md (madde 1, 6)
**SONUÇ:** `docs/mcp-envanter.md` canlı dökümle dolu (araç adı · okuma/yazma türü · parametre
özeti · not); madde 1 ve 6 kapalı.
**Subtask'lar:**
1. `src/reklamzeka/meta_gateway.py` `list_tools()` dönüşüne `input_schema` alanını ekle
   (MCP `tools/list` yanıtındaki `inputSchema`) — madde 1'in "yazma araçlarının parametre yüzeyi"
   kısmı bunsuz ölçülemez. `tests/test_mcp_contract.py` dökümünü parametre özeti sütunuyla
   genişlet (zorunlu alanlar + `status` benzeri kritik parametreler).
2. Dökümü koş: `META_MCP_ACCESS_TOKEN=… uv run --extra mcp pytest "tests/test_mcp_contract.py::test_list_tools_and_dump_inventory" -v -s`;
   ham JSON'u `docs/kanit/asama-02/mcp-tools.json` olarak kaydet (token/PII içermez).
3. `docs/mcp-envanter.md` tablosunu DÖKÜMDEN doldur — elle tahmin YAZILMAZ. Tür sınıflaması:
   adında create/update/activate/edit/delete geçen = yazma (`meta_gateway.WRITE_TOOL_HINTS`
   ile aynı liste); gerisi okuma.
4. "Doğrulanacak davranışlar" kutularından şemadan okunabilenleri işaretle: create araçlarında
   `status` parametresi var mı (yalnız ŞEMA tespiti — davranış provası aşama 07), creative/görsel
   upload yolu (madde 6), insights seviye/breakdown/tarih aralığı yüzeyi, aktivite logu araçları.
5. `docs/api-gercekleri.md` #1 ve #6 Sonuç hücrelerine hüküm + kanıt yolu yaz; ⬜ → ✅.
**Kabul kriteri (kanıt):** `rg -n 'doldurulacak' docs/mcp-envanter.md; test -s docs/kanit/asama-02/mcp-tools.json && rg -n '^\| (1|6) .*✅' docs/api-gercekleri.md` → ilk arama 0 eşleşme (exit 1), dosya dolu, son arama 2 satır.

### T02.3 — Canlı insights ölçümleri (madde 2, 3, 7, 8 + rate limit davranışı)
**SONUÇ:** follows action_type, thruplay alan adı, profil ziyareti ucu, sağlık kategorisi kısıtı
ve rate limit davranışı canlı çekimle ölçülmüş; #2/#3/#7/#8 kapalı.
**Subtask'lar:**
1. Envanterdeki okuma araçlarıyla hesap nesnelerini listele; biri boost kaynaklı, biri normal en
   az iki Meta Ad seç (madde 3 için videolu olanı tercih et). Boost'lu nesne bulunamazsa
   kullanıcıya DURUM bloğuyla sor — uydurma nesneyle ölçüm YAPILMAZ.
2. Madde 2 (follows): boost'lu Meta Ad için insights çek (actions alanı; tarih aralığı boost'un
   koştuğu dönem). Dönen TÜM action_type değerlerini `docs/kanit/asama-02/insights-actions.json`'a
   dök; follow benzeri action_type var/yok hükmünü yaz. "Yok" da kapanıştır → rubrik `derived`
   delta-korelasyon yoluna düşer (MASTER §9.3).
3. Madde 3 (thruplay): aynı çekimde `video_thruplay_watched_actions` alanını iste; alan v26'da
   kabul ediliyor mu, veri dönüyor mu — hüküm + kanıt yolu.
4. Madde 7 (profile visits): (a) ads insights actions listesinde profil ziyareti benzeri
   action_type ara; (b) envanterde IG Platform (organik) insights aracı var mı bak. Hüküm
   "hangi uçtan, hangi alanla" sorusunu yanıtlar; resmî MCP yüzeyinde HİÇ yoksa bu da hükümdür
   ve ingest'e "ayrı IG organik kanalı gerekir" notu düşülür (MASTER §3, katman 1).
5. Madde 8 (sağlık kısıtı): envanterdeki dataset/sinyal tanılama araçlarıyla hesabın kategori
   kısıtını sorgula (alt-huni event kısıtı görünüyor mu); çıktı → `docs/kanit/asama-02/saglik-kisiti.json`.
6. Rate limit: yukarıdaki normal çağrılar sırasında hata biçimini ve throttle bilgisinin
   (`X-FB-Ads-Insights-Throttle` eşdeğeri) MCP yüzeyinde görünüp görünmediğini gözle;
   `docs/mcp-envanter.md` "rate limit davranışı" kutusunu bulguyla işaretle. Kasıtlı limit
   zorlaması YAPILMAZ (canlı müşteri hesabı).
**Kabul kriteri (kanıt):** `rg -n '^\| (2|3|7|8) .*✅' docs/api-gercekleri.md` → 4 satır; `ls docs/kanit/asama-02/insights-actions.json docs/kanit/asama-02/saglik-kisiti.json` → iki dosya da var.

### T02.4 — Boost yapısının hesap dökümü (madde 5)
**SONUÇ:** Uygulama-içi boost'un ad account'taki yapısı (Meta Campaign / Meta Ad Set / Meta Ad
zinciri, ad kalıbı, meta_objective, creative bağı) ölçülmüş; #5 kapalı ve mapping
kalibrasyonu (aşama 05) için not düşülmüş.
**Subtask'lar:**
1. Boost kaynaklı Meta Campaign → Meta Ad Set → Meta Ad zincirini okuma araçlarıyla dök:
   isim kalıbı, meta_objective, `advantage_state_info`, creative'de `source_instagram_media_id`
   görünürlüğü. Ham çıktı: `docs/kanit/asama-02/boost-yapisi.json` (token/PII yok).
2. `docs/api-gercekleri.md` #5 Sonuç hücresine hüküm + kanıt yolu; ⬜ → ✅.
3. Gözlenen ad kalıbını aşama 05 mapping isim-kuralı kalibrasyonu için hükmün içine not düş:
   boost nesneleri `[İK-<id>]` önekine uymayacaktır → yetim nesne raporu güvenlik ağıdır
   (MASTER §9.4, §3 katman 4).
**Kabul kriteri (kanıt):** `test -s docs/kanit/asama-02/boost-yapisi.json && rg -n '^\| 5 .*✅' docs/api-gercekleri.md` → exit 0 + 1 satır.

### T02.5 — Sözleşme testleri yeşil + teyitsiz tablo kapanış süpürmesi
**SONUÇ:** `tests/test_mcp_contract.py` token'la 2 passed / 0 skipped; teyitsiz tabloda ⬜
kalmadı (madde 4 devir notlu, ✅ değil); offline kanıt paketi yeşil.
**Subtask'lar:**
1. Madde 4 Sonuç hücresine devri yaz: "⏭ aşama 07'ye devirli (onaylı yazma provası: tek
   PAUSED test nesnesi + geri-okuma); kod engeli `guardrails.assert_paused_create` şimdiden
   aktif; create ŞEMA tespiti T02.2'de yapıldı" — ⬜ kaldırılır, ✅ YAZILMAZ (madde kapalı değil, devirli).
2. `META_MCP_ACCESS_TOKEN=… uv run --extra mcp pytest tests/test_mcp_contract.py -v` → 2 passed, 0 skipped.
3. `kanit:hizli` koş (offline testler + `uv run python scripts/lint_terminology.py`) → yeşil; kod/test
   düzenlemelerinde çıplak terim girdiyse Meta'nın kendi araç/alan adları satıra `term-ok` ile muaf tutulur.
4. **Subtask-üretici:** `rg -n '⬜' docs/api-gercekleri.md` → çıkan HER satır için "ölçümü
   tamamla" subtask'ı aç ve ilgili task'a (T02.2–T02.4) geri dön. Bulgu (⬜ satırı) kaybolunca
   task kapanır.
**Kabul kriteri (kanıt):** `rg -n '⬜' docs/api-gercekleri.md` → eşleşme yok (exit 1) VE `META_MCP_ACCESS_TOKEN=… uv run --extra mcp pytest tests/test_mcp_contract.py -v` → `2 passed`, çıktıda `skipped` yok.

## Task checklist

- [ ] T02.1 — OAuth + headless token · kanıt: list_tools duman testi → `N araç` (N ≥ 1)
- [ ] T02.2 — envanter dökümü · kanıt: `rg 'doldurulacak' docs/mcp-envanter.md` → 0 eşleşme + #1/#6 ✅
- [ ] T02.3 — canlı insights ölçümleri · kanıt: `rg '^\| (2|3|7|8) .*✅' docs/api-gercekleri.md` → 4 satır
- [ ] T02.4 — boost yapısı dökümü · kanıt: `boost-yapisi.json` dolu + #5 ✅
- [ ] T02.5 — kapanış süpürmesi · kanıt: `rg '⬜' docs/api-gercekleri.md` → 0 · MCP testleri 2 passed/0 skipped

## Aşama requirements

| id | requirement | doğrulama | delege |
|---|---|---|---|
| R02.1 | Resmî MCP'ye OAuth'lu bağlantı kurulu; headless token çalışıyor | `META_MCP_ACCESS_TOKEN=… uv run --extra mcp pytest tests/test_mcp_contract.py -v` → 2 passed, 0 skipped | — |
| R02.2 | `docs/mcp-envanter.md` canlı dökümle dolu; elle tahmin yok | `rg -n 'doldurulacak' docs/mcp-envanter.md` → 0 eşleşme + `test -s docs/kanit/asama-02/mcp-tools.json` | — |
| R02.3 | 8 teyitsiz maddeden 7'si ölçülmüş hükümle ✅; madde 4 devir notlu | `rg -n '⬜' docs/api-gercekleri.md` → 0 eşleşme; `rg -n '^\| 4 .*aşama 07' docs/api-gercekleri.md` → 1 satır | madde 4 → aşama 07 |
| R02.4 | Offline kanıt paketi yeşil (testler + terminoloji lint) | `kanit:hizli` | — |
| R02.5 | Bu aşamada Meta'ya hiçbir yazma yapılmadı | `uv run pytest tests/test_guardrails.py -q` → geçer; `docs/kanit/asama-02/` altında yalnız okuma dökümleri var | — |

## Doğrulama (aşama kapanışı)

Sırayla; idempotent — aynı diziyi iki kez koşmak hükmü değiştirmez:

1. `uv run --extra mcp python -c "import mcp"` → sessiz çıkış (ortam hazır).
2. `META_MCP_ACCESS_TOKEN=… uv run --extra mcp pytest tests/test_mcp_contract.py -v` → **2 passed, 0 skipped**.
3. `rg -n 'doldurulacak' docs/mcp-envanter.md` → eşleşme yok; `rg -c '^\| ' docs/mcp-envanter.md` → ≥ 7
   (başlık + ayraç + en az 5 araç satırı).
4. `rg -n '⬜' docs/api-gercekleri.md` → eşleşme yok; `rg -c '✅' docs/api-gercekleri.md` → 7
   (madde 1–3, 5–8); `rg -n '^\| 4 .*aşama 07' docs/api-gercekleri.md` → 1 satır (devir).
5. `ls docs/kanit/asama-02/` → `boost-yapisi.json  insights-actions.json  mcp-tools.json  saglik-kisiti.json`,
   hepsi boş değil (`test -s` ile).
6. `kanit:hizli` → yeşil.
7. Yazma olmadığının teyidi: `uv run pytest tests/test_guardrails.py -q` → geçer (ACTIVE
   engeli yerinde); bu aşamanın hiçbir kabul kriteri yazma aracı çağrısı içermez.

## Efor/maliyet notu

İnsan-bloklu başlangıç: OAuth tarayıcı izni + token — takvim süresi kullanıcıya bağlı, session
T02.1'de DURUM bloğuyla bekler. Sonrası tek-ajan ve LLM'siz MCP client çağrıları (token maliyeti
~0); canlı çağrılar salt-okuma ve düşük hacim (BUC kotasını zorlamaz, kasıtlı limit testi yok).
Aktif iş tahmini: 2–4 saat + insan adımı bekleme.

## Bitirirken (zorunlu)

1. `CHECKLIST.md`'de bu aşamanın maddelerini işaretle.
2. `STATE.md`'ye tur kaydı yaz: tarih · yapılan · kanıt yolları · açık kalan.
