"""年度 templates ("中華民國○年度…") resolve to the latest published year."""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src"))

from fetch_laws import DGBAS_INDEX, resolve_years, target_names  # noqa: E402


def test_latest_year_wins():
    targets = {"中華民國○年度總決算編製要點": "SET"}
    names = ["中華民國一百十三年度總決算編製要點", "中華民國一百十四年度總決算編製要點",
             "中華民國一百零九年度總決算編製要點", "中華民國一百十四年度總決算附屬單位決算編製要點"]
    assert resolve_years(targets, names) == []
    assert targets == {"中華民國一百十四年度總決算編製要點": "SET"}


def test_reworded_title_and_arabic_year():
    """Several templates per code: the newest year across all of them."""
    targets = {"中央各主管機關○年度概算編製應行注意辦理事項": "CMBE",
               "中央各主管機關編製○年度概算應行注意辦理事項": "CMBE"}
    names = ["中央各主管機關編製112年度概算應行注意辦理事項",
             "中央各主管機關編製一百十五年度概算應行注意辦理事項",
             "中央各主管機關一百十六年度概算編製應行注意辦理事項"]
    resolve_years(targets, names)
    assert targets == {"中央各主管機關一百十六年度概算編製應行注意辦理事項": "CMBE"}


def test_whole_name_only():
    """A notice that merely mentions the name ("…,自即日停止適用。") is not it."""
    targets = {"各機關編製○年度單位預算案應行注意辦理事項": "UBPE"}
    names = ["各機關編製110年度單位預算案應行注意辦理事項",
             "各機關編製111年度單位預算案應行注意辦理事項,自即日停止適用。"]
    resolve_years(targets, names)
    assert targets == {"各機關編製110年度單位預算案應行注意辦理事項": "UBPE"}


def test_unmatched_template_reported():
    targets = {"○年度不存在的要點": "X", "預算法": "BUDGET"}
    assert resolve_years(targets, ["預算法"]) == ["○年度不存在的要點"]
    assert targets == {"預算法": "BUDGET"}


def test_configured_templates_against_dgbas_index():
    with open(DGBAS_INDEX, encoding="utf-8") as f:
        index = json.load(f)
    targets = target_names()
    assert resolve_years(targets, list(index)) == []
    by_code = {code: name for name, code in targets.items()}
    assert by_code["FY2025SET"] == "中華民國一百十四年度總決算編製要點"
    assert by_code["FY2027LCGBPP"] == "中華民國一百十六年度直轄市及縣(市)總預算編製要點"
    assert by_code["CMBE"] == "中央各主管機關一百十六年度概算編製應行注意辦理事項"
    assert by_code["UBPE"] == "各機關一百十六年度單位預算案編製應行注意辦理事項"
    assert by_code["BPRIN"] == "一百十六年度中央及地方政府預算籌編原則"
    assert by_code["LYRES"].startswith("中央政府各機關執行立法院審查中華民國一百十三年度")
