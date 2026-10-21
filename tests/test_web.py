"""Browser tests for the query page (web/index.html), run on the real law data.

Skipped where Playwright is not installed (the Mac mini's update run). The GitHub
deploy job installs it and runs these first, so a broken page is never deployed.
"""

import csv
import functools
import http.server
import io
import json
import os
import re
import shutil
import threading
from urllib.parse import quote

import pytest

sync_api = pytest.importorskip("playwright.sync_api")

WEB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve(directory):
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=directory))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_port}/"


@pytest.fixture(scope="module")
def base_url():
    server, url = serve(WEB)
    yield url
    server.shutdown()


@pytest.fixture(scope="module")
def browser():
    with sync_api.sync_playwright() as p:
        try:
            browser = p.chromium.launch()
        except Exception as e:
            if os.environ.get("CI"):
                raise  # the deploy gate must not pass by skipping
            pytest.skip(f"no browser for Playwright: {e}")
        yield browser
        browser.close()


@pytest.fixture
def page(browser, base_url):
    """A fresh phone-sized page with all laws loaded; fails on any page error."""
    context = browser.new_context(viewport={"width": 390, "height": 800}, service_workers="block",
                                  permissions=["clipboard-read", "clipboard-write"])
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(base_url + "#")
    page.wait_for_selector("details")
    yield page
    context.close()
    assert errors == []


def go(page, query):
    """Same-page navigation, like tapping a link; returns once the view is rendered."""
    page.evaluate("""h => new Promise(done => {
        addEventListener("hashchange", () => setTimeout(done), { once: true });
        location.hash = h;
    })""", quote(query))


def test_layout_keeps_text_and_citations(page):
    """Line breaks, hanging items and marks may restructure an article, never lose
    a character or a citation link."""
    result = page.evaluate("""() => {
        const hrefs = html => {
            const d = document.createElement("div");
            d.innerHTML = html;
            return [d, [...new Set([...d.querySelectorAll("a.cite")].map(a => a.getAttribute("href")))].sort().join()];
        };
        const lost = [], cut = [];
        let items = 0;
        for (const n of nodes.values()) {
            const [laid, laidHrefs] = hrefs(formatText(n));
            if (laid.textContent.replace(/ /g, "") !== n.text.replace(/ /g, "")) lost.push(n.id);
            if (laidHrefs !== hrefs(linkify(n))[1]) cut.push(n.id);
            items += laid.querySelectorAll(".item").length;
        }
        return { articles: nodes.size, lost, cut, items };
    }""")
    assert result["articles"] > 1000
    assert result["lost"] == []
    assert result["cut"] == []
    assert result["items"] > 500  # markers still recognized


def test_items_hang_and_nest(page):
    go(page, "預算法第4條")
    text = page.locator(".card .text").first
    assert text.locator(":scope > .item > .mk").first.inner_text() == "一、"
    assert text.locator(".item .item > .mk").first.inner_text().startswith("（一）")


def test_search_marks_terms_and_carries_them_to_the_article(page):
    go(page, "流用 預備金")
    found = int(re.search(r"找到 (\d+) 條", page.locator("h3").first.inner_text()).group(1))
    assert found > 0
    assert page.locator(".card mark").count() >= found
    hit = page.locator(".hit-head a").first
    assert "?mark=" in hit.get_attribute("href")
    hit.click()
    page.wait_for_selector(".card h2")
    assert page.locator(".card .text mark").count() > 0


def test_marks_cover_every_occurrence(page):
    """Every occurrence of a term is marked in full, in plain text and inside citations."""
    result = page.evaluate("""() => {
        let expected = 0, marked = 0;
        for (const n of nodes.values()) {
            const ranges = hitRanges(n, ["預算", "條"]);  // every citation holds a 條
            const d = document.createElement("div");
            d.innerHTML = formatText(n, null, ranges);
            expected += ranges.reduce((sum, [a, b]) => sum + b - a, 0);
            marked += [...d.querySelectorAll("mark")].reduce((sum, m) => sum + m.textContent.length, 0);
        }
        return { expected, marked };
    }""")
    assert result["expected"] > 1000
    assert result["marked"] == result["expected"]


def test_tai_and_tai_variant_find_the_same(page):
    counts = []
    for query in ("台灣", "臺灣"):
        go(page, query)
        counts.append(page.locator("h3").first.inner_text())
    assert counts[0] == counts[1]
    assert "找到 0 條" not in counts[0]


def test_article_and_full_text_views(page, base_url):
    go(page, "預算法第62條")
    assert page.locator(".card h2").first.inner_text() == "預算法 第 62 條"
    assert page.locator(".card").first.locator("[data-copy]").count() == 1
    go(page, "預算法")
    index = json.load(open(os.path.join(WEB, "laws", "index.json"), encoding="utf-8"))
    count = next(law["count"] for law in index["laws"] if law["code"] == "BUDGET")
    assert page.locator("#full-text .law-article").count() == count
    assert page.locator("#scrubber").is_visible()
    page.evaluate("document.getElementById('a-BUDGET-0062').scrollIntoView()")
    page.wait_for_function("document.querySelector('#scrubber .bubble').textContent.startsWith('第 62 條')")


def test_favourites_export_and_import(page, base_url):
    go(page, "預算法")
    page.locator("#full-text .star").nth(2).click()
    go(page, "")
    group = page.locator(".fav-group").first
    assert "預算法" in group.inner_text() and "第 3 條" in group.inner_text()

    page.once("dialog", lambda d: d.accept())  # "已複製收藏…"
    page.click("[data-fav-io=export]")
    page.wait_for_function("navigator.clipboard.readText().then(t => t.length > 0)")
    exported = page.evaluate("navigator.clipboard.readText()")
    assert exported == "BUDGET-0003"

    page.evaluate("localStorage.clear()")
    page.reload()
    page.wait_for_selector("[data-fav-io=import]")
    dialogs = iter([lambda d: d.accept(exported + " bogus"), lambda d: d.accept()])
    page.on("dialog", lambda d: next(dialogs)(d))
    page.click("[data-fav-io=import]")
    page.wait_for_selector(".fav-group")
    assert "第 3 條" in page.locator(".fav-group").first.inner_text()


def test_update_marks_amended_articles(page):
    """The phone holds an older 預算法 (第 62 條 worded differently, 第 3 條 missing);
    downloading the update marks exactly those two."""
    page.evaluate("""async () => {
        const cache = await caches.open("laws-data");
        const law = await (await cache.match("laws/BUDGET.json")).json();
        law.nodes = law.nodes.filter(n => n.id !== "BUDGET-0003");
        law.nodes.find(n => n.id === "BUDGET-0062").text = "舊條文";
        await cache.put("laws/BUDGET.json", new Response(JSON.stringify(law)));
        const index = await (await cache.match("laws/index.json")).json();
        index.laws.find(l => l.code === "BUDGET").hash = "old";
        await cache.put("laws/index.json", new Response(JSON.stringify(index)));
    }""")
    page.reload()
    page.wait_for_selector("#update-bar:not([hidden])")
    assert "預算法" in page.locator("#update-bar span").inner_text()
    with page.expect_navigation():
        page.click("#update-yes")
    page.wait_for_selector("details")
    stored = page.evaluate("JSON.parse(localStorage.getItem('amended'))")
    assert sorted(a["id"] for a in stored) == ["BUDGET-0003", "BUDGET-0062"]
    assert "預算法 第 62 條" in page.locator("h3:has-text('最近修正') + .card").inner_text()
    go(page, "預算法第62條")
    assert page.locator(".badge.amended").inner_text().startswith("新修正")


def test_attachment_names_link_to_the_original(page):
    result = page.evaluate("""() => {
        let named = 0;
        const unlinked = [];
        for (const n of nodes.values()) {
            const url = lawUrl.get(n.law_code);
            if (!url || !/\\.(pdf|odt)/i.test(n.text)) continue;
            named++;
            const d = document.createElement("div");
            d.innerHTML = formatText(n);
            if (![...d.querySelectorAll("a[target=_blank]")].every(a => a.href === url) ||
                !d.querySelector("a[target=_blank]")) unlinked.push(n.id);
        }
        return { named, unlinked };
    }""")
    assert result["named"] > 0
    assert result["unlinked"] == []


def test_back_button_returns_to_where_a_link_was_followed(page):
    go(page, "預算法")
    assert page.locator("#back").is_hidden() or page.locator("#back").inner_text() == "← 首頁"
    page.evaluate("document.getElementById('a-BUDGET-0033').scrollIntoView()")
    y = page.evaluate("scrollY")
    page.locator("#a-BUDGET-0033 a.cite").first.click()
    page.wait_for_function("document.getElementById('back').textContent === '← 預算法'")
    target = page.evaluate("location.hash")

    page.locator(".hit-head > a").first.click()  # a second hop, to an article citing this one
    page.wait_for_function("document.getElementById('back').textContent.startsWith('← 預算法 第')")
    page.reload()  # the way back survives a reload
    page.wait_for_selector("#back:not([hidden])")
    page.click("#back")
    page.wait_for_function(f"location.hash === {json.dumps(target)}")
    page.click("#back")
    page.wait_for_function("location.hash === '#' + encodeURIComponent('預算法')")
    page.wait_for_function(f"Math.abs(scrollY - {y}) < 2")
    assert page.locator("#full-text").count() == 1


def test_new_version_offers_a_reload(browser, tmp_path):
    """After a deploy the phone first shows its cached page; sw.js fetches the new
    one, notices the difference and the page offers to reload into it."""
    site = tmp_path / "web"
    shutil.copytree(WEB, site)
    server, url = serve(site)
    context = browser.new_context()  # service worker on
    page = context.new_page()
    try:
        page.goto(url + "#")
        page.wait_for_selector("details")
        page.evaluate("navigator.serviceWorker.ready")
        page.reload()  # now answered by the service worker
        page.wait_for_selector("details")
        assert page.evaluate("!!navigator.serviceWorker.controller")
        assert page.locator("#app-update").is_hidden()  # same page: nothing to offer

        index = site / "index.html"
        index.write_text(index.read_text(encoding="utf-8").replace("原始碼</a>", "原始碼</a> v2"), encoding="utf-8")
        later = os.path.getmtime(index) + 60  # the test server's Last-Modified has 1 s resolution
        os.utime(index, (later, later))
        page.reload()
        page.wait_for_selector("#app-update:not([hidden])")
        assert "v2" not in page.locator("footer").inner_text()  # still the cached page
        with page.expect_navigation():
            page.click("#app-reload")
        page.wait_for_selector("details")
        assert "v2" in page.locator("footer").inner_text()
    finally:
        context.close()
        server.shutdown()


def exported_rows(page):
    """Clicks 匯出 and parses the downloaded CSV."""
    with page.expect_download() as download:
        page.click("[data-export]")
    data = open(download.value.path(), encoding="utf-8").read()
    assert data.startswith("﻿")  # so Excel reads the Chinese
    return list(csv.reader(io.StringIO(data[1:])))


def test_export_results_as_csv(page):
    go(page, "流用 預備金")
    found = int(re.search(r"找到 (\d+) 條", page.locator("h3").first.inner_text()).group(1))
    rows = exported_rows(page)
    assert rows[0] == ["法規", "條次", "條文", "連結"]
    assert len(rows) == found + 1
    assert all("流用" in r[2] and "預備金" in r[2] for r in rows[1:])
    assert rows[1][3].endswith("#" + page.locator(".hit-head a").first.get_attribute("href").split("#")[1].split("?")[0])

    go(page, "預算法第62條")
    cited = int(re.search(r"被 (\d+) 條", page.locator(".section-head h3").inner_text()).group(1))
    assert len(exported_rows(page)) == cited + 1

    go(page, "預算法")
    total = page.locator("#full-text .law-article").count()
    assert len(exported_rows(page)) == total + 1
    page.check("#only-cited")
    shown = page.locator("#full-text .law-article.is-cited").count()
    assert 0 < shown < total
    assert len(exported_rows(page)) == shown + 1
