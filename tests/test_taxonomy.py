from reklamzeka.taxonomy import deep_merge, resolve_effective_config


def test_instance_overrides_category_and_family():
    family = {"kpi_targets": {"cpl": 100}, "analysis_logic_ref": "aile"}
    category = {"kpi_targets": {"cpl": 80}}
    instance = {"kpi_targets": {"cpl": 60}}
    cfg = resolve_effective_config(family, category, instance)
    assert cfg["kpi_targets"]["cpl"] == 60
    assert cfg["analysis_logic_ref"] == "aile"  # üstten miras


def test_null_deletes_inherited_key():
    family = {"rules": {"yorum_kapat": True, "uyari_metni": "x"}}
    category = {"rules": {"uyari_metni": None}}
    cfg = resolve_effective_config(family, category, None)
    assert "uyari_metni" not in cfg["rules"]
    assert cfg["rules"]["yorum_kapat"] is True


def test_dict_lists_merge_by_key():
    family = {"metrics": [
        {"metric_key": "reach", "weight": 0.5},
        {"metric_key": "cpm", "weight": 0.5},
    ]}
    category = {"metrics": [
        {"metric_key": "cpm", "weight": 0.3},          # override
        {"metric_key": "frequency", "weight": 0.2},    # ekleme
    ]}
    cfg = resolve_effective_config(family, category, None)
    by_key = {m["metric_key"]: m for m in cfg["metrics"]}
    assert set(by_key) == {"reach", "cpm", "frequency"}
    assert by_key["cpm"]["weight"] == 0.3


def test_scalar_lists_replaced_by_lower_layer():
    family = {"medium": ["ig_feed"]}
    category = {"medium": ["ig_feed", "ig_story"]}
    cfg = resolve_effective_config(family, category, None)
    assert cfg["medium"] == ["ig_feed", "ig_story"]


def test_empty_layers_ok():
    assert resolve_effective_config(None, None, None) == {}
    assert deep_merge({"a": 1}) == {"a": 1}
