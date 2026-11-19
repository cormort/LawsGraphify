// Laws Graphify - Interactive Knowledge Graph Application

let rawData = null;
let nodeById = new Map();
let lawCounts = new Map();
let lawFullNames = new Map();
let connectedLawCodes = new Set();
let validEdges = [];
let outgoingMap = new Map();
let incomingMap = new Map();
let connectedNodeIds = new Set();
let reviewSourceSet = new Set();
let reviewEdgeNodeIds = new Set();
let reviewLawCodes = new Set();

let svg = null;
let container = null;
let simulation = null;
let zoomBehavior = null;
let currentZoomScale = 1;

let nodeSelection = null;
let linkSelection = null;
let labelSelection = null;
let tooltip = null;

const activeFilters = {
    preset: "triad",
    search: "",
    laws: new Set(),
    connectedOnly: true,
    external: true,
    internal: true,
    needsReviewOnly: false,
    egoNodeId: null,
};

let selectedNode = null;
let activeNeighborIds = new Set();
let searchTimeout = null;

const LAW_COLORS = {
    "CONST": "#ef4444",
    "BUDGET": "#3b82f6",
    "SETTLE": "#a855f7",
    "ACCOUNT": "#10b981",
    "CPA": "#f59e0b",
    "IACP": "#14b8a6",
    "CSMF": "#ec4899",
    "CGMBPP": "#f43f5e",
    "CNGSF": "#8b5cf6",
    "CACGSB": "#0ea5e9",
    "CNDR": "#84cc16",
    "AUDIT": "#06b6d4",
    "LGA": "#f97316",
    "TFA": "#6366f1",
    "FDA": "#eab308",
};

const CORE_CODES = [
    "CONST", "BUDGET", "SETTLE", "ACCOUNT", "CPA", "IACP", "CSMF", "CGMBPP",
    "CNGSF", "CACGSB", "CNDR", "MOPE", "SUPE", "AUDIT", "AUDITER", "LGA",
    "TFA", "FDA", "FY2027GBPP", "FY2027GSUBPP", "BOPA", "STATA"
];

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
}

function safeDecode(value) {
    try { return decodeURIComponent(value); } catch { return value; }
}

function getLawColor(code) {
    if (LAW_COLORS[code]) return LAW_COLORS[code];
    let hash = 0;
    for (let i = 0; i < code.length; i++) hash = code.charCodeAt(i) + ((hash << 5) - hash);
    return `hsl(${Math.abs(hash % 360)}, 68%, 52%)`;
}

function shortLawTitle(name) {
    if (!name) return "";
    return name
        .replace(/收支保管及運用辦法$/, "")
        .replace(/應行注意事項$/, "")
        .replace(/^中央政府各機關/, "")
        .replace(/^行政院及所屬各級機關/, "");
}

function shortNodeLabel(node) {
    const shortLaw = shortLawTitle(node.law_name);
    const num = node.article_sub_num ? `${node.article_num}-${node.article_sub_num}` : `${node.article_num}`;
    return `${shortLaw} ${num}`;
}

function citationText(node) {
    const zh = (node.article_zh || "").replace(/\s/g, "");
    const [, n, sub, u] = zh.match(/^第(\d+)(?:-(\d+))?([條點])$/) || [];
    return node.law_name + (n ? `第${n}${u}${sub ? "之" + sub : ""}` : zh);
}

// Theme sync (same localStorage.theme key as index.html)
const THEMES = [null, "light", "dark"];
document.getElementById("graph-theme-btn")?.addEventListener("click", () => {
    const now = document.documentElement.dataset.theme || null;
    const next = THEMES[(THEMES.indexOf(now) + 1) % THEMES.length];
    if (next) document.documentElement.dataset.theme = next;
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem("theme", JSON.stringify(next)); } catch (e) {}
});

document.addEventListener("DOMContentLoaded", initApp);

async function initApp() {
    setupUIEventListeners();
    const statusEl = document.getElementById("graph-status");
    if (!window.d3) {
        statusEl.innerHTML = `<div class="status-card"><strong>需要網路載入圖表函式庫</strong><p style="font-size:13px;color:var(--text-secondary);">離線狀態下無法載入 D3.js，您仍可使用 <a href="index.html">隨身法典</a>離線查詢全文與引用。</p></div>`;
        return;
    }

    try {
        const response = await fetch("laws_graph.json");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        rawData = await response.json();
        preprocessData();
        initD3Stage();
        populateLawFilters();
        applyRouteFromHash(true);
        statusEl.hidden = true;
    } catch (err) {
        console.warn("Could not load laws_graph.json:", err);
        statusEl.innerHTML = `<div class="status-card"><strong>無法載入圖譜資料</strong><p style="font-size:13px;color:var(--text-secondary);">請在專案目錄執行以下指令開啟本機伺服器：</p><code>python3 run_server.py</code><p style="font-size:12px;"><a href="index.html">返回隨身法典</a></p></div>`;
    }
}

function preprocessData() {
    nodeById = new Map();
    lawCounts = new Map();
    lawFullNames = new Map();
    connectedLawCodes = new Set();
    outgoingMap = new Map();
    incomingMap = new Map();
    connectedNodeIds = new Set();
    reviewSourceSet = new Set();
    reviewEdgeNodeIds = new Set();
    reviewLawCodes = new Set();

    for (const n of rawData.nodes) {
        n.searchText = `${n.id} ${n.law_name} ${n.article_zh} ${n.text || ""}`.normalize("NFKC").replace(/台/g, "臺").toLowerCase();
        nodeById.set(n.id, n);
        lawCounts.set(n.law_code, (lawCounts.get(n.law_code) || 0) + 1);
        lawFullNames.set(n.law_code, n.law_name);
    }

    validEdges = rawData.edges.filter(e => e.target && nodeById.has(e.source) && nodeById.has(e.target));
    for (const e of validEdges) {
        connectedNodeIds.add(e.source);
        connectedNodeIds.add(e.target);
        const srcNode = nodeById.get(e.source);
        const tgtNode = nodeById.get(e.target);
        connectedLawCodes.add(srcNode.law_code);
        connectedLawCodes.add(tgtNode.law_code);

        if (!outgoingMap.has(e.source)) outgoingMap.set(e.source, []);
        outgoingMap.get(e.source).push(e);
        if (!incomingMap.has(e.target)) incomingMap.set(e.target, []);
        incomingMap.get(e.target).push(e);

        if (e.needs_review) {
            reviewSourceSet.add(e.source);
            reviewEdgeNodeIds.add(e.source);
            reviewEdgeNodeIds.add(e.target);
            reviewLawCodes.add(srcNode.law_code);
            reviewLawCodes.add(tgtNode.law_code);
        }
    }

    const summaryEl = document.getElementById("graph-dataset-summary");
    if (summaryEl) {
        summaryEl.textContent = `全庫共 ${lawCounts.size} 部法規、${rawData.nodes.length} 條、${validEdges.length} 條引用`;
    }
}

function initD3Stage() {
    const containerEl = document.getElementById("svg-container");
    containerEl.innerHTML = "";
    const width = containerEl.clientWidth || 800;
    const height = containerEl.clientHeight || 600;

    if (!tooltip) {
        tooltip = d3.select("body")
            .append("div")
            .attr("class", "graph-tooltip")
            .style("opacity", 0)
            .style("pointer-events", "none");
    }

    svg = d3.select("#svg-container")
        .append("svg")
        .attr("viewBox", [0, 0, width, height]);

    container = svg.append("g");

    zoomBehavior = d3.zoom()
        .scaleExtent([0.1, 8])
        .on("zoom", (event) => {
            container.attr("transform", event.transform);
            currentZoomScale = event.transform.k;
            updateZoomLabels();
        });

    svg.call(zoomBehavior);

    const defs = svg.append("defs");
    for (const [id, size, refX] of [["arrow-external", 6, 19], ["arrow-internal", 5, 19], ["arrow-highlighted", 7, 21]]) {
        defs.append("marker")
            .attr("id", id)
            .attr("viewBox", "0 -5 10 10")
            .attr("refX", refX)
            .attr("refY", 0)
            .attr("markerWidth", size)
            .attr("markerHeight", size)
            .attr("orient", "auto")
            .append("path")
            .attr("d", "M0,-5L10,0L0,5");
    }

    container.append("g").attr("class", "links");
    container.append("g").attr("class", "nodes");
    container.append("g").attr("class", "labels");

    svg.on("click", (event) => {
        if (event.target.tagName === "svg") deselectAllNodes();
    });
}

function setPreset(presetName, rebuild = true) {
    activeFilters.preset = presetName;
    activeFilters.egoNodeId = null;
    document.querySelectorAll(".preset-btn").forEach(b => b.classList.toggle("active", b.dataset.preset === presetName));

    const labelEl = document.getElementById("active-scope-label");
    if (presetName === "triad") {
        activeFilters.laws = new Set(["BUDGET", "SETTLE", "ACCOUNT"].filter(c => lawCounts.has(c)));
        activeFilters.connectedOnly = true;
        activeFilters.needsReviewOnly = false;
        if (labelEl) labelEl.textContent = "範圍：主計三法";
    } else if (presetName === "core") {
        activeFilters.laws = new Set(CORE_CODES.filter(c => lawCounts.has(c)));
        activeFilters.connectedOnly = true;
        activeFilters.needsReviewOnly = false;
        if (labelEl) labelEl.textContent = "範圍：核心主計法規";
    } else if (presetName === "connected") {
        activeFilters.laws = new Set(connectedLawCodes);
        activeFilters.connectedOnly = true;
        activeFilters.needsReviewOnly = false;
        if (labelEl) labelEl.textContent = "範圍：全部有引用條文";
    } else if (presetName === "review") {
        activeFilters.laws = new Set(reviewLawCodes);
        activeFilters.connectedOnly = true;
        activeFilters.needsReviewOnly = true;
        if (labelEl) labelEl.textContent = "範圍：僅需人工複核";
    } else {
        if (labelEl) labelEl.textContent = "範圍：自訂篩選";
    }

    syncFilterControlsUI();
    if (rebuild) rebuildGraph();
}

function syncFilterControlsUI() {
    document.getElementById("toggle-connected").checked = activeFilters.connectedOnly;
    document.getElementById("toggle-external").checked = activeFilters.external;
    document.getElementById("toggle-internal").checked = activeFilters.internal;
    document.getElementById("toggle-needs-review").checked = activeFilters.needsReviewOnly;
    document.querySelectorAll("#law-filters input[type=checkbox]").forEach(cb => {
        cb.checked = activeFilters.laws.has(cb.dataset.code);
    });
}

function applyRouteFromHash(initial = false) {
    const raw = safeDecode(location.hash.slice(1)).trim();
    if (!raw) {
        setPreset("triad", true);
        return;
    }

    if (nodeById.has(raw)) {
        const node = nodeById.get(raw);
        const lawsNeeded = new Set([node.law_code]);
        for (const e of outgoingMap.get(node.id) || []) {
            if (nodeById.has(e.target)) lawsNeeded.add(nodeById.get(e.target).law_code);
        }
        for (const e of incomingMap.get(node.id) || []) {
            if (nodeById.has(e.source)) lawsNeeded.add(nodeById.get(e.source).law_code);
        }
        activeFilters.preset = "custom";
        activeFilters.laws = lawsNeeded;
        activeFilters.connectedOnly = connectedNodeIds.has(node.id);
        activeFilters.external = true;
        activeFilters.internal = true;
        activeFilters.needsReviewOnly = false;
        activeFilters.search = "";
        activeFilters.egoNodeId = null;
        document.querySelectorAll(".preset-btn").forEach(b => b.classList.remove("active"));
        document.getElementById("active-scope-label").textContent = `聚焦：${citationText(node)}`;
        syncFilterControlsUI();
        rebuildGraph(node);
        return;
    }

    if (lawCounts.has(raw)) {
        const lawsNeeded = new Set([raw]);
        for (const e of validEdges) {
            const s = nodeById.get(e.source), t = nodeById.get(e.target);
            if (s.law_code === raw) lawsNeeded.add(t.law_code);
            if (t.law_code === raw) lawsNeeded.add(s.law_code);
        }
        activeFilters.preset = "custom";
        activeFilters.laws = lawsNeeded;
        activeFilters.connectedOnly = connectedLawCodes.has(raw);
        activeFilters.external = true;
        activeFilters.internal = true;
        activeFilters.needsReviewOnly = false;
        activeFilters.search = "";
        activeFilters.egoNodeId = null;
        document.querySelectorAll(".preset-btn").forEach(b => b.classList.remove("active"));
        document.getElementById("active-scope-label").textContent = `聚焦法規：${lawFullNames.get(raw) || raw}`;
        syncFilterControlsUI();
        rebuildGraph();
        return;
    }

    if (initial) setPreset("triad", true);
}

window.addEventListener("hashchange", () => {
    if (rawData) applyRouteFromHash(false);
});

function setupUIEventListeners() {
    // Presets
    document.querySelectorAll(".preset-btn").forEach(btn => {
        btn.addEventListener("click", () => setPreset(btn.dataset.preset, true));
    });

    // Search input
    const searchInput = document.getElementById("search-input");
    const clearSearchBtn = document.getElementById("clear-search");
    searchInput.addEventListener("input", (e) => {
        activeFilters.search = e.target.value.normalize("NFKC").replace(/台/g, "臺").toLowerCase().trim();
        clearSearchBtn.style.display = activeFilters.search ? "block" : "none";
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => rebuildGraph(), 180);
    });
    clearSearchBtn.addEventListener("click", () => {
        searchInput.value = "";
        activeFilters.search = "";
        clearSearchBtn.style.display = "none";
        rebuildGraph();
    });

    // Law list search
    document.getElementById("law-filter-search").addEventListener("input", (e) => {
        const q = e.target.value.normalize("NFKC").replace(/台/g, "臺").toLowerCase().trim();
        document.querySelectorAll("#law-filters .checkbox-item").forEach(item => {
            item.hidden = q && !item.dataset.search.includes(q);
        });
    });

    // Quick law select buttons
    document.getElementById("laws-all").addEventListener("click", () => {
        activeFilters.preset = "custom";
        activeFilters.laws = new Set(lawCounts.keys());
        activeFilters.connectedOnly = false;
        document.querySelectorAll(".preset-btn").forEach(b => b.classList.remove("active"));
        syncFilterControlsUI();
        rebuildGraph();
    });
    document.getElementById("laws-none").addEventListener("click", () => {
        activeFilters.preset = "custom";
        activeFilters.laws = new Set();
        document.querySelectorAll(".preset-btn").forEach(b => b.classList.remove("active"));
        syncFilterControlsUI();
        rebuildGraph();
    });
    document.getElementById("laws-connected").addEventListener("click", () => setPreset("connected", true));

    // Switches
    document.getElementById("toggle-connected").addEventListener("change", (e) => {
        activeFilters.connectedOnly = e.target.checked;
        rebuildGraph();
    });
    document.getElementById("toggle-external").addEventListener("change", (e) => {
        activeFilters.external = e.target.checked;
        rebuildGraph();
    });
    document.getElementById("toggle-internal").addEventListener("change", (e) => {
        activeFilters.internal = e.target.checked;
        rebuildGraph();
    });
    document.getElementById("toggle-needs-review").addEventListener("change", (e) => {
        activeFilters.needsReviewOnly = e.target.checked;
        rebuildGraph();
    });

    // HUD Zoom controls
    document.getElementById("zoom-in").addEventListener("click", () => {
        if (svg) svg.transition().duration(250).call(zoomBehavior.scaleBy, 1.35);
    });
    document.getElementById("zoom-out").addEventListener("click", () => {
        if (svg) svg.transition().duration(250).call(zoomBehavior.scaleBy, 1 / 1.35);
    });
    document.getElementById("zoom-fit").addEventListener("click", resetZoomFit);

    // Inspector controls
    document.getElementById("close-inspector").addEventListener("click", deselectAllNodes);
    document.getElementById("insp-copy").addEventListener("click", async () => {
        if (!selectedNode) return;
        const text = `${citationText(selectedNode)}：${selectedNode.text}`;
        const btn = document.getElementById("insp-copy");
        try {
            await navigator.clipboard.writeText(text);
            btn.textContent = "已複製";
            setTimeout(() => { btn.textContent = "複製公文引用"; }, 1400);
        } catch {
            prompt("複製下面這段文字：", text);
        }
    });
    document.getElementById("btn-focus-ego").addEventListener("click", () => {
        if (!selectedNode) return;
        if (activeFilters.egoNodeId === selectedNode.id) {
            activeFilters.egoNodeId = null;
        } else {
            activeFilters.egoNodeId = selectedNode.id;
        }
        rebuildGraph(selectedNode);
    });

    // Inspector tabs
    const tabButtons = document.querySelectorAll(".tab-btn");
    tabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            tabButtons.forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
        });
    });

    // Mobile drawer controls
    const sidebar = document.getElementById("sidebar-left");
    const backdrop = document.getElementById("mobile-backdrop");
    const closeBtn = document.getElementById("close-mobile-sidebar");
    const toggleMobile = (open) => {
        sidebar.classList.toggle("open", open);
        backdrop.classList.toggle("show", open);
        closeBtn.style.display = open ? "inline-flex" : "none";
    };
    document.getElementById("open-mobile-sidebar")?.addEventListener("click", () => toggleMobile(true));
    closeBtn?.addEventListener("click", () => toggleMobile(false));
    backdrop?.addEventListener("click", () => toggleMobile(false));
}

function populateLawFilters() {
    const filterContainer = document.getElementById("law-filters");
    filterContainer.innerHTML = "";
    const sortedCodes = [...lawCounts.keys()].sort((a, b) => {
        const ac = connectedLawCodes.has(a) ? 1 : 0;
        const bc = connectedLawCodes.has(b) ? 1 : 0;
        return (bc - ac) || (lawCounts.get(b) - lawCounts.get(a));
    });

    for (const code of sortedCodes) {
        const fullName = lawFullNames.get(code) || code;
        const item = document.createElement("label");
        item.className = "checkbox-item";
        item.dataset.search = `${code} ${fullName}`.toLowerCase();
        item.innerHTML = `
            <input type="checkbox" data-code="${escapeHtml(code)}">
            <span class="law-color-dot" style="background-color: ${escapeHtml(getLawColor(code))}"></span>
            <span class="chk-name" title="${escapeHtml(fullName)}">${escapeHtml(fullName)}</span>
            <span style="color: var(--text-muted); font-size: 10px; margin-left: auto;">${lawCounts.get(code)}</span>
        `;
        item.querySelector("input").addEventListener("change", (e) => {
            activeFilters.preset = "custom";
            document.querySelectorAll(".preset-btn").forEach(b => b.classList.remove("active"));
            document.getElementById("active-scope-label").textContent = "範圍：自訂篩選";
            if (e.target.checked) activeFilters.laws.add(code);
            else activeFilters.laws.delete(code);
            rebuildGraph();
        });
        filterContainer.appendChild(item);
    }
}

function populateLegend(visibleNodes) {
    const legendContainer = document.getElementById("legend-items");
    legendContainer.innerHTML = "";
    const shownCodes = [...new Set(visibleNodes.map(n => n.law_code))];
    if (!shownCodes.length) {
        legendContainer.innerHTML = `<span style="font-size:11px;color:var(--text-muted);">目前無顯示法規</span>`;
        return;
    }
    const maxShow = 14;
    for (const code of shownCodes.slice(0, maxShow)) {
        const item = document.createElement("div");
        item.className = "legend-item";
        item.innerHTML = `<span class="legend-color" style="background-color:${escapeHtml(getLawColor(code))}"></span><span>${escapeHtml(lawFullNames.get(code) || code)}</span>`;
        legendContainer.appendChild(item);
    }
    if (shownCodes.length > maxShow) {
        const more = document.createElement("div");
        more.className = "legend-item";
        more.style.color = "var(--text-muted)";
        more.textContent = `…另有 ${shownCodes.length - maxShow} 部法規`;
        legendContainer.appendChild(more);
    }
}

function updateKPIs(visibleNodes, visibleEdges) {
    document.getElementById("kpi-nodes").innerText = visibleNodes.length;
    document.getElementById("kpi-edges").innerText = visibleEdges.length;
    document.getElementById("kpi-laws").innerText = new Set(visibleNodes.map(n => n.law_code)).size;
    document.getElementById("kpi-review").innerText = visibleEdges.filter(e => e.needs_review).length;
}

function computeSubgraph() {
    let candidateIds = new Set();

    if (activeFilters.egoNodeId && nodeById.has(activeFilters.egoNodeId)) {
        candidateIds.add(activeFilters.egoNodeId);
        for (const e of outgoingMap.get(activeFilters.egoNodeId) || []) {
            if (!activeFilters.external && e.is_external) continue;
            if (!activeFilters.internal && !e.is_external) continue;
            if (activeFilters.needsReviewOnly && !e.needs_review) continue;
            candidateIds.add(e.target);
        }
        for (const e of incomingMap.get(activeFilters.egoNodeId) || []) {
            if (!activeFilters.external && e.is_external) continue;
            if (!activeFilters.internal && !e.is_external) continue;
            if (activeFilters.needsReviewOnly && !e.needs_review) continue;
            candidateIds.add(e.source);
        }
    } else {
        for (const node of rawData.nodes) {
            if (!activeFilters.laws.has(node.law_code)) continue;
            if (activeFilters.connectedOnly && !connectedNodeIds.has(node.id)) continue;
            if (activeFilters.search && !node.searchText.includes(activeFilters.search)) continue;
            if (activeFilters.needsReviewOnly && !reviewEdgeNodeIds.has(node.id)) continue;
            candidateIds.add(node.id);
        }
    }

    const activeEdgeLinks = [];
    const linkedNodeIds = new Set();
    for (const e of validEdges) {
        if (!candidateIds.has(e.source) || !candidateIds.has(e.target)) continue;
        if (!activeFilters.external && e.is_external) continue;
        if (!activeFilters.internal && !e.is_external) continue;
        if (activeFilters.needsReviewOnly && !e.needs_review) continue;
        activeEdgeLinks.push({ ...e });
        linkedNodeIds.add(e.source);
        linkedNodeIds.add(e.target);
    }

    // If connectedOnly is active without a text search, hide nodes left isolated by edge attribute filters
    const finalNodes = rawData.nodes.filter(n => {
        if (!candidateIds.has(n.id)) return false;
        if (activeFilters.connectedOnly && !activeFilters.search && !activeFilters.egoNodeId && selectedNode?.id !== n.id) {
            return linkedNodeIds.has(n.id);
        }
        return true;
    });

    return { visibleNodes: finalNodes, visibleEdges: activeEdgeLinks };
}

function rebuildGraph(focusTarget = null) {
    if (!svg || !rawData) return;
    if (simulation) simulation.stop();

    const { visibleNodes, visibleEdges } = computeSubgraph();
    updateKPIs(visibleNodes, visibleEdges);
    populateLegend(visibleNodes);

    const statusEl = document.getElementById("graph-status");
    if (!visibleNodes.length) {
        statusEl.hidden = false;
        statusEl.innerHTML = `<div class="status-card"><strong>沒有符合條件的條文節點</strong><span style="font-size:13px;color:var(--text-secondary);">試著切換快速檢視範圍或放寬左側篩選條件。</span></div>`;
    } else {
        statusEl.hidden = true;
    }

    const containerEl = document.getElementById("svg-container");
    const width = containerEl.clientWidth || 800;
    const height = containerEl.clientHeight || 600;

    // Seed any unpositioned nodes gently near center
    for (const n of visibleNodes) {
        if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) {
            n.x = width / 2 + (Math.random() - 0.5) * 160;
            n.y = height / 2 + (Math.random() - 0.5) * 160;
        }
    }

    const linksG = container.select("g.links");
    const nodesG = container.select("g.nodes");
    const labelsG = container.select("g.labels");

    linkSelection = linksG
        .selectAll("path")
        .data(visibleEdges, d => `${d.source}-${d.target}-${d.kind}`)
        .join("path")
        .attr("class", d => `edge-path ${d.is_external ? "external" : "internal"} ${d.kind === "relative" ? "relative" : ""}`)
        .attr("marker-end", d => d.is_external ? "url(#arrow-external)" : "url(#arrow-internal)");

    simulation = d3.forceSimulation(visibleNodes)
        .force("link", d3.forceLink(visibleEdges).id(d => d.id).distance(105).strength(0.55))
        .force("charge", d3.forceManyBody().strength(-160))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide().radius(24));

    nodeSelection = nodesG
        .selectAll("circle")
        .data(visibleNodes, d => d.id)
        .join("circle")
        .attr("class", d => `node-circle ${reviewSourceSet.has(d.id) ? "review-needed" : ""}`)
        .attr("r", 8.5)
        .attr("fill", d => getLawColor(d.law_code))
        .call(drag(simulation));

    labelSelection = labelsG
        .selectAll("text")
        .data(visibleNodes, d => d.id)
        .join("text")
        .attr("class", "node-label")
        .attr("dy", -13)
        .text(d => shortNodeLabel(d));

    nodeSelection
        .on("mouseover", handleMouseOverNode)
        .on("mousemove", handleMouseMoveNode)
        .on("mouseout", handleMouseOutNode)
        .on("click", handleNodeClick);

    const renderTick = () => {
        linkSelection.attr("d", d => {
            const dx = d.target.x - d.source.x;
            const dy = d.target.y - d.source.y;
            const dr = Math.sqrt(dx * dx + dy * dy) * 1.35 || 1;
            return `M${d.source.x},${d.source.y}A${dr},${dr} 0 0,1 ${d.target.x},${d.target.y}`;
        });
        nodeSelection.attr("cx", d => d.x).attr("cy", d => d.y);
        labelSelection.attr("x", d => d.x).attr("y", d => d.y);
    };

    simulation.on("tick", renderTick);

    // Pre-settle synchronously so positions are meaningful immediately
    const preTicks = visibleNodes.length <= 250 ? 90 : visibleNodes.length <= 700 ? 45 : 20;
    for (let i = 0; i < preTicks; i++) simulation.tick();
    renderTick();

    if (focusTarget && visibleNodes.some(n => n.id === focusTarget.id)) {
        selectNode(focusTarget);
    } else if (selectedNode && visibleNodes.some(n => n.id === selectedNode.id)) {
        selectNode(selectedNode, false);
    } else {
        if (selectedNode) deselectAllNodes();
        resetZoomFit(visibleNodes);
    }

    updateZoomLabels();
}

function updateZoomLabels() {
    if (!labelSelection) return;
    const hideSmall = currentZoomScale < 0.75;
    labelSelection.classed("zoom-hidden", d => {
        if (!hideSmall) return false;
        return !activeNeighborIds.has(d.id);
    });
}

function drag(sim) {
    return d3.drag()
        .on("start", (event, d) => {
            if (!event.active) sim.alphaTarget(0.25).restart();
            d.fx = d.x;
            d.fy = d.y;
        })
        .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
        })
        .on("end", (event, d) => {
            if (!event.active) sim.alphaTarget(0);
            d.fx = null;
            d.fy = null;
        });
}

function handleMouseOverNode(event, d) {
    if (tooltip) {
        tooltip.transition().duration(120).style("opacity", 0.98);
        const snippet = d.text ? (d.text.length > 110 ? d.text.substring(0, 110) + "…" : d.text) : "此條無文字說明。";
        tooltip.html(`
            <div class="tooltip-header">
                <span class="tooltip-badge" style="background-color:${escapeHtml(getLawColor(d.law_code))}">${escapeHtml(d.law_code)}</span>
                <span class="tooltip-id">${escapeHtml(d.id)}</span>
            </div>
            <div class="tooltip-title">${escapeHtml(d.law_name)} ${escapeHtml(d.article_zh)}</div>
            <div class="tooltip-body">${escapeHtml(snippet)}</div>
        `);
    }

    labelSelection.filter(n => n.id === d.id)
        .text(`${d.law_name} ${d.article_zh}`)
        .classed("hovered-label", true);

    if (selectedNode) return;

    const neighbors = new Set([d.id]);
    linkSelection.each(link => {
        if (link.source.id === d.id) neighbors.add(link.target.id);
        else if (link.target.id === d.id) neighbors.add(link.source.id);
    });

    nodeSelection.classed("dimmed", n => !neighbors.has(n.id));
    labelSelection.classed("dimmed", n => !neighbors.has(n.id));
    linkSelection.classed("dimmed", true);
    linkSelection.filter(link => link.source.id === d.id || link.target.id === d.id)
        .classed("dimmed", false)
        .classed("highlighted", true)
        .attr("marker-end", "url(#arrow-highlighted)");
}

function handleMouseMoveNode(event) {
    if (!tooltip) return;
    const el = tooltip.node();
    const w = el?.offsetWidth || 300;
    const h = el?.offsetHeight || 120;
    let left = event.clientX + 14;
    let top = event.clientY + 14;
    if (left + w > window.innerWidth) left = event.clientX - w - 14;
    if (top + h > window.innerHeight) top = event.clientY - h - 14;
    tooltip.style("left", Math.max(8, left) + "px").style("top", Math.max(8, top) + "px");
}

function handleMouseOutNode(event, d) {
    if (tooltip) tooltip.transition().duration(120).style("opacity", 0);
    labelSelection.filter(n => n.id === d.id)
        .text(shortNodeLabel(d))
        .classed("hovered-label", false);
    if (selectedNode) return;
    resetHighlights();
}

function resetHighlights() {
    if (!nodeSelection) return;
    activeNeighborIds = new Set();
    nodeSelection.classed("dimmed", false).classed("highlighted", false);
    labelSelection.classed("dimmed", false);
    linkSelection.classed("dimmed", false).classed("highlighted", false)
        .attr("marker-end", d => d.is_external ? "url(#arrow-external)" : "url(#arrow-internal)");
    updateZoomLabels();
}

function handleNodeClick(event, d) {
    event.stopPropagation();
    selectNode(d);
}

function deselectAllNodes() {
    selectedNode = null;
    if (activeFilters.egoNodeId) {
        activeFilters.egoNodeId = null;
        rebuildGraph();
        return;
    }
    resetHighlights();
    document.getElementById("inspector-panel").classList.add("collapsed");
}

function selectNode(node, shouldZoom = true) {
    selectedNode = node;
    activeNeighborIds = new Set([node.id]);

    nodeSelection.classed("highlighted", false);
    linkSelection.each(link => {
        if (link.source.id === node.id) activeNeighborIds.add(link.target.id);
        else if (link.target.id === node.id) activeNeighborIds.add(link.source.id);
    });

    nodeSelection.classed("dimmed", n => !activeNeighborIds.has(n.id));
    labelSelection.classed("dimmed", n => !activeNeighborIds.has(n.id));
    linkSelection.classed("dimmed", true);
    nodeSelection.filter(n => n.id === node.id).classed("highlighted", true);
    linkSelection.filter(link => link.source.id === node.id || link.target.id === node.id)
        .classed("dimmed", false)
        .classed("highlighted", true)
        .attr("marker-end", "url(#arrow-highlighted)");
    updateZoomLabels();

    document.getElementById("insp-law-badge").innerText = node.law_code;
    document.getElementById("insp-law-badge").style.backgroundColor = getLawColor(node.law_code);
    document.getElementById("insp-title").innerText = node.article_zh;
    document.getElementById("insp-law-fullname").innerText = node.law_name;
    document.getElementById("insp-text").innerText = node.text || "此條無文字說明。";
    document.getElementById("insp-codex-link").href = `index.html#${encodeURIComponent(node.id)}`;

    const egoBtn = document.getElementById("btn-focus-ego");
    const isEgo = activeFilters.egoNodeId === node.id;
    egoBtn.classList.toggle("active", isEgo);
    egoBtn.setAttribute("aria-pressed", String(isEgo));
    egoBtn.textContent = isEgo ? "顯示原範圍" : "只看此條鄰居";

    const outEdges = outgoingMap.get(node.id) || [];
    const inEdges = incomingMap.get(node.id) || [];
    populateCitationsList("insp-outgoing-list", outEdges, "target");
    populateCitationsList("insp-incoming-list", inEdges, "source");
    document.getElementById("insp-out-count").innerText = outEdges.length;
    document.getElementById("insp-in-count").innerText = inEdges.length;

    document.getElementById("inspector-panel").classList.remove("collapsed");
    if (shouldZoom) zoomToNode(node);
}

function populateCitationsList(elementId, edges, directionKey) {
    const listEl = document.getElementById(elementId);
    listEl.innerHTML = "";
    if (!edges.length) {
        listEl.innerHTML = `<li class="no-citations">無引用記錄</li>`;
        return;
    }

    for (const edge of edges) {
        const targetNode = nodeById.get(edge[directionKey]);
        if (!targetNode) continue;
        const item = document.createElement("li");
        item.className = "citation-item";
        const badgeClass = edge.is_external ? "external" : "internal";
        const badgeLabel = edge.is_external ? "跨法規" : "本法";
        let metaHtml = `<span class="cit-badge ${badgeClass}">${badgeLabel}</span>`;
        if (edge.kind === "relative") metaHtml += `<span class="cit-badge relative">相對引用</span>`;
        const subRefHtml = edge.sub_ref ? `<div class="citation-subref">細部：${escapeHtml(edge.sub_ref)}</div>` : "";
        const reviewHtml = edge.needs_review
            ? `<div class="citation-review-flag"><span>⚠️</span><span>信心度 ${Math.round(edge.confidence * 100)}% 需複核</span></div>` : "";

        item.innerHTML = `
            <div class="citation-header">
                <span class="citation-target-id">${escapeHtml(targetNode.law_name)} ${escapeHtml(targetNode.article_zh)}</span>
                <div class="citation-meta">${metaHtml}</div>
            </div>
            ${subRefHtml}
            ${reviewHtml}
        `;

        item.addEventListener("click", () => {
            if (!activeFilters.laws.has(targetNode.law_code) || (activeFilters.egoNodeId && activeFilters.egoNodeId !== targetNode.id)) {
                activeFilters.laws.add(targetNode.law_code);
                activeFilters.egoNodeId = null;
                syncFilterControlsUI();
                rebuildGraph(targetNode);
            } else {
                selectNode(targetNode);
            }
        });
        listEl.appendChild(item);
    }
}

function zoomToNode(node) {
    if (!svg || !Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
    const el = document.getElementById("svg-container");
    const width = el.clientWidth || 800;
    const height = el.clientHeight || 600;
    const transform = d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(1.35)
        .translate(-node.x, -node.y);
    svg.transition().duration(450).call(zoomBehavior.transform, transform);
}

function resetZoomFit(nodesSubset = null) {
    if (!svg || !rawData) return;
    const list = Array.isArray(nodesSubset) ? nodesSubset : (nodeSelection ? nodeSelection.data() : []);
    if (!list.length) return;

    const el = document.getElementById("svg-container");
    const width = el.clientWidth || 800;
    const height = el.clientHeight || 600;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of list) {
        if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
        if (n.x < minX) minX = n.x;
        if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.y > maxY) maxY = n.y;
    }
    if (!Number.isFinite(minX)) return;

    const gw = (maxX - minX) || 120;
    const gh = (maxY - minY) || 120;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const scale = Math.max(0.2, Math.min(width / (gw + 120), height / (gh + 120), 1.4));
    const transform = d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(scale)
        .translate(-cx, -cy);
    svg.transition().duration(450).call(zoomBehavior.transform, transform);
}
