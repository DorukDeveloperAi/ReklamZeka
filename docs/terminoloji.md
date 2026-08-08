# Terminoloji Sözlüğü (KİLİTLİ — MASTER §1)

Bu sözlük LLM prompt şablonlarının başına enjekte edilir; kod tanımlayıcılarına
kadar bağlayıcıdır. Çıplak "kampanya"/"campaign" yasaktır (lint:
`scripts/lint_terminology.py`).

| Kavram | Standart ad | Kod adı |
|---|---|---|
| Stratejik kampanya ailesi (Marka Doktor, Satış, …) | İç Kampanya Ailesi (İKA) | `internal_campaign_family` |
| Aile içi tür/şablon | İç Kampanya Kategorisi (İKK) | `internal_campaign_category` |
| Fiilen koşan örnek | İç Kampanya (İK) | `internal_campaign` |
| İç hedef taksonomisi (bilinirlik/takipçi/lead/satış/hibrit) | Amaç Kapsamı | `goal_scope` |
| Mecra/yerleşim | Mecra | `medium` |
| Sayfa türü / satış hedef varlığı | Sayfa Türü | `page_type` |
| Meta platform nesneleri | Meta Campaign / Meta Ad Set / Meta Ad | `meta_campaign` / `meta_ad_set` / `meta_ad` |
| Meta optimizasyon hedefi (Amaç Kapsamı'ndan AYRI) | Meta Objective | `meta_objective` |
| Hedef beyanı belgesi | Brief | `brief` |
| Amaç kapsamından türeyen ölçüm seti | Rubrik | `rubric` |
| Meta nesnesi ↔ İK bağı | Eşleme Kaydı | `meta_object_mapping` |
| Önerilen yazma işlemi | Değişiklik Önerisi (Diff) | `change_proposal` |
| Onay/red/uygulama kaydı | Karar Günlüğü | `decision_log` |
| Günlük metrik çekimi | Metrik Anlık Görüntüsü | `metric_snapshot` |
| Kullanıcı-tanımlı metin kuralı | Metin Kural Seti | `copy_rule_set` |

Kurallar:
- Bir İK, bir-veya-çok Meta Campaign/Ad Set/Ad'e eşlenebilir; bağ her zaman
  eşleme katmanında (`meta_object_mapping`) açıktır.
- `meta_level` değerleri tam niteliklidir: `meta_campaign | meta_ad_set | meta_ad`.
- Meta'nın kendi araç/alan adlarındaki kaçınılmaz çıplak kullanımlar satıra
  `term-ok` yorumu ile muaf tutulur (yalnız harici adlar için).
