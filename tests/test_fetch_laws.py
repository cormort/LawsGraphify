"""年度 templates ("中華民國○年度…") resolve to the latest published year."""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src"))

from fetch_laws import DGBAS_INDEX, dgbas_dates, fund_targets, moj_dates, resolve_years, target_names  # noqa: E402


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


def test_fund_regulations_found_with_stable_codes():
    moj = {"住宅基金收支保管及運用辦法": {"LawName": "住宅基金收支保管及運用辦法"},
           "預算法": {"LawName": "預算法"}}
    codes = fund_targets(moj)
    assert list(codes) == ["住宅基金收支保管及運用辦法"]
    # Same code as when the 82 were first listed by hand, so favourites keep working
    assert codes["住宅基金收支保管及運用辦法"] == "F" + __import__("hashlib").sha1(
        "住宅基金收支保管及運用辦法".encode()).hexdigest()[:6].upper()


def test_dates():
    law = {"LawHistories": "1.中華民國二十一年九月二十四日國民政府制定公布全文\r\n2.中華民國一百十年六月九日總統令修正公布",
           "LawModifiedDate": "20210609"}
    assert moj_dates(law) == {"published": "1932-09-24", "amended": "2021-06-09"}
    assert moj_dates({**law, "LawAbandonNote": "廢"}) == {"published": "1932-09-24"}
    page = "<td>公發布日：</td><td> 民國 100 年 03 月 29 日</td> 修正日期： 民國 110 年 05 月 07 日 系統更新日期： 114.12.30"
    assert dgbas_dates(page) == {"published": "2011-03-29", "amended": "2021-05-07"}
