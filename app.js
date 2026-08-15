(() => {
  const DATA_URL = "./wharfhotels-org-tree.json";
  const ROW_H = 36;
  const OVERSCAN = 10;
  const INDENT = 18;

  const els = {
    status: document.getElementById("m-status"),
    fetch: document.getElementById("m-fetch"),
    parse: document.getElementById("m-parse"),
    flatten: document.getElementById("m-flatten"),
    dom: document.getElementById("m-dom"),
    total: document.getElementById("m-total"),
    hint: document.getElementById("hint"),
    search: document.getElementById("search"),
    locale: document.getElementById("locale"),
    expand: document.getElementById("btn-expand"),
    collapse: document.getElementById("btn-collapse"),
    viewport: document.getElementById("viewport"),
    spacer: document.getElementById("spacer"),
    rows: document.getElementById("rows"),
    empty: document.getElementById("empty"),
  };

  const state = {
    roots: [],
    locale: "zh-HK",
    query: "",
    expanded: new Set(),
    visible: [],
    allExpandableIds: [],
    stats: null,
  };

  const chevron = {
    open: '<svg viewBox="0 0 12 12" fill="none"><path d="M3 4.5L6 8l3-3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    closed: '<svg viewBox="0 0 12 12" fill="none"><path d="M4.5 3L8 6l-3.5 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  function kidsOf(node) {
    if (!node || node.nodeType === "position") return [];
    const children = node.children || [];
    const positions = node.positions || [];
    if (!children.length) return positions;
    if (!positions.length) return children;
    return children.concat(positions);
  }

  function nodeKind(node) {
    if (node.nodeType === "position") return "position";
    if (node.category === "company") return "company";
    return "department";
  }

  function kindLabel(kind) {
    if (kind === "company") return "公司";
    if (kind === "position") return "岗位";
    return "部门";
  }

  function displayName(node) {
    const map = node.name || {};
    const loc = state.locale;
    return (map[loc] || map["zh-HK"] || map["zh-CN"] || map.en || node.label || node.code || "").trim();
  }

  function collectExpandable(nodes, out) {
    for (const n of nodes) {
      const kids = kidsOf(n);
      if (kids.length) {
        out.push(n.id);
        collectExpandable(kids, out);
      }
    }
  }

  function expandAll() {
    state.expanded = new Set(state.allExpandableIds);
    rebuild("expand-all");
  }

  function collapseAll() {
    state.expanded = new Set();
    rebuild("collapse-all");
  }

  function matchesQuery(node, q) {
    if (!q) return true;
    const name = displayName(node).toLowerCase();
    const code = String(node.code || "").toLowerCase();
    const label = String(node.label || "").toLowerCase();
    return name.includes(q) || code.includes(q) || label.includes(q);
  }

  function filterTree(nodes, q) {
    if (!q) return nodes;
    const keep = [];
    for (const n of nodes) {
      const childHits = filterTree(kidsOf(n), q);
      if (childHits.length || matchesQuery(n, q)) {
        const clone = Object.assign({}, n);
        if (n.nodeType === "position") {
          keep.push(clone);
          continue;
        }
        const orgKids = [];
        const posKids = [];
        for (const c of childHits) {
          if (c.nodeType === "position") posKids.push(c);
          else orgKids.push(c);
        }
        clone.children = orgKids;
        clone.positions = posKids;
        keep.push(clone);
      }
    }
    return keep;
  }

  function flatten(nodes, expanded, out, depth) {
    for (const n of nodes) {
      const kids = kidsOf(n);
      out.push({
        id: n.id,
        depth,
        hasChildren: kids.length > 0,
        kind: nodeKind(n),
        code: n.code || "",
        name: displayName(n),
        open: kids.length > 0 && expanded.has(n.id),
      });
      if (kids.length && expanded.has(n.id)) flatten(kids, expanded, out, depth + 1);
    }
  }

  function rebuild(reason) {
    const t0 = performance.now();
    const q = state.query.trim().toLowerCase();
    const source = filterTree(state.roots, q);
    if (q) {
      const ids = [];
      collectExpandable(source, ids);
      state.expanded = new Set(ids);
    } else if (reason === "search") {
      state.expanded = new Set(state.allExpandableIds);
    }
    const visible = [];
    flatten(source, state.expanded, visible, 0);
    state.visible = visible;
    const flattenMs = performance.now() - t0;
    els.flatten.textContent = flattenMs.toFixed(1) + " ms";
    els.total.textContent = visible.length.toLocaleString() + " / " +
      ((state.stats && (state.stats.orgCount + state.stats.positionCount)) || "—");
    els.spacer.style.height = visible.length * ROW_H + "px";
    renderWindow();
    if (reason === "load") {
      els.status.textContent = "已全量展开";
      els.hint.textContent =
        "共 " + visible.length.toLocaleString() +
        " 个节点已展开。虚拟列表只创建可视行 DOM，滚动应保持流畅。";
    }
  }

  let rowPool = [];
  function ensurePool(count) {
    while (rowPool.length < count) {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML =
        '<span class="indent"></span>' +
        '<button type="button" class="toggle" aria-label="展开/折叠"></button>' +
        '<span class="badge"></span>' +
        '<span class="label"></span>' +
        '<span class="code"></span>';
      row.addEventListener("click", onToggle);
      els.rows.appendChild(row);
      rowPool.push(row);
    }
    for (let i = 0; i < rowPool.length; i++) {
      rowPool[i].hidden = i >= count;
    }
  }

  function onToggle(ev) {
    const row = ev.currentTarget.closest(".row");
    const id = row && row.getAttribute("data-id");
    if (!id) return;
    ev.preventDefault();
    if (state.expanded.has(id)) state.expanded.delete(id);
    else state.expanded.add(id);
    rebuild("toggle");
  }

  function renderWindow() {
    const { viewport, rows } = els;
    const scrollTop = viewport.scrollTop;
    const height = viewport.clientHeight || 600;
    const n = state.visible.length;
    const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
    const end = Math.min(n, Math.ceil((scrollTop + height) / ROW_H) + OVERSCAN);
    const count = Math.max(0, end - start);
    ensurePool(count);
    rows.style.transform = "translateY(" + start * ROW_H + "px)";
    for (let i = 0; i < count; i++) {
      const item = state.visible[start + i];
      const row = rowPool[i];
      row.classList.toggle("is-pos", item.kind === "position");
      row.classList.toggle("is-leaf", !item.hasChildren);
      row.setAttribute("data-id", item.hasChildren ? item.id : "");
      row.querySelector(".indent").style.flex = "0 0 " + item.depth * INDENT + "px";
      const btn = row.querySelector(".toggle");
      btn.classList.toggle("leaf", !item.hasChildren);
      btn.innerHTML = item.hasChildren ? (item.open ? chevron.open : chevron.closed) : chevron.closed;
      const badge = row.querySelector(".badge");
      badge.className = "badge " + item.kind;
      badge.textContent = kindLabel(item.kind);
      row.querySelector(".label").textContent = item.name;
      row.querySelector(".code").textContent = item.code;
    }
    els.dom.textContent = String(count);
    els.empty.hidden = n > 0;
  }

  let ticking = false;
  els.viewport.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      renderWindow();
    });
  });
  window.addEventListener("resize", () => renderWindow());

  els.expand.addEventListener("click", () => {
    state.query = "";
    els.search.value = "";
    els.viewport.scrollTop = 0;
    expandAll();
    els.status.textContent = "已全量展开";
  });
  els.collapse.addEventListener("click", () => {
    els.viewport.scrollTop = 0;
    collapseAll();
    els.status.textContent = "已全部折叠";
  });

  let searchTimer = 0;
  els.search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = els.search.value;
      rebuild("search");
      els.status.textContent = state.query.trim() ? "搜索结果" : "已全量展开";
      els.viewport.scrollTop = 0;
    }, 160);
  });

  els.locale.addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-locale]");
    if (!btn) return;
    state.locale = btn.getAttribute("data-locale");
    for (const b of els.locale.querySelectorAll("button")) b.classList.toggle("on", b === btn);
    rebuild("locale");
  });

  async function boot() {
    const tFetch0 = performance.now();
    let res;
    try {
      res = await fetch(DATA_URL);
      if (!res.ok) throw new Error("HTTP " + res.status);
    } catch (err) {
      els.status.textContent = "加载失败";
      els.hint.textContent = "请用本地 HTTP 打开本页，不要直接用 file://。在仓库根目录执行：python3 -m http.server 8765";
      throw err;
    }
    const buf = await res.arrayBuffer();
    const fetchMs = performance.now() - tFetch0;
    els.fetch.textContent = fetchMs.toFixed(0) + " ms · " + (buf.byteLength / 1024 / 1024).toFixed(2) + " MB";

    const tParse0 = performance.now();
    const text = new TextDecoder("utf-8").decode(buf);
    const data = JSON.parse(text);
    const parseMs = performance.now() - tParse0;
    els.parse.textContent = parseMs.toFixed(0) + " ms";

    state.roots = data.tree || [];
    state.stats = data.stats || {};
    state.allExpandableIds = [];
    collectExpandable(state.roots, state.allExpandableIds);
    state.expanded = new Set(state.allExpandableIds);
    rebuild("load");
  }

  boot().catch((err) => {
    console.error(err);
    els.status.textContent = "出错";
  });
})();
