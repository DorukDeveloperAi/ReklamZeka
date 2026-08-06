---
kosum: tek-ajan
getirir:
  - dugum: modul:src/reklamzeka/crm_ledger.py
  - dugum: modul:src/reklamzeka/capi_feed.py
  - dokunur: dok:utopya/vizyon/4-uyum-guveni.md
---
# Aşama 10 — CRM V2 KAPISI (v2)

> Roadmap: [MASTER.md](MASTER.md) · Bağımlı: 08, 09
> Bu dosya KENDİ BAŞINA yeterlidir: taze bir /goal session'ı yalnız bunu okuyarak işi bitirebilmeli.

## Bağlam (bu aşamayı koşan session için)

- **Neden:** Satış amaç kapsamının CPA/ROAS'u v1'de yalnız piksel-görünür dönüşümle hesaplanır
  (`config/rubrics/satis.yaml`: cpa/roas `source: ads_insights`, "alt-sınır" notu); offline kapanışlar
  digest'te `ölçülemedi` raporlanır — tahmin yazılmaz (MASTER §9.5, kullanıcı kararı). Bu aşama o
  dürüst boşluğu gerçek CRM kapanış verisiyle kapatır.
- **Tek teknik yol:** Offline Conversions API öldü (14 May 2025, `docs/api-gercekleri.md`). CRM geri
  beslemesi yalnız **Conversions API (CAPI) + dataset + `lead_id`** ile yapılır.
- **Şartname bağları:** `utopya/vizyon/5-acik-uclu-buyume.md` G5.3 (kabul: rubrik gerçek kapanışla
  beslenir, `ölçülemedi` kapanır; kendi defterimiz kanon — Meta atribüsyonuna tek başına güvenilmez)
  ve `utopya/vizyon/4-uyum-guveni.md` G4.3 (**tasarım şartnameye işlenmeden kod yazılmaz**).
- **Bilinen risk:** Offline API → CAPI geçişlerinde kabul edilen olay oranında %70'e varan düşüş
  raporlandı. Bu yüzden CAPI yalnız Meta'nın optimizasyon/atıf tarafını besler; CPA/ROAS **her zaman
  kendi defterimizden** hesaplanır.
- **Kapı kararı:** kullanıcı 2026-08-06'da "CRM var, v2'de" dedi; bu aşama roadmap'in
  SON aşamasıdır ve fiili açılış onayı T10.1'de alınır. Aşama 08 ve 09 kapanmış olmalı.
- **Sıra kuralı (SERT):** T10.1'deki ✋ insan onayı alınmadan T10.2–T10.5 BAŞLAMAZ.

## SONUÇ

**Bu aşama bitince:** CRM kapanış verisi Conversions API + dataset + `lead_id` eşleme defteriyle Satış
rubriğini besliyor ve digest'teki CPA/ROAS `ölçülemedi` satırları defter kapsamındaki dönemler için
kapanmış durumda; kişisel veri sisteme girmiyor (yalnız `lead_id` + hash); "kod değişmeden yeni İç
Kampanya Kategorisi + yeni digest sink'i" provası belgelenmiş (G5.2).

## Önkoşullar

- Aşama 08 ve 09 kapalı: `rg -n "Aşama 0[89]" CHECKLIST.md` → o aşamaların tüm maddeleri `[x]`.
- Digest hattı çalışır: `python -m reklamzeka.digest --help` → çıkış kodu 0 (giriş noktası farklıysa
  `STATE.md`'deki son digest komutunu kullan ve buraya not düş).
- Satış İK'ları için spend serisi dolu: `sqlite3 warehouse.db "SELECT COUNT(*) FROM metric_snapshot WHERE metric_key='spend'"` → > 0.
- Kanıt sınıfları tanımlı: `python -c "import json;print(sorted(json.load(open('.claude/kanit.json'))))"`
  → `hizli`, `surus`, `tam` girişleri var.
- Kullanıcı ulaşılabilir ve CRM'den örnek export alınabilir (T10.1 görüşmesinin girdisi).
- Events Manager'da dataset erişimi + CAPI token'ı: `echo $META_CAPI_ACCESS_TOKEN | wc -c` → > 1.

## Task'lar

### T10.1 — Şartname revizyonu (G4.3 KVKK tasarımı) + ✋ kapı onayı
**SONUÇ:** `utopya/vizyon/4-uyum-guveni.md` G4.3 v2 tasarımıyla revize edilmiş; kullanıcı kapı
kararlarını vermiş ve kayıt altında. **Bu task kapanmadan diğer task'lar başlamaz.**
**Subtask'lar:**
1. G4.3'e "v2 tasarımı" alt bölümünü işle (şartname ÖNCE, kod sonra — G4.3 gereği):
   - **Hash'li eşleme alanları:** `em_hash` (e-posta: lowercase+trim → SHA-256) ve `ph_hash`
     (telefon: E.164 normalize → SHA-256) — CAPI `em`/`ph` user_data alanlarının bizim taraftaki karşılığı.
   - **Amaç sınırlaması:** hash'ler YALNIZ (a) CAPI user_data eşlemesi ve (b) defter lead eşlemesi
     için kullanılır; başka sorgu/rapor/segment amacıyla kullanılamaz — bu cümle şartnameye aynen girer.
   - **Girmeme garantisi:** düz metin e-posta/telefon/ad-soyad HİÇBİR depoya (SQLite, Sheets, log,
     digest) yazılmaz; hash'leme import sınırında bellekte yapılır, düz metin atılır; sisteme kalıcı
     giren tek kimlik `lead_id` + hash'lerdir. Sheets'e yalnız anonim/özet satır gider.
2. ✋ **İNSAN onayı** — üç karar, üçü de kayda geçer (MASTER v1 §10 soru 8):
   - **Kapı açma kararı:** v2 CRM entegrasyonu şimdi açılıyor mu?
   - **CRM export formatı:** dosya türü, kolon listesi, alınma kadansı (elle/zamanlı).
   - **Lead kimlik alanı:** Meta `lead_id` CRM'de saklanıyor mu; saklanmıyorsa eşleme hangi alanla
     yapılacak (em_hash/ph_hash fallback sırası)?
   - Türev karar: kapanış kanalı → CAPI `action_source` eşlemesi (`phone_call` / `physical_store` / `other`).
3. Onay kaydını `STATE.md`'ye yaz: `T10.1 kapı onayı · <tarih> · karar özetleri (format/kimlik/action_source)`.
**Kabul kriteri (kanıt):** `rg -n "amaç sınırlaması|em_hash|ph_hash|düz metin" utopya/vizyon/4-uyum-guveni.md`
→ G4.3 altında ≥4 eşleşme; `rg -n "T10.1 kapı onayı" STATE.md` → tarihli onay satırı var.

### T10.2 — Lead→satış eşleme defteri (kendi kanonumuz)
**SONUÇ:** CRM export'u SQLite defterine idempotent aktarılıyor; Sheets yalnız anonim/özet görüyor;
hiçbir depoya düz metin kişisel veri değmiyor.
**Subtask'lar:**
1. `src/reklamzeka/schema.py` DDL'e üç tablo:
   `crm_lead_ledger(lead_id PK, em_hash, ph_hash, ik_id → internal_campaign, meta_ad_id, lead_created_at, source)`;
   `crm_closure(closure_id PK, lead_id FK, closed_at, revenue_try, closure_channel, export_batch_ref, imported_at)`;
   `capi_feed_log(batch_id PK, sent_count, events_received, test_event_code, response_ref, created_at)` (T10.3 kullanır).
2. `src/reklamzeka/crm_ledger.py`: `import_crm_export(path)` — T10.1'de kararlaşan formatı okur,
   hash'leri bellekte üretir, düz metni diske yazmadan atar; aynı export ikinci kez verildiğinde satır
   sayısı değişmez (doğal anahtar: `lead_id` + closure).
3. `src/reklamzeka/sheets_schema.py`: `CRM_OZET` sekmesi (dönem, İKK, lead sayısı, kapanış sayısı,
   gelir toplamı TRY) — kişisel veri alanı YOK; sistem yalnız append yazar (MASTER §2.1 deseni).
4. `tests/test_crm_ledger.py`: idempotent import · hash determinizmi · **sızıntı testi**: e-posta/telefon
   içeren fixture import edildikten sonra `warehouse.db` dökümünde `@` ve düz telefon deseni YOK.
5. `tests/test_schema_kvkk.py`: DDL + Sheets şema sabitlerinde yasak kolon adı yok (email, phone,
   ad_soyad, tc, adres) — G4.3 "şema denetimi" kabul ölçütünün kalıcı testi.
**Kabul kriteri (kanıt):** `python -m pytest tests/test_crm_ledger.py tests/test_schema_kvkk.py -q`
→ tümü geçer; `python scripts/lint_terminology.py` → ihlal yok.

### T10.3 — CAPI entegrasyonu: dataset'e offline event gönderimi
**SONUÇ:** Defterdeki kapanışlar dataset'e uygun `action_source` ile gidiyor; kabul oranı
(`events_received`/gönderilen) loglanıyor ve izleniyor; rubrik hesabı CAPI'den BAĞIMSIZ, defter kanon.
**Subtask'lar:**
1. `config/settings.example.yaml`'a `capi:` bloğu: `dataset_id`, `access_token_env:
   "META_CAPI_ACCESS_TOKEN"`, `default_action_source`, `test_event_code`, `dry_run: true`
   (guardrails dry-run deseniyle aynı davranış).
2. `src/reklamzeka/capi_feed.py`: `crm_closure`'dan gönderilmemişleri toplar →
   `POST /<api_version>/<dataset_id>/events` (sürüm tek konfig sabitinden, MASTER §9.6); payload:
   `event_name=Purchase`, `event_time=closed_at`, `action_source`=T10.1 eşlemesi,
   `user_data={lead_id, em, ph}` (yalnız hash), `custom_data={value, currency:"TRY"}`.
   `dry_run=true` iken payload loglanır, HTTP çağrısı yapılmaz.
3. Yanıttaki `events_received` → `capi_feed_log`; kabul oranı < 0.7 ise digest'e uyarı satırı
   (geçişlerde %70'e varan düşüş raporlanmıştı). Oran düşükse eşleme kalitesi incelenir ama CPA/ROAS
   ETKİLENMEZ — hesap defterden yapılır; CAPI yalnız Meta optimizasyon/atıf tarafını besler.
4. Gönderilen closure işaretlenir (tekrar gönderim yok); `tests/test_capi_feed.py`: payload şeması
   (hash'li alanlar, düz metin yok) · dry-run'da çağrı yok · idempotent gönderim · `events_received` logu.
**Kabul kriteri (kanıt):** `python -m pytest tests/test_capi_feed.py -q` → geçer; sürüş:
`test_event_code` ile canlı gönderim sonrası
`sqlite3 warehouse.db "SELECT sent_count, events_received FROM capi_feed_log ORDER BY created_at DESC LIMIT 1"`
→ `events_received ≥ 1` ve olaylar Events Manager'da görünür.

### T10.4 — Satış rubriği gerçek CPA/ROAS + digest `ölçülemedi` kapanışı
**SONUÇ:** cpa/roas defterden hesaplanıyor; digest'te Satış İK'larının cpa/roas satırları defter
kapsamındaki dönemlerde sayısal; kapsam dışı dönemde `ölçülemedi` dürüstlüğü korunuyor.
**Subtask'lar:**
1. `config/rubrics/satis.yaml`: `cpa` → `source: derived` (dönem spend'i [`metric_snapshot`] /
   `crm_closure` kapanış sayısı), `roas` → `source: derived` (`crm_closure` gelir toplamı / spend);
   başlık yorumu ve `notes` güncellenir: "defter kanon; piksel-görünür değer yalnız alt-sınır bilgi
   satırı". Ağırlıklar değişmez.
2. Evaluate hattındaki `derived` hesaplayıcıya iki türetim kaydı: spend `metric_snapshot`'tan,
   kapanış/gelir `crm_closure`'dan (`ik_id` üzerinden; lead→İK bağı defterde).
3. Digest: Satış İK cpa/roas satırında defter **kapsama kontrolü** — dönemde defter verisi varsa sayı,
   yoksa `ölçülemedi` yazılır ("tahmin yazılmaz" kuralı DEĞİŞMEZ, MASTER §9.5).
4. `tests/test_digest_satis_v2.py`: defter+snapshot fixture'ıyla digest metninde Satış İK cpa/roas
   sayısal ve `ölçülemedi` YOK; boş-defter fixture'ında `ölçülemedi` GERİ GELİYOR.
**Kabul kriteri (kanıt):** `python -m pytest tests/test_digest_satis_v2.py -q` → geçer; sürüş: gerçek
defterle digest koşusu → çıktıda Satış cpa/roas satırlarında `ölçülemedi` yok.

### T10.5 — Genişleme provası (G5.2): kod değişmeden yeni İKK + yeni digest sink'i
**SONUÇ:** Prova belgelenmiş ve tekrarlanabilir: yeni İç Kampanya Kategorisi + yeni digest sink'i
yalnız veri/konfig satırıyla eklendi; `src/` ve `tests/` diff'i sıfır.
**Subtask'lar:**
1. Prova başlangıcını işaretle: `git tag prova-onu-10`.
2. Yeni İKK: kanona (Sheets) satır — ör. Satış ailesinde yeni bir tür (aşama 05'in AI iskeletiyle
   ya da elle); `resolve_effective_config` ile çözüldüğünü ve digest'te göründüğünü göster.
3. Yeni sink: digest sink kaydına konfig satırı (ör. ikinci dosya/webhook sink'i
   `config/sinks.yaml`'da) → digest çıktısı yeni sink'e de düşer. Sink kaydı konfigten
   eklenemiyorsa prova FAIL'dir: önce sink registry'yi konfig-güdümlü hale getir (bu genelleme
   prova ÖNCESİ commit'lenir, tag ondan sonra atılır), provayı temiz noktadan tekrar koş.
4. `docs/genisleme-provasi.md`: adımlar + komutlar + çıktı örnekleri + git kanıtı — tekrarlanabilirlik
   G5.2 kabul ölçütüdür.
**Kabul kriteri (kanıt):** `git diff --stat prova-onu-10 -- src/ tests/` → boş çıktı;
`rg -n "sink" docs/genisleme-provasi.md` → prova adımları belgeli.

## Task checklist

- [ ] T10.1 — G4.3 revizyonu + ✋ kapı onayı · kanıt: `rg` G4.3 tasarım satırları + STATE.md onay kaydı
- [ ] T10.2 — eşleme defteri · kanıt: `pytest tests/test_crm_ledger.py tests/test_schema_kvkk.py -q` → geçer
- [ ] T10.3 — CAPI gönderimi · kanıt: `pytest tests/test_capi_feed.py -q` → geçer; `capi_feed_log.events_received ≥ 1`
- [ ] T10.4 — rubrik + digest kapanışı · kanıt: `pytest tests/test_digest_satis_v2.py -q` → geçer; canlı digest'te Satış cpa/roas'ta `ölçülemedi` yok
- [ ] T10.5 — genişleme provası · kanıt: `git diff --stat prova-onu-10 -- src/ tests/` → boş + `docs/genisleme-provasi.md`

## Aşama requirements

| id | requirement | doğrulama | delege |
|---|---|---|---|
| R-10.1 | G4.3 v2 KVKK tasarımıyla revize; kapı onayı tarihli kayıtlı | `kanit:hizli` (T10.1 `rg` komutları) | G4.3 kabul ölçütü |
| R-10.2 | Hiçbir depoda düz metin kişisel veri yok; defter yalnız `lead_id` + hash tutar | `kanit:tam` (`test_schema_kvkk` + sızıntı testi) | G4.3 kabul ölçütü |
| R-10.3 | CAPI kabul oranı ölçülüyor; oran ne olursa olsun CPA/ROAS defterden hesaplanır | `kanit:tam` (`test_capi_feed`) | G5.3 |
| R-10.4 | Satış rubriği gerçek kapanışla besleniyor; digest `ölçülemedi` satırları defter kapsamında kapalı | `kanit:surus` (canlı digest koşusu) | G5.3 kabul ölçütü |
| R-10.5 | Yeni İKK + yeni sink kod diff'siz eklendi, prova belgeli ve tekrarlanabilir | `kanit:hizli` (`git diff --stat` + doc) | G5.2 kabul ölçütü |

## Doğrulama (aşama kapanışı)

1. `python -m pytest tests/test_crm_ledger.py tests/test_schema_kvkk.py tests/test_capi_feed.py tests/test_digest_satis_v2.py -q` → tümü geçer (`kanit:tam`).
2. `python scripts/lint_terminology.py` → ihlal yok.
3. Sürüş (`kanit:surus`): gerçek CRM export → `import_crm_export` → CAPI `test_event_code` gönderimi
   (`events_received ≥ 1`) → digest koşusu → Satış İK cpa/roas satırları sayısal, `ölçülemedi` yalnız
   defter kapsamı dışındaki dönemlerde.
4. İdempotens: aynı export'u ikinci kez import et + digest'i ikinci kez koş → defter satır sayısı ve
   digest hükmü değişmez; CAPI tekrar gönderim yapmaz.
5. `git diff --stat prova-onu-10 -- src/ tests/` → boş (G5.2 provası).

## Efor/maliyet notu

İnsan-etkileşim-ağır: kapı onayı, CRM export temini ve Events Manager/dataset erişimi bekletebilir.
Kod tarafı orta (~3 modül + 4 test dosyası); token-hafif (yeni LLM adımı yok, digest metni mevcut hat).
Takvim ~2-3 gün (insan beklemeleri dahil), saf iş ~1 gün.

## Bitirirken (zorunlu)

1. `CHECKLIST.md`'de bu aşamanın maddelerini işaretle.
2. `STATE.md`'ye tur kaydı yaz: tarih · yapılan · kanıt yolları · açık kalan.
