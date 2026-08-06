# ReklamZeka

Brief-temelli, kontrol-öncelikli Meta reklam yardımcı ajanı (Doruk Sağlık Grubu).
AI vardır ama otonom değildir: **her yazma işlemi insan onayından geçer**, yeni
Meta nesneleri açıkça PAUSED üretilir, brief'e bağlanamayan öneri üretilmez.

- **Plan (kanon):** `plans/reklamzeka-sistemi/v1/MASTER.md` — terminoloji, veri
  modeli, mimari, fazlar. Durum: `plans/reklamzeka-sistemi/v1/STATE.md`.
- **Terminoloji kilidi:** `docs/terminoloji.md` · lint: `python scripts/lint_terminology.py`
- **API gerçekleri + Faz 0 doğrulama listesi:** `docs/api-gercekleri.md`

## Yapı

```
src/reklamzeka/
  taxonomy.py       # Aile→Kategori→Örnek miras/override çözümü (dikey-agnostik motor)
  schema.py         # SQLite ambar (warehouse.db) DDL
  sheets_schema.py  # Google Sheets kanon sekme/kolon tanımları
  meta_gateway.py   # resmî Meta Ads MCP tek geçiş noktası (değiştirilebilir arka uç)
  guardrails.py     # ACTIVE-create engeli + (Faz 2) tavanlar/dry-run
config/rubrics/     # amaç kapsamı başına düzenlenebilir rubrik varsayılanları
scripts/            # lint + (Faz 1) cadence scriptleri
docs/               # terminoloji, API gerçekleri, MCP envanteri
```

## Kurulum

```sh
pip install -e ".[dev]"          # + [mcp] [sheets] [panel] gerektikçe
pytest                            # birim testleri
python scripts/lint_terminology.py
```

Faz 0 kullanıcı adımları: resmî Meta Ads MCP OAuth bağlantısı (interaktif) ve
Google Sheets kimlik bilgisi — bkz. `plans/reklamzeka-sistemi/v1/STATE.md`.
