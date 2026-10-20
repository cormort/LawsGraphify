"""Unit tests for the Law Cross-Reference Parser (test_citation_resolver.py)

This test suite verifies compliance with the specifications and milestones
defined in the implementation plan (T1 to T9).
"""

from src.citation_resolver import (
    chinese_to_arabic,
    normalize_text,
    parse_article_no,
    parse_citations,
)


def test_normalize_text():
    """Test full-width characters and spaces normalization."""
    assert normalize_text("１２３") == "123"
    assert normalize_text("６２之一") == "62之一"
    assert normalize_text("　第十條　") == " 第十條 "
    assert normalize_text("預算法　第六十條") == "預算法 第六十條"


def test_chinese_to_arabic():
    """Test Chinese numerals to Arabic numerals conversion."""
    assert chinese_to_arabic("一") == 1
    assert chinese_to_arabic("十") == 10
    assert chinese_to_arabic("十一") == 11
    assert chinese_to_arabic("二十") == 20
    assert chinese_to_arabic("二十二") == 22
    assert chinese_to_arabic("六十二") == 62
    assert chinese_to_arabic("一百一十五") == 115
    assert chinese_to_arabic("一百零五") == 105
    assert chinese_to_arabic("62") == 62
    assert chinese_to_arabic("") == 0
    assert chinese_to_arabic(None) == 0


def test_parse_article_no():
    """Test helper for parsing source article coordinates."""
    assert parse_article_no(62) == (62, None)
    assert parse_article_no("62") == (62, None)
    assert parse_article_no("62-001") == (62, 1)
    assert parse_article_no("六十二之一") == (62, 1)
    assert parse_article_no("62之一") == (62, 1)


def test_t1_cross_law_list():
    """T1: Cross-law absolute references with list expansion.

    Input: "預算法第六十條及第六十二條"
    Current Law: ACCOUNT, Article: "0010"
    """
    edges = parse_citations("預算法第六十條及第六十二條", "ACCOUNT", "0010")
    assert len(edges) == 2

    # First edge: "預算法第六十條"
    assert edges[0]["source"] == "ACCOUNT-0010"
    assert edges[0]["target"] == "BUDGET-0060"
    assert edges[0]["kind"] == "absolute"
    assert edges[0]["is_external"] is True
    assert edges[0]["sub_ref"] is None
    assert edges[0]["confidence"] == 1.0
    assert edges[0]["needs_review"] is False

    # Second edge: "及第六十二條" (inherits BUDGET)
    assert edges[1]["source"] == "ACCOUNT-0010"
    assert edges[1]["target"] == "BUDGET-0062"
    assert edges[1]["kind"] == "absolute"
    assert edges[1]["is_external"] is True  # BUDGET is external to ACCOUNT
    assert edges[1]["sub_ref"] is None
    assert edges[1]["confidence"] == 0.9  # Part of list expansion
    assert edges[1]["needs_review"] is False


def test_t2_internal_absolute():
    """T2: Internal absolute reference (no law name).

    Input: "第十條"
    Current Law: BUDGET, Article: "0060"
    """
    edges = parse_citations("第十條", "BUDGET", "0060")
    assert len(edges) == 1
    edge = edges[0]
    assert edge["source"] == "BUDGET-0060"
    assert edge["target"] == "BUDGET-0010"
    assert edge["kind"] == "absolute"
    assert edge["is_external"] is False
    assert edge["sub_ref"] is None
    assert edge["confidence"] == 0.95
    assert edge["needs_review"] is False


def test_t3_range_expansion():
    """T3: Range expansion.

    Input: "第六十條至第六十三條"
    Current Law: BUDGET, Article: "0010"
    """
    edges = parse_citations("第六十條至第六十三條", "BUDGET", "0010")
    assert len(edges) == 4
    
    expected_targets = ["BUDGET-0060", "BUDGET-0061", "BUDGET-0062", "BUDGET-0063"]
    for i, target in enumerate(expected_targets):
        assert edges[i]["source"] == "BUDGET-0010"
        assert edges[i]["target"] == target
        assert edges[i]["kind"] == "absolute"
        assert edges[i]["is_external"] is False
        assert edges[i]["confidence"] == 0.9
        assert edges[i]["needs_review"] is False


def test_t4_relative_reference():
    """T4: Relative reference.

    Input: "前條"
    Current Law: BUDGET, Article: 10
    """
    # Computable within bounds
    edges = parse_citations("前條", "BUDGET", 10)
    assert len(edges) == 1
    edge = edges[0]
    assert edge["source"] == "BUDGET-0010"
    assert edge["target"] == "BUDGET-0009"
    assert edge["kind"] == "relative"
    assert edge["is_external"] is False
    assert edge["confidence"] == 1.0
    assert edge["needs_review"] is False

    # Out of bounds (underflow)
    edges_underflow = parse_citations("前條", "BUDGET", 1)
    assert len(edges_underflow) == 1
    assert edges_underflow[0]["target"] == "BUDGET-0000"
    assert edges_underflow[0]["confidence"] == 0.3
    assert edges_underflow[0]["needs_review"] is True

    # Out of bounds (overflow)
    # BUDGET max article is 102. Let's refer to "次條" at 102.
    edges_overflow = parse_citations("次條", "BUDGET", 102)
    assert len(edges_overflow) == 1
    assert edges_overflow[0]["target"] == "BUDGET-0103"
    assert edges_overflow[0]["confidence"] == 0.3
    assert edges_overflow[0]["needs_review"] is True


def test_t5_scope_inheritance():
    """T5: Scope inheritance.

    Input: "會計法第二十一條及第六十條"
    Current Law: ACCOUNT, Article: "0010"
    """
    edges = parse_citations("會計法第二十一條及第六十條", "ACCOUNT", "0010")
    assert len(edges) == 2

    # First: "會計法第二十一條"
    # Explicitly mentions law name, so it is external=True even if target == current
    assert edges[0]["target"] == "ACCOUNT-0021"
    assert edges[0]["is_external"] is True
    assert edges[0]["confidence"] == 1.0

    # Second: "及第六十條"
    # Inherits ACCOUNT, but no explicit law name, target == current -> external=False
    assert edges[1]["target"] == "ACCOUNT-0060"
    assert edges[1]["is_external"] is False
    assert edges[1]["confidence"] == 0.9


def test_t6_sub_article():
    """T6: Sub-article parsing.

    Input: "第六十二條之一"
    Current Law: BUDGET, Article: "0010"
    """
    edges = parse_citations("第六十二條之一", "BUDGET", "0010")
    assert len(edges) == 1
    assert edges[0]["target"] == "BUDGET-0062-001"
    assert edges[0]["confidence"] == 0.95
    assert edges[0]["needs_review"] is False


def test_t7_internal_absolute_subref():
    """T7: Internal absolute reference with paragraph/item details.

    Input: "本法第十條第二項"
    Current Law: BUDGET, Article: "0060"
    """
    edges = parse_citations("本法第十條第二項", "BUDGET", "0060")
    assert len(edges) == 1
    assert edges[0]["target"] == "BUDGET-0010"
    assert edges[0]["sub_ref"] == "第二項"
    assert edges[0]["is_external"] is False
    assert edges[0]["confidence"] == 0.95


def test_t8_within_article_ignored():
    """T8: Within-article relative references ignored.

    Input: "前項所列費用"
    Current Law: BUDGET, Article: "0060"
    """
    edges = parse_citations("前項所列費用", "BUDGET", "0060")
    assert len(edges) == 0


def test_t9_unmapped_suspected_law():
    """T9: Suspected law name not in alias map.

    Input: "國家安全法第十條"
    Current Law: BUDGET, Article: "0060"
    """
    edges = parse_citations("國家安全法第十條", "BUDGET", "0060")
    assert len(edges) == 1
    assert edges[0]["target"] is None
    assert edges[0]["is_external"] is True
    assert edges[0]["confidence"] == 0.0
    assert edges[0]["needs_review"] is True


def test_other_relative_variations():
    """Test multi-article relative references such as 前二條."""
    # Test "前二條" under BUDGET article 10
    edges = parse_citations("前二條", "BUDGET", 10)
    assert len(edges) == 2
    assert edges[0]["target"] == "BUDGET-0009"
    assert edges[1]["target"] == "BUDGET-0008"
    assert edges[0]["kind"] == "relative"
    assert edges[1]["kind"] == "relative"


def test_chinese_numeral_hundred_ten():
    """"一百十" is 110 (Taiwanese legal style omits 一 before 十)."""
    edges = parse_citations("第一百十條", "CONST", 111)
    assert edges[0]["target"] == "CONST-0110"


def test_fullwidth_paren_alias():
    """Aliases with full-width （） must match NFKC-normalized text."""
    edges = parse_citations("中央對直轄市及縣（市）政府補助辦法第三條", "BUDGET", 1)
    assert edges[0]["target"] == "CACGSB-0003"


def test_self_law_resets_scope():
    """"本法" after another law name switches back to the current law."""
    edges = parse_citations("會計法第十條及本法第五條", "BUDGET", 1)
    assert [e["target"] for e in edges] == ["ACCOUNT-0010", "BUDGET-0005"]


def test_relative_stays_in_current_law():
    """"前條" always refers to the current law even after another law is named."""
    edges = parse_citations("依會計法第十條及前條規定", "BUDGET", 20)
    assert edges[1]["target"] == "BUDGET-0019"
    assert edges[1]["is_external"] is False


def test_suspected_name_must_precede_citation():
    """An unmapped "...標準" in mid-sentence prose is not a law name."""
    edges = parse_citations("收入部分暫依上年度標準，覈實收入。但依第八十八條規定辦理", "BUDGET", 54)
    assert edges[0]["target"] == "BUDGET-0088"


def test_suspected_name_after_citing_verb():
    """"依/依照/準用 + 未收錄法規" is still detected as an unmapped law."""
    for text in ("依國家安全法第十條", "並依照國家安全法第十條", "準用國家安全法第十條"):
        edges = parse_citations(text, "BUDGET", 60)
        assert edges[0]["target"] is None and edges[0]["needs_review"] is True
    # "依法" / "依本法" are not law names
    assert parse_citations("依法第十條", "BUDGET", 60)[0]["target"] == "BUDGET-0010"


def test_scope_ends_at_sentence_boundary():
    """A law named in one sentence does not carry into the next."""
    edges = parse_citations("依會計法第十條辦理。前項報告，應依第十一條規定送審。", "BUDGET", 60)
    assert [e["target"] for e in edges] == ["ACCOUNT-0010", "BUDGET-0011"]
    # Within one sentence the scope still carries
    edges = parse_citations("依會計法第十條及第十一條辦理。", "BUDGET", 60)
    assert [e["target"] for e in edges] == ["ACCOUNT-0010", "ACCOUNT-0011"]


def test_relative_from_sub_article():
    """前條 from 第62條之1 is 第62條; from 第62條之2 it is 第62條之1."""
    assert parse_citations("前條", "BUDGET", "62-1")[0]["target"] == "BUDGET-0062"
    assert parse_citations("前條", "BUDGET", "62-2")[0]["target"] == "BUDGET-0062-001"
    targets = [e["target"] for e in parse_citations("前三條", "BUDGET", "62-2")]
    assert targets == ["BUDGET-0062-001", "BUDGET-0062", "BUDGET-0061"]
    # Forward from a sub-article is ambiguous (62之2 may exist) -> review
    edge = parse_citations("次條", "BUDGET", "62-1")[0]
    assert edge["target"] == "BUDGET-0063" and edge["needs_review"] is True


def test_relative_with_article_order():
    """With the real article list, 前條 of 第63條 is 第62條之1 if it exists."""
    order = [(61, None), (62, None), (62, 1), (63, None)]
    assert parse_citations("前條", "BUDGET", 63, order)[0]["target"] == "BUDGET-0062-001"
    targets = [e["target"] for e in parse_citations("前二條", "BUDGET", 63, order)]
    assert targets == ["BUDGET-0062-001", "BUDGET-0062"]
    # Forward from a sub-article is now exact, no review needed
    edge = parse_citations("次條", "BUDGET", "62-1", order)[0]
    assert edge["target"] == "BUDGET-0063" and edge["needs_review"] is False
    edge = parse_citations("次條", "BUDGET", 62, order)[0]
    assert edge["target"] == "BUDGET-0062-001"
    # Past the end of the list -> out of bounds
    edge = parse_citations("次條", "BUDGET", 63, order)[0]
    assert edge["confidence"] == 0.3 and edge["needs_review"] is True


def test_short_name_definitions():
    """"(以下簡稱X)" after a known law name defines X; other abbreviations are ignored."""
    from src.citation_resolver import extract_short_names
    text = "依中央對各級地方政府重大天然災害救災經費處理辦法（以下簡稱處理辦法）及各機關（以下簡稱各機關）"
    short = extract_short_names(text)
    assert short == {"處理辦法": "CNDR"}
    edges = parse_citations("依處理辦法第八條規定", "FDRS", 3, local_aliases=short)
    assert edges[0]["target"] == "CNDR-0008" and edges[0]["needs_review"] is False


def test_unmapped_name_after_other_verbs():
    """"符合/應依/指 + 未收錄法規" must not fall back to the current law."""
    for text in ("符合國家安全法第三十五條", "應依國家安全法第七十八條", "係指國家安全法第三條"):
        edges = parse_citations(text, "BUDGET", 1)
        assert edges[0]["target"] is None and edges[0]["needs_review"] is True, text
    # Self references still resolve to the current law
    assert parse_citations("依本辦法第五條", "BUDGET", 1)[0]["target"] == "BUDGET-0005"


def test_point_citations():
    """行政規則 cite by 點: single, range, with 款, and 本要點 resets scope."""
    assert parse_citations("依第二點第二款辦理", "CACGP", 4)[0]["target"] == "CACGP-0002"
    assert parse_citations("依第二點第二款辦理", "CACGP", 4)[0]["sub_ref"] == "第二款"
    targets = [e["target"] for e in parse_citations("依第十二點至第十四點規定", "SUPE", 23)]
    assert targets == ["SUPE-0012", "SUPE-0013", "SUPE-0014"]
    targets = [e["target"] for e in parse_citations("依預算法第六十二條及本要點第五點", "SUPE", 1)]
    assert targets == ["BUDGET-0062", "SUPE-0005"]


def test_point_not_inherited_from_article_law():
    """"依預算法第五十一條…依第二十三點" -> 第二十三點 is the current 要點's."""
    edges = parse_citations("未能依預算法第五十一條規定期限完成審議時，其預算之執行依第二十三點", "SUPE", 43)
    assert [e["target"] for e in edges] == ["BUDGET-0051", "SUPE-0023"]
    assert edges[1]["is_external"] is False
    # Named right before -> that rule's point
    assert parse_citations("依各機關單位預算執行要點第五點", "BDA", 4)[0]["target"] == "MOPE-0005"
