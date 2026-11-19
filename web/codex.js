/* 歲計會計隨身法典 — Main Application Logic */

let nodes = new Map();      // id -> node
let incoming = new Map();   // target id -> [edge]
let outgoing = new Map();   // source id -> [edge]
let lawOrder = new Map();   // code -> [article ids in order]
let laws = [];              // [{code, name, kind, count, ...}]
let lawByCode = new Map();  // code -> law
let fundCodeSet = new Set();
let citerCountMap = new Map(); // target id -> unique citing source count
let links = new Map();      // code -> {code, name, url}: external link only
let categories = {};        // tab -> group -> [code]
let lawCategoryMap = new Map(); // code -> {tab, group}
let lawUrl = new Map();     // code -> DGBAS page
let nameToCode = {};        // normalized name -> code
let codeToName = {};        // code -> display name
let sortedNames = [];       // names, longest first

// hash -> scrollY, restored on back; capped at 100 entries
let savedPositions = [];
try { savedPositions = JSON.parse(sessionStorage.getItem("scroll")) || []; } catch (e) {}
const scrollPositions = new Map(savedPositions.slice(-100));

const MAX_RESULTS = 200;
let exportable = null;      // current view's articles: {name, ids()}
let currentScope = null;    // {type: "law"|"section", code?, section?, prefix, label}
let currentSearch = null;   // active search result state for facet filtering
const EXPORT_BUTTON = `<button class="tool" type="button" data-export>匯出</button>`;
const PRINT_BUTTON = `<button class="tool" type="button" data-print aria-label="友善列印">列印</button>`;

const store = {
    get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (e) { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} },
};

const sessionStore = {
    get(key, fallback) { try { return JSON.parse(sessionStorage.getItem(key)) ?? fallback; } catch (e) { return fallback; } },
    set(key, value) { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch (e) {} },
};

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
}

function safeDecode(value) {
    try { return decodeURIComponent(value); } catch { return value; }
}

// Toast feedback
let toastTimer = null;
function showToast(msg) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

// "六十二" / "一百十" / "62" -> number
function toNumber(s) {
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    const digits = { 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    const units = { 十: 10, 百: 100, 千: 1000 };
    let total = 0, digit = 0;
    for (const ch of s) {
        if (ch in digits) digit = digits[ch];
        else if (ch in units) { total += (digit || 1) * units[ch]; digit = 0; }
    }
    return total + digit;
}

function nodeId(code, main, sub) {
    return `${code}-${String(main).padStart(4, "0")}` + (sub ? `-${String(sub).padStart(3, "0")}` : "");
}

function articleLabel(id) {
    const node = nodes.get(id);
    if (node) return node.article_zh;
    const [, main, sub] = id.match(/-(\d{4})(?:-(\d{3}))?$/) || [];
    return main ? `第 ${+main}${sub ? "-" + +sub : ""} 條` : id;
}

function lawName(code) { return codeToName[code] || code; }
function codeOf(id) { return id.replace(/-\d{4}(-\d{3})?$/, ""); }
function unit(code) { return nodes.get(lawOrder.get(code)?.[0])?.article_zh.includes("點") ? "點" : "條"; }
function citerCount(id) { return citerCountMap.get(id) || 0; }
function label(id) { return /-\d{4}/.test(id) ? `${lawName(codeOf(id))} ${articleLabel(id)}` : lawName(id); }
function link(id, text) { return `<a href="#${encodeURIComponent(id)}">${escapeHtml(text ?? label(id))}</a>`; }
function known(id) { return nodes.has(id) || lawOrder.has(id); }

function kindBadgeLabel(kind) {
    if (kind === "憲法與法律") return "法律";
    if (kind === "廢止") return "已廢止";
    return kind || "";
}

const NUM = "[0-9零一二三四五六七八九十百千兩]+";
const ARTICLE_PAT = new RegExp(`^第?(${NUM})[條點]?(?:[之\\-](${NUM}))?[條點]?$`);
const TRAILING_ART_PAT = new RegExp(`^(.*?)\\s*(第?(${NUM})[條點]?(?:[之\\-](${NUM}))?[條點]?)$`);

function parseQuery(raw) {
    const text = raw.normalize("NFKC").replace(/台/g, "臺").trim();
    if (!text) return null;
    const compact = text.replace(/\s+/g, "");
    if (text === "其他") return { type: "tab", tab: "其他" };
    const sec = text.match(/^(基金|廢止專區)(?:專區)?(?:\s+(.*))?$/);
    if (sec && sec[2]) {
        const pick = k => sec[2].match(new RegExp(`(?:^|\\s)${k}:(\\S+)`))?.[1] || "";
        const rest = sec[2].replace(/(?:^|\s)(?:類別|主管):\S+/g, " ").trim();
        return { type: "search", code: null, section: sec[1], fundType: pick("類別"), owner: pick("主管"), termsRaw: rest, ...terms(rest) };
    }
    if (sec) return { type: "section", section: sec[1] };
    const direct = compact.toUpperCase().match(/^([A-Z0-9]+)-(\d{1,4})(?:-(\d{1,3}))?$/);
    if (direct && codeToName[direct[1]]) {
        return { type: "article", code: direct[1], main: +direct[2], sub: direct[3] ? +direct[3] : null };
    }
    const name = sortedNames.find(n => compact.includes(n));
    if (!name) return { type: "search", code: null, termsRaw: text, ...terms(text) };

    const code = nameToCode[name];
    const rest = (text.includes(name) ? text.replace(name, " ") : compact.replace(name, " ")).trim();
    if (!rest) return { type: "law", code };
    const m = rest.replace(/\s+/g, "").match(ARTICLE_PAT);
    if (m) return { type: "article", code, main: toNumber(m[1]), sub: m[2] ? toNumber(m[2]) : null };
    return { type: "search", code, termsRaw: rest, ...terms(rest) };
}

const SECTIONS = {
    "基金": {
        kind: "特種基金", title: "基金收支保管規定專區", where: "基金規定",
        note: n => `${n} 部：各特種基金的收支保管及運用辦法，以及由法律直接規範的基金之法律與管理辦法。`,
        topics: ["來源", "用途", "管理會", "預算", "會計", "決算", "賸餘", "結束"],
        short: l => l.name.replace(/收支保管及運用辦法$/, ""),
    },
    "廢止專區": {
        kind: "廢止", title: "廢止法規專區", where: "已廢止的規定",
        note: n => `${n} 部已廢止的規定，依廢止日期由新到舊排列，僅供查考；一般搜尋與「被引用」不含這些。`,
        topics: [],
        short: l => `${l.name}（${rocDate(l.abolished)}廢止）`,
        sort: (a, b) => (b.abolished || "").localeCompare(a.abolished || ""),
    },
};

// code -> [基金類別, 主管機關]
const FUND_META = {"F707E80":["特別收入基金","總統府"],"FB1F205":["作業基金","內政部"],"FC07CDC":["特別收入基金","經濟部"],"FB683F8":["作業基金","交通部"],"FE72DE0":["作業基金","內政部"],"FC05DB6":["特別收入基金","行政院"],"FDC5BA5":["特別收入基金","經濟部"],"F5DEE95":["作業基金","勞動部"],"F7A91EB":["作業基金","原住民族委員會"],"F8A811F":["作業基金","原住民族委員會"],"FD2FE67":["特別收入基金","公平交易委員會"],"F041CF5":["特別收入基金","內政部"],"NPFR":["作業基金","衛生福利部"],"FB0637C":["作業基金","教育部"],"F4A9FEE":["作業基金","文化部"],"F7D7130":["作業基金","教育部"],"F798890":["作業基金","教育部"],"FD9B3AF":["資本計畫基金","國防部"],"FB908BE":["作業基金","國防部"],"F2D7DFC":["作業基金","國防部"],"F427F75":["作業基金","國軍退除役官兵輔導委員會"],"FBF44BD":["特別收入基金","環境部"],"FBE8AA9":["特別收入基金","教育部"],"FD9F7CA":["特別收入基金","衛生福利部"],"FAEC86A":["作業基金","內政部"],"F052F0E":["特別收入基金","勞動部"],"F9677D5":["特別收入基金","經濟部"],"FD6887A":["作業基金","國立故宮博物院"],"FF85C45":["特別收入基金","文化部"],"F81B77C":["特別收入基金","內政部"],"FB9F93A":["作業基金","內政部"],"FC9FC37":["特別收入基金","國家通訊傳播委員會"],"FB2D9A7":["特別收入基金","農業部"],"FE45EC5":["特別收入基金","核能安全委員會"],"FE1DB80":["特別收入基金","經濟部"],"FD109BD":["作業基金","國軍退除役官兵輔導委員會"],"F880F5F":["特別收入基金","法務部"],"F25F454":["特別收入基金","環境部"],"F271D89":["作業基金","經濟部"],"FD1B6CD":["作業基金","法務部"],"F5A37E8":["特別收入基金","海洋委員會"],"F87A541":["特別收入基金","環境部"],"F99BA92":["特別收入基金","農業部"],"F01B160":["作業基金","內政部"],"F05D7C4":["特別收入基金","環境部"],"FFC0841":["特別收入基金","環境部"],"F988E0A":["作業基金","經濟部"],"FD15BBA":["特別收入基金","經濟部"],"F6C9D55":["特別收入基金","內政部"],"FA5E1D8":["特別收入基金","教育部"],"FBB4228":["作業基金","國家科學及技術委員會"],"F94F090":["作業基金","經濟部"],"F334F96":["特別收入基金","環境部"],"F0B008A":["作業基金","衛生福利部"],"F500CF7":["作業基金","經濟部"],"FBB7DFD":["特別收入基金","經濟部"],"F0C017D":["作業基金","考試院考選部"],"F760681":["特別收入基金","經濟部"],"F5FD380":["特別收入基金","交通部"],"F4623BA":["特別收入基金","行政院"],"FE7B886":["特別收入基金","衛生福利部"],"F3DFC6F":["作業基金","行政院"],"F48E8E6":["特別收入基金","行政院"],"FBED6C2":["特別收入基金","衛生福利部"],"FE5DFA5":["特別收入基金","環境部"],"F192A4B":["特別收入基金","環境部"],"FD7F279":["作業基金","農業部"],"FA43C4C":["特別收入基金","農業部"],"F6BE2A6":["特別收入基金","農業部"],"F395409":["特別收入基金","農業部"],"FEE28F2":["特別收入基金","農業部"],"F950FF8":["作業基金","農業部"],"F140C7F":["特別收入基金","國家通訊傳播委員會"],"FC7BD0C":["特別收入基金","運動部"],"F82C061":["特別收入基金","衛生福利部"],"FDBF048":["作業基金","衛生福利部"],"FBA5022":["特別收入基金","金融監督管理委員會"],"FD14EAA":["特別收入基金","行政院"],"F20C49D":["債務基金","財政部"],"F7B0EDB":["作業基金","衛生福利部"],"NPA":["作業基金","衛生福利部"],"NUSFR":["作業基金","教育部"],"NUSFA":["作業基金","教育部"],"NDMUF":["作業基金","國防部"],"MEA":["作業基金","國防部"],"NSHSFA":["作業基金","教育部"],"MOEIFA":["作業基金","教育部"],"PFCSFA":["特別收入基金","內政部"],"PFCSFR":["特別收入基金","內政部"]};
const FUND_TYPES = ["作業基金", "特別收入基金", "債務基金", "資本計畫基金"];
const lawDate = code => { const l = lawByCode.get(code); return l?.amended || l?.published || ""; };
const newestFirst = (a, b) => lawDate(b).localeCompare(lawDate(a));
const FUND_KIND = SECTIONS["基金"].kind, ABOLISHED_KIND = SECTIONS["廢止專區"].kind;

function rocDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return y ? `民國 ${y - 1911} 年 ${m} 月 ${d} 日` : iso;
}

function abolishedNote(code) {
    const date = lawByCode.get(code)?.abolished;
    return date ? `<p class="warn">本規定已於${rocDate(date)}廢止，僅供查考。</p>` : "";
}

function lawDates(code) {
    const law = lawByCode.get(code) || {};
    const parts = [law.published && `發布 ${rocDate(law.published)}`, law.amended && `最新修正 ${rocDate(law.amended)}`].filter(Boolean);
    return parts.length ? `<p class="muted">${parts.join(" · ")}</p>` : "";
}

function terms(text) {
    const words = text.split(/\s+/).filter(Boolean);
    return {
        include: words.filter(w => !w.startsWith("-")),
        exclude: words.filter(w => w.startsWith("-") && w.length > 1).map(w => w.slice(1)),
    };
}

function hitRanges(node, words) {
    const ranges = [];
    for (const w of words.filter(Boolean)) {
        for (let i = node.norm.indexOf(w); i >= 0; i = node.norm.indexOf(w, i + w.length)) ranges.push([i, i + w.length]);
    }
    return ranges.sort((x, y) => x[0] - y[0]);
}

function marked(text, a, b, ranges) {
    let html = "", pos = a;
    for (const [s, e] of ranges) {
        const from = Math.max(s, pos), to = Math.min(e, b);
        if (from >= to) continue;
        html += escapeHtml(text.slice(pos, from)) + `<mark>${escapeHtml(text.slice(from, to))}</mark>`;
        pos = to;
    }
    return html + escapeHtml(text.slice(pos, b));
}

function linkify(node, focusId, ranges = [], from = 0, to = (node.text || "").length) {
    const text = node.text || "";
    const bySpan = new Map();
    for (const e of outgoing.get(node.id) || []) {
        for (const [a, b] of e.spans || []) {
            const key = `${a},${b}`;
            if (!bySpan.has(key)) bySpan.set(key, { a, b, targets: [] });
            bySpan.get(key).targets.push(e.target);
        }
    }
    const url = lawUrl.get(node.law_code);
    if (url) {
        for (const m of text.matchAll(/[^\s，。；：、]+?\.(?:pdf|odt|ods|docx?|xlsx?)/gi)) {
            bySpan.set(`${m.index},file`, { a: m.index, b: m.index + m[0].length, targets: [], url });
        }
    }
    let html = "", pos = from;
    for (let { a, b, targets, url: fileUrl } of [...bySpan.values()].sort((x, y) => x.a - y.a)) {
        a = Math.max(a, from);
        b = Math.min(b, to);
        if (a < pos || a >= b) continue;
        html += marked(text, pos, a, ranges);
        const words = marked(text, a, b, ranges);
        const knownTargets = targets.filter(Boolean);
        if (fileUrl) {
            html += `<a class="cite" href="${escapeHtml(fileUrl)}" target="_blank" rel="noopener" title="附件請到主計總處原文頁下載">${words}</a>`;
        } else if (!knownTargets.length) {
            html += `<span class="cite-unresolved" title="引用的法規未收錄">${words}</span>`;
        } else {
            const title = knownTargets.map(label).join("、");
            const focus = focusId && knownTargets.includes(focusId) ? " focus" : "";
            html += `<a class="cite${focus}" href="#${encodeURIComponent(knownTargets[0])}" title="${escapeHtml(title)}">${words}</a>`;
        }
        pos = b;
    }
    return html + marked(text, pos, to, ranges);
}

const MARKERS = [
    ["cn", /^[一二三四五六七八九十百]+、/],
    ["cnp", /^\([一二三四五六七八九十百]+\)/],
    ["num", /^\d+ ?[、.](?!\d)/],
    ["nump", /^\(\d+\)/],
    ["gan", /^[甲乙丙丁戊己庚辛壬癸][、.]/],
];

function marker(s) {
    for (const [type, re] of MARKERS) {
        const m = s.match(re);
        if (m) return { type, length: m[0].length };
    }
    return null;
}

function lines(norm) {
    const latin = c => /[A-Za-z0-9]/.test(c || "");
    const out = [];
    let start = 0;
    for (let i = 1; i < norm.length; i++) {
        if (norm[i] === " " && (marker(norm.slice(i + 1)) || /\.(?:pdf|odt|ods|docx?|xlsx?)$/i.test(norm.slice(start, i))
                || !(latin(norm[i - 1]) || latin(norm[i + 1])))) {
            out.push([start, i]);
            start = i + 1;
        } else if (/[。:;︰]/.test(norm[i - 1]) && marker(norm.slice(i))) {
            out.push([start, i]);
            start = i;
        }
    }
    out.push([start, norm.length]);
    return out.filter(([a, b]) => a < b);
}

function formatText(node, focusId, ranges = []) {
    let html = "";
    const open = [];
    const close = depth => { while (open.length > depth) { open.pop(); html += "</div></div>"; } };
    for (const [a, b] of lines(node.norm)) {
        const m = marker(node.norm.slice(a, b));
        if (!m) {
            if (!/^\S+\.(?:pdf|odt|ods|docx?|xlsx?)$/i.test(node.norm.slice(a, b))) close(0);
            html += `<div class="para">${linkify(node, focusId, ranges, a, b)}</div>`;
            continue;
        }
        const level = open.indexOf(m.type);
        close(level >= 0 ? level : open.length);
        open.push(m.type);
        html += `<div class="item"><span class="mk">${linkify(node, focusId, ranges, a, a + m.length)}</span>`
            + `<div class="body">${linkify(node, focusId, ranges, a + m.length, b)}`;
    }
    close(0);
    return html;
}

function starButton(id, favs = store.get("favs", [])) {
    const on = favs.includes(id);
    return `<button class="star" type="button" data-fav="${escapeHtml(id)}" aria-pressed="${on}"
        aria-label="${on ? "取消收藏" : "加入收藏"}">${on ? "★" : "☆"}</button>`;
}

function copyButton(id) {
    return `<button class="tool ghost" type="button" data-copy="${escapeHtml(id)}">複製</button>`;
}

function edgeBadges(edges) {
    const subRefs = [...new Set(edges.map(e => e.sub_ref).filter(Boolean))];
    const badges = subRefs.map(s => `<span class="badge">${escapeHtml(s)}</span>`);
    if (edges.some(e => e.kind === "relative")) badges.push(`<span class="badge">相對引用</span>`);
    const review = edges.filter(e => e.needs_review);
    if (review.length) {
        const pct = Math.round(Math.min(...review.map(e => e.confidence)) * 100);
        badges.push(`<span class="badge review">需複核 ${pct}%</span>`);
    }
    return badges.join("");
}

function groupBySource(edges) {
    const groups = new Map();
    edges.forEach(e => groups.set(e.source, [...(groups.get(e.source) || []), e]));
    return [...groups.values()];
}

const AMENDED_DAYS = 60;
function amended() {
    const since = new Date(Date.now() - AMENDED_DAYS * 864e5).toLocaleDateString("sv");
    return store.get("amended", []).filter(a => a.date >= since && known(a.id));
}

function amendedBadge(id, list) {
    const a = list.find(x => x.id === id);
    return a ? `<span class="badge amended" title="${escapeHtml(a.date)} 下載更新時有修正">新修正 ${escapeHtml(a.date.slice(5).replace("-", "/"))}</span>` : "";
}

function rememberRecent(id) {
    const recents = store.get("recents", []).filter(x => x !== id);
    store.set("recents", [id, ...recents].slice(0, 10));
}

function updateFavBadge() {
    const badge = document.getElementById("fav-badge");
    if (!badge) return;
    const count = store.get("favs", []).filter(known).length;
    badge.textContent = count;
    badge.hidden = count === 0;
}

// --- Favourites & CSV Export ---

function renderFavs(favs, withRemove = false) {
    const groups = new Map();
    for (const id of favs) {
        const code = /-\d{4}/.test(id) ? codeOf(id) : id;
        if (!groups.has(code)) groups.set(code, []);
        if (id !== code) groups.get(code).push(id);
    }
    return `<div class="card">${[...groups].map(([code, ids]) => {
        const hasWhole = favs.includes(code);
        const rmWhole = withRemove && hasWhole ? `<button type="button" class="fav-rm" data-fav-remove="${escapeHtml(code)}" aria-label="移除收藏 ${escapeHtml(lawName(code))}">×</button>` : "";
        return `<div class="fav-group"><div class="fav-group-head">${link(code, lawName(code))}${rmWhole}</div>
            ${ids.length ? `<div class="badges">${ids.sort().map(id => withRemove
                ? `<span class="fav-chip-wrap"><a class="badge" href="#${encodeURIComponent(id)}">${escapeHtml(articleLabel(id))}</a><button type="button" class="fav-rm" data-fav-remove="${escapeHtml(id)}" aria-label="移除收藏 ${escapeHtml(label(id))}">×</button></span>`
                : `<a class="badge" href="#${encodeURIComponent(id)}">${escapeHtml(articleLabel(id))}</a>`).join("")}</div>` : ""}</div>`;
    }).join("")}</div>`;
}

async function exportView() {
    if (!exportable) return;
    const { name, ids } = exportable;
    const page = location.href.split("#")[0];
    const rows = [["法規", "條次", "條文", "連結"],
        ...ids().map(id => { const n = nodes.get(id); return n ? [n.law_name, n.article_zh, n.text, `${page}#${id}`] : null; }).filter(Boolean)];
    const csv = "\ufeff" + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const file = new File([csv], `${name.replace(/[\\/:*?"<>|]/g, "_")}.csv`, { type: "text/csv" });
    if (matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
        try {
            await navigator.share({ files: [file] });
            return;
        } catch (e) {
            if (e.name === "AbortError") return;
        }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function citation(node) {
    const zh = node.article_zh.replace(/\s/g, "");
    const [, n, sub, u] = zh.match(/^第(\d+)(?:-(\d+))?([條點])$/) || [];
    return node.law_name + (n ? `第${n}${u}${sub ? "之" + sub : ""}` : zh);
}

async function copyArticle(button) {
    const node = nodes.get(button.dataset.copy);
    if (!node) return;
    const text = `${citation(node)}：${node.text}`;
    try {
        await navigator.clipboard.writeText(text);
        button.textContent = "已複製";
        showToast("已複製公文引用格式");
        setTimeout(() => { button.textContent = "複製"; }, 1500);
    } catch {
        prompt("複製下面這段文字：", text);
    }
}

async function copyArticleLink(id) {
    const url = location.href.split("#")[0] + "#" + encodeURIComponent(id);
    try {
        await navigator.clipboard.writeText(url);
        showToast("已複製條文連結");
    } catch {
        prompt("複製連結：", url);
    }
}

// --- Read Aloud (Web Speech API) ---

const speech = window.speechSynthesis;
let speaking = null;  // {ids, i, utterance}
const RATES = [0.75, 1, 1.25, 1.5, 2];
let rate = store.get("speechRate", 1);
let cachedVoices = speech ? speech.getVoices() : [];
if (speech && "onvoiceschanged" in speech) {
    speech.onvoiceschanged = () => { cachedVoices = speech.getVoices(); };
}

function speakButton(id) {
    return speech ? `<button class="tool ghost" type="button" data-speak="${escapeHtml(id)}">朗讀</button>` : "";
}

function showSpeaking() {
    const id = speaking?.ids[speaking.i];
    document.querySelectorAll("[data-speak]").forEach(b => { b.textContent = b.dataset.speak === id ? "停止" : "朗讀"; });
    document.querySelectorAll("[data-speak-all]").forEach(b => { b.textContent = speaking ? "停止朗讀" : "朗讀全文"; });
    document.querySelector(".law-article.speaking")?.classList.remove("speaking");
    if (id) document.getElementById("a-" + id)?.classList.add("speaking");

    const bar = document.getElementById("speech-bar");
    if (!bar) return;
    if (!speaking || !id) {
        bar.hidden = true;
        document.body.classList.remove("has-speech");
        return;
    }
    bar.hidden = false;
    document.body.classList.add("has-speech");
    document.getElementById("speech-title").textContent = `🔊 ${label(id)}`;
    document.getElementById("speech-progress").textContent = speaking.ids.length > 1
        ? `第 ${speaking.i + 1} / ${speaking.ids.length} 條` : "單條朗讀中";
    document.getElementById("speech-prev").disabled = speaking.i <= 0;
    document.getElementById("speech-next").disabled = speaking.i >= speaking.ids.length - 1;
}

function stopSpeaking() {
    if (!speaking) return;
    speaking = null;
    speech?.cancel();
    showSpeaking();
}

function speak(ids, startIndex = 0) {
    if (!speech || !ids.length) return;
    speech.cancel();
    const run = speaking = { ids, i: startIndex, parts: [] };
    const voices = cachedVoices.length ? cachedVoices : speech.getVoices();
    const voice = voices.find(v => /^zh[-_]TW/i.test(v.lang));
    const next = () => {
        if (speaking !== run) return;
        if (run.i >= ids.length) return stopSpeaking();
        const node = nodes.get(ids[run.i]);
        if (!node) { run.i++; return next(); }
        showSpeaking();
        document.getElementById("a-" + node.id)?.scrollIntoView({ block: "nearest" });
        const text = `${run.i ? node.article_zh : label(node.id)}。${node.text}`;
        const sentences = text.match(/[^。；]+[。；]?/g) || [text];
        say(sentences, 0);
    };
    const say = (sentences, j) => {
        if (speaking !== run) return;
        if (j >= sentences.length) { run.i++; return next(); }
        const u = run.utterance = new SpeechSynthesisUtterance(sentences[j]);
        u.lang = "zh-TW";
        if (voice) u.voice = voice;
        u.rate = rate;
        u.onend = () => say(sentences, j + 1);
        u.onerror = () => { if (speaking === run) stopSpeaking(); };
        speech.speak(u);
    };
    next();
}

function showRate() {
    const rateBtn = document.getElementById("rate-btn");
    const pill = document.getElementById("speech-rate-pill");
    if (rateBtn) rateBtn.textContent = `🔊 ${rate}×`;
    if (pill) pill.textContent = `${rate}×`;
    document.querySelectorAll(".rate-pill").forEach(btn => {
        btn.setAttribute("aria-pressed", String(Number(btn.dataset.rate) === rate));
    });
}

function setRate(newRate) {
    rate = newRate;
    store.set("speechRate", rate);
    showRate();
}

(function initRateControls() {
    const rateRow = document.getElementById("rate-row");
    const rateBtn = document.getElementById("rate-btn");
    const pills = document.getElementById("rate-pills");
    if (!speech) {
        if (rateRow) rateRow.hidden = true;
        return;
    }
    if (pills) {
        pills.innerHTML = RATES.map(r => `<button class="rate-pill" type="button" data-rate="${r}" aria-pressed="${r === rate}">${r}×</button>`).join("");
    }
    showRate();
    rateBtn?.addEventListener("click", () => setRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length]));
    document.getElementById("speech-rate-pill")?.addEventListener("click", () => setRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length]));
    document.getElementById("speech-stop")?.addEventListener("click", stopSpeaking);
    document.getElementById("speech-prev")?.addEventListener("click", () => {
        if (speaking && speaking.i > 0) speak(speaking.ids, speaking.i - 1);
    });
    document.getElementById("speech-next")?.addEventListener("click", () => {
        if (speaking && speaking.i < speaking.ids.length - 1) speak(speaking.ids, speaking.i + 1);
    });
})();

// --- Favorites Backup / Restore Modal ---

const favModal = document.getElementById("fav-modal");
const favImportText = document.getElementById("fav-import-text");
const favImportPreview = document.getElementById("fav-import-preview");
const favImportConfirm = document.getElementById("fav-import-confirm");
let favModalMode = "import";

function parseFavInput(raw) {
    const favs = store.get("favs", []);
    const valid = [...new Set(raw.normalize("NFKC").trim().split(/[\s,]+/).filter(Boolean))].filter(known);
    const added = valid.filter(id => !favs.includes(id));
    return { valid, added };
}

async function exportFavs() {
    const text = store.get("favs", []).join(" ");
    if (!text) { showToast("目前沒有任何收藏"); return; }
    try {
        await navigator.clipboard.writeText(text);
        showToast("已複製收藏代碼，可貼到備忘錄保存");
    } catch {
        favModalMode = "export";
        document.getElementById("fav-modal-title").textContent = "匯出收藏備份";
        document.getElementById("fav-modal-desc").textContent = "複製下方代碼保存到備忘錄；換手機或資料被清除時，可用「匯入」貼回。";
        favImportText.value = text;
        favImportText.readOnly = true;
        favImportPreview.textContent = "";
        favImportConfirm.hidden = true;
        favModal.showModal();
        favImportText.select();
    }
}

function importFavs() {
    favModalMode = "import";
    document.getElementById("fav-modal-title").textContent = "匯入收藏備份";
    document.getElementById("fav-modal-desc").textContent = "貼上之前匯出的收藏代碼（以空白或逗號分隔）：";
    favImportText.readOnly = false;
    favImportText.value = "";
    favImportPreview.textContent = "等待貼上代碼…";
    favImportConfirm.hidden = false;
    favImportConfirm.disabled = true;
    favModal.showModal();
    favImportText.focus();
}

favImportText?.addEventListener("input", () => {
    if (favModalMode !== "import") return;
    const { valid, added } = parseFavInput(favImportText.value);
    if (!favImportText.value.trim()) {
        favImportPreview.textContent = "等待貼上代碼…";
        favImportConfirm.disabled = true;
    } else if (!valid.length) {
        favImportPreview.textContent = "找不到符合的法規或條文代碼。";
        favImportConfirm.disabled = true;
    } else {
        favImportPreview.textContent = `辨識到 ${valid.length} 筆有效項目（其中 ${added.length} 筆為新收藏）。`;
        favImportConfirm.disabled = false;
    }
});

favImportConfirm?.addEventListener("click", () => {
    const { added } = parseFavInput(favImportText.value);
    const favs = store.get("favs", []);
    store.set("favs", [...favs, ...added]);
    favModal.close();
    updateFavBadge();
    showToast(`已匯入 ${added.length} 筆收藏`);
    runFromHash();
    if (!document.getElementById("saved-drawer").hidden) renderDrawer();
});

document.getElementById("fav-modal-cancel")?.addEventListener("click", () => favModal.close());

// --- Saved Drawer (Bookmarks + Recents) ---

let activeDrawerTab = "fav";
const savedDrawer = document.getElementById("saved-drawer");
const drawerBackdrop = document.getElementById("drawer-backdrop");
const drawerBtn = document.getElementById("drawer-btn");

function renderDrawer() {
    const favs = store.get("favs", []).filter(known);
    const recents = store.get("recents", []).filter(known);
    const body = document.getElementById("drawer-body");
    const footer = document.getElementById("drawer-footer");
    document.querySelectorAll("[data-drawer-tab]").forEach(btn => {
        const on = btn.dataset.drawerTab === activeDrawerTab;
        btn.setAttribute("aria-selected", String(on));
        btn.setAttribute("aria-pressed", String(on));
        btn.textContent = btn.dataset.drawerTab === "fav" ? `★ 收藏 (${favs.length})` : `🕘 最近查看 (${recents.length})`;
    });
    if (activeDrawerTab === "fav") {
        body.innerHTML = favs.length ? renderFavs(favs, true)
            : `<p class="empty">還沒有收藏。點擊法規或條文旁的 ☆ 即可加入，存在本機瀏覽器。</p>`;
        footer.innerHTML = `${favs.length ? `<button class="tool" type="button" data-fav-io="export">匯出代碼</button>` : ""}
            <button class="tool" type="button" data-fav-io="import">匯入備份</button>`;
    } else {
        body.innerHTML = recents.length
            ? `<div class="card list">${recents.map(id => `<a href="#${encodeURIComponent(id)}"><span class="row-title">${escapeHtml(label(id))}</span><span class="count">開啟 →</span></a>`).join("")}</div>`
            : `<p class="empty">尚未瀏覽任何法規或條文。</p>`;
        footer.innerHTML = recents.length
            ? `<button class="tool" type="button" id="clear-recents">清除瀏覽紀錄</button>` : "";
    }
}

function openDrawer(tab = activeDrawerTab) {
    activeDrawerTab = tab;
    closePrefsMenu();
    renderDrawer();
    drawerBackdrop.hidden = false;
    savedDrawer.hidden = false;
    drawerBtn.setAttribute("aria-expanded", "true");
}

function closeDrawer() {
    savedDrawer.hidden = true;
    drawerBackdrop.hidden = true;
    drawerBtn.setAttribute("aria-expanded", "false");
}

drawerBtn?.addEventListener("click", () => savedDrawer.hidden ? openDrawer() : closeDrawer());
document.getElementById("drawer-close")?.addEventListener("click", closeDrawer);
drawerBackdrop?.addEventListener("click", closeDrawer);
savedDrawer?.addEventListener("click", e => {
    const tabBtn = e.target.closest("[data-drawer-tab]");
    if (tabBtn) { activeDrawerTab = tabBtn.dataset.drawerTab; renderDrawer(); return; }
    if (e.target.closest("a")) closeDrawer();
});

// --- Preferences Popover ---

const prefsBtn = document.getElementById("prefs-btn");
const prefsMenu = document.getElementById("prefs-menu");

function syncThemeUI() {
    const theme = store.get("theme", null) || "auto";
    document.querySelectorAll("[data-theme-opt]").forEach(btn => {
        btn.setAttribute("aria-pressed", String(btn.dataset.themeOpt === theme));
    });
    const fs = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--fs")) || 17;
    const disp = document.getElementById("font-display");
    if (disp) disp.textContent = `${Math.round(fs)}px`;
}

function closePrefsMenu() {
    if (!prefsMenu) return;
    prefsMenu.hidden = true;
    prefsBtn?.setAttribute("aria-expanded", "false");
}

prefsBtn?.addEventListener("click", e => {
    e.stopPropagation();
    const opening = prefsMenu.hidden;
    if (opening) {
        closeDrawer();
        syncThemeUI();
        prefsMenu.hidden = false;
        prefsBtn.setAttribute("aria-expanded", "true");
    } else {
        closePrefsMenu();
    }
});

// --- Views ---

function originalLink(l) {
    return `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener"><span class="row-main"><span class="row-title">${escapeHtml(l.name)}</span><span class="meta-pill">外部原文</span></span><span class="count">原文 ↗</span></a>`;
}

function renderSection(key) {
    const sec = SECTIONS[key], list = laws.filter(l => l.kind === sec.kind);
    list.sort(sec.sort || ((a, b) => newestFirst(a.code, b.code)));
    const owners = [...new Set(Object.values(FUND_META).map(m => m[1]))].sort((a, b) => a.localeCompare(b, "zh-Hant"));
    const abolishedCount = laws.filter(l => l.kind === ABOLISHED_KIND).length;
    const topAction = key === "基金"
        ? `<a class="tool subtle-link" href="#${encodeURIComponent("廢止專區")}">廢止法規（${abolishedCount}）→</a>`
        : `<a class="tool subtle-link" href="#${encodeURIComponent("基金")}">← 返回現行收支辦法</a>`;
    const filterBar = key !== "基金" ? `<form class="section-search" data-section="${escapeHtml(key)}" hidden></form>` : `<form class="section-search" data-section="${escapeHtml(key)}">
        <select name="t" aria-label="基金類別"><option value="">全部基金類別</option>${FUND_TYPES.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("")}</select>
        <select name="o" aria-label="主管機關"><option value="">全部主管機關</option>${owners.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("")}</select>
        <select name="topic" aria-label="常用條文主題快搜"><option value="">常用主題快搜…</option>${sec.topics.map(t => `<option value="${escapeHtml(t)}">搜「${escapeHtml(t)}」條文</option>`).join("")}</select>
        <button type="button" class="tool" id="section-reset" hidden>重設</button>
    </form>`;
    return `<div class="title-row"><div><h2>${escapeHtml(sec.title)}</h2><p class="muted">${escapeHtml(sec.note(list.length))}</p></div>${topAction}</div>
        ${filterBar}
        <h3 id="section-heading">${escapeHtml(sec.where)}（<span id="section-count">${list.length}</span>）</h3>
        <div class="card list" id="section-list">${list.map(l => {
            const meta = FUND_META[l.code];
            const pills = meta ? `<span class="meta-pill">${escapeHtml(meta[0])}</span><span class="meta-pill">${escapeHtml(meta[1])}</span>` : "";
            const searchKey = `${l.name} ${sec.short(l)} ${meta ? meta.join(" ") : ""} ${l.code}`.normalize("NFKC").replace(/台/g, "臺");
            return `<a href="#${encodeURIComponent(l.code)}" data-t="${escapeHtml(meta?.[0] || "")}" data-o="${escapeHtml(meta?.[1] || "")}" data-search="${escapeHtml(searchKey)}">
                <span class="row-main"><span class="row-title">${escapeHtml(sec.short(l))}</span>${pills}</span>
                <span class="count">${escapeHtml(l.amended || l.published || "")} · ${l.count} ${unit(l.code)}</span></a>`;
        }).join("")}</div>
        <div class="card empty-inline" id="section-empty" hidden>沒有符合篩選條件的${escapeHtml(sec.where)}。<button type="button" class="tool" id="section-empty-reset">重設篩選</button></div>
        ${key === "基金" ? `<div class="card list"><a href="#${encodeURIComponent("廢止專區")}"><span class="row-main"><span class="row-title">${escapeHtml(SECTIONS["廢止專區"].title)} →</span></span><span class="count">${abolishedCount} 部</span></a></div>` : ""}`;
}

function applySectionFilters(f = document.querySelector(".section-search"), changedEl = null) {
    if (!f) return 0;
    const key = f.dataset.section;
    if (f.t && f.o && changedEl === f.t) {
        const keep = f.o.value;
        const owners = [...new Set(Object.values(FUND_META).filter(m => !f.t.value || m[0] === f.t.value).map(m => m[1]))]
            .sort((a, b) => a.localeCompare(b, "zh-Hant"));
        f.o.innerHTML = `<option value="">全部主管機關</option>` + owners.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("");
        f.o.value = owners.includes(keep) ? keep : "";
    }
    if (f.topic && changedEl === f.topic && f.topic.value) {
        const topic = f.topic.value;
        f.topic.value = "";
        location.hash = encodeURIComponent(key + filterTokens(f) + " " + topic);
        return 0;
    }
    const t = f.t?.value || "", o = f.o?.value || "", rawN = document.getElementById("q")?.value || "";
    const saved = sessionStore.get("sectionFilters", {});
    saved[key] = { t, o, n: rawN };
    sessionStore.set("sectionFilters", saved);

    const words = rawN.normalize("NFKC").replace(/台/g, "臺").split(/\s+/).filter(Boolean);
    const items = [...document.querySelectorAll("#section-list a")];
    let shown = 0;
    items.forEach(a => {
        const hay = a.dataset.search || a.querySelector(".row-title")?.textContent || a.textContent;
        const hide = !words.every(w => hay.includes(w)) || (!!t && a.dataset.t !== t) || (!!o && a.dataset.o !== o);
        a.hidden = hide;
        if (!hide) shown++;
    });

    const countEl = document.getElementById("section-count");
    if (countEl) countEl.textContent = (shown === items.length) ? `${items.length}` : `${shown} / ${items.length}`;
    const listCard = document.getElementById("section-list");
    const emptyCard = document.getElementById("section-empty");
    if (listCard) listCard.hidden = shown === 0;
    if (emptyCard) emptyCard.hidden = shown > 0;
    const resetBtn = document.getElementById("section-reset");
    if (resetBtn) resetBtn.hidden = !t && !o && !rawN.trim();

    if (currentScope && currentScope.type === "section" && currentScope.section === key) {
        currentScope.prefix = key + filterTokens(f);
    }
    return shown;
}

function restoreSectionFilters() {
    const f = document.querySelector(".section-search");
    if (!f) return;
    const saved = sessionStore.get("sectionFilters", {})[f.dataset.section];
    if (!saved) return;
    if (f.t && saved.t) f.t.value = saved.t;
    applySectionFilters(f, f.t);
    if (f.o && saved.o) f.o.value = saved.o;
    if (saved.n) {
        const input = document.getElementById("q");
        const clearBtn = document.getElementById("q-clear");
        if (input) input.value = saved.n;
        if (clearBtn) clearBtn.hidden = !saved.n;
    }
    applySectionFilters(f);
}

function renderGroups(tab) {
    const order = codes => codes.filter(c => lawByCode.has(c) || links.has(c)).sort(newestFirst);
    const byLevel = store.get("groupBy", "topic") === "level";
    let groups = Object.entries(categories[tab] || {}).map(([group, codes]) => [group, order(codes)]);
    if (byLevel) {
        const all = order(groups.flatMap(([, codes]) => codes));
        groups = [...new Set(all.map(c => lawByCode.get(c)?.kind || "沒有收錄條文，連到原文"))]
            .map(level => [level, all.filter(c => (lawByCode.get(c)?.kind || "沒有收錄條文，連到原文") === level)]);
    }
    groups = groups.filter(([, codes]) => codes.length);
    const total = groups.reduce((n, [, codes]) => n + codes.length, 0);
    const anyCollapsed = groups.some(([, codes]) => codes.length > 5);
    const toggle = ["topic", "level"].map(by => `<button class="tool" type="button" data-group-by="${by}" aria-pressed="${byLevel === (by === "level")}">${by === "level" ? "依層級" : "依主題"}</button>`).join("");

    return `<div id="groups" data-tab="${escapeHtml(tab)}">
        <div class="section-head">
            <h3>${escapeHtml(tab)}（<span id="groups-count" data-total="${total}">${total}</span> 部）</h3>
            <div class="tools">
                ${toggle}
                <button class="tool" type="button" id="toggle-all-groups" data-state="${anyCollapsed ? "expand" : "collapse"}">${anyCollapsed ? "全部展開" : "全部收合"}</button>
            </div>
        </div>
        ${groups.map(([group, codes]) => {
            return `<details class="card" data-group="${escapeHtml(group)}"${codes.length > 5 ? "" : " open"}><summary>${escapeHtml(group)}（<span class="grp-count">${codes.length}</span>）</summary>
                <div class="list">${codes.map(c => {
                    const law = lawByCode.get(c);
                    if (!law) return originalLink(links.get(c));
                    const kLabel = kindBadgeLabel(law.kind);
                    return `<a href="#${encodeURIComponent(c)}"><span class="row-main"><span class="row-title">${escapeHtml(law.name)}</span><span class="meta-pill">${escapeHtml(kLabel)}</span></span><span class="count">${escapeHtml(lawDate(c))} · ${law.count} ${unit(c)}</span></a>`;
                }).join("")}</div></details>`;
        }).join("")}
        <div class="card empty-inline" id="groups-empty" hidden>本頁沒有符合名稱的法規，可按 Enter 搜尋全部條文。</div>
    </div>`;
}

function applyGroupFilter(raw = document.getElementById("q")?.value || "") {
    const groupsEl = document.getElementById("groups");
    if (!groupsEl) return 0;
    const words = raw.normalize("NFKC").replace(/台/g, "臺").trim().split(/\s+/).filter(Boolean);
    let totalShown = 0;
    groupsEl.querySelectorAll("details").forEach(d => {
        let grpShown = 0;
        d.querySelectorAll(".list a").forEach(a => {
            const title = (a.querySelector(".row-title")?.textContent || a.textContent).normalize("NFKC").replace(/台/g, "臺");
            const ok = words.every(w => title.includes(w));
            a.hidden = !ok;
            if (ok) grpShown++;
        });
        const cntEl = d.querySelector(".grp-count");
        if (cntEl) cntEl.textContent = grpShown;
        d.hidden = grpShown === 0;
        if (words.length && grpShown > 0) d.open = true;
        totalShown += grpShown;
    });
    const countSpan = document.getElementById("groups-count");
    if (countSpan) {
        const total = Number(countSpan.dataset.total) || totalShown;
        countSpan.textContent = (!words.length || totalShown === total) ? `${total}` : `${totalShown} / ${total}`;
    }
    const emptyEl = document.getElementById("groups-empty");
    if (emptyEl) emptyEl.hidden = totalShown > 0;
    return totalShown;
}

function renderHome() {
    const favs = store.get("favs", []).filter(known);
    const recents = store.get("recents", []).filter(known);
    const changes = amended();
    let html = `<p class="muted intro-line">點選法規閱讀全文，條文中的引用可直接點擊跳轉；支援條號（<code>預算法第62條</code>）與關鍵字（<code>預算法 流用</code>）。</p>`;
    if (changes.length) {
        html += `<h3>最近修正（下載更新時比對）</h3><div class="card list">${changes.map(a =>
            `<a href="#${encodeURIComponent(a.id)}"><span class="row-main"><span class="row-title">${escapeHtml(label(a.id))}</span></span><span class="count">${escapeHtml(a.date)}</span></a>`).join("")}</div>`;
    }
    html += `<div class="quick-bento${recents.length ? " has-recents" : ""}">`;
    html += `<div><div class="fav-head"><h3>★ 收藏</h3><div class="tools">
        ${favs.length ? `<button class="tool" type="button" data-fav-io="export">匯出</button>` : ""}
        <button class="tool" type="button" data-fav-io="import">匯入</button></div></div>
        ${favs.length ? renderFavs(favs) : `<div class="card empty-inline">點法規或條文旁的 ☆ 加入收藏（存在本機）。</div>`}</div>`;
    if (recents.length) {
        html += `<div><div class="section-head"><h3>🕘 最近查看</h3></div><div class="card"><div class="recent-chips">${recents.map(id =>
            `<a class="chip-link" href="#${encodeURIComponent(id)}">${escapeHtml(label(id))}</a>`).join("")}</div></div></div>`;
    }
    html += `</div>`;
    return html + renderGroups("主計法規");
}

function renderBreadcrumb(code, articleId = null) {
    const law = lawByCode.get(code);
    const parts = [];
    if (law?.kind === FUND_KIND) {
        parts.push(`<a href="#${encodeURIComponent("基金")}">收支辦法</a>`);
    } else if (law?.kind === ABOLISHED_KIND) {
        parts.push(`<a href="#${encodeURIComponent("基金")}">收支辦法</a>`, `<a href="#${encodeURIComponent("廢止專區")}">廢止專區</a>`);
    } else {
        const cat = lawCategoryMap.get(code);
        if (cat?.tab === "其他") {
            parts.push(`<a href="#${encodeURIComponent("其他")}">其他</a>`);
        } else {
            parts.push(`<a href="#">主計法規</a>`);
        }
        if (cat?.group) parts.push(`<span>${escapeHtml(cat.group)}</span>`);
    }
    if (articleId) {
        parts.push(`<a href="#${encodeURIComponent(code)}">${escapeHtml(lawName(code))}</a>`);
        parts.push(`<span>${escapeHtml(articleLabel(articleId))}</span>`);
    } else {
        parts.push(`<span>${escapeHtml(lawName(code))}</span>`);
    }
    return `<nav class="breadcrumb" aria-label="目前位置">${parts.join(`<span aria-hidden="true">›</span>`)}</nav>`;
}

function renderOutgoingBox(id) {
    const edges = outgoing.get(id) || [];
    const seenTargets = new Map();
    const unresolved = new Set();
    for (const e of edges) {
        if (e.target) {
            if (!seenTargets.has(e.target)) seenTargets.set(e.target, e.is_external);
        } else {
            for (const [a, b] of e.spans || []) {
                const txt = (nodes.get(id)?.text || "").slice(a, b);
                if (txt) unresolved.add(txt);
            }
        }
    }
    if (!seenTargets.size && !unresolved.size) return `<div class="outgoing-box"><p class="muted">本條無引用其他條文。</p></div>`;
    const pills = [...seenTargets].map(([tid, isExt]) =>
        `<a class="cite-pill ${isExt ? "ext" : "int"}" href="#${encodeURIComponent(tid)}"><span>${escapeHtml(label(tid))}</span><small>${isExt ? "跨法規" : "本法"}</small></a>`
    ).join("");
    const unresHtml = unresolved.size ? `<p class="muted" style="margin-top:8px;">未收錄引用：${[...unresolved].map(escapeHtml).join("、")}</p>` : "";
    return `<div class="outgoing-box"><h4>本條向外引用（${seenTargets.size}）</h4><div class="chips">${pills}</div>${unresHtml}</div>`;
}

function renderArticle(q, marks) {
    const id = nodeId(q.code, q.main, q.sub);
    const target = nodes.get(id);
    const lawHasText = lawOrder.has(q.code);
    let html = renderBreadcrumb(q.code, id);

    if (lawHasText) {
        const order = lawOrder.get(q.code), i = order.indexOf(id);
        const prevId = i > 0 ? order[i - 1] : null;
        const nextId = i >= 0 && i < order.length - 1 ? order[i + 1] : null;
        const step = (t, txt) => t ? link(t, txt) : `<span class="muted">${txt}</span>`;
        html += `<nav class="article-nav">${link(q.code, `← 《${lawName(q.code)}》全文`)}
            <span>${step(prevId, "‹ 上一條")}　${step(nextId, "下一條 ›")}</span></nav>`;
    }

    html += `<div class="split article"><div class="side"><div class="card"><div class="title-row"><h2>${escapeHtml(label(id))}</h2>${starButton(id)}</div>`;
    html += abolishedNote(q.code);
    if (target) {
        const badge = amendedBadge(id, amended());
        if (badge) html += `<div class="badges">${badge}</div>`;
        if (target.chapter) html += `<p class="muted">${escapeHtml(target.chapter)}</p>`;
        html += `<div class="action-bar">${copyButton(id).replace(" ghost", "")}<button class="tool" type="button" data-copy-link="${escapeHtml(id)}">複製連結</button>${speakButton(id).replace(" ghost", "")}${PRINT_BUTTON}<a class="tool" href="graph.html#${encodeURIComponent(id)}">關聯圖 ↗</a></div>`;
        html += `<div class="text">${formatText(target, null, hitRanges(target, marks))}</div>`;
        html += renderOutgoingBox(id);
        rememberRecent(id);
    } else if (lawHasText) {
        html += `<div class="warn">資料中沒有這一條（可能已刪除、改條號，或條號輸入錯誤）。${incoming.has(id) ? "下面的引用可能已經失效。" : ""}</div>`;
    } else {
        html += `<p class="muted">這部法規沒有收錄全文，只列出引用它的條文。</p>`;
    }

    const bySource = groupBySource(incoming.get(id) || []), favs = store.get("favs", []);
    const similar = target && fundCodeSet.has(q.code) ? renderSimilar(target, favs) : "";
    html += `</div></div><div>`;

    if (!bySource.length) {
        html += `<div class="section-head"><h3>被 0 條條文引用</h3></div><p class="empty">沒有其他條文引用這一條。</p>${similar}</div></div>`;
        return html;
    }

    const own = sid => sid.startsWith(q.code + "-");
    bySource.sort((a, b) => (own(a[0].source) - own(b[0].source)) || a[0].source.localeCompare(b[0].source));
    const extCount = bySource.filter(g => !own(g[0].source)).length;
    const ownCount = bySource.length - extCount;

    const allIds = bySource.map(g => g[0].source);
    exportable = { name: `引用 ${label(id)} 的條文`, ids: () => {
        const active = document.querySelector(".cite-filter [aria-pressed='true']")?.dataset.citeScope || "all";
        return allIds.filter(sid => active === "all" || (active === "ext" ? !own(sid) : own(sid)));
    }};

    html += `<div class="section-head"><h3>被 ${bySource.length} 條條文引用</h3><div class="tools">${PRINT_BUTTON}${EXPORT_BUTTON}</div></div>`;
    if (extCount > 0 && ownCount > 0) {
        html += `<div class="cite-filter">
            <button class="facet-btn" type="button" data-cite-scope="all" aria-pressed="true">全部 (${bySource.length})</button>
            <button class="facet-btn" type="button" data-cite-scope="ext" aria-pressed="false">跨法規 (${extCount})</button>
            <button class="facet-btn" type="button" data-cite-scope="own" aria-pressed="false">本法 (${ownCount})</button>
        </div>`;
    }
    html += bySource.map(group => {
        const src = nodes.get(group[0].source);
        const scope = own(src.id) ? "own" : "ext";
        return `<div class="card cite-card" data-cite-scope="${scope}"><div class="hit-head">${link(src.id)}<div class="badges">${edgeBadges(group)}${speakButton(src.id)}${copyButton(src.id)}${starButton(src.id, favs)}</div></div>
            <div class="text">${formatText(src, id)}</div></div>`;
    }).join("") + similar + `</div></div>`;
    return html;
}

// --- Fund Similarity (Cached + Mathematically Pruned) ---

const SAME = 0.9, OWN = 0.5, SIMILAR_SHOWN = 5;
const pairCache = new Map();
const closestCache = new Map();
const fundStandingCache = new Map();

function fundCodes() { return fundCodeSet; }

function pairs(node) {
    let set = pairCache.get(node.id);
    if (!set) {
        const t = node.norm.replace(/本基金|本辦法|\s/g, "");
        set = new Set();
        for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
        pairCache.set(node.id, set);
    }
    return set;
}

function similarity(a, b) {
    if (a.size > b.size) [a, b] = [b, a];
    let shared = 0;
    for (const p of a) if (b.has(p)) shared++;
    return shared / (a.size + b.size - shared || 1);
}

function closest(node, funds = fundCodeSet) {
    if (funds === fundCodeSet && closestCache.has(node.id)) return closestCache.get(node.id);
    const mine = pairs(node);
    const mineLen = mine.size;
    const res = [...funds].filter(code => code !== node.law_code).map(code => {
        let top = { score: 0 };
        for (const id of lawOrder.get(code) || []) {
            const theirs = pairs(nodes.get(id));
            const theirLen = theirs.size;
            if (!mineLen || !theirLen) continue;
            const upper = mineLen < theirLen ? mineLen / theirLen : theirLen / mineLen;
            if (upper <= top.score) continue;
            const score = similarity(mine, theirs);
            if (score > top.score) top = { id, score };
        }
        return top;
    }).filter(t => t.id).sort((a, b) => b.score - a.score);
    if (funds === fundCodeSet) closestCache.set(node.id, res);
    return res;
}

function renderSimilar(node, favs) {
    const best = closest(node);
    const same = best.filter(t => t.score >= SAME).length;
    const summary = same ? `另有 ${same} 個基金有相同規定（相似度 90% 以上）`
        : best[0]?.score >= OWN ? "其他基金有類似但不相同的規定" : "本基金特有：其他基金沒有相似度 50% 以上的規定";
    return `<h3>其他基金的類似規定</h3><p class="muted">${summary}</p>` + best.slice(0, SIMILAR_SHOWN).filter(t => t.score >= 0.3).map(t =>
        `<div class="card"><div class="hit-head">${link(t.id)}<div class="badges"><span class="badge">相似 ${Math.round(t.score * 100)}%</span>${speakButton(t.id)}${copyButton(t.id)}${starButton(t.id, favs)}</div></div>
            <div class="text">${formatText(nodes.get(t.id))}</div></div>`).join("");
}

const FUND_PARTS = [["來源", /來源/], ["用途", /用途/], ["保管", /存儲|保管及運用應/], ["管理會", /管理會/],
    ["預算決算", /預算之?編製|決算/], ["會計", /會計(事務|制度)/], ["賸餘", /賸餘|短絀/], ["結束", /結束|裁撤/]];

function fundOverview(code, ids) {
    if (!fundCodeSet.has(code)) return null;
    if (!fundStandingCache.has(code)) {
        const text = ids.map(id => nodes.get(id).text).join("");
        const meta = FUND_META[code];
        const authority = meta?.[1] || text.match(/以([^，。、；（]{2,25}?)(?:（[^）]*）)?為主管機關/)?.[1] || "";
        const fundType = meta?.[0] || "";
        const jumps = FUND_PARTS.map(([name, pat]) => [name, ids.slice(1).find(id => pat.test(nodes.get(id).text))]).filter(j => j[1]);
        const standing = new Map(ids.map(id => {
            const best = closest(nodes.get(id), fundCodeSet);
            return [id, { same: best.filter(t => t.score >= SAME).length, own: !(best[0]?.score >= OWN) }];
        }));
        const own = ids.filter(id => standing.get(id).own).length;
        fundStandingCache.set(code, { authority, fundType, jumps, standing, own });
    }
    const { authority, fundType, jumps, standing, own } = fundStandingCache.get(code);
    const metaBadges = [fundType, authority].filter(Boolean).map(v => `<span class="meta-pill">${escapeHtml(v)}</span>`).join("");
    const html = `<div class="fund-facts">
        ${metaBadges ? `<div class="badges">${metaBadges}</div>` : ""}
        <p class="muted">${own} ${unit(code)}為本基金特有，其餘與其他基金相同或類似。</p>
        ${jumps.length ? `<div class="chips"><span class="muted" style="font-size:12px;">快速跳至：</span>${jumps.map(([name, id]) => `<button class="tool" type="button" data-scroll="a-${escapeHtml(id)}">${escapeHtml(name)}</button>`).join("")}</div>` : ""}</div>`;
    return { html, standing, own };
}

function standingBadge(id, s) {
    if (!s) return "";
    const href = `#${encodeURIComponent(id)}`;
    return s.own ? `<a class="badge own" href="${href}">本基金特有</a>`
        : s.same ? `<a class="badge" href="${href}">與 ${s.same} 個基金相同</a>` : "";
}

function renderFullText(code) {
    const ids = lawOrder.get(code);
    const law = lawByCode.get(code);
    const fund = fundOverview(code, ids);
    const cited = ids.filter(id => citerCount(id)).length;
    const chapters = ids.filter(id => nodes.get(id).chapter);
    const favs = store.get("favs", []);
    rememberRecent(code);
    exportable = { name: lawName(code), ids: () => scrubList().map(el => el.id.slice(2)) };

    let html = renderBreadcrumb(code);
    html += `<div class="split"><div class="card side"><div class="title-row"><h2>${escapeHtml(lawName(code))}</h2><span class="meta-pill">${escapeHtml(kindBadgeLabel(law?.kind))}</span></div>${abolishedNote(code)}${lawDates(code)}
        <p class="muted">共 ${ids.length} ${unit(code)}，${cited} ${unit(code)}被其他條文引用</p>
        <div class="action-bar">${starButton(code)}${speech ? `<button class="tool" type="button" data-speak-all>朗讀全文</button>` : ""}${EXPORT_BUTTON}${PRINT_BUTTON}<a class="tool" href="graph.html#${encodeURIComponent(code)}">關聯圖 ↗</a></div>
        <div class="controls">
            <div class="check-row">
                <label class="check-pill"><input type="checkbox" id="only-cited"> 只看被引用的 (${cited})</label>
                ${fund ? `<label class="check-pill"><input type="checkbox" id="only-own"> 只看本基金特有 (${fund.own})</label>` : ""}
            </div>
            <div id="law-filter-status" class="muted" hidden></div>
        </div>${fund ? fund.html : ""}`;
    if (chapters.length) {
        html += `<details class="toc"${matchMedia("(min-width: 1100px)").matches ? " open" : ""}><summary>目錄（${chapters.length} 章）</summary>
            ${chapters.map(id => `<button type="button" data-scroll="ch-${escapeHtml(id)}">${escapeHtml(nodes.get(id).chapter)}</button>`).join("")}</details>`;
    }
    html += `</div><div class="card" id="full-text" data-law="${escapeHtml(code)}">`;
    const changes = amended();
    let current = "", currentChapterId = "";
    html += ids.map(id => {
        const node = nodes.get(id), n = citerCount(id);
        const chapter = node.chapter ? `<div class="chapter" id="ch-${escapeHtml(id)}">${escapeHtml(node.chapter)}</div>` : "";
        if (node.chapter) { current = node.chapter; currentChapterId = "ch-" + id; }
        const s = fund?.standing.get(id);
        return `${chapter}<article class="law-article${n ? " is-cited" : ""}${s?.own ? " is-own" : ""}" id="a-${escapeHtml(id)}" data-chapter="${escapeHtml(current)}" data-chapter-id="${escapeHtml(currentChapterId)}">
            <div class="hit-head"><div class="art-title-wrap">${link(id, node.article_zh)}<div class="badges">${amendedBadge(id, changes)}${standingBadge(id, s)}
                ${n ? `<a class="badge" href="#${encodeURIComponent(id)}">被 ${n} 條引用</a>` : ""}</div></div>
                <div class="art-actions">${speakButton(id)}${copyButton(id)}${starButton(id, favs)}</div></div>
            <div class="text">${formatText(node)}</div></article>`;
    }).join("");
    html += `<p class="empty" id="full-text-empty" hidden>沒有符合篩選條件的條文。<button type="button" class="tool" id="full-text-reset">清除篩選</button></p>`;
    return html + `</div></div>`;
}

function applyInLawFilter(raw = document.getElementById("q")?.value || "") {
    const ft = document.getElementById("full-text");
    if (!ft) return 0;
    const statusEl = document.getElementById("law-filter-status");
    const words = raw.normalize("NFKC").replace(/台/g, "臺").split(/\s+/).filter(Boolean);

    const articles = [...ft.querySelectorAll(".law-article")];
    let matched = 0;
    for (const el of articles) {
        const id = el.id.slice(2);
        const node = nodes.get(id);
        const textEl = el.querySelector(".text");
        if (!words.length) {
            el.classList.remove("filter-hidden");
            if (el.dataset.origHtml) {
                textEl.innerHTML = el.dataset.origHtml;
                delete el.dataset.origHtml;
            }
            matched++;
        } else {
            const ok = words.every(w => node.norm.includes(w));
            el.classList.toggle("filter-hidden", !ok);
            if (ok) {
                matched++;
                if (!el.dataset.origHtml) el.dataset.origHtml = textEl.innerHTML;
                textEl.innerHTML = formatText(node, null, hitRanges(node, words));
            } else if (el.dataset.origHtml) {
                textEl.innerHTML = el.dataset.origHtml;
                delete el.dataset.origHtml;
            }
        }
    }

    ft.querySelectorAll(".chapter").forEach(ch => {
        if (!words.length) { ch.classList.remove("filter-hidden"); return; }
        let sib = ch.nextElementSibling, hasVis = false;
        while (sib && !sib.classList.contains("chapter")) {
            if (sib.classList.contains("law-article") && !sib.classList.contains("filter-hidden")) { hasVis = true; break; }
            sib = sib.nextElementSibling;
        }
        ch.classList.toggle("filter-hidden", !hasVis);
    });

    if (statusEl) {
        statusEl.hidden = !words.length;
        statusEl.innerHTML = words.length ? `關鍵字篩選：符合 <strong>${matched}</strong> / ${articles.length} 條` : "";
    }
    const visibleCount = scrubList().length;
    const emptyEl = document.getElementById("full-text-empty");
    if (emptyEl) emptyEl.hidden = visibleCount > 0;
    updateScrubber();
    return matched;
}

function renderCitedList(code) {
    const cited = [...incoming.keys()].filter(id => id.startsWith(code + "-")).sort();
    const l = links.get(code);
    return renderBreadcrumb(code) + `<div class="card"><h2>${escapeHtml(lawName(code))}</h2>
        ${l ? `<p class="muted">這部沒有收錄條文（只有附件，或不在法務部、主計總處的系統），請看原文：</p><div class="list">${originalLink(l)}</div>`
            : `<p class="muted">這部法規沒有收錄全文，以下是被引用的條文。</p>`}</div>`
        + (cited.length ? `<div class="card list">${cited.map(id => `<a href="#${encodeURIComponent(id)}">
            <span class="row-title">${escapeHtml(articleLabel(id))}</span><span class="count">${citerCount(id)} 處</span></a>`).join("")}</div>` : "");
}

function renderNameMatches(q) {
    if (q.code || q.section) return "";
    const found = [...laws.filter(l => l.kind !== ABOLISHED_KIND), ...links.values()]
        .filter(l => q.include.every(w => l.name.normalize("NFKC").replace(/台/g, "臺").includes(w)));
    return found.length ? `<div class="section-head"><h4>名稱含「${escapeHtml(q.include.join(" "))}」的法規（${found.length}）</h4></div><div class="card list">${found.slice(0, MAX_RESULTS).map(l =>
        links.has(l.code) ? originalLink(l) : `<a href="#${encodeURIComponent(l.code)}"><span class="row-main"><span class="row-title">${escapeHtml(l.name)}</span><span class="meta-pill">${escapeHtml(kindBadgeLabel(l.kind))}</span></span><span class="count">${l.count} ${unit(l.code)}</span></a>`).join("")}</div>` : "";
}

function renderHitCards(hitIds, words, favs) {
    const mark = "?mark=" + encodeURIComponent(words.join(" "));
    return hitIds.slice(0, MAX_RESULTS).map(id =>
        `<div class="card" data-law-code="${escapeHtml(codeOf(id))}"><div class="hit-head"><a href="#${encodeURIComponent(id)}${mark}">${escapeHtml(label(id))}</a><div class="badges">${speakButton(id)}${copyButton(id)}${starButton(id, favs)}</div></div><p class="text">${snippet(nodes.get(id), words)}</p></div>`
    ).join("");
}

function renderSearch(q) {
    if (!q.include.length) return `<p class="warn">請輸入要搜尋的關鍵字。</p>`;
    const scope = q.code ? lawOrder.get(q.code) || []
        : laws.filter(l => q.section ? l.kind === SECTIONS[q.section].kind : l.kind !== ABOLISHED_KIND)
            .filter(l => (!q.fundType || FUND_META[l.code]?.[0] === q.fundType) && (!q.owner || FUND_META[l.code]?.[1] === q.owner))
            .flatMap(l => lawOrder.get(l.code) || []);
    const hits = scope.filter(id => {
        const t = nodes.get(id).norm;
        return q.include.every(w => t.includes(w)) && !q.exclude.some(w => t.includes(w));
    });
    const favs = store.get("favs", []);
    const where = q.code ? `《${lawName(q.code)}》` : q.section ? [q.owner, q.fundType, SECTIONS[q.section].where].filter(Boolean).join(" ") : "全部法規";
    const title = `在${where}中找到 ${hits.length} 條「${q.include.join(" ")}」${q.exclude.length ? `（排除 ${q.exclude.join("、")}）` : ""}`;
    const names = renderNameMatches(q);

    const scopeBtn = (q.code || q.section)
        ? `<button type="button" class="scope-chip" id="search-broaden" data-terms="${escapeHtml(q.termsRaw)}">${escapeHtml(where)} ×</button>`
        : `<span class="badge muted-pill">全部法規</span>`;
    const summaryHtml = `<div class="card search-summary">
        <div class="search-terms">${scopeBtn}${q.include.map(w => `<span class="badge">${escapeHtml(w)}</span>`).join("")}${q.exclude.map(w => `<span class="badge review">-${escapeHtml(w)}</span>`).join("")}</div>
        ${hits.length ? `<div class="tools">${PRINT_BUTTON}${EXPORT_BUTTON}</div>` : ""}
    </div>`;

    if (!hits.length) return summaryHtml + names + `<h3>${escapeHtml(title)}</h3><p class="empty">沒有符合的條文。${q.code || names ? "" : "要查法規請輸入名稱，例如「預算法」。"}</p>`;

    currentSearch = { hits, words: q.include, activeCode: "" };
    exportable = {
        name: `搜尋 ${q.code ? lawName(q.code) : q.section ? SECTIONS[q.section].where : ""} ${q.include.join(" ")}`.replace(/\s+/g, " "),
        ids: () => currentSearch?.activeCode ? currentSearch.hits.filter(id => codeOf(id) === currentSearch.activeCode) : (currentSearch?.hits || hits),
    };

    const countsByLaw = new Map();
    for (const id of hits) {
        const c = codeOf(id);
        countsByLaw.set(c, (countsByLaw.get(c) || 0) + 1);
    }
    const facets = [...countsByLaw.entries()].sort((a, b) => b[1] - a[1]);
    const facetBar = facets.length > 1 ? `<div class="facet-bar" role="group" aria-label="依結果法規篩選">
        <button type="button" class="facet-btn" data-facet="" aria-pressed="true">全部 (${hits.length})</button>
        ${facets.map(([c, n]) => `<button type="button" class="facet-btn" data-facet="${escapeHtml(c)}" aria-pressed="false">${escapeHtml(lawName(c))} (${n})</button>`).join("")}
    </div>` : "";

    let html = summaryHtml + names + `<div class="section-head"><h3>${escapeHtml(title)}</h3></div>` + facetBar;
    html += `<div class="hits" id="search-hits">${renderHitCards(hits, q.include, favs)}</div>`;
    html += `<p class="muted" id="search-trunc"${hits.length > MAX_RESULTS ? "" : " hidden"}>只顯示前 ${MAX_RESULTS} 條，請用上方篩選或加關鍵字縮小範圍。</p>`;
    return html;
}

function snippet(node, words) {
    const text = node.text;
    const first = Math.min(...words.map(w => node.norm.indexOf(w)).filter(i => i >= 0));
    const start = Math.max(0, first - 60), end = Math.min(text.length, first + 100);
    return (start ? "…" : "") + marked(text, start, end, hitRanges(node, words)) + (end < text.length ? "…" : "");
}

function render(raw, marks) {
    const result = document.getElementById("result");
    exportable = null;
    currentSearch = null;
    const q = parseQuery(raw);
    if (!q) result.innerHTML = renderHome();
    else if (q.type === "article") result.innerHTML = renderArticle(q, marks);
    else if (q.type === "section") result.innerHTML = renderSection(q.section);
    else if (q.type === "tab") result.innerHTML = `<p class="muted intro-line">主計業務常會查到的其他法規。標「原文 ↗」的沒有收錄條文，連到主管機關原文。</p>` + renderGroups(q.tab);
    else if (q.type === "law") result.innerHTML = lawOrder.has(q.code) ? renderFullText(q.code) : renderCitedList(q.code);
    else result.innerHTML = renderSearch(q);
    return q;
}

function syncSearchBar(q, raw) {
    const input = document.getElementById("q");
    const scopeBtn = document.getElementById("search-scope");
    const clearBtn = document.getElementById("q-clear");

    if (q?.type === "law" || q?.type === "article" || (q?.type === "search" && q.code)) {
        currentScope = { type: "law", code: q.code, prefix: lawName(q.code), label: "本法：" + lawName(q.code) };
    } else if (q?.type === "section" || (q?.type === "search" && q.section)) {
        const sec = q.section;
        const extra = q.type === "search"
            ? (q.fundType ? ` 類別:${q.fundType}` : "") + (q.owner ? ` 主管:${q.owner}` : "")
            : "";
        currentScope = { type: "section", section: sec, prefix: sec + extra, label: sec === "基金" ? "收支辦法" : "廢止專區" };
    } else {
        currentScope = null;
    }

    if (currentScope) {
        scopeBtn.textContent = currentScope.label + " ×";
        scopeBtn.hidden = false;
        if (currentScope.type === "law" && document.getElementById("full-text")) {
            input.placeholder = `輸入條號（如 62）跳至該條，或輸入關鍵字即時篩選《${lawName(currentScope.code)}》…`;
        } else if (currentScope.type === "section") {
            input.placeholder = `輸入名稱／機關即時篩選清單，或按 Enter 搜尋條文內容…`;
        } else {
            input.placeholder = `在「${currentScope.label.replace(/^本法：/, "")}」搜尋條文，或輸入其他法規…`;
        }
    } else {
        scopeBtn.hidden = true;
        input.placeholder = "即時篩選法規名稱，或輸入條號（如 預算法 62）、關鍵字按查詢";
    }

    input.value = q?.type === "search" ? (q.termsRaw ?? raw) : "";
    clearBtn.hidden = !input.value;
    hideSuggest();
}

function runFromHash() {
    stopSpeaking();
    const [path, mark] = location.hash.slice(1).split("?mark=");
    const raw = safeDecode(path);
    const q = render(raw, mark ? safeDecode(mark).split(" ") : []);
    syncSearchBar(q, raw);
    if (q?.type === "section") restoreSectionFilters();

    const kind = lawByCode.get(q?.code)?.kind;
    const tab = q?.section || kind === FUND_KIND || kind === ABOLISHED_KIND ? "fund"
        : q?.tab || Object.values(categories["其他"] || {}).some(codes => codes.includes(q?.code)) ? "other" : "law";
    document.querySelectorAll("[data-tab]").forEach(a => {
        if (a.dataset.tab === tab) a.setAttribute("aria-current", "page");
        else a.removeAttribute("aria-current");
    });
    window.scrollTo(0, scrollPositions.get(location.hash) || 0);
    updateScrubber();
    updateBack();
}

// --- Instant Search Suggest ---

const qInput = document.getElementById("q");
const qClear = document.getElementById("q-clear");
const suggestBox = document.getElementById("search-suggest");
let suggestIdx = -1;

function hideSuggest() {
    suggestBox.hidden = true;
    suggestBox.innerHTML = "";
    suggestIdx = -1;
}

function findMatchingLaws(normText) {
    const scored = [];
    const seen = new Set();
    const scoreItem = (code, name, kind, count, url, isAlias = false) => {
        if (seen.has(code)) return;
        const n = name.normalize("NFKC").replace(/台/g, "臺");
        const idx = n.indexOf(normText);
        const codeMatch = code.toLowerCase().includes(normText.toLowerCase());
        if (idx < 0 && !codeMatch) return;
        seen.add(code);
        let score = 0;
        if (n === normText) score = 100;
        else if (idx === 0) score = 80;
        else if (idx > 0) score = 50;
        else score = 30;
        if (isAlias) score -= 5;
        if (kind === ABOLISHED_KIND) score -= 40;
        scored.push({ code, name, kind, count, url, score });
    };

    for (const l of laws) scoreItem(l.code, l.name, l.kind, l.count, null);
    for (const l of links.values()) scoreItem(l.code, l.name, "原文", 0, l.url);
    for (const [alias, code] of Object.entries(nameToCode)) {
        if (alias === code || seen.has(code)) continue;
        const l = lawByCode.get(code), lk = links.get(code);
        if (l) scoreItem(code, l.name, l.kind, l.count, null, alias.includes(normText));
        else if (lk) scoreItem(code, lk.name, "原文", 0, lk.url, true);
    }
    return scored.sort((a, b) => b.score - a.score || a.name.length - b.name.length).slice(0, 6);
}

function handleUnifiedInput() {
    const raw = qInput.value.trim();
    qClear.hidden = !qInput.value;
    const norm = raw.normalize("NFKC").replace(/台/g, "臺");

    const ft = document.getElementById("full-text");
    const secList = document.getElementById("section-list");
    const groupsEl = document.getElementById("groups");

    // A. In Full-Text Law view with active law scope: live jump to article number OR live filter articles
    if (ft && currentScope?.type === "law") {
        const am = norm.replace(/\s+/g, "").match(ARTICLE_PAT);
        if (!raw) {
            applyInLawFilter("");
            hideSuggest();
            return;
        }
        if (am) {
            applyInLawFilter("");
            const targetEl = document.getElementById("a-" + nodeId(currentScope.code, toNumber(am[1]), am[2] ? toNumber(am[2]) : null));
            if (targetEl) targetEl.scrollIntoView();
            hideSuggest();
            return;
        }
        const matchedCount = applyInLawFilter(raw);
        if (matchedCount > 0) {
            hideSuggest();
            return;
        }
    }

    // B. In 收支辦法 / 廢止專區 list view: live filter the fund list
    if (secList && currentScope?.type === "section") {
        const shown = applySectionFilters();
        if (!raw || shown > 0) {
            hideSuggest();
            return;
        }
    }

    // C. In Home (主計法規) / 其他 groups view: live filter the law groups
    if (groupsEl && !currentScope) {
        const shown = applyGroupFilter(raw);
        // Only show compact suggest if user typed a direct article jump (e.g. "預算法 62") or 0 laws matched in this tab
        let directQ = raw ? parseQuery(raw) : null;
        if (directQ?.type !== "article" && raw) {
            const tm = norm.match(TRAILING_ART_PAT);
            if (tm && tm[1].trim()) {
                const topLaw = findMatchingLaws(tm[1].trim()).find(x => !x.url);
                if (topLaw) directQ = { type: "article", code: topLaw.code, main: toNumber(tm[3]), sub: tm[4] ? toNumber(tm[4]) : null };
            }
        }
        if (!raw || (shown > 0 && directQ?.type !== "article")) {
            hideSuggest();
            return;
        }
    }

    if (!raw) { hideSuggest(); return; }

    // Render compact quick-jump suggest dropdown
    let itemsHtml = "";
    let directQ = parseQuery(raw);
    if (directQ?.type !== "article" && currentScope?.type === "law" && ARTICLE_PAT.test(norm.replace(/\s+/g, ""))) {
        const am = norm.replace(/\s+/g, "").match(ARTICLE_PAT);
        if (am) directQ = { type: "article", code: currentScope.code, main: toNumber(am[1]), sub: am[2] ? toNumber(am[2]) : null };
    }
    if (directQ?.type !== "article") {
        const tm = norm.match(TRAILING_ART_PAT);
        if (tm && tm[1].trim()) {
            const topLaw = findMatchingLaws(tm[1].trim()).find(x => !x.url);
            if (topLaw) directQ = { type: "article", code: topLaw.code, main: toNumber(tm[3]), sub: tm[4] ? toNumber(tm[4]) : null };
        }
    }
    if (directQ?.type === "article") {
        const tid = nodeId(directQ.code, directQ.main, directQ.sub);
        if (nodes.has(tid) || lawOrder.has(directQ.code)) {
            itemsHtml += `<button type="button" class="suggest-item jump-direct" role="option" data-suggest-hash="${escapeHtml(encodeURIComponent(tid))}">
                <span>↗ 直接跳至：${escapeHtml(label(tid))}</span>
                <span class="s-meta">${nodes.has(tid) ? "條文頁" : "查引用"}</span>
            </button>`;
        }
    }

    const matches = findMatchingLaws(norm)
        .filter(m => !(ft && currentScope?.type === "law" && m.code === currentScope.code))
        .slice(0, 4);
    for (const m of matches) {
        const kLabel = m.url ? "原文 ↗" : kindBadgeLabel(m.kind);
        const meta = m.url ? `<span class="meta-pill">${kLabel}</span>`
            : `<span class="meta-pill">${escapeHtml(kLabel)}</span><span>${m.count} ${unit(m.code)}</span>`;
        if (m.url) {
            itemsHtml += `<a class="suggest-item" role="option" href="${escapeHtml(m.url)}" target="_blank" rel="noopener">
                <span>${escapeHtml(m.name)}</span><span class="s-meta">${meta}</span></a>`;
        } else {
            itemsHtml += `<button type="button" class="suggest-item" role="option" data-suggest-hash="${escapeHtml(encodeURIComponent(m.code))}">
                <span>${escapeHtml(m.name)}</span><span class="s-meta">${meta}</span></button>`;
        }
    }

    if (!itemsHtml) { hideSuggest(); return; }
    suggestBox.innerHTML = itemsHtml;
    suggestBox.hidden = false;
    suggestIdx = -1;
}

qInput.addEventListener("input", handleUnifiedInput);
qInput.addEventListener("focus", () => { if (qInput.value.trim()) handleUnifiedInput(); });
qClear.addEventListener("click", () => {
    qInput.value = "";
    qClear.hidden = true;
    hideSuggest();
    if (document.getElementById("full-text")) applyInLawFilter("");
    if (document.getElementById("section-list")) applySectionFilters();
    if (document.getElementById("groups")) applyGroupFilter("");
    qInput.focus();
});

document.getElementById("search-scope").addEventListener("click", () => {
    const val = qInput.value.trim();
    currentScope = null;
    document.getElementById("search-scope").hidden = true;
    qInput.placeholder = "即時篩選法規名稱，或輸入條號（如 預算法 62）、關鍵字按查詢";
    if (document.getElementById("full-text")) applyInLawFilter("");
    if (currentSearch && val) {
        location.hash = encodeURIComponent(val);
    } else {
        qInput.focus();
        if (val) handleUnifiedInput();
    }
});

suggestBox.addEventListener("mousedown", e => e.preventDefault());
suggestBox.addEventListener("click", e => {
    const hashBtn = e.target.closest("[data-suggest-hash]");
    if (hashBtn) {
        hideSuggest();
        qInput.blur();
        location.hash = hashBtn.dataset.suggestHash;
        return;
    }
    if (e.target.closest("[data-suggest-submit]")) {
        hideSuggest();
        document.getElementById("query-form").requestSubmit();
        return;
    }
    if (e.target.closest("a")) hideSuggest();
});

qInput.addEventListener("keydown", e => {
    if (suggestBox.hidden) return;
    const opts = [...suggestBox.querySelectorAll(".suggest-item")];
    if (!opts.length) return;
    if (e.key === "ArrowDown") {
        e.preventDefault();
        suggestIdx = (suggestIdx + 1) % opts.length;
    } else if (e.key === "ArrowUp") {
        e.preventDefault();
        suggestIdx = (suggestIdx - 1 + opts.length) % opts.length;
    } else if (e.key === "Escape") {
        hideSuggest();
        return;
    } else if (e.key === "Enter" && suggestIdx >= 0) {
        e.preventDefault();
        opts[suggestIdx].click();
        return;
    } else {
        return;
    }
    opts.forEach((el, i) => el.classList.toggle("active", i === suggestIdx));
    opts[suggestIdx]?.scrollIntoView({ block: "nearest" });
});

// Global shortcuts: `/` or Cmd/Ctrl+K focuses search; Escape closes overlays
document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
        hideSuggest();
        closePrefsMenu();
        closeDrawer();
        return;
    }
    const tag = document.activeElement?.tagName;
    const isEditing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || document.activeElement?.isContentEditable;
    if ((e.key === "/" && !isEditing && !e.metaKey && !e.ctrlKey && !e.altKey) ||
        ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) {
        e.preventDefault();
        qInput.focus();
        qInput.select();
    }
});

// --- Back Button ---

const back = document.getElementById("back");
let lastY = 0;
function queryLabel(q, raw) {
    return !q ? "" : q.type === "article" ? label(nodeId(q.code, q.main, q.sub)) : q.type === "law" ? lawName(q.code) : raw;
}
function updateBack() {
    lastY = scrollY;
    back.classList.remove("away");
    const from = history.state?.from;
    back.hidden = from === undefined;
    if (back.hidden) return;
    const raw = safeDecode(from.slice(1).split("?mark=")[0]);
    back.textContent = "← " + (queryLabel(parseQuery(raw), raw) || "首頁");
}
back.addEventListener("click", () => history.back());
window.addEventListener("scroll", () => {
    back.classList.toggle("away", scrollY > lastY && scrollY > 200);
    lastY = scrollY;
}, { passive: true });

// --- Data & Offline Cache ---

const DATA = "laws-data";

async function fetchOk(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(`${path} ${response.status}`);
    return response;
}

async function download(cache, index, codes, removed = []) {
    const status = document.getElementById("loading-status");
    const files = new Array(codes.length);
    const BATCH = 16;
    let done = 0;
    for (let i = 0; i < codes.length; i += BATCH) {
        const chunk = codes.slice(i, i + BATCH);
        const resChunk = await Promise.all(chunk.map(code => fetchOk(`laws/${code}.json`)));
        resChunk.forEach((res, j) => { files[i + j] = res; });
        done += chunk.length;
        if (status && codes.length > 20) status.textContent = `首次載入法規資料（${done} / ${codes.length} 部）…`;
    }
    const changed = (await Promise.all(files.map((file, i) => changedArticles(cache, codes[i], file)))).flat();
    await Promise.all(files.map((file, i) => cache.put(`laws/${codes[i]}.json`, file)));
    if (changed.length) {
        const date = new Date().toLocaleDateString("sv");
        const older = store.get("amended", []).filter(a => !changed.includes(a.id));
        store.set("amended", [...changed.map(id => ({ id, date })), ...older].slice(0, 100));
    }
    await Promise.all(removed.map(code => cache.delete(`laws/${code}.json`)));
    await cache.put("laws/index.json", new Response(JSON.stringify(index)));
}

async function changedArticles(cache, code, file) {
    const old = await cache.match(`laws/${code}.json`);
    if (!old) return [];
    const before = new Map((await old.json()).nodes.map(n => [n.id, n.text]));
    return (await file.clone().json()).nodes.filter(n => before.get(n.id) !== n.text).map(n => n.id);
}

async function checkUpdates(cache, local) {
    const remote = await (await fetchOk("laws/index.json")).json();
    const had = new Map(local.laws.map(l => [l.code, l.hash]));
    const changed = remote.laws.filter(l => had.get(l.code) !== l.hash);
    const removed = local.laws.map(l => l.code).filter(code => !remote.laws.some(l => l.code === code));
    if (!changed.length && !removed.length) {
        if (JSON.stringify({ ...remote, built: 0 }) !== JSON.stringify({ ...local, built: 0 }))
            await download(cache, remote, []);
        return;
    }
    const bar = document.getElementById("update-bar"), yes = document.getElementById("update-yes");
    const names = changed.map(l => l.name);
    bar.querySelector("span").textContent = `法規有更新：${names.slice(0, 3).join("、")}${names.length > 3 ? ` 等 ${names.length} 部` : ""}` +
        (removed.length ? `（另移除 ${removed.length} 部）` : "") + "，要下載嗎？";
    bar.hidden = false;
    document.getElementById("update-no").onclick = () => { bar.hidden = true; };
    yes.onclick = async () => {
        yes.disabled = true;
        yes.textContent = "下載中…";
        try {
            await download(cache, remote, changed.map(l => l.code), removed);
            location.reload();
        } catch {
            yes.disabled = false;
            yes.textContent = "重試";
        }
    };
}

async function loadData() {
    const cache = await caches.open(DATA);
    let index = await (await cache.match("laws/index.json"))?.json();
    if (index) {
        checkUpdates(cache, index).catch(() => {});
    } else {
        index = await (await fetchOk("laws/index.json")).json();
        await download(cache, index, index.laws.map(l => l.code));
    }
    const files = await Promise.all(index.laws.map(async l => {
        let res = await cache.match(`laws/${l.code}.json`);
        if (!res) {
            res = await fetchOk(`laws/${l.code}.json`);
            await cache.put(`laws/${l.code}.json`, res.clone());
        }
        return res.json();
    }));
    return { ...index, nodes: files.flatMap(f => f.nodes), edges: files.flatMap(f => f.edges) };
}

async function init() {
    const data = await loadData();
    const normChar = new Map();
    const normC = c => {
        let v = normChar.get(c);
        if (v === undefined) {
            const h = c.normalize("NFKC");
            v = h.length === c.length ? (h === "台" ? "臺" : h) : (c === "台" ? "臺" : c);
            normChar.set(c, v);
        }
        return v;
    };

    data.nodes.forEach(n => {
        let norm = "";
        for (const c of n.text) norm += normC(c);
        n.norm = norm;
        nodes.set(n.id, n);
        if (!lawOrder.has(n.law_code)) lawOrder.set(n.law_code, []);
        lawOrder.get(n.law_code).push(n.id);
    });

    laws = data.laws || [];
    lawByCode = new Map(laws.map(l => [l.code, l]));
    fundCodeSet = new Set(laws.filter(l => l.kind === FUND_KIND).map(l => l.code));
    const abolished = new Set(laws.filter(l => l.abolished).map(l => l.code));

    data.edges.forEach(e => {
        if (!outgoing.has(e.source)) outgoing.set(e.source, []);
        outgoing.get(e.source).push(e);
        if (!e.target) return;
        if (abolished.has(nodes.get(e.source)?.law_code)) return;
        if (!incoming.has(e.target)) incoming.set(e.target, []);
        incoming.get(e.target).push(e);
    });
    for (const [tid, edges] of incoming) {
        citerCountMap.set(tid, new Set(edges.map(e => e.source)).size);
    }

    links = new Map((data.links || []).map(l => [l.code, l]));
    categories = data.categories || { 主計法規: { 法規: [...laws.filter(l => l.kind !== FUND_KIND && l.kind !== ABOLISHED_KIND).map(l => l.code), ...links.keys()] } };
    for (const [tab, groups] of Object.entries(categories)) {
        for (const [group, codes] of Object.entries(groups)) {
            for (const c of codes) lawCategoryMap.set(c, { tab, group });
        }
    }
    lawUrl = new Map(laws.filter(l => l.url).map(l => [l.code, l.url]));

    nameToCode = data.aliases || {};
    data.nodes.forEach(n => { nameToCode[n.law_name.normalize("NFKC")] = n.law_code; });
    for (const [name, code] of Object.entries(nameToCode)) {
        if (name !== code && (!codeToName[code] || name.length > codeToName[code].length)) codeToName[code] = name;
    }
    data.nodes.forEach(n => { codeToName[n.law_code] = n.law_name; });
    laws.filter(l => l.kind === FUND_KIND)
        .forEach(l => {
            const short = l.name.replace(/(?:收支保管及運用辦法|管理運用及監督辦法|管理及監督辦法|設置管理辦法|設置管理條例|設置條例)$/, "");
            if (short !== l.name) nameToCode[short] ??= l.code;
        });
    sortedNames = Object.keys(nameToCode).sort((a, b) => b.length - a.length);

    document.getElementById("data-info").textContent =
        `${laws.length} 部法規、${nodes.size} 條條文 · 法務部資料 ${data.moj_updated || "—"} · 建置 ${data.built || ""}`;
    updateFavBadge();
    syncThemeUI();
    runFromHash();
}

// --- Event Listeners ---

document.getElementById("query-form").addEventListener("submit", e => {
    e.preventDefault();
    hideSuggest();
    qInput.blur();
    const val = qInput.value.trim();
    if (!val) {
        if (currentScope?.type === "law") location.hash = encodeURIComponent(currentScope.code);
        else if (currentScope?.type === "section") location.hash = encodeURIComponent(currentScope.section);
        else location.hash = "";
        return;
    }
    const directQ = parseQuery(val);
    const finalQuery = (currentScope && directQ?.type === "search" && !directQ.code && !directQ.section)
        ? `${currentScope.prefix} ${val}`
        : val;
    location.hash = encodeURIComponent(finalQuery);
});

window.addEventListener("hashchange", e => {
    const from = new URL(e.oldURL).hash;
    if (scrollPositions.has(from)) scrollPositions.delete(from);
    scrollPositions.set(from, window.scrollY);
    while (scrollPositions.size > 100) scrollPositions.delete(scrollPositions.keys().next().value);
    try { sessionStorage.setItem("scroll", JSON.stringify([...scrollPositions])); } catch (e) {}
    if (!history.state) history.replaceState({ from }, "");
    runFromHash();
});

function refreshStarsFor(id) {
    const favs = store.get("favs", []);
    document.querySelectorAll(`[data-fav]`).forEach(el => {
        if (el.dataset.fav === id) el.outerHTML = starButton(id, favs);
    });
}

document.addEventListener("click", e => {
    if (!e.target.closest(".prefs-anchor")) closePrefsMenu();
    if (!e.target.closest(".search-wrap")) hideSuggest();

    const tabLink = e.target.closest("[data-tab='fund']");
    if (tabLink) {
        sessionStore.set("sectionFilters", {});
        const f = document.querySelector(".section-search");
        if (f && location.hash === "#%E5%9F%BA%E9%87%91") {
            if (f.t) f.t.value = "";
            applySectionFilters(f, f.t);
            if (f.o) f.o.value = "";
            qInput.value = "";
            qClear.hidden = true;
            applySectionFilters(f);
        }
    }

    const fav = e.target.closest("[data-fav]");
    if (fav) {
        const id = fav.dataset.fav, favs = store.get("favs", []);
        const adding = !favs.includes(id);
        store.set("favs", adding ? [id, ...favs] : favs.filter(x => x !== id));
        refreshStarsFor(id);
        updateFavBadge();
        showToast(adding ? "已加入收藏" : "已取消收藏");
        if (!savedDrawer.hidden) renderDrawer();
        return;
    }

    const favRm = e.target.closest("[data-fav-remove]");
    if (favRm) {
        const id = favRm.dataset.favRemove;
        store.set("favs", store.get("favs", []).filter(x => x !== id));
        refreshStarsFor(id);
        updateFavBadge();
        renderDrawer();
        if (!location.hash || location.hash === "#") runFromHash();
        return;
    }

    if (e.target.id === "clear-recents") {
        store.set("recents", []);
        renderDrawer();
        if (!location.hash || location.hash === "#") runFromHash();
        showToast("已清除最近查看紀錄");
        return;
    }

    const groupBy = e.target.closest("[data-group-by]");
    if (groupBy) {
        store.set("groupBy", groupBy.dataset.groupBy);
        const groups = document.getElementById("groups");
        groups.outerHTML = renderGroups(groups.dataset.tab);
        return;
    }

    const openGrp = e.target.closest("[data-open-group]");
    if (openGrp) {
        const details = document.querySelector(`details[data-group="${CSS.escape(openGrp.dataset.openGroup)}"]`);
        if (details) {
            details.open = true;
            details.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        return;
    }

    if (e.target.id === "toggle-all-groups") {
        const expand = e.target.dataset.state === "expand";
        document.querySelectorAll("#groups details").forEach(d => { d.open = expand; });
        e.target.dataset.state = expand ? "collapse" : "expand";
        e.target.textContent = expand ? "全部收合" : "全部展開";
        return;
    }

    if (e.target.id === "section-reset" || e.target.id === "section-empty-reset") {
        const f = document.querySelector(".section-search");
        qInput.value = "";
        qClear.hidden = true;
        if (f) {
            if (f.t) f.t.value = "";
            applySectionFilters(f, f.t);
            if (f.o) f.o.value = "";
            applySectionFilters(f);
        }
        return;
    }

    if (e.target.id === "full-text-reset") {
        qInput.value = "";
        qClear.hidden = true;
        const oc = document.getElementById("only-cited");
        if (oc) oc.checked = false;
        const oo = document.getElementById("only-own");
        if (oo) oo.checked = false;
        const ft = document.getElementById("full-text");
        ft?.classList.remove("only-cited", "only-own");
        applyInLawFilter("");
        return;
    }

    if (e.target.id === "search-broaden") {
        location.hash = encodeURIComponent(e.target.dataset.terms || "");
        return;
    }

    const facetBtn = e.target.closest("[data-facet]");
    if (facetBtn && currentSearch) {
        const code = facetBtn.dataset.facet;
        currentSearch.activeCode = code;
        document.querySelectorAll(".facet-bar [data-facet]").forEach(b => b.setAttribute("aria-pressed", String(b === facetBtn)));
        const subset = code ? currentSearch.hits.filter(id => codeOf(id) === code) : currentSearch.hits;
        const container = document.getElementById("search-hits");
        if (container) container.innerHTML = renderHitCards(subset, currentSearch.words, store.get("favs", []));
        const trunc = document.getElementById("search-trunc");
        if (trunc) trunc.hidden = subset.length <= MAX_RESULTS;
        return;
    }

    const citeScopeBtn = e.target.closest("[data-cite-scope]");
    if (citeScopeBtn && citeScopeBtn.tagName === "BUTTON") {
        const scope = citeScopeBtn.dataset.citeScope;
        document.querySelectorAll(".cite-filter [data-cite-scope]").forEach(b => b.setAttribute("aria-pressed", String(b === citeScopeBtn)));
        document.querySelectorAll(".cite-card").forEach(c => {
            c.hidden = scope !== "all" && c.dataset.citeScope !== scope;
        });
        return;
    }

    const ratePill = e.target.closest("[data-rate]");
    if (ratePill) { setRate(Number(ratePill.dataset.rate)); return; }

    const themeOpt = e.target.closest("[data-theme-opt]");
    if (themeOpt) {
        const opt = themeOpt.dataset.themeOpt;
        const next = opt === "auto" ? null : opt;
        const root = document.documentElement;
        root.classList.add("theme-switching");
        if (next) root.dataset.theme = next; else delete root.dataset.theme;
        setTimeout(() => root.classList.remove("theme-switching"), 60);
        store.set("theme", next);
        syncThemeUI();
        return;
    }

    const favIo = e.target.closest("[data-fav-io]");
    if (favIo) { favIo.dataset.favIo === "export" ? exportFavs() : importFavs(); return; }

    if (e.target.closest("[data-export]") && exportable) { exportView(); return; }

    const copy = e.target.closest("[data-copy]");
    if (copy) { copyArticle(copy); return; }

    const copyLink = e.target.closest("[data-copy-link]");
    if (copyLink) { copyArticleLink(copyLink.dataset.copyLink); return; }

    const say = e.target.closest("[data-speak]");
    if (say) {
        const id = say.dataset.speak, shown = scrubList().map(el => el.id.slice(2));
        if (speaking?.ids[speaking.i] === id) stopSpeaking();
        else speak(shown.includes(id) ? shown.slice(shown.indexOf(id)) : [id]);
        return;
    }
    if (e.target.closest("[data-speak-all]")) {
        speaking ? stopSpeaking() : speak(scrubList().map(el => el.id.slice(2)));
        return;
    }
    if (e.target.closest("[data-print]")) { window.print(); return; }

    const scroll = e.target.closest("[data-scroll]");
    if (scroll) {
        document.getElementById(scroll.dataset.scroll)?.scrollIntoView();
        return;
    }

    const font = e.target.closest("[data-font]");
    if (font) {
        const now = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--fs")) || 17;
        const size = Math.min(26, Math.max(14, now + 2 * font.dataset.font));
        document.documentElement.style.setProperty("--fs", size + "px");
        store.set("fontSize", size);
        syncThemeUI();
    }
});

const filterTokens = f => (f.t?.value ? ` 類別:${f.t.value}` : "") + (f.o?.value ? ` 主管:${f.o.value}` : "");

document.addEventListener("change", e => {
    if (e.target.closest(".section-search")) {
        applySectionFilters(e.target.closest(".section-search"), e.target);
        return;
    }
    if (e.target.id === "only-cited" || e.target.id === "only-own") {
        document.getElementById("full-text")?.classList.toggle(e.target.id, e.target.checked);
        const emptyEl = document.getElementById("full-text-empty");
        if (emptyEl) emptyEl.hidden = scrubList().length > 0;
        updateScrubber();
    }
});

// --- Scrubber & TOC Scrollspy ---

const scrubber = document.getElementById("scrubber");
const SCRUB_LINE = 141;
let scrubTimer = null;

function scrubList() {
    return [...document.querySelectorAll("#full-text .law-article")].filter(el => el.offsetParent);
}

function showScrub(list, i) {
    scrubber.style.setProperty("--f", list.length > 1 ? i / (list.length - 1) : 0);
    const chapter = list[i].dataset.chapter;
    scrubber.querySelector(".bubble").innerHTML = escapeHtml(list[i].querySelector(".hit-head a").textContent)
        + (chapter ? `<small>${escapeHtml(chapter)}</small>` : "");
    const chId = list[i].dataset.chapterId;
    document.querySelectorAll(".toc button").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.scroll === chId);
    });
}

function updateScrubber() {
    const list = scrubList();
    scrubber.hidden = list.length <= 5;
    if (scrubber.hidden || scrubber.classList.contains("drag")) return;
    scrubber.style.top = document.querySelector(".topbar").offsetHeight + 12 + "px";
    let i = 0;
    for (let lo = 0, hi = list.length - 1; lo <= hi;) {
        const mid = (lo + hi) >> 1;
        if (list[mid].getBoundingClientRect().top <= SCRUB_LINE) { i = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) i = list.length - 1;
    showScrub(list, i);
}

function scrubTo(e) {
    const list = scrubList(), rect = scrubber.getBoundingClientRect();
    if (!list.length) return;
    const f = Math.min(1, Math.max(0, (e.clientY - rect.top - 20) / (rect.height - 40)));
    const i = Math.round(f * (list.length - 1));
    list[i].scrollIntoView();
    showScrub(list, i);
}

scrubber.addEventListener("pointerdown", e => {
    e.preventDefault();
    scrubber.setPointerCapture(e.pointerId);
    scrubber.classList.add("drag");
    scrubTo(e);
});
scrubber.addEventListener("pointermove", e => { if (scrubber.classList.contains("drag")) scrubTo(e); });
for (const type of ["pointerup", "pointercancel"]) {
    scrubber.addEventListener(type, () => scrubber.classList.remove("drag"));
}
window.addEventListener("scroll", () => {
    if (scrubber.hidden) return;
    updateScrubber();
    scrubber.classList.add("show");
    clearTimeout(scrubTimer);
    scrubTimer = setTimeout(() => scrubber.classList.remove("show"), 1000);
}, { passive: true });

const toTop = document.getElementById("to-top");
window.addEventListener("scroll", () => { toTop.style.display = window.scrollY > 600 ? "block" : "none"; }, { passive: true });
toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

// --- PWA Install & Service Worker ---

const installBtn = document.getElementById("install-btn");
let installPrompt = null;
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
installBtn.hidden = standalone || !iOS;
window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    installPrompt = e;
    installBtn.hidden = false;
});
window.addEventListener("appinstalled", () => { installBtn.hidden = true; });
installBtn.addEventListener("click", async () => {
    if (!installPrompt) {
        alert("用 Safari 開啟本頁，點下方「分享」→「加入主畫面」，即可像 App 一樣離線使用。");
        return;
    }
    installPrompt.prompt();
    if ((await installPrompt.userChoice).outcome === "accepted") installBtn.hidden = true;
    installPrompt = null;
});

function showOnline() {
    const info = document.getElementById("offline-info");
    if (!navigator.onLine) info.innerHTML = `<span class="offline-pill">離線中</span>`;
    else if (navigator.serviceWorker?.controller) info.textContent = "· ✓ 已可離線使用";
    else info.textContent = "";
}
if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").then(() => navigator.serviceWorker.ready).then(showOnline).catch(() => {});
    navigator.serviceWorker.addEventListener("controllerchange", showOnline);
    navigator.serviceWorker.addEventListener("message", e => {
        if (e.data === "app-updated") document.getElementById("app-update").hidden = false;
    });
    document.getElementById("app-reload").addEventListener("click", () => location.reload());
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible" || !navigator.onLine) return;
        navigator.serviceWorker.getRegistration().then(reg => reg?.update()).catch(() => {});
        navigator.serviceWorker.controller?.postMessage("check-update");
    });
}
window.addEventListener("online", showOnline);
window.addEventListener("offline", showOnline);
showOnline();

init().catch(err => {
    document.getElementById("result").innerHTML =
        `<p class="warn">讀不到法規資料（${escapeHtml(err.message)}）。請在專案目錄執行 <code>python3 run_server.py</code> 再開啟。</p>`;
});
