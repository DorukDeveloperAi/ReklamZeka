---
kosum: tek-ajan
getirir:
  - dugum: modul:src/reklamzeka/budget_advisor.py
  - dokunur: modul:src/reklamzeka/guardrails.py
---
# Aşama 08 — BÜTÇE DANIŞMANI (v2)

> Roadmap: [MASTER.md](MASTER.md) · Bağımlı: 07
> Bu dosya KENDİ BAŞINA yeterlidir: taze bir /goal session'ı yalnız bunu okuyarak işi bitirebilmeli.

## Bağlam (bu aşamayı koşan session için)

Kaynak plan: `plans/reklamzeka-sistemi/v1/MASTER.md` §3 katman 7 (`budget_advisor.py`) ve §4.c
(agrega + bütçe tahsis akışı). Bu aşama, bütçesi **kategoriye** tanımlı İç Kampanya
Kategorilerinde (İKK) örnekleri (İç Kampanya, İK) portföy olarak skorlayıp **İKK-içi** bütçe
kaydırma diff'leri üretir. Diff'ler aşama 07'de kurulan onay hattına düşer; **otomatik uygulama
yoktur** — uygulamayı yalnız insan onayı sonrası aşama 07'nin `apply` yolu yapar.

**Terminoloji (kilitli, MASTER §1):** İç Kampanya Kategorisi (İKK) = aile içi tür/şablon;
İç Kampanya (İK) = fiilen koşan örnek; Meta platform nesneleri daima tam nitelikli yazılır:
**Meta Campaign / Meta Ad Set / Meta Ad**. Çıplak "kampanya"/"campaign" kodda ve log'larda
yasaktır (`scripts/lint_terminology.py`).

**Önceki aşamalardan devralınan durum:**
- Aşama 04/06: günlük koşu `metric_snapshot`'a yazıyor (PK: `snapshot_date, meta_level, meta_id,
  metric_key`; ham JSON `raw_insights`'ta, `raw_json_ref` ile geriye dönük türetim mümkün).
- Aşama 07: onay hattı canlı — `change_proposal` (`action_type='budget_shift'` şemada hazır) →
  Sheets `ONAY_KUYRUGU` sekmesi (APPEND_ONLY) → insan onayı → apply → `decision_log`.
- Guardrail çekirdeği: `src/reklamzeka/guardrails.py` (`GuardrailViolation` sınıfı mevcut;
  tavanlar 07'de doldu, kaydırma kuralı bu aşamada eklenir).
- Efektif konfig çözücü: `src/reklamzeka/taxonomy.py` (aile→kategori→örnek miras) — yeniden yazma.

**Advantage+ gerçeği (docs/api-gercekleri.md):** `advantage_state_info` **salt-okunur** alandır;
değerler `ADVANTAGE_PLUS_SALES / ADVANTAGE_PLUS_APP / ADVANTAGE_PLUS_LEADS / DISABLED`.
MASTER risk 10: bu alan **okunmadan yapısal öneri üretilmez**; Advantage+ durumundaki
Meta Campaign'lerde ad-set-bütçesine geçiş önerilmez — **Meta Campaign bütçesi önceliklidir**.

**Kapsam dışı (bilinçli):** İKK'lar-ARASI kaydırma · otomatik uygulama · bütçe SEVİYESİ
değişikliği önerisi (Meta Campaign bütçesi ↔ Meta Ad Set bütçesi geçişi) · LLM'li skor
(hesap tümüyle deterministik SQL+Python'dur; yorum katmanı aşama 06'nın digest'inde kalır).

## SONUÇ

**Bu aşama bitince:** Bir İKK'da onaylanmış en az bir bütçe kaydırma döngüsü tamamlanmış
(öneri → insan onayı → aşama 07 apply → `decision_log`) ve etkisi sonraki digest'te
önce/sonra karşılaştırmasıyla raporlanır durumda.

## Önkoşullar

Ambar yolu `warehouse.db` varsayıldı; farklıysa `config/settings.yaml`'dan ölç, komutlarda değiştir.

1. **Aşama 07 kapalı:** bu roadmap'in `CHECKLIST.md`'sinde 07 maddeleri işaretli; onay hattı
   uçtan uca çalışır durumda (öneri→onay→apply→`decision_log`).
2. **Kategori-bütçeli en az bir İKK var** — ölç:
   `sqlite3 warehouse.db "SELECT category_id,name FROM internal_campaign_category WHERE budget_definition='category' AND status='active';"`
   → ≥1 satır. Yoksa ✋ İNSAN: kullanıcı Sheets `IC_KAMPANYA_KATEGORILERI`'nde bir İKK'yı
   `budget_definition=category` yapar (sync sonrası yeniden ölç).
3. **≥14 günlük snapshot birikimi** (aşama 06'nın koşu süresi sayılır) — ölç:
   ```sh
   sqlite3 warehouse.db "SELECT m.ik_id, COUNT(DISTINCT s.snapshot_date) AS gun
     FROM metric_snapshot s
     JOIN meta_object_mapping m ON s.meta_level=m.meta_level AND s.meta_id=m.meta_id
     JOIN internal_campaign ik ON ik.ik_id=m.ik_id
     JOIN internal_campaign_category k ON k.category_id=ik.category_id
     WHERE k.budget_definition='category' AND ik.status='active'
     GROUP BY m.ik_id;"
   ```
   → hedef İKK'nın HER aktif İK'sı için `gun ≥ 14`. Birikim eksikse aşama BLOKLANMAZ:
   T08.1–T08.4 sentetik fikstürle ilerler; yalnız T08.5 (canlı döngü) birikimi bekler.
4. ✋ İNSAN: **harcama tavanı başlangıç değerleri** (global + İKK bazlı, günlük). MASTER §10
   soru 7 hâlâ açıksa koşu başında kullanıcıdan alınır; tavansız İKK'da advisor koşmaz (T08.3).

## Task'lar

### T08.1 — Portföy skoru + marjinal verim çekirdeği (`budget_advisor.py`)
**SONUÇ:** `budget_definition='category'` olan bir İKK için İK-bazlı portföy skoru ve son 14 gün
eğiminden marjinal verim tahmini deterministik üretilir (LLM çağrısı yok).
**Subtask'lar:**
1. Metrik envanterini ölç: `sqlite3 warehouse.db "SELECT DISTINCT metric_key FROM metric_snapshot;"`
   — CPL/CPA anahtarı doğrudan yoksa `spend` + lead/purchase action anahtarlarından türet
   (`derived`; ham JSON'dan yeniden türetim kanonu: docs/api-gercekleri.md "Tasarım kancaları").
2. `src/reklamzeka/budget_advisor.py` oluştur: `portfolio_scores(conn, category_id, window_days=14)`
   — İKK'nın aktif İK'ları → `meta_object_mapping` → snapshot agregasyonu; İK başına günlük
   `spend`, hedef metrik (brief `kpi_targets` içinden `metric_key`: CPL/CPA) ve 14 günlük
   EKK (en küçük kareler) doğrusal eğim.
3. Marjinal verim: eğim + son seviye → "ek 1 birim günlük bütçenin beklenen maliyet etkisi"
   sıralaması; saf, yan-etkisiz fonksiyon (test edilebilir), formül docstring'de.
4. Efektif konfig `src/reklamzeka/taxonomy.py` çözücüsüyle okunur; hedef/eşikler brief'ten
   (`brief.kpi_targets`) gelir — sabit kodlanmış aile/İKK adı YASAK (motor veri-körüdür).
5. 14 günden az verili İK → skor `ölçülemedi`; kaydırma hesabına GİRMEZ (tahmin yazılmaz).
**Kabul kriteri (kanıt):** `python -m pytest tests/test_budget_advisor.py -k "portfoy or verim" -q`
→ tümü PASS (sentetik 14 günlük fikstür: bilinen zıt eğimli iki İK → beklenen eğim işaretleri
ve marjinal verim sıralaması; 13 günlük İK → `ölçülemedi`).

### T08.2 — Advantage+ uyum katmanı
**SONUÇ:** `advantage_state_info` okunmadan yapısal öneri üretilemez; Advantage+ durumundaki
Meta Campaign'lerde bütçe diff'i daima Meta Campaign bütçesi seviyesinde kalır.
**Subtask'lar:**
1. Kaynağı ölç: ingest'in `advantage_state_info`'yu yazdığı yeri bul
   (`sqlite3 warehouse.db ".schema"` + `raw_insights.payload` örneği). Okuyucu:
   `advantage_state(conn, meta_campaign_id) -> str | None`.
2. Kural 1 — alan okunamadıysa (`None`): o Meta Campaign için yapısal öneri ÜRETİLMEZ; aynı
   seviyede tutar kaydırması ancak `risk_flags: ["advantage_state_unknown"]` ile üretilebilir
   ve digest'e uyarı düşer. Ingest'e alan ekletmek bu aşamanın işi DEĞİL (04'e iade notu yaz).
3. Kural 2 — değer `ADVANTAGE_PLUS_SALES/APP/LEADS`: diff hedefi Meta Campaign `daily_budget`
   alanıdır; Meta Ad Set bütçesi hedeflenmez, ad-set-bütçesine geçiş önerilmez.
4. Kural 3 — bu aşamada bütçe SEVİYESİ değişikliği hiçbir durumda önerilmez (tek eylem:
   İKK-içi tutar kaydırması); kural kodda tek noktada, testte belgeli.
**Kabul kriteri (kanıt):** `python -m pytest tests/test_budget_advisor.py -k advantage -q`
→ tümü PASS (3 senaryo: `DISABLED` → diff serbest; `ADVANTAGE_PLUS_LEADS` → hedef alan
Meta Campaign `daily_budget`; alan yok → yapısal öneri yok + `advantage_state_unknown` bayrağı).

### T08.3 — Kaydırma diff'i + guardrail'ler
**SONUÇ:** Sıfır-toplamlı İKK-içi kaydırma diff'i (`action_type='budget_shift'`) guardrail'lerden
geçerek üretilir; brief'e bağlanamayan diff üretilmez.
**Subtask'lar:**
1. Diff üretimi: İK bazında `{field:'daily_budget', current, proposed}` + zorunlu
   `rationale = {brief_id, metric_key, threshold, measured}` (`rationale NOT NULL` — brief'siz İK
   diff'e giremez, MASTER §3 katman 8 kanonu). Sıfır-toplam: Σproposed = Σcurrent (İKK bütçesi
   değişmez; İKK'lar-ARASI kaydırma kapsam dışı).
2. `src/reklamzeka/guardrails.py`'ye `assert_budget_shift(diff, caps)` ekle (mevcut
   `GuardrailViolation` kullan): İK başına değişim ≤ ±%50 (MASTER §6 varsayılanı) · günlük
   tavanlar (global + İKK bazlı) aşılırsa ihlal · sıfır-toplam bozulursa ihlal.
3. Tavan konfigi aşama 07'nin `HARCAMA_TAVANLARI` sekmesinden okunur; İKK-bazlı tavan alanı
   yoksa o sekmeye kolon ekle. ✋ İNSAN: başlangıç değerlerini kullanıcı yazar — tavan tanımsız
   İKK'da advisor diff üretmez, digest'e "tavan tanımsız" uyarısı düşer.
4. `expires_at = created_at + 7 gün` (MASTER §6: bayat veriyle yazma yapılmaz).
**Kabul kriteri (kanıt):** `python -m pytest tests/test_guardrails.py -k budget -q` → tümü PASS
(±%50 ihlali, tavan ihlali, sıfır-toplam ihlali → `GuardrailViolation`) ve
`python -m pytest tests/test_budget_advisor.py -k rationale -q` → PASS (brief'siz İK → diff yok).

### T08.4 — Onay hattına teslim + digest etki raporu
**SONUÇ:** Diff'ler aşama 07 kuyruğuna düşer (`change_proposal` + Sheets `ONAY_KUYRUGU` append),
otomatik uygulama YOK; uygulanmış kaydırmanın etkisi sonraki digest'te raporlanır.
**Subtask'lar:**
1. Yazım yolu: aşama 07'nin mevcut öneri-yazım fonksiyonunu KULLAN (yeniden yazma);
   `budget_advisor.py` apply/MCP ÇAĞIRMAZ, `meta_gateway` import etmez.
2. CLI: `python -m reklamzeka.budget_advisor --ikk <category_id> [--dry-run]` — dry-run stdout'a
   İK bazlı `mevcut→önerilen` günlük bütçe tablosu + gerekçe basar, DB/Sheets'e YAZMAZ.
3. Digest ekleme: `status='applied'` budget_shift önerileri için `decision_log.applied_at`
   öncesi/sonrası eşit pencerelerde hedef metrik karşılaştırması → "Bütçe kaydırma etkisi"
   bölümü; pencere verisi yetersizse değer `ölçülemedi` yazılır (tahmin yazılmaz).
4. Kadans: haftalık koşuya advisor eklenir (MASTER §3 katman 11 — haftalık agrega+bütçe+digest).
**Kabul kriteri (kanıt):**
`python -m reklamzeka.budget_advisor --ikk <category_id> --dry-run` → stdout'ta diff tablosu; ardından
`sqlite3 warehouse.db "SELECT COUNT(*) FROM change_proposal WHERE action_type='budget_shift';"`
→ sayı dry-run ÖNCESİYLE AYNI (yazım yok). Gerçek koşu sonrası aynı sorgu → ≥1 `pending` satır
ve `ONAY_KUYRUGU`'nda yeni satır. Ayrıca `rg -n "meta_gateway|apply" src/reklamzeka/budget_advisor.py`
→ boş çıktı (otomatik uygulama yolunun kod düzeyinde yokluğu).

### T08.5 — Canlı döngü: onaylı kaydırma + etki raporu (✋ İNSAN)
**SONUÇ:** Gerçek bir İKK'da en az bir kaydırma diff'i insan tarafından onaylanmış, aşama 07
apply yoluyla uygulanmış ve etkisi sonraki digest'te görünür — aşamanın SONUÇ cümlesi budur.
**Subtask'lar:**
1. Önkoşul 3'teki birikim sorgusunu yeniden ölç (≥14 gün); advisor'ı gerçek İKK'da koş,
   kuyruğa düşen diff'i kullanıcıya sun. ✋ İNSAN: onay/red kararı — sistem adına karar verilmez.
2. Onay → aşama 07 apply hattı uygular (guardrail'ler uygulama anında YENİDEN koşar);
   `decision_log` kaydı düşer (append-only, çift yazım).
3. Sonraki digest koşusunda "Bütçe kaydırma etkisi" bölümünün o `proposal_id` ile dolduğunu
   doğrula; erken pencerede değerler `ölçülemedi` olabilir — bölümün varlığı ve dürüstlüğü esastır.
**Kabul kriteri (kanıt):**
```sh
sqlite3 warehouse.db "SELECT cp.proposal_id, dl.decision, dl.applied_at
  FROM change_proposal cp JOIN decision_log dl ON dl.proposal_id=cp.proposal_id
  WHERE cp.action_type='budget_shift' AND cp.status='applied';"
```
→ ≥1 satır; ve uygulamadan SONRAKİ digest çıktısında "Bütçe kaydırma etkisi" bölümü aynı
`proposal_id` ile mevcut (digest çıktı yolu/log'u kanıt olarak STATE.md'ye yazılır).

## Task checklist

- [ ] T08.1 — Portföy skoru + marjinal verim · kanıt: `pytest -k "portfoy or verim"` → PASS
- [ ] T08.2 — Advantage+ uyum katmanı · kanıt: `pytest -k advantage` → PASS (3 senaryo)
- [ ] T08.3 — Kaydırma diff'i + guardrail'ler · kanıt: `pytest -k budget` + `-k rationale` → PASS
- [ ] T08.4 — Onay hattı + digest etkisi · kanıt: dry-run yazmıyor; gerçek koşu → pending ≥1
- [ ] T08.5 — Canlı döngü (✋ İNSAN) · kanıt: applied budget_shift sorgusu ≥1 + digest bölümü dolu

## Aşama requirements

| id | requirement | doğrulama | delege |
|---|---|---|---|
| R08.1 | Portföy skoru + marjinal verim son-14-gün eğiminden, tümüyle deterministik (LLM yok) | `kanit:hizli` (`pytest -k "portfoy or verim"`) | — |
| R08.2 | `advantage_state_info` okunmadan yapısal öneri yok; A+ Meta Campaign'de ad-set bütçesine geçiş önerilmez | `kanit:hizli` (`pytest -k advantage`) | — |
| R08.3 | Tek diff'te ±%50 sınırı · günlük tavanlar (global+İKK) · sıfır-toplam; İKK'lar-arası kaydırma yok | `kanit:hizli` (`pytest tests/test_guardrails.py -k budget`) | — |
| R08.4 | Otomatik uygulama yok; tek çıkış aşama 07 onay kuyruğu; brief'siz (rationale'siz) öneri üretilmez | `rg -n "meta_gateway\|apply" src/reklamzeka/budget_advisor.py` → boş; `pytest -k rationale` → PASS | — |
| R08.5 | Onaylı kaydırma döngüsü tamam ve etkisi sonraki digest'te raporlu | `kanit:surus` (T08.5 SQL sorgusu + digest bölümü) | ✋ insan onayı |
| R08.6 | Terminoloji disiplini (çıplak terim yok) | `kanit:hizli` (lint) | — |

## Doğrulama (aşama kapanışı)

Üç kademe, her biri KOŞULMUŞ komut + gerçek çıktı yoluyla:

- `kanit:hizli` — birim testler: portföy/eğim, Advantage+ senaryoları, guardrail ihlalleri + lint.
- `kanit:tam` — tüm takım + dry-run uçtan uca kanıtı (yazım yokluğu sayaçla ölçülür, göz kararı değil).
- `kanit:surus` — canlı döngü: onay → apply → `decision_log` → digest etki bölümü. "Derleniyor/test
  geçiyor" SONUÇ kanıtı DEĞİLDİR; aşama ancak `kanit:surus` ile kapanır.

## Efor/maliyet notu

- Kod+test (T08.1–T08.4): tek-ajan, LLM çağrısı yok → token maliyeti ~0; deterministik SQL+Python.
- Asıl maliyet TAKVİM: önkoşuldaki ≥14 gün snapshot birikimi (aşama 06 koşusuyla paralel sayılır)
  ve T08.5'te insan onayı + bir digest kadansı beklemesi (~2–7 gün). Kod bitince aşama açık kalır,
  `kanit:surus` düşene dek kapanmaz — bu bekleme STATE.md'de "açık kalan" olarak ilan edilir.

## Bitirirken (zorunlu)

1. `CHECKLIST.md`'de bu aşamanın maddelerini işaretle.
2. `STATE.md`'ye tur kaydı yaz: tarih · yapılan · kanıt yolları · açık kalan.
