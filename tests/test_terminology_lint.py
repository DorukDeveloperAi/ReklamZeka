import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

spec = importlib.util.spec_from_file_location(
    "lint_terminology", ROOT / "scripts" / "lint_terminology.py"
)
lint = importlib.util.module_from_spec(spec)
sys.modules["lint_terminology"] = lint
spec.loader.exec_module(lint)

# çıplak kelimeyi bu dosyada geçirmemek için parçalı kur
BARE_EN = "camp" + "aign"
BARE_TR = "kamp" + "anya"


def test_repo_is_clean():
    assert lint.main(ROOT) == 0


def test_detects_bare_usage(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    (src / "bad.py").write_text(f"x = '{BARE_EN} listesi'\n", encoding="utf-8")
    assert lint.main(tmp_path) == 1


def test_detects_bare_turkish(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    (src / "bad.py").write_text(f"# {BARE_TR} raporu\n", encoding="utf-8")
    assert lint.main(tmp_path) == 1


def test_qualified_and_waived_ok(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    (src / "good.py").write_text(
        "a = 'internal_campaign_family'\n"
        "b = 'meta_campaign'\n"
        "c = 'İç Kampanya Ailesi'\n"
        f"d = 'ads_create_{BARE_EN}'  # term-ok: Meta araç adı\n",
        encoding="utf-8",
    )
    assert lint.main(tmp_path) == 0
