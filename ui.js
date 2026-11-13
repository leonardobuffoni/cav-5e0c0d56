"use strict";
// Shared helpers for both dashboards. Amounts arrive as decimal strings computed in Python;
// any sum done here uses integer cents (BigInt), never floats. Number() is used only for geometry.
// DOM is built with textContent / createElementNS only: no data ever becomes HTML.

const $ = (id) => document.getElementById(id);
const SVGNS = "http://www.w3.org/2000/svg";
const MONTHS_LONG = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const MONTHS_SHORT = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "dataset") Object.assign(n.dataset, v);
    else if (k.startsWith("aria") || k === "role") n.setAttribute(k === "role" ? k : "aria-" + k.slice(4).toLowerCase(), v);
    else n[k] = v;
  }
  for (const c of children.flat()) if (c != null && c !== false) n.append(c);
  return n;
}
function svg(tag, attrs = {}, ...children) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  for (const c of children.flat()) if (c != null && c !== false) n.append(c);
  return n;
}

// --- privacy ---------------------------------------------------------------------------------
// "Nascondi importi": every amount goes through money()/compact(), so one flag masks the page.
let MASKED = false;
try { MASKED = localStorage.getItem("ca-masked") === "1"; } catch { /* storage unavailable */ }
const MASK = "••••";

function setupPrivacy(rerender) {
  const btn = $("maskBtn");
  const apply = () => {
    document.documentElement.classList.toggle("masked", MASKED);
    btn.setAttribute("aria-pressed", String(MASKED));
    btn.title = MASKED ? "Mostra gli importi" : "Nascondi gli importi";
    btn.querySelector("span").textContent = MASKED ? "Mostra importi" : "Nascondi importi";
  };
  btn.addEventListener("click", () => {
    MASKED = !MASKED;
    try { localStorage.setItem("ca-masked", MASKED ? "1" : "0"); } catch { /* ignore */ }
    apply();
    rerender();
  });
  apply();
}

// --- numbers ---------------------------------------------------------------------------------
const cents = (value) => {
  const m = String(value ?? "0").match(/^(-?)(\d+)(?:\.(\d{1,2}))?/);
  if (!m) return 0n;
  const v = BigInt(m[2]) * 100n + BigInt((m[3] || "0").padEnd(2, "0"));
  return m[1] ? -v : v;
};
const decimal = (c) => {
  const neg = c < 0n, a = neg ? -c : c;
  return (neg ? "-" : "") + (a / 100n).toString() + "." + (a % 100n).toString().padStart(2, "0");
};
const group = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const numberIT = (value) => {
  if (value == null || value === "") return "—";
  const m = String(value).match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!m) return "—";
  return m[1] + group(m[2]) + (m[3] ? "," + m[3] : "");
};
// "1.234,50 €"; whole=true drops the cents (rounded half up) for big headline figures.
const money = (value, { whole = false, sign = false } = {}) => {
  if (value == null) return "—";
  if (MASKED) return MASK + " €";
  let c = typeof value === "bigint" ? value : cents(value);
  const neg = c < 0n;
  let a = neg ? -c : c;
  let text;
  if (whole) text = group(((a + 50n) / 100n).toString());
  else text = group((a / 100n).toString()) + "," + (a % 100n).toString().padStart(2, "0");
  const prefix = neg ? "−" : sign && c > 0n ? "+" : "";
  return prefix + text + " €";
};
// Compact for axis ticks and tight strips: 950 · 4,8k · 12k
const compact = (value, tight = false) => {
  if (MASKED) return "••";
  const n = Number(typeof value === "bigint" ? value : cents(value)) / 100;
  const a = Math.abs(n), s = n < 0 ? "−" : "";
  if (a >= 10000 || (tight && a >= 1000)) return s + Math.round(a / 1000) + "k";
  if (a >= 1000) return s + (Math.round(a / 100) / 10).toString().replace(".", ",") + "k";
  return s + Math.round(a);
};
const pct = (value, { sign = false } = {}) => {
  if (value == null) return "—";
  const n = Math.round(Number(value) * 10) / 10;
  const text = Math.abs(n).toFixed(Math.abs(n) >= 10 ? 0 : 1).replace(".", ",");
  return (n < 0 ? "−" : sign && n > 0 ? "+" : "") + text + "%";
};
const ratioPct = (part, whole) => (whole ? Number(part * 10000n / whole) / 100 : null);
const isNeg = (v) => (typeof v === "bigint" ? v < 0n : String(v).startsWith("-"));
const absC = (c) => (c < 0n ? -c : c);
const tone = (v) => (typeof v === "bigint" ? (v < 0n ? "neg" : v > 0n ? "pos" : "") : isNeg(v) ? "neg" : cents(v) > 0n ? "pos" : "");
const financialText = (text) => String(text).replace(/(?<![\d.,])(-?\d+\.\d{2})(?![\d.,])/g, (_, n) => (MASKED ? MASK : numberIT(n)));

// --- dates -----------------------------------------------------------------------------------
const fmtDate = (s) => (s ? new Date(s + "T00:00:00").toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");
const fmtDay = (s) => (s ? `${Number(s.slice(8, 10))} ${MONTHS_SHORT[Number(s.slice(5, 7)) - 1]}` : "—");
const fmtTime = (sec) => new Date(sec * 1000).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
const monthLong = (ym) => `${MONTHS_LONG[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const monthShort = (ym) => MONTHS_SHORT[Number(ym.slice(5, 7)) - 1];
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// --- crypto ----------------------------------------------------------------------------------
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
async function decryptPage(key, aad) {
  const res = await fetch("data.enc", { cache: "no-store" });
  if (!res.ok) throw new Error("dati non ancora pubblicati");
  const box = await res.json();
  try {
    const k = await crypto.subtle.importKey("raw", fromB64u(key), "AES-GCM", false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64u(box.iv), additionalData: new TextEncoder().encode(aad) }, k, fromB64u(box.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new Error("link non valido o chiave cambiata: usa il link più recente");
  }
}

// --- building blocks -------------------------------------------------------------------------
function kpi({ label, value, valueClass = "", foot, delta, emphasis = false, hint, spark }) {
  return el("div", { className: "kpi" + (emphasis ? " kpi-lead" : ""), title: hint || "" },
    el("div", { className: "kpi-label", textContent: label }),
    el("div", { className: "kpi-value " + valueClass, textContent: value }),
    delta ? el("div", { className: "kpi-delta " + (delta.tone || "") }, delta.text) : null,
    foot ? el("div", { className: "kpi-foot", textContent: foot }) : null,
    spark ? sparkline(spark.values, spark) : null);
}

// Tiny trend line: values are cents (BigInt); `future` = how many trailing points are estimates.
function sparkline(values, { cls = "", future = 0, label = "" } = {}) {
  if (!values || values.length < 2) return null;
  const W = 200, H = 34, n = values.length;
  const nums = values.map((v) => Number(v) / 100);
  const lo = Math.min(0, ...nums), hi = Math.max(...nums, lo + 1);
  const x = (i) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v) => H - 3 - ((v - lo) / (hi - lo)) * (H - 6);
  const pts = nums.map((v, i) => [x(i), y(v)]);
  const path = (list) => list.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const cut = Math.max(1, n - future);
  const root = svg("svg", { class: "spark " + cls, viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", role: "img", "aria-label": label || "andamento" });
  if (lo < 0) root.append(svg("line", { x1: 0, x2: W, y1: y(0), y2: y(0), class: "zero", "vector-effect": "non-scaling-stroke" }));
  root.append(svg("path", { class: "area", d: path(pts.slice(0, cut)) + ` L${x(cut - 1).toFixed(1)} ${H} L0 ${H} Z` }),
    svg("path", { class: "line", d: path(pts.slice(0, cut)), "vector-effect": "non-scaling-stroke" }));
  if (future) root.append(svg("path", { class: "line future", d: path(pts.slice(cut - 1)), "vector-effect": "non-scaling-stroke", "stroke-dasharray": "3 3" }));
  return el("div", { className: "spark-wrap" }, root);
}
function tag(text, kind = "") { return el("span", { className: "tag " + kind, textContent: text }); }
function emptyState(text) { return el("p", { className: "empty", textContent: text }); }
function note(text, kind = "") { return el("p", { className: "note " + kind, textContent: financialText(text) }); }

// One tooltip element per chart container, positioned inside it.
function tooltip(host) {
  let tip = host.querySelector(":scope > .tip");
  if (!tip) host.append((tip = el("div", { className: "tip", role: "status" })));
  return {
    show(x, y, title, rows) {
      tip.replaceChildren(el("div", { className: "tip-title", textContent: title }),
        ...rows.map((r) => el("div", { className: "tip-row" + (r.strong ? " strong" : "") },
          r.swatch ? el("i", { className: "sw " + r.swatch }) : el("i", { className: "sw none" }),
          el("span", { textContent: r.label }), el("b", { className: r.tone || "", textContent: r.value }))));
      tip.classList.add("on");
      const w = tip.offsetWidth, hw = host.clientWidth;
      tip.style.left = Math.max(4, Math.min(hw - w - 4, x - w / 2)) + "px";
      tip.style.top = Math.max(4, y - tip.offsetHeight - 14) + "px";
    },
    hide() { tip.classList.remove("on"); },
  };
}

function niceMax(max) {
  if (max <= 0) return { top: 1, step: 1 };
  const raw = max / 4, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  return { top: Math.ceil(max / step) * step, step };
}

/*
 * Column chart: per category, stacks side by side. series: [{key, name, cls, stack}].
 * values(i, key) -> cents (BigInt). marker: {name, cls, value(i) -> cents|null} drawn as a tick.
 * strip: {label, value(i) -> cents} shown as a signed row under the axis.
 */
function columnChart(host, { categories, series, values, marker, strip, selected, onSelect, tip }) {
  const draw = () => {
    const W = Math.max(300, host.clientWidth), small = W < 440;
    const padL = small ? 34 : 46, padR = 6, top = 14, plotH = small ? 170 : 220;
    const stripH = strip ? 26 : 0, axisH = 26, H = top + plotH + axisH + stripH;
    const stacks = [...new Set(series.map((s) => s.stack || s.key))];
    const totals = categories.map((_, i) => stacks.map((st) => series.filter((s) => (s.stack || s.key) === st)
      .reduce((a, s) => a + Number(values(i, s.key)) / 100, 0)));
    const markerMax = marker ? Math.max(0, ...categories.map((_, i) => Number(marker.value(i) ?? 0n) / 100)) : 0;
    const { top: yMax, step } = niceMax(Math.max(markerMax, ...totals.flat()));
    const band = (W - padL - padR) / categories.length;
    const bw = Math.min(small ? 9 : 22, (band - (small ? 6 : 14)) / stacks.length - 2);
    const y = (v) => top + plotH - (v / yMax) * plotH;
    const root = svg("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: "cc", role: "img" });
    for (let v = 0; v <= yMax + 1e-9; v += step) {
      root.append(svg("line", { x1: padL, x2: W - padR, y1: y(v), y2: y(v), class: v === 0 ? "axis" : "grid" }),
        svg("text", { x: padL - 8, y: y(v) + 4, class: "tick", "text-anchor": "end" }, compact(BigInt(Math.round(v * 100)))));
    }
    const t = tooltip(host);
    categories.forEach((c, i) => {
      const x0 = padL + band * i, cx = x0 + band / 2;
      const g = svg("g", { class: "col" + (c.dim ? " dim" : "") + (selected === i ? " sel" : ""), tabindex: onSelect ? 0 : null, role: onSelect ? "button" : null, "aria-label": c.aria || c.label });
      if (selected === i) g.append(svg("rect", { x: x0 + 1, y: top - 6, width: band - 2, height: plotH + 6 + axisH - 4, rx: 6, class: "sel-bg" }));
      const groupW = stacks.length * bw + (stacks.length - 1) * 3;
      stacks.forEach((st, k) => {
        let base = 0;
        const bx = cx - groupW / 2 + k * (bw + 3);
        const parts = series.filter((s) => (s.stack || s.key) === st).map((s) => ({ s, v: Number(values(i, s.key)) / 100 })).filter((p) => p.v > 0);
        parts.forEach((p, j) => {
          const y1 = y(base + p.v), y0 = y(base), last = j === parts.length - 1;
          const h = Math.max(1, y0 - y1 - (j > 0 ? 2 : 0));
          const yy = y1;
          const r = last ? Math.min(4, bw / 2, h) : 0;
          const d = `M${bx},${yy + h} V${yy + r} Q${bx},${yy} ${bx + r},${yy} H${bx + bw - r} Q${bx + bw},${yy} ${bx + bw},${yy + r} V${yy + h} Z`;
          g.append(svg("path", { d, class: "bar " + p.s.cls + (c.dim ? " est" : "") }));
          base += p.v;
        });
      });
      if (marker) {
        const mv = marker.value(i);
        if (mv != null && mv > 0n) g.append(svg("line", { x1: cx - groupW / 2 - 3, x2: cx + groupW / 2 + 3, y1: y(Number(mv) / 100), y2: y(Number(mv) / 100), class: "mark " + marker.cls }));
      }
      g.append(svg("text", { x: cx, y: top + plotH + 17, class: "xl" + (selected === i ? " on" : ""), "text-anchor": "middle" }, c.label));
      if (strip) {
        const sv = strip.value(i);
        g.append(svg("text", { x: cx, y: top + plotH + axisH + 15, class: "sv " + tone(sv) + (c.dim ? " est" : ""), "text-anchor": "middle" }, sv == null ? "" : (sv > 0n && band >= 40 ? "+" : "") + compact(sv, band < 40)));
      }
      g.append(svg("rect", { x: x0, y: 0, width: band, height: H, class: "hit" }));
      const show = () => { const r = tip(i); t.show(cx, top + 10, r.title, r.rows); };
      g.addEventListener("mouseenter", show);
      g.addEventListener("focus", show);
      g.addEventListener("mouseleave", () => t.hide());
      g.addEventListener("blur", () => t.hide());
      if (onSelect) {
        g.addEventListener("click", () => onSelect(i));
        g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(i); } });
      }
      root.append(g);
    });
    if (strip) root.append(svg("text", { x: padL - 8, y: top + plotH + axisH + 15, class: "tick strong", "text-anchor": "end" }, strip.label));
    const keep = host.querySelector(":scope > .tip");
    host.replaceChildren(root);
    if (keep) host.append(keep);
  };
  draw();
  if (host._ro) host._ro.disconnect();
  let last = host.clientWidth;
  host._ro = new ResizeObserver(() => { if (Math.abs(host.clientWidth - last) > 4) { last = host.clientWidth; draw(); } });
  host._ro.observe(host);
}

// Horizontal ranked bars; each row is a button when onClick is given.
function rankBars(host, rows, { onClick, empty = "Nessun dato." } = {}) {
  if (!rows.length) { host.replaceChildren(emptyState(empty)); return; }
  const max = rows.reduce((m, r) => (absC(r.value) > m ? absC(r.value) : m), 0n) || 1n;
  host.replaceChildren(...rows.map((r) => {
    const fill = el("i", { className: "rb-fill " + (r.cls || "") });
    fill.style.width = Math.max(0.6, Number(absC(r.value) * 10000n / max) / 100) + "%";
    const body = [
      el("span", { className: "rb-label" }, el("span", { className: "rb-name", textContent: r.label }), r.tag || null),
      el("span", { className: "rb-value", textContent: r.valueText ?? money(r.value) }),
      el("span", { className: "rb-track" }, fill),
      el("span", { className: "rb-meta" }, ...(r.meta || []).map((m) => (typeof m === "string" ? el("span", { textContent: m }) : m))),
    ];
    if (!onClick || r.disabled) return el("div", { className: "rb" }, ...body);
    const b = el("button", { className: "rb rb-btn", type: "button", title: r.title || "Apri il dettaglio" }, ...body, el("span", { className: "rb-go", ariaHidden: "true" }));
    b.addEventListener("click", () => onClick(r));
    return b;
  }));
}

function legend(items) {
  return el("div", { className: "legend" }, ...items.map((i) => el("span", {}, el("i", { className: "sw " + i.cls }), i.label)));
}

function setStatus(d, extra) {
  const s = d.status || {};
  const ok = s.last_attempt_ok !== false && !s.stale;
  $("dot").className = "dot" + (ok ? " ok" : "");
  const success = s.last_success_at ? fmtTime(s.last_success_at) : "mai";
  $("syncText").textContent = (s.imported_until ? `Estratti verificati fino al ${fmtDate(s.imported_until)} · ` : "") + `ultimo aggiornamento banca ${success}`;
  if (extra) $("consent").textContent = extra;
  renderServiceHealth(d);
}

function scrollToEl(node) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  node.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

// Section nav: highlights the section in view.
let NAV_READY = false;
function navSpy() {
  if (NAV_READY) return;
  NAV_READY = true;
  const links = [...document.querySelectorAll(".tabs a")];
  const targets = links.map((a) => document.querySelector(a.getAttribute("href"))).filter(Boolean);
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) links.forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + e.target.id));
  }, { rootMargin: "-30% 0px -60% 0px" });
  targets.forEach((t) => io.observe(t));
}

function failPage(e) {
  $("syncText").textContent = "Dati non disponibili";
  const box = $("fatal");
  box.replaceChildren(el("strong", { textContent: "Impossibile mostrare i dati" }), el("p", { textContent: e.message }));
  box.classList.remove("hidden");
}
