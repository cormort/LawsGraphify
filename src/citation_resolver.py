"""Law Cross-Reference Parser (法規交叉引用解析器)

This module provides functions to parse, normalize, and resolve cross-references
within and between laws. It maps law names and aliases to standard codes,
handles range and list expansions, resolves relative references, extracts sub-refs,
and computes confidence scores and review flags.
"""

import os
import re
import unicodedata

import yaml

# Cache for law aliases config
_aliases_map = None
_sorted_aliases_cache = None
_sorted_aliases_id = None

# Known maximum article numbers for the 4 core laws
LAW_MAX_ARTICLES = {
    "CONST": 175,
    "BUDGET": 102,
    "SETTLE": 31,
    "ACCOUNT": 122,
}

# Words to exclude from suspected law names to avoid false positives
EXCLUDED_LAW_NAMES = {
    "本法", "該法", "前法", "同法", "他法", "此法", "各法", "辦法", "立法", "法律",
    "法規", "司法", "執法", "行政",
    # Additional false-positive patterns from real legal text
    "依法", "表達原則", "下列原則", "原則", "標準", "方案",
    "有違反本法", "違反本法", "準用本法", "用本法",
    "送立法", "履行其他法", "及其他法", "得拒絕之",
    "依下列原則", "為原則", "之原則",
}

# Regex to match suspected law names
SUSPECTED_LAW_PAT = re.compile(
    r"([A-Za-z0-9\u4e00-\u9fa5]{2,30}?(?:法|條例|通則|規程|規則|細則|辦法|綱要|標準"
    r"|準則|要點|注意事項|原則|方案))"
)

# How a document refers to itself
SELF_REF_PAT = re.compile(
    r"本(?:法|條例|辦法|細則|規則|準則|要點|原則|方案|規定|注意事項|應行注意事項|標準|通則)"
)

# Characters that end a law-name scope
SENTENCE_ENDS = "。"

# Citing verbs that precede a law name ("依國家安全法第十條")
LEADING_VERB_PAT = re.compile(
    r"依照|依據|按照|準用|適用|違反|參照|符合|係指|依|指|及|或|與|並|應|得|經|於|由|就|未|按"
)

# Starts that rule out a law title ("本辦法", "同條例", "應…")
NON_LAW_PREFIXES = ("應", "依", "未", "得", "之", "及", "或", "與", "並", "準", "前",
                    "上", "下", "本", "同", "該", "此", "各", "其", "發", "經")

# Main regex to identify article reference segments:
# Group 1 (range): 第X條[之Y]至第?Z條[之W]  (條 or 點: 行政規則 number by 點)
# Group 2 (single): 第X條[之Y] / 第X點
# Group 3 (relative): 前條, 次條, 後條, 前二條, 前N條, 後N條
REF_REGEX = re.compile(
    r"(?P<range>第(?P<r_start_main>[一二三四五六七八九十百千0-9]+)[條點]"
    r"(?:之(?P<r_start_sub>[一二三四五六七八九十0-9]+))?"
    r"\s*至\s*"
    r"第?(?P<r_end_main>[一二三四五六七八九十百千0-9]+)[條點]"
    r"(?:之(?P<r_end_sub>[一二三四五六七八九十0-9]+))?)"
    r"|"
    r"(?P<single>第(?P<s_main>[一二三四五六七八九十百千0-9]+)[條點]"
    r"(?:之(?P<s_sub>[一二三四五六七八九十0-9]+))?)"
    r"|"
    r"(?P<relative>(?P<rel_type>前條|次條|後條|前二條"
    r"|前(?P<rel_count>[一二三四五六七八九十0-9]+)條"
    r"|後(?P<rel_count_post>[一二三四五六七八九十0-9]+)條))"
)

# Sub-reference lookahead pattern (e.g. 第二項, 第一款, 第一目)
SUB_REF_PAT = re.compile(
    r"^((?:第[一二三四五六七八九十0-9]+[項款目])+"
    r"(?:\s*第[一二三四五六七八九十0-9]+[項款目])*)"
)


def load_aliases() -> dict[str, str]:
    """Loads and builds the alias mapping from config/law_aliases.yaml.

    Returns:
        A dictionary mapping lowercase/standard law name to standard law code.
    """
    global _aliases_map
    if _aliases_map is not None:
        return _aliases_map

    _aliases_map = {}
    config_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "config",
        "law_aliases.yaml",
    )
    if not os.path.exists(config_path):
        return _aliases_map

    try:
        with open(config_path, encoding="utf-8") as f:
            data = yaml.safe_load(f)
            if not data or "aliases" not in data:
                return _aliases_map
            
            aliases_data = data["aliases"]
            for key, val in aliases_data.items():
                if isinstance(val, str):
                    # Direct mapping: Name -> Code (e.g., 憲法: CONST)
                    _aliases_map[normalize_text(key)] = val
                    _aliases_map[val] = val  # Code -> Code mapping as well
                elif isinstance(val, list):
                    # List mapping: Code -> [Names] (e.g., BUDGET: [預算法, 預算])
                    for name in val:
                        _aliases_map[normalize_text(name)] = key
                    _aliases_map[key] = key
    except Exception:
        # In case of any read issues, return whatever was built or empty map
        pass

    return _aliases_map


def normalize_text(text: str) -> str:
    """Normalizes full-width alphanumeric characters and spaces to half-width.

    Args:
        text: Input string.

    Returns:
        Normalized string.
    """
    if not text:
        return ""
    # Standard NFKC normalization handles full-width numbers, letters, spaces
    normalized = unicodedata.normalize("NFKC", text)
    # Additionally normalize Chinese full-width commas or dots if needed
    normalized = normalized.replace("，", ",").replace("；", ";")
    return normalized


def chinese_to_arabic(chinese_str: str | None) -> int:
    """Converts a Chinese numeral string to its integer value.

    Args:
        chinese_str: Chinese numeral string (e.g., "六十二", "二十二", "一百一十五").

    Returns:
        The integer value, or 0 if empty or invalid.
    """
    if not chinese_str:
        return 0

    # If it's already an Arabic numeral, convert directly
    if chinese_str.isdigit():
        return int(chinese_str)

    digits = {
        "零": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
        "六": 6, "七": 7, "八": 8, "九": 9, "兩": 2,
        "壹": 1, "貳": 2, "參": 3, "肆": 4, "伍": 5,
        "陸": 6, "柒": 7, "捌": 8, "玖": 9,
    }
    units = {
        "十": 10, "拾": 10, "百": 100, "佰": 100, "千": 1000, "仟": 1000
    }

    # If there are no unit words (e.g., "一二" instead of "十二"), convert sequentially
    has_unit = any(u in chinese_str for u in units)
    if not has_unit:
        val_str = ""
        for char in chinese_str:
            if char in digits:
                val_str += str(digits[char])
            else:
                return 0
        return int(val_str) if val_str else 0

    total = 0
    digit = 0
    for char in chinese_str:
        if char in digits:
            digit = digits[char]
        elif char in units:
            # Bare unit ("十五", "一百十") implies a leading one
            total += (digit or 1) * units[char]
            digit = 0
    total += digit
    return total


def parse_article_no(article_no: int | str | None) -> tuple[int, int | None]:
    """Parses a current article number into a tuple of (main_no, sub_no).

    Args:
        article_no: String or integer representing article number
            (e.g. 62, "62-001", "62之一").

    Returns:
        Tuple of (main_no, sub_no).
    """
    if article_no is None:
        return 0, None
    if isinstance(article_no, int):
        return article_no, None

    # Clean the string
    article_str = normalize_text(str(article_no)).strip()
    
    # Check for formats like "62-001"
    if "-" in article_str:
        parts = article_str.split("-")
        try:
            return int(parts[0]), int(parts[1])
        except ValueError:
            pass

    # Check for Chinese sub-article format like "六十二之一" or "62之一"
    if "之" in article_str:
        parts = article_str.split("之")
        main_part = parts[0]
        sub_part = parts[1]
        
        # Parse main part
        if main_part.isdigit():
            main_no = int(main_part)
        else:
            main_no = chinese_to_arabic(main_part)
            
        # Parse sub part
        if sub_part.isdigit():
            sub_no = int(sub_part)
        else:
            sub_no = chinese_to_arabic(sub_part)
            
        return main_no, sub_no

    # Single number
    if article_str.isdigit():
        return int(article_str), None
    
    # Try Chinese numerals directly
    try:
        return chinese_to_arabic(article_str), None
    except Exception:
        return 0, None


def find_law_name_in_substring(
    sub_text: str, aliases: dict[str, str]
) -> tuple[str | None, str | None, bool]:
    """Searches a substring for the last occurrence of a known alias or
    suspected law name.

    Args:
        sub_text: Substring before the current citation match.
        aliases: Alias mapping dictionary.

    Returns:
        Tuple of (law_code, law_name, is_suspected).
        law_code: resolved code or None if suspected but not in alias map.
        law_name: name matched in text or None.
        is_suspected: True if the name matched but is not in alias map.
    """
    if not sub_text:
        return None, None, False

    # 1. Search for known aliases (longest first to avoid subset matching issues)
    global _sorted_aliases_cache, _sorted_aliases_id
    if _sorted_aliases_cache is None or _sorted_aliases_id is not id(aliases):
        _sorted_aliases_cache = sorted(aliases.keys(), key=len, reverse=True)
        _sorted_aliases_id = id(aliases)
    sorted_aliases = _sorted_aliases_cache
    best_alias = None
    best_idx = -1

    for alias in sorted_aliases:
        # We look for the last occurrence
        idx = sub_text.rfind(alias)
        if idx != -1 and idx > best_idx:
            best_idx = idx
            best_alias = alias

    if best_alias is not None:
        return aliases[best_alias], best_alias, False

    # 2. Unmapped law name directly before the citation ("依國家安全法第十條").
    # Take the trailing run of CJK text and keep what follows the last citing
    # verb; a name buried mid-sentence is almost always prose.
    tail = re.search(r"[A-Za-z0-9\u4e00-\u9fa5]+$", sub_text.rstrip())
    if tail:
        name = LEADING_VERB_PAT.split(tail.group(0))[-1]
        if SUSPECTED_LAW_PAT.fullmatch(name) and name not in EXCLUDED_LAW_NAMES:
            # Real law names never start with a particle or a self/other reference
            if name.startswith(NON_LAW_PREFIXES):
                return None, None, False
            # Multi-char suffixes (原則/標準/方案/要點): minimum total length 5
            if any(name.endswith(s) for s in ("原則", "標準", "方案", "要點")) and len(name) <= 4:
                return None, None, False
            # "之" right before the suffix is a descriptive phrase, not a title
            for s_len in (1, 2, 3, 4):
                if len(name) > s_len and name[-(s_len + 1)] == "之":
                    suffix = name[-s_len:]
                    if any(suffix.endswith(t) for t in ("法", "辦法", "準則", "標準", "原則", "要點", "方案", "事項")):
                        return None, None, False
            # None code: the caller marks the edge unresolved / needs review
            return None, name, False

    return None, None, False


SHORT_NAME_PAT = re.compile(r"\(以下(?:簡稱|稱)([^()]{1,20})\)")


def extract_short_names(text: str) -> dict[str, str]:
    """Finds "<known law>(以下簡稱X)" definitions and maps X to that law's code.

    Only definitions right after a known alias count, so "(以下簡稱各機關)"
    and other non-law abbreviations are ignored.
    """
    aliases = load_aliases()
    normalized = normalize_text(text)
    short_names = {}
    for m in SHORT_NAME_PAT.finditer(normalized):
        before = normalized[:m.start()]
        known = [a for a in aliases if before.endswith(a)]
        if known:
            short_names[m.group(1)] = aliases[max(known, key=len)]
    return short_names


def format_node_id(
    law_code: str | None, main_no: int, sub_no: int | None
) -> str | None:
    """Formats a node ID into the standard format:
    {LAW_CODE}-{main_no:04d}[-{sub_no:03d}].

    Args:
        law_code: The resolved law code (e.g. BUDGET).
        main_no: Main article number.
        sub_no: Sub-article number or None.

    Returns:
        Formatted string or None.
    """
    if not law_code:
        return None
    if sub_no is not None:
        return f"{law_code}-{main_no:04d}-{sub_no:03d}"
    return f"{law_code}-{main_no:04d}"


def parse_citations(
    text: str,
    current_law_code: str,
    current_article_no: int | str | None = None,
    article_order: list[tuple[int, int | None]] | None = None,
    local_aliases: dict[str, str] | None = None,
) -> list[dict]:
    """Parses citation edges from the input text.

    Args:
        text: Input text containing cross-references.
        current_law_code: Law code of the document being parsed (e.g. BUDGET).
        current_article_no: Article number of the document being parsed
            (e.g. 62, "62-001").
        article_order: The current law's articles in order as (main, sub)
            tuples. When given, 前條/次條 resolve to the real neighbours
            (第63條's 前條 is 62之1 if it exists); otherwise they are computed.
        local_aliases: Short names defined elsewhere in the same document
            ("(以下簡稱處理辦法)"), from extract_short_names().

    Returns:
        List of dictionaries representing resolved cross-reference edges.
    """
    if not text:
        return []

    aliases = load_aliases()
    if local_aliases:
        aliases = {**aliases, **local_aliases}
    normalized_text = normalize_text(text)
    
    # Parse current source coordinates
    curr_main_no, curr_sub_no = parse_article_no(current_article_no)
    source_id = format_node_id(current_law_code, curr_main_no, curr_sub_no)

    edges = []
    last_end = 0

    # Context scope variables (carry over to next match)
    active_law_code = current_law_code
    active_law_name = None

    matches = list(REF_REGEX.finditer(normalized_text))
    
    for i, match in enumerate(matches):
        # 1. Scope inheritance: check substring from last match end to current start
        # for law names
        sub_text = normalized_text[last_end:match.start()]

        # A sentence boundary ends the previous law's scope; only names in
        # the new sentence count.
        boundary = max(sub_text.rfind(c) for c in SENTENCE_ENDS)
        if boundary != -1:
            sub_text = sub_text[boundary + 1:]
            active_law_code, active_law_name = current_law_code, None
        resolved_code, law_name, is_suspected = find_law_name_in_substring(
            sub_text, aliases
        )
        
        # "本法" / "本要點" / "本辦法"… after the last named law switches scope
        # back to the current law
        self_idx = max((m.start() for m in SELF_REF_PAT.finditer(sub_text)), default=-1)
        if self_idx != -1 and (law_name is None or self_idx > sub_text.rfind(law_name)):
            resolved_code, law_name = None, None
            active_law_code, active_law_name = current_law_code, None

        if law_name is not None:
            active_law_name = law_name
            # Unmapped suspected name -> None: target unknown, flagged for review
            # (and inherited by "及第X條" until the next named law / 本法)
            active_law_code = resolved_code

        # If no law name is found, active_law_code and active_law_name persist.
        # Check if the text of this match is inheriting a previously explicit
        # name or is standalone.
        curr_has_explicit_name = (law_name is not None)

        # 2. Check for sub-reference lookahead immediately following this match
        match_end = match.end()
        sub_ref = None
        sub_ref_match = SUB_REF_PAT.match(normalized_text[match_end:])
        if sub_ref_match:
            sub_ref = sub_ref_match.group(1)
            # Advance last_end to include sub_ref
            last_end = match_end + sub_ref_match.end()
        else:
            last_end = match_end

        # Check if this match is part of a list/parallel expansion
        is_list_expansion = False
        if i > 0:
            in_between = normalized_text[matches[i - 1].end():match.start()].strip()
            # If the text in between is only list delimiters
            if re.match(r"^[、及或與和，,\s]*$", in_between):
                is_list_expansion = True

        # Process the reference details
        match_dict = match.groupdict()

        # "第X點" only belongs to another law when that law is named right
        # before it ("執行要點第五點"); 條-numbered laws have no 點, so an
        # inherited scope ("依預算法第五十一條…依第二十三點") means this document.
        law_code = active_law_code
        if "點" in match.group(0) and not (
            law_name and sub_text.rstrip().endswith(law_name)
        ):
            law_code, curr_has_explicit_name = current_law_code, False


        if match_dict["range"] is not None:
            # RANGE MATCH
            r_start_main = match_dict["r_start_main"]
            r_start_sub = match_dict["r_start_sub"]
            r_end_main = match_dict["r_end_main"]
            r_end_sub = match_dict["r_end_sub"]

            start_main = chinese_to_arabic(r_start_main)
            start_sub = chinese_to_arabic(r_start_sub) if r_start_sub else None
            end_main = chinese_to_arabic(r_end_main)
            end_sub = chinese_to_arabic(r_end_sub) if r_end_sub else None

            # Generate target list
            targets = []
            if start_main == end_main:
                if start_sub is not None and end_sub is not None:
                    for sub in range(start_sub, end_sub + 1):
                        targets.append((start_main, sub))
                else:
                    targets.append((start_main, None))
            else:
                for m in range(start_main, end_main + 1):
                    if m == start_main:
                        targets.append((m, start_sub))
                    elif m == end_main:
                        targets.append((m, end_sub))
                    else:
                        targets.append((m, None))

            for main_num, sub_num in targets:
                # Target ID
                target_id = format_node_id(law_code, main_num, sub_num)
                
                # Confidence & Needs Review Calculation
                if active_law_name is not None and law_code is None:
                    # Suspected but not in alias map
                    confidence = 0.0
                    needs_review = True
                else:
                    # Range/parallel expansion gets 0.9 confidence, needs_review = False
                    confidence = 0.9
                    needs_review = False

                # External Check
                # If target law is different from current: external=True
                # If target law is same: external=True ONLY if explicitly written
                if law_code != current_law_code:
                    is_external = True
                else:
                    is_external = curr_has_explicit_name or (
                        active_law_name is not None and i == 0
                    )

                edges.append({
                    "source": source_id,
                    "target": target_id,
                    "kind": "absolute",
                    "is_external": is_external,

                    "sub_ref": sub_ref,
                    "confidence": confidence,
                    "needs_review": needs_review,
                })

        elif match_dict["single"] is not None:
            # SINGLE MATCH
            s_main = match_dict["s_main"]
            s_sub = match_dict["s_sub"]

            main_num = chinese_to_arabic(s_main)
            sub_num = chinese_to_arabic(s_sub) if s_sub else None
            
            target_id = format_node_id(law_code, main_num, sub_num)

            # Confidence & Needs Review Calculation
            if active_law_name is not None and law_code is None:
                confidence = 0.0
                needs_review = True
            elif is_list_expansion:
                confidence = 0.9
                needs_review = False
            elif curr_has_explicit_name or (
                active_law_name is not None and not is_list_expansion and i == 0
            ):
                # Explicitly named external or internal law reference
                confidence = 1.0
                needs_review = False
            else:
                # Standalone absolute reference (no explicit law name, e.g. "第十條")
                confidence = 0.95
                needs_review = False

            # External Check
            if law_code != current_law_code:
                is_external = True
            else:
                # If same law: external=True if there is an explicit name match
                # in the prefix
                is_external = curr_has_explicit_name or (
                    active_law_name is not None and i == 0
                )

            edges.append({
                "source": source_id,
                "target": target_id,
                "kind": "absolute",
                "is_external": is_external,
                "sub_ref": sub_ref,
                "confidence": confidence,
                "needs_review": needs_review,
            })

        elif match_dict["relative"] is not None:
            # RELATIVE MATCH
            rel_type = match_dict["rel_type"]
            
            # Resolve relative targets as (main, sub)
            if rel_type == "前條":
                back, fwd = 1, 0
            elif rel_type in ("次條", "後條"):
                back, fwd = 0, 1
            elif rel_type == "前二條":
                back, fwd = 2, 0
            elif match_dict["rel_count"] is not None:
                back, fwd = chinese_to_arabic(match_dict["rel_count"]), 0
            else:
                back, fwd = 0, chinese_to_arabic(match_dict["rel_count_post"])

            # Backwards follows article order: 62之2 -> 62之1 -> 62 -> 61
            targets = []
            main, sub = curr_main_no, curr_sub_no
            for _ in range(back):
                if sub is None:
                    main -= 1
                else:
                    sub = sub - 1 if sub > 1 else None
                targets.append((main, sub))
            # Without article_order, forward from 62之1 assumes 63 (62之2 may
            # exist), so it is flagged for review
            fwd_ambiguous = curr_sub_no is not None
            targets += [(curr_main_no + k, None) for k in range(1, fwd + 1)]

            # Real article list known: take the actual neighbours instead
            pos = None
            if article_order and (curr_main_no, curr_sub_no) in article_order:
                pos = article_order.index((curr_main_no, curr_sub_no))
                offsets = [-k for k in range(1, back + 1)] + list(range(1, fwd + 1))
                fwd_ambiguous = False
                targets = [
                    article_order[pos + off] if 0 <= pos + off < len(article_order)
                    else arith
                    for off, arith in zip(offsets, targets)
                ]
                in_list = [0 <= pos + off < len(article_order) for off in offsets]

            for t_idx, (target_num, target_sub) in enumerate(targets):
                # Check out-of-bounds
                is_out_of_bounds = False
                if pos is not None:
                    is_out_of_bounds = not in_list[t_idx]
                elif target_num <= 0:
                    is_out_of_bounds = True
                elif current_law_code in LAW_MAX_ARTICLES:
                    if target_num > LAW_MAX_ARTICLES[current_law_code]:
                        is_out_of_bounds = True

                # Node formatting
                target_id = format_node_id(
                    current_law_code, target_num, target_sub
                ) if curr_main_no > 0 else None

                # Confidence
                if curr_main_no <= 0 or target_id is None:
                    confidence = 0.0
                    needs_review = True
                elif is_out_of_bounds:
                    confidence = 0.3
                    needs_review = True
                elif fwd and fwd_ambiguous:
                    confidence = 0.7
                    needs_review = True
                else:
                    # Relative references (前條/次條/後條) are deterministic math:
                    # if not out-of-bounds, the reference is valid even if
                    # the target article happens to not be in our dataset
                    confidence = 1.0
                    needs_review = False

                edges.append({
                    "source": source_id,
                    "target": target_id,
                    "kind": "relative",
                    "is_external": False,

                    "sub_ref": sub_ref,
                    "confidence": confidence,
                    "needs_review": needs_review,
                })

    return edges
