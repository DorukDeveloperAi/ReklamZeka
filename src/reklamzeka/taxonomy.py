"""İç Kampanya taksonomisi: Aile → Kategori → Örnek miras/override çözümü.

Motor hiçbir aile adını bilmez; "Marka Doktor" ve "Satış" yalnız veridir.
Efektif konfig her koşuda taze hesaplanır, hiçbir katmanda kopyalanıp donmaz.

Birleştirme kuralları (MASTER §2.3):
- dict'ler derin birleşir, alttaki katman (instance) kazanır
- None değeri üst katmandan gelen anahtarı SİLER
- dict-listeler anahtar bazlı birleşir (öğe kimliği: metric_key | key | id | name)
- skaler listelerde alttaki liste üsttekinin yerini alır
"""

from __future__ import annotations

from typing import Any

_LIST_ITEM_KEYS = ("metric_key", "key", "id", "name")

_DELETED = object()


def _item_key(item: Any) -> Any:
    if isinstance(item, dict):
        for k in _LIST_ITEM_KEYS:
            if k in item:
                return (k, item[k])
    return None


def _merge_lists(base: list, override: list) -> list:
    """dict-listeleri kimlik anahtarına göre birleştirir; kimliksiz listelerde override kazanır."""
    base_keys = [_item_key(i) for i in base]
    over_keys = [_item_key(i) for i in override]
    if not base or not override or None in base_keys or None in over_keys:
        return [i for i in override]

    merged: dict[Any, Any] = {k: v for k, v in zip(base_keys, base)}
    for k, item in zip(over_keys, override):
        if k in merged and isinstance(merged[k], dict) and isinstance(item, dict):
            merged[k] = _deep_merge_two(merged[k], item)
        else:
            merged[k] = item
    result = [v for v in merged.values() if v is not _DELETED]
    return result


def _deep_merge_two(base: dict, override: dict) -> dict:
    out: dict = dict(base)
    for key, value in override.items():
        if value is None:
            out.pop(key, None)
            continue
        if key in out and isinstance(out[key], dict) and isinstance(value, dict):
            out[key] = _deep_merge_two(out[key], value)
        elif key in out and isinstance(out[key], list) and isinstance(value, list):
            out[key] = _merge_lists(out[key], value)
        else:
            out[key] = value
    return out


def deep_merge(*layers: dict | None) -> dict:
    """Katmanları sırayla birleştirir; sonraki katman öncekini override eder.

    Kullanım: deep_merge(family_cfg, category_cfg, instance_cfg)
    """
    result: dict = {}
    for layer in layers:
        if layer:
            result = _deep_merge_two(result, layer)
    return result


def resolve_effective_config(
    family: dict | None,
    category: dict | None,
    instance: dict | None,
) -> dict:
    """Bir İç Kampanyanın efektif konfigürasyonu.

    Girdi: her katmanın konfig sözlüğü (attribute_schema, kpi_targets, rules,
    analysis_logic vb. alanları içerebilir). Katman ayrımı çağıranın işidir
    (Sheets→SQLite cache'ten okunur); bu fonksiyon saf birleştirmedir.
    """
    return deep_merge(family, category, instance)
