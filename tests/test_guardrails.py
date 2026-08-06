import pytest

from reklamzeka.guardrails import GuardrailViolation, assert_paused_create


def test_create_without_paused_blocked():
    with pytest.raises(GuardrailViolation):
        assert_paused_create("ads_create_entity", {"name": "x"})  # status yok


def test_create_with_active_blocked():
    with pytest.raises(GuardrailViolation):
        assert_paused_create("ads_create_entity", {"status": "ACTIVE"})


def test_create_with_paused_ok():
    assert_paused_create("ads_create_entity", {"status": "PAUSED"})


def test_update_to_active_blocked():
    with pytest.raises(GuardrailViolation):
        assert_paused_create("ads_update_entity", {"status": "ACTIVE"})


def test_update_without_status_ok():
    assert_paused_create("ads_update_entity", {"daily_budget": 40000})
