"""Fetch the project's laws into data/laws_json/.

Sources, in order:
  1. 法務部全國法規資料庫 open data (法律 + 命令), cached as chlaw.json / chorder.json
  2. 主計總處主管法規共用系統 (law.dgbas.gov.tw) for 行政規則 (要點、注意事項…)
     that the MOJ data does not carry

Usage:
  python3 src/fetch_laws.py            # reuse cached MOJ data
  python3 src/fetch_laws.py --refresh  # re-download MOJ data (what the weekly Action runs)
  python3 src/fetch_laws.py --recrawl  # also rebuild the DGBAS name -> id index
  python3 src/fetch_laws.py --refresh --moj-only  # GitHub Action: DGBAS blocks its servers

DGBAS rule pages are fetched on every run. If one fails (network, bot check),
its previous file is kept and the run carries on, so a flaky site never wipes data.
"""

import argparse
import html
import io
import json
import os
import re
import ssl
import time
import urllib.request
import zipfile

import yaml

from citation_resolver import chinese_to_arabic, normalize_text

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_DIR = os.path.join(BASE_DIR, "data", "laws_json")
DGBAS_INDEX = os.path.join(BASE_DIR, "data", "dgbas_index.json")
META = os.path.join(BASE_DIR, "data", "meta.json")

MOJ_URLS = {
    "chlaw": "https://law.moj.gov.tw/api/ch/law/json",
    "chorder": "https://law.moj.gov.tw/api/ch/order/json",
}
DGBAS = "https://law.dgbas.gov.tw/"
DGBAS_ROOTS = ("100", "200")  # 歲計, 會計

# law.moj.gov.tw's certificate lacks a Subject Key Identifier, which Python
# 3.13+'s strict X.509 mode rejects. Chain and hostname checks stay on.
SSL_CTX = ssl.create_default_context()
SSL_CTX.verify_flags &= ~ssl.VERIFY_X509_STRICT
HEADERS = {"User-Agent": "Mozilla/5.0"}  # DGBAS answers urllib's default UA with 403
DELAY = 1.0  # seconds between DGBAS requests; it is a government site

ROW_PAT = re.compile(r'<td[^>]*class="th"[^>]*>(.*?)</td>\s*<td>(.*?)</td>', re.S)
POINT_PAT = re.compile(r"([一二三四五六七八九十百]+)(?:之([一二三四五六七八九十]+))?、")


class Blocked(RuntimeError):
    """The site answered with a bot check instead of content."""


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, context=SSL_CTX, timeout=180) as resp:
        body = resp.read()
    # Stop rather than work around a Cloudflare bot check
    if b"challenge-platform" in body or b"Just a moment" in body:
        raise Blocked(f"bot check at {url}")
    return body


def clean(text: str) -> str:
    """Strips tags and entities, collapses whitespace."""
    text = html.unescape(re.sub(r"<[^>]+>", " ", text or ""))
    return re.sub(r"\s+", " ", text).strip()


def article_nums(article_no: str) -> tuple[int, int | None]:
    """"第 62-1 條" -> (62, 1); headings / unparseable -> (0, None)."""
    no = clean(article_no).replace("第", "").replace("條", "").strip()
    main, _, sub = no.partition("-")
    if main.isdigit():
        return int(main), int(sub) if sub.isdigit() else None
    return 0, None


YEAR = "○"  # in a target name: the 年度, filled in with the latest one published


def resolve_years(targets: dict[str, str], names) -> list[str]:
    """Replaces each code's "○" names in targets with the published name of the
    latest year among them ("中華民國○年度總決算編製要點" -> "…一百十四年度…").
    Returns the templates that matched nothing."""
    templates = {}
    for name in [n for n in targets if YEAR in n]:
        templates.setdefault(targets.pop(name), []).append(name)
    unmatched = []
    for code, names_of_code in templates.items():
        found = []
        for template in names_of_code:
            head, _, tail = template.partition(YEAR)
            pat = re.compile(re.escape(head) + r"([零一二三四五六七八九十百]+|\d+)" + re.escape(tail) + "$")
            found += [(chinese_to_arabic(m.group(1)), n) for n in names if (m := pat.match(n))]
        if found:
            targets[max(found)[1]] = code
        else:
            unmatched += names_of_code
    return unmatched


def target_names() -> dict[str, str]:
    """Normalized law name -> code, for every alias not marked external or linked."""
    with open(os.path.join(BASE_DIR, "config", "law_aliases.yaml"), encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    external = set(cfg.get("external") or []) | set(cfg.get("links") or {})  # links: elsewhere, not fetched
    names = {}
    for key, val in cfg["aliases"].items():
        pairs = [(key, val)] if isinstance(val, str) else [(n, key) for n in val]
        for name, code in pairs:
            if code not in external:
                names[normalize_text(name)] = code
    return names


def load_moj(refresh: bool) -> tuple[dict[str, dict], str]:
    """Normalized law name -> MOJ law record (法律 wins over 命令 on clashes),
    plus the MOJ data's own update date."""
    laws, updated = {}, ""
    for key, url in MOJ_URLS.items():
        path = os.path.join(BASE_DIR, f"{key}.json")
        if refresh or not os.path.exists(path):
            print(f"Downloading {url} ...")
            with zipfile.ZipFile(io.BytesIO(fetch(url))) as z:
                member = next(n for n in z.namelist() if n.lower().endswith(".json"))
                data = json.loads(z.read(member).decode("utf-8-sig"))
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
        else:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        print(f" {key}: {len(data['Laws'])} laws, updated {data.get('UpdateDate')}")
        updated = updated or str(data.get("UpdateDate", "")).split(" ")[0]  # "2026/6/12 上午 …"
        for law in data["Laws"]:
            laws.setdefault(normalize_text(law["LawName"]), law)
    return laws, updated


def moj_articles(law: dict) -> list[dict]:
    return [
        {"num": main, "sub_num": sub, "zh": art.get("ArticleNo", ""),
         "article": clean(art.get("ArticleContent", ""))}
        for art in law.get("LawArticles", [])
        for main, sub in [article_nums(art.get("ArticleNo", ""))]
    ]


def dgbas_index(recrawl: bool) -> dict[str, str]:
    """Normalized law name -> DGBAS id, crawled from the 歲計/會計 category tree."""
    if not recrawl and os.path.exists(DGBAS_INDEX):
        with open(DGBAS_INDEX, encoding="utf-8") as f:
            return json.load(f)

    print("Crawling DGBAS category index ...")
    index, todo, seen = {}, list(DGBAS_ROOTS), set()
    while todo:
        cid = todo.pop()
        if cid in seen:
            continue
        seen.add(cid)
        page = fetch(f"{DGBAS}LawCategoryMain.aspx?type=M&CategoryID={cid}").decode("utf-8")
        time.sleep(DELAY)
        # Children share the root's leading digit (100 -> 110..170 -> 121..125)
        todo += [c for c in re.findall(r"CategoryID=(\d+)", page) if c[0] == cid[0]]

        for page_no in range(1, 100):
            listing = fetch(f"{DGBAS}LawCategoryContentList.aspx?CategoryID={cid}&page={page_no}")
            found = re.findall(r'LawContent\.aspx\?id=([A-Z]{2}\d+)"[^>]*>(.*?)</a>',
                               listing.decode("utf-8"), re.S)
            new = {normalize_text(clean(name)): law_id for law_id, name in found
                   if normalize_text(clean(name)) not in index}
            if not new:
                break
            index.update(new)
            time.sleep(DELAY)

    with open(DGBAS_INDEX, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
    print(f" {len(index)} laws indexed across {len(seen)} categories")
    return index


def dgbas_articles(law_id: str) -> list[dict]:
    """Rows of LawContent.aspx: "第 N 條" in the header cell, or "一、" 點-style."""
    page = fetch(f"{DGBAS}LawContent.aspx?id={law_id}").decode("utf-8")
    articles = []
    for header, body in ROW_PAT.findall(page):
        zh = clean(header)
        # DGBAS hard-wraps lines with <br>; rejoin CJK text split mid-sentence
        text = re.sub(r"(?<=[^\x00-\x7f])\s+(?=[^\x00-\x7f])", "", clean(body))
        main, sub = article_nums(zh)
        if not zh and (m := POINT_PAT.match(text)):
            # 點 are stored as articles; citation_resolver parses "第X點" too
            main = chinese_to_arabic(m.group(1))
            sub = chinese_to_arabic(m.group(2)) if m.group(2) else None
            zh = f"第 {main}{f'-{sub}' if sub else ''} 點"
        articles.append({"num": main, "sub_num": sub, "zh": zh, "article": text})
    return articles


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--refresh", action="store_true", help="re-download MOJ data")
    parser.add_argument("--recrawl", action="store_true", help="rebuild the DGBAS name -> id index")
    parser.add_argument("--moj-only", action="store_true",
                        help="leave DGBAS files as they are (update_local.sh refreshes them)")
    args = parser.parse_args()

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    targets = target_names()
    moj, moj_updated = load_moj(args.refresh)
    dgbas = None  # loaded only if some target is missing from MOJ
    counts, missing, written, kept = {"moj": 0, "dgbas": 0}, [], set(), []
    if any(YEAR in name for name in targets):
        dgbas = dgbas_index(args.recrawl)
        missing += resolve_years(targets, [*moj, *dgbas])

    done_codes = set()
    for name in sorted(targets):
        if targets[name] in done_codes:
            continue  # another alias of a law already written (憲法 -> 中華民國憲法)
        if name in moj:
            law_name, source, articles = moj[name]["LawName"], "moj", moj_articles(moj[name])
        elif args.moj_only:
            if os.path.exists(os.path.join(OUTPUT_DIR, f"{name}.json")):
                written.add(f"{name}.json")
                done_codes.add(targets[name])
            continue
        else:
            dgbas = dgbas if dgbas is not None else dgbas_index(args.recrawl)
            if name not in dgbas:
                missing.append(name)
                continue
            try:
                law_name, source, articles = name, "dgbas", dgbas_articles(dgbas[name])
            except (OSError, Blocked) as e:  # URLError is an OSError
                # Keep last run's text rather than dropping the law
                if os.path.exists(os.path.join(OUTPUT_DIR, f"{name}.json")):
                    written.add(f"{name}.json")
                    done_codes.add(targets[name])
                    kept.append(f"{name} ({e})")
                else:
                    missing.append(f"{name} (抓取失敗：{e})")
                continue
            finally:
                time.sleep(DELAY)
            if not any(a["num"] for a in articles):
                missing.append(f"{name} (DGBAS 無條文，可能只有附件)")
                continue

        with open(os.path.join(OUTPUT_DIR, f"{law_name}.json"), "w", encoding="utf-8") as f:
            json.dump({"name": law_name, "code": targets[name], "source": source, "content": articles},
                      f, ensure_ascii=False, indent=2)
        counts[source] += 1
        written.add(f"{law_name}.json")
        done_codes.add(targets[name])
        print(f" -> [{source}] {law_name} ({len(articles)} articles)")

    # Drop names whose law was written under another alias
    missing = [n for n in missing if targets.get(n.split(" (")[0]) not in done_codes]
    print(f"\nMOJ: {counts['moj']}, DGBAS: {counts['dgbas']}, not found: {len(missing)}")
    for name in missing:
        print(f"  ✗ {name}")
    if kept:
        print(f"\n{len(kept)} DGBAS law(s) could not be fetched; kept the previous text:")
        for name in kept:
            print(f"  ! {name}")
            if os.environ.get("GITHUB_ACTIONS"):
                print(f"::warning title=DGBAS 抓取失敗，沿用舊條文::{name}")

    with open(META, "w", encoding="utf-8") as f:
        json.dump({"moj_updated": moj_updated, "fetched": time.strftime("%Y-%m-%d")},
                  f, ensure_ascii=False, indent=2)

    # Left over from an earlier run. Last year's version of a law written this run
    # (same code) is replaced; anything else graph_builder would still load, so
    # say so instead of deleting silently
    stale = sorted(set(os.listdir(OUTPUT_DIR)) - written)
    for name in list(stale):
        with open(os.path.join(OUTPUT_DIR, name), encoding="utf-8") as f:
            code = json.load(f).get("code")
        if code in done_codes:
            os.remove(os.path.join(OUTPUT_DIR, name))
            stale.remove(name)
            print(f"  - {name} (superseded by a newer year)")
    if stale:
        print(f"\n{len(stale)} file(s) in {OUTPUT_DIR} are no longer targets; move or delete them:")
        for name in stale:
            print(f"  ? {name}")


if __name__ == "__main__":
    main()
