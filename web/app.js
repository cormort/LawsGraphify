// Laws Graphify - Interactive Knowledge Graph Application

let rawData = null; // Store the original graph dataset
let svg = null;
let container = null;
let simulation = null;
let zoomBehavior = null;

// Graph Nodes & Edges visual selections
let nodeSelection = null;
let linkSelection = null;
let labelSelection = null;
let tooltip = null;

// Keep track of active filters & selections
const activeFilters = {
    search: "",
    laws: new Set(), // Set of selected law codes to display
    external: true,
    internal: true,
    needsReviewOnly: false
};

let selectedNode = null;
let searchTimeout = null;

// Color Palette for specific law codes (HSL colors)
const LAW_COLORS = {
    "CONST": "#f87171",    // Red
    "BUDGET": "#60a5fa",   // Blue
    "SETTLE": "#c084fc",   // Purple
    "ACCOUNT": "#34d399",  // Green
    "CPA": "#fbbf24",      // Amber
    "IACP": "#2dd4bf",     // Teal
    "CSMF": "#f472b6",     // Pink
    "CGMBPP": "#fb7185",   // Rose
    "CNGSF": "#a78bfa",    // Violet
    "CACGSB": "#38bdf8",   // Sky
    "CNDR": "#a3e635",     // Lime
    "FY2027GBPP": "#22d3ee",    // Cyan
    "FY2027GSUBPP": "#818cf8",  // Indigo
};

// Escape data before it goes into innerHTML / .html()
function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
}

// Fallback color generator based on string hash
function getLawColor(code) {
    if (LAW_COLORS[code]) return LAW_COLORS[code];
    let hash = 0;
    for (let i = 0; i < code.length; i++) {
        hash = code.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash % 360);
    return `hsl(${h}, 70%, 60%)`;
}

// Initialize Application
document.addEventListener("DOMContentLoaded", () => {
    initApp();
});

async function initApp() {
    setupUIEventListeners();
    try {
        const response = await fetch("laws_graph.json");
        if (!response.ok) throw new Error("CORS or File Not Found");
        rawData = await response.json();
        setupGraph();
    } catch (err) {
        console.warn("Could not fetch laws_graph.json directly, searching fallback paths or checking inline data...", err);
        // Fallback: Show a friendly overlay in case of CORS errors
        document.getElementById("svg-container").innerHTML = `
            <div class="cors-error-container">
                <div class="cors-card">
                    <span class="cors-icon">⚠️</span>
                    <h3>CORS 跨來源存取阻擋</h3>
                    <p>瀏覽器安全機制阻止了以本地檔案 (file://) 讀取 JSON。請在專案目錄下執行以下指令開啟本地伺服器：</p>
                    <code>python3 -m http.server 8000</code>
                    <p>然後在瀏覽器中開啟：<a href="http://localhost:8000/web/" target="_blank">http://localhost:8000/web/</a></p>
                </div>
            </div>
        `;
    }
}

// Setup Event Listeners for HTML inputs
function setupUIEventListeners() {
    // Search input
    const searchInput = document.getElementById("search-input");
    const clearSearchBtn = document.getElementById("clear-search");

    searchInput.addEventListener("input", (e) => {
        activeFilters.search = e.target.value.toLowerCase().trim();
        clearSearchBtn.style.display = activeFilters.search ? "block" : "none";
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => { applyFilters(); }, 150);
    });

    clearSearchBtn.addEventListener("click", () => {
        searchInput.value = "";
        activeFilters.search = "";
        clearSearchBtn.style.display = "none";
        applyFilters();
    });

    // Toggle switches
    document.getElementById("toggle-external").addEventListener("change", (e) => {
        activeFilters.external = e.target.checked;
        applyFilters();
    });

    document.getElementById("toggle-internal").addEventListener("change", (e) => {
        activeFilters.internal = e.target.checked;
        applyFilters();
    });

    document.getElementById("toggle-needs-review").addEventListener("change", (e) => {
        activeFilters.needsReviewOnly = e.target.checked;
        applyFilters();
    });

    // HUD Zoom controls
    document.getElementById("zoom-in").addEventListener("click", () => {
        if (svg) svg.transition().duration(300).call(zoomBehavior.scaleBy, 1.3);
    });

    document.getElementById("zoom-out").addEventListener("click", () => {
        if (svg) svg.transition().duration(300).call(zoomBehavior.scaleBy, 1 / 1.3);
    });

    document.getElementById("zoom-fit").addEventListener("click", () => {
        resetZoomFit();
    });

    // Inspector close button
    document.getElementById("close-inspector").addEventListener("click", () => {
        deselectAllNodes();
    });

    // Inspector Tab Switching
    const tabButtons = document.querySelectorAll(".tab-btn");
    tabButtons.forEach(btn => {
        btn.addEventListener("click", (e) => {
            tabButtons.forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
            
            btn.classList.add("active");
            const tabId = `tab-${btn.dataset.tab}`;
            document.getElementById(tabId).classList.add("active");
        });
    });
}

// Setup D3 Graphics
function setupGraph() {
    if (!rawData) return;

    const containerEl = document.getElementById("svg-container");
    containerEl.innerHTML = ""; // Clear loader

    const width = containerEl.clientWidth;
    const height = containerEl.clientHeight;

    // Initialize tooltip selection if not already created
    if (!tooltip) {
        tooltip = d3.select("body")
            .append("div")
            .attr("class", "graph-tooltip")
            .style("opacity", 0);
    }

    // Create SVG element
    svg = d3.select("#svg-container")
        .append("svg")
        .attr("viewBox", [0, 0, width, height]);

    // Create a group that contains all zoomable graph contents
    container = svg.append("g");

    // Add Zoom Behavior
    zoomBehavior = d3.zoom()
        .scaleExtent([0.1, 8])
        .on("zoom", (event) => {
            container.attr("transform", event.transform);
        });

    svg.call(zoomBehavior);

    // Setup marker arrows for directed links
    const defs = svg.append("defs");
    
    // External Edge arrow
    defs.append("marker")
        .attr("id", "arrow-external")
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 20) // Position near node circle edge (circle radius + offset)
        .attr("refY", 0)
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-5L10,0L0,5");

    // Internal Edge arrow
    defs.append("marker")
        .attr("id", "arrow-internal")
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 20)
        .attr("refY", 0)
        .attr("markerWidth", 5)
        .attr("markerHeight", 5)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-5L10,0L0,5");

    // Highlighted Edge arrow
    defs.append("marker")
        .attr("id", "arrow-highlighted")
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 22)
        .attr("refY", 0)
        .attr("markerWidth", 7)
        .attr("markerHeight", 7)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-5L10,0L0,5");

    // Calculate initial metrics & KPIs
    computeKPIs();
    populateLawFilters();
    populateLegend();

    // Map source/target node IDs into object references for D3 simulation
    const nodeById = new Map(rawData.nodes.map(d => [d.id, d]));
    
    // Filter out edges whose target nodes do not exist in the node set
    const validEdges = rawData.edges.filter(d => {
        return d.target && nodeById.has(d.source) && nodeById.has(d.target);
    });

    // Setup simulation
    simulation = d3.forceSimulation(rawData.nodes)
        .force("link", d3.forceLink(validEdges).id(d => d.id).distance(120).strength(0.5))
        .force("charge", d3.forceManyBody().strength(-150))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide().radius(25));

    // Render Edges
    linkSelection = container.append("g")
        .attr("class", "links")
        .selectAll("path")
        .data(validEdges)
        .join("path")
        .attr("class", d => `edge-path ${d.is_external ? 'external' : 'internal'} ${d.kind === 'relative' ? 'relative' : ''}`)
        .attr("marker-end", d => d.is_external ? "url(#arrow-external)" : "url(#arrow-internal)");

    // Render Nodes
    nodeSelection = container.append("g")
        .attr("class", "nodes")
        .selectAll("circle")
        .data(rawData.nodes)
        .join("circle")
        .attr("class", d => {
            const hasReview = validEdges.some(e => e.source.id === d.id && e.needs_review);
            return `node-circle ${hasReview ? 'review-needed' : ''}`;
        })
        .attr("r", 9)
        .attr("fill", d => getLawColor(d.law_code))
        .call(drag(simulation));

    // Render Labels
    labelSelection = container.append("g")
        .attr("class", "labels")
        .selectAll("text")
        .data(rawData.nodes)
        .join("text")
        .attr("class", "node-label")
        .attr("fill", "#e2e8f0")
        .attr("dy", -14)
        .text(d => d.id);

    // Setup mouse interactions
    nodeSelection.on("mouseover", handleMouseOverNode)
        .on("mousemove", handleMouseMoveNode)
        .on("mouseout", handleMouseOutNode)
        .on("click", handleNodeClick);

    // Ticks for simulation
    simulation.on("tick", () => {
        linkSelection.attr("d", d => {
            const dx = d.target.x - d.source.x;
            const dy = d.target.y - d.source.y;
            const dr = Math.sqrt(dx * dx + dy * dy);
            // Draw slightly curved paths so parallel bi-directional edges don't overlap
            return `M${d.source.x},${d.source.y}A${dr},${dr} 0 0,1 ${d.target.x},${d.target.y}`;
        });

        nodeSelection
            .attr("cx", d => d.x)
            .attr("cy", d => d.y);

        labelSelection
            .attr("x", d => d.x)
            .attr("y", d => d.y);
    });

    // Click on empty canvas to deselect
    svg.on("click", (event) => {
        if (event.target.tagName === "svg") { deselectAllNodes(); }
    });

    // Fit once the layout settles (node positions are meaningless before that)
    simulation.on("end.fit", () => {
        simulation.on("end.fit", null);
        resetZoomFit();
    });
}

// Compute statistics and update KPIs
function computeKPIs() {
    document.getElementById("kpi-nodes").innerText = rawData.nodes.length;
    document.getElementById("kpi-edges").innerText = rawData.edges.length;

    const lawCodes = new Set(rawData.nodes.map(n => n.law_code));
    document.getElementById("kpi-laws").innerText = lawCodes.size;

    const reviewCount = rawData.edges.filter(e => e.needs_review).length;
    document.getElementById("kpi-review").innerText = reviewCount;
}

// Dynamically generate law filter checkboxes
function populateLawFilters() {
    const filterContainer = document.getElementById("law-filters");
    filterContainer.innerHTML = "";

    // Count nodes per law code
    const lawCounts = {};
    const lawFullNames = {};
    
    rawData.nodes.forEach(n => {
        lawCounts[n.law_code] = (lawCounts[n.law_code] || 0) + 1;
        lawFullNames[n.law_code] = n.law_name;
    });

    // Populate active laws filter set with all codes initially
    Object.keys(lawCounts).forEach(code => activeFilters.laws.add(code));

    // Render checkbox options sorted by article count descending
    const sortedCodes = Object.keys(lawCounts).sort((a, b) => lawCounts[b] - lawCounts[a]);
    
    sortedCodes.forEach(code => {
        const item = document.createElement("div");
        item.className = "checkbox-item";
        
        const dot = `<span class="law-color-dot" style="background-color: ${escapeHtml(getLawColor(code))}"></span>`;
        const countBadge = `<span style="color: var(--text-muted); font-size: 10px; margin-left: auto;">(${lawCounts[code]})</span>`;
        
        item.innerHTML = `
            <input type="checkbox" id="chk-${escapeHtml(code)}" checked data-code="${escapeHtml(code)}">
            ${dot}
            <span>${escapeHtml(code)} - ${escapeHtml(lawFullNames[code].substring(0, 10))}${lawFullNames[code].length > 10 ? '...' : ''}</span>
            ${countBadge}
        `;

        item.querySelector("input").addEventListener("change", (e) => {
            const codeVal = e.target.dataset.code;
            if (e.target.checked) {
                activeFilters.laws.add(codeVal);
            } else {
                activeFilters.laws.delete(codeVal);
            }
            applyFilters();
        });

        filterContainer.appendChild(item);
    });
}

// Generate the legend labels dynamically
function populateLegend() {
    const legendContainer = document.getElementById("legend-items");
    legendContainer.innerHTML = "";

    const lawFullNames = {};
    rawData.nodes.forEach(n => {
        lawFullNames[n.law_code] = n.law_name;
    });

    Object.keys(lawFullNames).forEach(code => {
        const item = document.createElement("div");
        item.className = "legend-item";
        item.innerHTML = `
            <span class="legend-color" style="background-color: ${escapeHtml(getLawColor(code))}"></span>
            <span>${escapeHtml(code)} - ${escapeHtml(lawFullNames[code])}</span>
        `;
        legendContainer.appendChild(item);
    });
}

// Apply searches & active toggles to show/hide nodes and links
function applyFilters() {
    if (!svg) return;

    // Filter matching nodes
    const visibleNodeIds = new Set();

    rawData.nodes.forEach(node => {
        // 1. Check Law Code filter
        if (!activeFilters.laws.has(node.law_code)) return;

        // 2. Check keyword search
        if (activeFilters.search) {
            const matchId = node.id.toLowerCase().includes(activeFilters.search);
            const matchText = node.text.toLowerCase().includes(activeFilters.search);
            const matchName = node.law_name.toLowerCase().includes(activeFilters.search);
            if (!matchId && !matchText && !matchName) return;
        }

        visibleNodeIds.add(node.id);
    });

    // Check if needs_review filter is active: further restrict visibleNodeIds
    if (activeFilters.needsReviewOnly) {
        const nodesCitingWithReview = new Set();
        rawData.edges.forEach(edge => {
            if (edge.needs_review && edge.target) {
                const srcId = typeof edge.source === 'object' ? edge.source.id : edge.source;
                const tgtId = typeof edge.target === 'object' ? edge.target.id : edge.target;
                nodesCitingWithReview.add(srcId);
                nodesCitingWithReview.add(tgtId);
            }
        });

        // Retain only nodes connected to review edges
        for (let id of visibleNodeIds) {
            if (!nodesCitingWithReview.has(id)) {
                visibleNodeIds.delete(id);
            }
        }
    }

    // Filter matching links
    linkSelection.style("display", d => {
        const srcId = d.source.id;
        const tgtId = d.target.id;
        
        // Both nodes must be visible
        if (!visibleNodeIds.has(srcId) || !visibleNodeIds.has(tgtId)) return "none";

        // Check external / internal visibility toggle
        if (!activeFilters.external && d.is_external) return "none";
        if (!activeFilters.internal && !d.is_external) return "none";

        // Check review flag toggle
        if (activeFilters.needsReviewOnly && !d.needs_review) return "none";

        return "block";
    });

    // Toggle node circle visibility
    nodeSelection.style("display", d => visibleNodeIds.has(d.id) ? "block" : "none");

    // Toggle label visibility
    labelSelection.style("display", d => {
        // Label should only show if node is visible
        if (!visibleNodeIds.has(d.id)) return "none";
        // If zoom scale is very small, hide label to prevent cluttering
        return "block";
    });
}

// Drag functionality for D3 nodes
function drag(sim) {
    function dragstarted(event, d) {
        if (!event.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }

    function dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }

    function dragended(event, d) {
        if (!event.active) sim.alphaTarget(0);
        d.fx = null;
        d.fy = null;
    }

    return d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended);
}

// Mouse Over Highlight
function handleMouseOverNode(event, d) {
    // Display glassmorphic tooltip
    if (tooltip) {
        tooltip.transition()
            .duration(150)
            .style("opacity", 0.98);
        
        const textSnippet = d.text ? (d.text.length > 120 ? d.text.substring(0, 120) + "..." : d.text) : "此條無文字說明。";
        
        tooltip.html(`
            <div class="tooltip-header">
                <span class="tooltip-badge" style="background-color: ${escapeHtml(getLawColor(d.law_code))}">${escapeHtml(d.law_code)}</span>
                <span class="tooltip-id">${escapeHtml(d.id)}</span>
            </div>
            <div class="tooltip-title">${escapeHtml(d.law_name)} ${escapeHtml(d.article_zh)}</div>
            <div class="tooltip-body">${escapeHtml(textSnippet)}</div>
        `);
    }

    // Morph node label to full Chinese regulation name
    labelSelection.filter(n => n.id === d.id)
        .text(`${d.law_name} ${d.article_zh}`)
        .classed("hovered-label", true);

    if (selectedNode) return; // Keep clicked selection locked for neighbor highlighting

    // Highlight immediate neighbors
    const neighbors = new Set([d.id]);
    const connectedLinks = [];

    linkSelection.each(link => {
        if (link.source.id === d.id) {
            neighbors.add(link.target.id);
            connectedLinks.push(link);
        } else if (link.target.id === d.id) {
            neighbors.add(link.source.id);
            connectedLinks.push(link);
        }
    });

    nodeSelection.classed("dimmed", n => !neighbors.has(n.id));
    labelSelection.classed("dimmed", n => !neighbors.has(n.id));
    linkSelection.classed("dimmed", true);

    linkSelection.filter(link => link.source.id === d.id || link.target.id === d.id)
        .classed("dimmed", false)
        .classed("highlighted", true)
        .attr("marker-end", "url(#arrow-highlighted)");
}

// Mouse Move tooltips position updates
function handleMouseMoveNode(event, d) {
    if (!tooltip) return;
    const tooltipEl = tooltip.node();
    if (!tooltipEl) return;
    
    const tooltipWidth = tooltipEl.offsetWidth || 320;
    const tooltipHeight = tooltipEl.offsetHeight || 120;
    
    let left = event.pageX + 15;
    let top = event.pageY + 15;
    
    // Prevent off-screen boundaries
    if (left + tooltipWidth > window.innerWidth) {
        left = event.pageX - tooltipWidth - 15;
    }
    if (top + tooltipHeight > window.innerHeight) {
        top = event.pageY - tooltipHeight - 15;
    }
    
    if (left < 0) left = 10;
    if (top < 0) top = 10;
    
    tooltip
        .style("left", left + "px")
        .style("top", top + "px");
}

// Mouse Out Reset Highlight
function handleMouseOutNode(event, d) {
    // Hide tooltip
    if (tooltip) {
        tooltip.transition()
            .duration(150)
            .style("opacity", 0);
    }

    // Restore label to original ID format
    labelSelection.filter(n => n.id === d.id)
        .text(d.id)
        .classed("hovered-label", false);

    if (selectedNode) return; // Keep clicked selection locked
    resetHighlights();
}

// Reset D3 Highlights
function resetHighlights() {
    nodeSelection.classed("dimmed", false).classed("highlighted", false);
    labelSelection.classed("dimmed", false);
    linkSelection.classed("dimmed", false).classed("highlighted", false);
    
    linkSelection.attr("marker-end", d => {
        return d.is_external ? "url(#arrow-external)" : "url(#arrow-internal)";
    });
}

// Click node handler
function handleNodeClick(event, d) {
    event.stopPropagation();
    selectNode(d);
}

// Deselect selection
function deselectAllNodes() {
    selectedNode = null;
    resetHighlights();
    document.getElementById("inspector-panel").classList.add("collapsed");
}

// Main node selection logic
function selectNode(node) {
    selectedNode = node;
    
    // Highlight connected elements in D3
    const neighbors = new Set([node.id]);
    const outgoingCitations = [];
    const incomingCitations = [];

    // Reset highlighted states
    nodeSelection.classed("highlighted", false);
    
    linkSelection.each(link => {
        const srcId = link.source.id;
        const tgtId = link.target.id;
        
        if (srcId === node.id) {
            neighbors.add(tgtId);
            outgoingCitations.push(link);
        } else if (tgtId === node.id) {
            neighbors.add(srcId);
            incomingCitations.push(link);
        }
    });

    nodeSelection.classed("dimmed", n => !neighbors.has(n.id));
    labelSelection.classed("dimmed", n => !neighbors.has(n.id));
    linkSelection.classed("dimmed", true);

    // Highlight node circle
    nodeSelection.filter(n => n.id === node.id).classed("highlighted", true);

    // Highlight edges
    linkSelection.filter(link => link.source.id === node.id || link.target.id === node.id)
        .classed("dimmed", false)
        .classed("highlighted", true)
        .attr("marker-end", "url(#arrow-highlighted)");

    // Populate Inspector Sidebar Right
    document.getElementById("insp-law-badge").innerText = node.law_code;
    document.getElementById("insp-law-badge").style.backgroundColor = getLawColor(node.law_code);
    document.getElementById("insp-title").innerText = `${node.article_zh}`;
    document.getElementById("insp-law-fullname").innerText = node.law_name;
    document.getElementById("insp-text").innerText = node.text || "此條無文字說明。";

    // Populate lists
    populateCitationsList("insp-outgoing-list", outgoingCitations, "target");
    populateCitationsList("insp-incoming-list", incomingCitations, "source");

    document.getElementById("insp-out-count").innerText = outgoingCitations.length;
    document.getElementById("insp-in-count").innerText = incomingCitations.length;

    // Show sidebar
    document.getElementById("inspector-panel").classList.remove("collapsed");

    // Center view on selected node smoothly
    zoomToNode(node);
}

// Populate reference list on inspector sidebar
function populateCitationsList(elementId, links, directionKey) {
    const listEl = document.getElementById(elementId);
    listEl.innerHTML = "";

    if (links.length === 0) {
        listEl.innerHTML = `<li class="no-citations">無引用記錄</li>`;
        return;
    }

    links.forEach(link => {
        const item = document.createElement("li");
        item.className = "citation-item";

        const targetNodeObj = link[directionKey];
        const badgeClass = link.is_external ? "external" : "internal";
        const badgeLabel = link.is_external ? "跨法規" : "本法";
        
        let metaHtml = `<span class="cit-badge ${badgeClass}">${badgeLabel}</span>`;
        if (link.kind === "relative") {
            metaHtml += `<span class="cit-badge relative">相對引用</span>`;
        }

        let subRefHtml = "";
        if (link.sub_ref) {
            subRefHtml = `<div class="citation-subref">詳情：${escapeHtml(link.sub_ref)}</div>`;
        }

        let reviewHtml = "";
        if (link.needs_review) {
            reviewHtml = `
                <div class="citation-review-flag">
                    <span class="review-icon">⚠️</span>
                    <span>信心度低 (${Math.round(link.confidence * 100)}%) 需複核</span>
                </div>
            `;
        }

        item.innerHTML = `
            <div class="citation-header">
                <span class="citation-target-id">${escapeHtml(targetNodeObj.id)}</span>
                <div class="citation-meta">${metaHtml}</div>
            </div>
            ${subRefHtml}
            ${reviewHtml}
        `;

        item.addEventListener("click", () => {
            selectNode(targetNodeObj);
        });

        listEl.appendChild(item);
    });
}

// Smooth zoom to focused node
function zoomToNode(node) {
    if (!svg) return;
    
    const width = document.getElementById("svg-container").clientWidth;
    const height = document.getElementById("svg-container").clientHeight;
    
    const transform = d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(1.5)
        .translate(-node.x, -node.y);

    svg.transition()
        .duration(750)
        .call(zoomBehavior.transform, transform);
}

// Fit zoom viewport showing all nodes
function resetZoomFit() {
    if (!svg || !rawData || rawData.nodes.length === 0) return;

    const width = document.getElementById("svg-container").clientWidth;
    const height = document.getElementById("svg-container").clientHeight;

    // Find bounding box of all nodes
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    rawData.nodes.forEach(n => {
        if (n.x < minX) minX = n.x;
        if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.y > maxY) maxY = n.y;
    });

    const graphWidth = (maxX - minX) || 100;
    const graphHeight = (maxY - minY) || 100;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const scale = Math.min(width / (graphWidth + 100), height / (graphHeight + 100), 1.5);
    const transform = d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(scale)
        .translate(-centerX, -centerY);

    svg.transition()
        .duration(750)
        .call(zoomBehavior.transform, transform);
}
