"use strict";
// Dashboard personale, in sola lettura.
// - Tutto il DOM è costruito con textContent: nessun testo (causali, commento AI) diventa HTML.
// - Gli indicatori arrivano calcolati in Python con Decimal; le somme dell'analisi per periodo sono fatte
//   qui in centesimi interi (BigInt), mai con float. Number() serve solo per la geometria dei grafici.
// - Il link contiene la chiave dopo "#k=": il frammento non arriva mai al server; data.enc è decifrato qui.

const PAGES_KEY = new URLSearchParams(location.hash.slice(1)).get("k");
const S = { d: null, txs: [], today: "", oldest: "", period: "30", mode: "out", cat: null, party: null, limit: 30 };

async function loadExport() {
  if (PAGES_KEY) return decryptPage(PAGES_KEY, "ca-dashboard-v1");
  const res = await fetch("/api/data", { headers: { "X-CA-Request": "1" }, cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "manca la chiave nel link (#k=…)");
  return data;
}

// --- periodi ---------------------------------------------------------------------------------
const isoDay = (date) => date.toISOString().slice(0, 10);
const addDays = (iso, n) => isoDay(new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5));
const monthEnd = (ym) => isoDay(new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)));
const prevMonth = (ym) => { const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };

function periodRange(value = S.period) {
  if (/^\d{4}-\d{2}$/.test(value)) {
    const p = prevMonth(value);
    return { from: value + "-01", to: monthEnd(value), prevFrom: p + "-01", prevTo: monthEnd(p), label: cap(monthLong(value)), prevLabel: monthLong(p) };
  }
  const days = Number(value);
  const from = addDays(S.today, -(days - 1));
  return { from, to: S.today, prevFrom: addDays(from, -days), prevTo: addDays(from, -1), label: periodName(value), prevLabel: `i ${days} giorni precedenti` };
}
const periodName = (v) => ({ 30: "Ultimi 30 giorni", 90: "Ultimi 3 mesi", 180: "Ultimi 6 mesi", 365: "Ultimi 12 mesi" }[v] || cap(monthLong(v)));

// Counted movements: booked, EUR, not internal transfers. Same rule as the engine totals.
const counted = (t) => !t.pending && !t.internal && t.currency === "EUR";
const inRange = (t, from, to) => t.date >= from && t.date <= to;
const partyOf = (t) => {
  const name = (t.counterparty || "").trim() || (t.description || "").replace(/^(PAGAMENTO|ADDEBITO|BONIFICO|ACCREDITO)\s+(POS\s+|SDD\s+)?/i, "").split(/\s+/).slice(0, 3).join(" ");
  return name ? name.replace(/\s+/g, " ") : "Non indicato";
};
const partyKey = (t) => partyOf(t).toLowerCase();
const sideOk = (t) => (S.mode === "out" ? isNeg(t.amount) : !isNeg(t.amount) && cents(t.amount) > 0n);

function aggregate(rows, keyOf) {
  const map = new Map();
  for (const t of rows) {
    const k = keyOf(t);
    const g = map.get(k) || { key: k, label: k, total: 0n, n: 0, last: "" };
    g.total += absC(cents(t.amount)); g.n += 1;
    if (t.date > g.last) { g.last = t.date; g.label = keyOf === partyKey ? partyOf(t) : k; }
    map.set(k, g);
  }
  return [...map.values()].sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0));
}
const sumAbs = (rows) => rows.reduce((s, t) => s + absC(cents(t.amount)), 0n);

// --- avvio -----------------------------------------------------------------------------------
async function load() {
  try {
    const d = await loadExport();
    S.d = d;
    S.today = isoDay(new Date((d.generated_at || Date.now() / 1000) * 1000));
    S.txs = d.transactions || [];
    S.oldest = S.txs.reduce((m, t) => (t.date < m ? t.date : m), S.today);
    setStatus(d, d.status && d.status.consent_valid_until ? `Consenso banca fino al ${fmtDate(d.status.consent_valid_until.slice(0, 10))}` : "");
    renderPeriodOptions();
    renderCategoryFilter();
    renderAll();
    setupPrivacy(renderAll);
    navSpy();
  } catch (e) {
    failPage(e);
  }
}

// Everything that shows amounts: re-run when the privacy toggle changes (drill-down state is kept).
function renderAll() {
  renderPlan();
  renderTrend();
  renderMatrix();
  renderAnalysis();
  renderRows();
  renderMore();
}

const accountName = (acc) => (acc && acc.iban_masked && acc.iban_masked !== "-" ? `Conto ${acc.iban_masked}` : (acc && acc.name) || "Conto");

// --- 1. Sintesi ------------------------------------------------------------------------------
function renderPlan() {
  const p = S.d.metrics.plan;
  if (!p) return;
  $("planPeriod").textContent = `${cap(monthLong(p.from))} – ${monthLong(p.to)} · ${p.covered_months} mesi completi verificati${p.covered_months < 12 ? " (la media usa solo questi)" : ""}`;
  const ser = (f) => p.months.filter((m) => m.complete).map(f);  // same months as the averages
  $("planCards").replaceChildren(
    kpi({ label: "Margine ordinario", value: p.margin == null ? "—" : money(p.margin, { whole: true, sign: true }), emphasis: true, foot: "Al mese, prima delle spese straordinarie",
      spark: { values: ser((m) => cents(m.salary) - cents(m.ordinary)), label: "margine mese per mese" } }),
    kpi({ label: "Stipendio medio", value: p.salary_12m == null ? "—" : money(p.salary_12m, { whole: true }), foot: "Al mese, premi e mensilità aggiuntive ripartiti",
      spark: { values: ser((m) => cents(m.salary)), label: "stipendio mese per mese" } }),
    kpi({ label: "Spesa ordinaria", value: p.avg_ordinary == null ? "—" : money(p.avg_ordinary, { whole: true }), foot: "Al mese, senza straordinarie",
      spark: { values: ser((m) => cents(m.ordinary)), cls: "out", label: "spesa ordinaria mese per mese" } }),
    kpi({ label: "Straordinarie", value: p.extraordinary_total == null ? "—" : money(p.extraordinary_total, { whole: true }), foot: `Nel periodo · ${money(p.extraordinary_monthly, { whole: true })} al mese`,
      spark: { values: ser((m) => cents(m.extraordinary)), cls: "out", label: "straordinarie mese per mese" } }));

  const box = $("ratio");
  if (p.expense_salary_pct) {
    const v = Number(p.expense_salary_pct);
    const fill = el("i"); fill.style.width = Math.min(100, v) + "%";
    const target = el("b", { title: "Obiettivo indicativo 80%" }); target.style.left = "80%";
    box.replaceChildren(
      el("div", { className: "pl-hero" }, el("strong", { className: v > 100 ? "neg" : "", textContent: pct(v) }), v > 80 ? tag("sopra l’obiettivo", "warn") : tag("entro l’obiettivo", "ok")),
      el("div", { className: "meter", role: "img", ariaLabel: `${pct(v)} dello stipendio speso; obiettivo 80%` }, fill, target),
      el("div", { className: "meter-legend" }, el("span", { textContent: "0%" }), el("span", { textContent: "obiettivo 80%" }), el("span", { textContent: "100%" })),
      el("div", { className: "compare" },
        el("div", {}, "Budget indicativo all’80%", el("b", { textContent: money(p.budget_80pct, { whole: true }) + " / mese" })),
        el("div", {}, "Margine dopo tutte le uscite", el("b", { className: tone(p.cash_margin), textContent: money(p.cash_margin, { whole: true, sign: true }) + " / mese" }))));
  } else box.replaceChildren(emptyState("Confronto disponibile dopo la verifica degli stipendi."));

  const items = p.alerts.map((t) => el("li", { className: /superano|Oltre 80%/.test(t) ? "bad" : /classificare|sovrapposti|Copertura/.test(t) ? "warn" : "", textContent: financialText(t) }));
  for (const t of p.tips) {
    const li = el("li", { className: "good" }, el("b", { textContent: cap(t.category) }), `: ${money(t.monthly, { whole: true })} al mese. Tagliare del 10% libera `, el("b", { textContent: money(t.saving_10pct, { whole: true }) }), " al mese.");
    items.push(li);
  }
  $("planAlerts").replaceChildren(...(items.length ? items : [el("li", { className: "good", textContent: "Nessun segnale: uscite sotto controllo." })]));
}

// --- 2. Andamento ----------------------------------------------------------------------------
function renderTrend() {
  const p = S.d.metrics.plan;
  if (!p) return;
  const months = p.months;
  $("trendLegend").replaceChildren(legend([{ cls: "in", label: "Stipendio netto" }, { cls: "out", label: "Uscite ordinarie" }, { cls: "extra", label: "Straordinarie" }]));
  columnChart($("trendChart"), {
    categories: months.map((m) => ({ label: monthShort(m.month), dim: !m.complete, aria: monthLong(m.month) })),
    series: [{ key: "salary", cls: "in" }, { key: "ordinary", cls: "out", stack: "x" }, { key: "extraordinary", cls: "extra", stack: "x" }],
    values: (i, k) => cents(months[i][k]),
    strip: { label: "Saldo", value: (i) => cents(months[i].salary) - cents(months[i].expenses) },
    selected: months.findIndex((m) => m.month === S.period),
    onSelect: (i) => { setPeriod(months[i].month); scrollToEl($("analisi")); },
    tip: (i) => {
      const m = months[i];
      const rows = [{ swatch: "in", label: "Stipendio", value: money(m.salary) }, { swatch: "out", label: "Ordinarie", value: money(m.ordinary) }];
      if (cents(m.extraordinary) > 0n) rows.push({ swatch: "extra", label: "Straordinarie", value: money(m.extraordinary) });
      rows.push({ strong: true, label: "Saldo del mese", value: money(cents(m.salary) - cents(m.expenses), { sign: true }) });
      return { title: cap(monthLong(m.month)) + (m.complete ? "" : " · copertura incompleta"), rows };
    },
  });
}

// --- Spese per voce, mese per mese -----------------------------------------------------------
function renderMatrix() {
  const p = S.d.metrics.plan;
  if (!p || !p.by_category) return;
  const months = p.months;
  const complete = months.filter((m) => m.complete);
  const ranked = [...complete].sort((a, b) => (cents(b.expenses) > cents(a.expenses) ? 1 : -1));
  const fact = (label, value, small, cls = "") => el("div", { className: "fact" }, el("dt", { textContent: label }), el("dd", { className: cls }, value, small ? el("small", { textContent: small }) : null));
  $("avgFacts").replaceChildren(
    fact("Spesa media mensile", money(p.avg_expenses, { whole: true }), "tutte le uscite"),
    fact("Di cui ordinaria", money(p.avg_ordinary, { whole: true }), "/ mese"),
    fact("Straordinaria", money(p.extraordinary_monthly, { whole: true }), "/ mese, ripartita"),
    fact("Mese più caro", ranked.length ? cap(monthShort(ranked[0].month)) + " " + ranked[0].month.slice(2, 4) : "—", ranked.length ? money(ranked[0].expenses, { whole: true }) : ""),
    fact("Mese più leggero", ranked.length ? cap(monthShort(ranked.at(-1).month)) + " " + ranked.at(-1).month.slice(2, 4) : "—", ranked.length ? money(ranked.at(-1).expenses, { whole: true }) : ""));

  const head = el("tr", {}, el("th", { textContent: "Categoria" }), el("th", { className: "avg", textContent: "Media / mese" }),
    ...months.map((m) => el("th", { className: m.complete ? "" : "part", title: m.complete ? "" : "Copertura incompleta: escluso dalla media" }, cap(monthShort(m.month)), el("small", { textContent: m.month.slice(0, 4) }))),
    el("th", { textContent: "Totale" }));
  const body = p.by_category.map((c) => {
    const vals = months.map((m) => cents(c.months[m.month]));
    const max = vals.reduce((a, v) => (v > a ? v : a), 0n);
    const min = vals.reduce((a, v) => (v < a ? v : a), max);
    const span = max - min;
    const extra = cents(c.extraordinary);
    return el("tr", {},
      el("td", { title: cap(c.category) + (extra > 0n ? ` · di cui straordinarie ${money(extra)}` : "") }, cap(c.category),
        extra > 0n ? el("i", { className: "dot-extra", ariaLabel: "contiene spese straordinarie" }) : null),
      el("td", { className: "avg", textContent: c.avg == null ? "—" : money(c.avg, { whole: true }) }),
      ...months.map((m, i) => {
        const v = vals[i];
        const td = el("td", { className: "cell" + (v === 0n ? " zero" : "") + (m.complete ? "" : " part"), textContent: v === 0n ? "–" : money(v, { whole: true }).replace(" €", ""),
          title: v === 0n ? "" : `${cap(c.category)} · ${monthLong(m.month)}: ${money(v)}` });
        if (v > 0n) {
          // Shade by position between the row's lowest and highest month: flat rows stay neutral.
          if (span > 0n) td.style.backgroundColor = `color-mix(in srgb, var(--c-out) ${Math.round(Number((v - min) * 1000n / span) / 1000 * 28)}%, transparent)`;
          td.addEventListener("click", () => openCategoryMonth(c.category, m.month));
        }
        return td;
      }),
      el("td", { className: "tot", textContent: money(c.total, { whole: true }) }));
  });
  const foot = el("tr", {}, el("td", { textContent: "Totale uscite" }), el("td", { className: "avg", textContent: money(p.avg_expenses, { whole: true }) }),
    ...months.map((m) => el("td", { textContent: money(m.expenses, { whole: true }).replace(" €", "") })),
    el("td", { textContent: money(p.total_expenses, { whole: true }) }));
  $("matrix").replaceChildren(el("thead", {}, head), el("tbody", {}, ...body), el("tfoot", {}, foot));
  const extras = p.by_category.filter((c) => cents(c.extraordinary) > 0n);
  $("matrixLegend").replaceChildren(
    el("span", {}, el("i", { className: "heat" }), "più alto del solito per quella voce"),
    extras.length ? el("span", {}, el("i", { className: "dot-extra" }), " contiene straordinarie: " + extras.map((c) => `${cap(c.category)} ${money(c.extraordinary, { whole: true })}`).join(" · ")) : null);
  $("matrixNote").textContent = `Importi in euro arrotondati. Media e totale sui ${p.covered_months} mesi completi verificati${months.some((m) => !m.complete) ? "; i mesi in grigio hanno copertura incompleta e restano fuori dalla media" : ""}. Il colore evidenzia, riga per riga, i mesi in cui quella voce è stata più alta del solito. Giroconti e investimenti esclusi.`;
}

function openCategoryMonth(category, month) {
  if (![...$("period").options].some((o) => o.value === month)) return;
  S.mode = "out"; S.cat = category; S.party = null;
  $("modeOut").setAttribute("aria-pressed", "true"); $("modeIn").setAttribute("aria-pressed", "false");
  setPeriod(month);
  scrollToEl($("analisi"));
}

// --- 3. Analisi spese (drill-down) -----------------------------------------------------------
function renderPeriodOptions() {
  const months = [...new Set(S.txs.map((t) => t.date.slice(0, 7)))].sort().reverse();
  const sel = $("period");
  sel.replaceChildren(
    el("optgroup", { label: "Periodi mobili" }, ...["30", "90", "180", "365"].map((v) => el("option", { value: v, textContent: periodName(v) }))),
    el("optgroup", { label: "Mesi" }, ...months.map((m) => el("option", { value: m, textContent: cap(monthLong(m)) + (m === S.today.slice(0, 7) ? " (in corso)" : "") }))));
  sel.value = S.period;
  sel.onchange = () => setPeriod(sel.value);
  const mode = (m) => () => { S.mode = m; S.cat = S.party = null; $("modeOut").setAttribute("aria-pressed", m === "out"); $("modeIn").setAttribute("aria-pressed", m === "in"); renderAnalysis(); };
  $("modeOut").onclick = mode("out");
  $("modeIn").onclick = mode("in");
}

function setPeriod(value) {
  S.period = value;
  $("period").value = value;
  S.limit = 30;
  renderTrend();
  renderAnalysis();
  renderRows();
}

function renderAnalysis() {
  const r = periodRange();
  const all = S.txs.filter(counted);
  const cur = all.filter((t) => inRange(t, r.from, r.to));
  const prev = S.oldest <= r.prevFrom ? all.filter((t) => inRange(t, r.prevFrom, r.prevTo)) : null;
  const inc = cur.filter((t) => !isNeg(t.amount)).reduce((s, t) => s + cents(t.amount), 0n);
  const out = cur.filter((t) => isNeg(t.amount)).reduce((s, t) => s + cents(t.amount), 0n);
  const pOut = prev ? prev.filter((t) => isNeg(t.amount)).reduce((s, t) => s + cents(t.amount), 0n) : null;
  const pIn = prev ? prev.filter((t) => !isNeg(t.amount)).reduce((s, t) => s + cents(t.amount), 0n) : null;
  const change = (now, before) => (before ? ratioPct(absC(now) - absC(before), absC(before)) : null);
  const fact = (label, value, small, cls = "", smallCls = "") => el("div", { className: "fact" }, el("dt", { textContent: label }), el("dd", { className: cls }, value, small ? el("small", { className: smallCls, textContent: small }) : null));
  const outCh = change(out, pOut), inCh = change(inc, pIn);
  $("periodFacts").replaceChildren(
    fact("Uscite", money(-out, { whole: true }), outCh == null ? "" : `${pct(outCh, { sign: true })} vs prima`),
    fact("Entrate", money(inc, { whole: true }), inCh == null ? "" : `${pct(inCh, { sign: true })} vs prima`),
    fact("Saldo", money(inc + out, { whole: true, sign: true }), "", tone(inc + out)),
    fact("Movimenti", numberIT(String(cur.length)), r.from === r.to ? "" : `${fmtDay(r.from)} – ${fmtDay(r.to)}`));

  const side = cur.filter(sideOk);
  const prevSide = prev ? prev.filter(sideOk) : null;
  const crumbs = [];
  const crumb = (label, fn) => { const b = el("button", { type: "button", textContent: label }); b.onclick = fn; return b; };
  const root = S.mode === "out" ? "Tutte le uscite" : "Tutte le entrate";
  if (!S.cat) crumbs.push(el("span", { textContent: root }));
  else {
    crumbs.push(crumb(root, () => { S.cat = S.party = null; renderAnalysis(); }), el("i"));
    if (!S.party) crumbs.push(el("span", { textContent: cap(S.cat) }));
    else crumbs.push(crumb(cap(S.cat), () => { S.party = null; renderAnalysis(); }), el("i"), el("span", { textContent: S.party.label }));
  }
  crumbs.push(el("span", { className: "crumb-period", textContent: "· " + r.label }));
  $("crumbs").replaceChildren(...crumbs);

  const box = $("drill");
  if (!S.cat) return levelCategories(box, side, prevSide, r);
  const inCat = side.filter((t) => t.category === S.cat);
  if (!S.party) return levelCategory(box, inCat, prevSide ? prevSide.filter((t) => t.category === S.cat) : null, r);
  return levelParty(box, inCat.filter((t) => partyKey(t) === S.party.key), r);
}

function levelCategories(box, side, prevSide, r) {
  const total = sumAbs(side);
  const prevBy = prevSide ? new Map(aggregate(prevSide, (t) => t.category).map((g) => [g.key, g.total])) : null;
  const rows = aggregate(side, (t) => t.category).map((g) => {
    const meta = [`${pct(ratioPct(g.total, total))} del totale`, `${g.n} ${g.n === 1 ? "movimento" : "movimenti"}`];
    if (prevBy) {
      const before = prevBy.get(g.key) || 0n;
      if (before) {
        const ch = ratioPct(g.total - before, before);
        meta.push(el("span", { className: S.mode === "out" ? (ch > 0 ? "neg" : "pos") : ch < 0 ? "neg" : "pos", textContent: `${pct(ch, { sign: true })} vs ${r.prevLabel}` }));
      } else meta.push(el("span", { textContent: "nuova nel periodo" }));
    }
    const extra = side.some((t) => t.category === g.key && t.expense_nature === "extraordinary");
    return { key: g.key, label: g.key, value: g.total, cls: S.mode === "in" ? "in" : "", meta, tag: extra ? tag("con straordinarie", "extra") : null };
  });
  const head = el("div", { className: "panel-head" }, el("div", {}, el("h3", { textContent: S.mode === "out" ? "Uscite per categoria" : "Entrate per categoria" }),
    el("p", { textContent: `${money(total, { whole: true })} in ${r.label.toLowerCase()} · clicca una categoria per scendere nel dettaglio` })));
  const list = el("div", { className: "ranks" });
  box.replaceChildren(head, list);
  rankBars(list, rows, { onClick: (row) => { S.cat = row.key; S.party = null; renderAnalysis(); }, empty: "Nessun movimento nel periodo." });
}

function levelCategory(box, rows, prevRows, r) {
  const total = sumAbs(rows);
  const n = rows.length;
  const avg = n ? total / BigInt(n) : 0n;
  const before = prevRows ? sumAbs(prevRows) : null;
  const ch = before ? ratioPct(total - before, before) : null;
  // 12-month context for this category, always on calendar months.
  const months = [];
  for (let ym = S.today.slice(0, 7), i = 0; i < 12; i++, ym = prevMonth(ym)) months.unshift(ym);
  const series = months.map((ym) => sumAbs(S.txs.filter((t) => counted(t) && sideOk(t) && t.category === S.cat && t.date.startsWith(ym))));
  const closed = series.slice(0, 11), avg12 = closed.reduce((s, v) => s + v, 0n) / 11n;
  const fact = (label, value, small, cls = "") => el("div", { className: "fact" }, el("dt", { textContent: label }), el("dd", {}, value, small ? el("small", { className: cls, textContent: small }) : null));
  const chart = el("div", { className: "chart" });
  const parties = el("div", { className: "ranks" });
  const latest = el("div", { className: "list" });
  const toTable = el("button", { type: "button", textContent: "Apri tutti i movimenti in tabella" });
  toTable.onclick = () => { $("cat").value = S.cat; $("dir").value = S.mode; $("q").value = ""; S.limit = 30; renderRows(); scrollToEl($("movimenti")); };
  box.replaceChildren(
    el("dl", { className: "facts mb12" },
      fact("Totale nel periodo", money(total, { whole: true }), ch == null ? "" : `${pct(ch, { sign: true })} vs ${r.prevLabel}`, S.mode === "out" ? (ch > 0 ? "neg" : "pos") : ""),
      fact("Movimenti", String(n), ""), fact("Importo medio", money(avg, { whole: true }), "a movimento"),
      fact("Media mensile", money(avg12, { whole: true }), "ultimi 11 mesi chiusi")),
    el("div", { className: "grid half" },
      el("div", {}, el("div", { className: "panel-head" }, el("div", {}, el("h3", { textContent: "Ultimi 12 mesi" }), el("p", { textContent: "Clicca un mese per spostare il periodo." }))), chart),
      el("div", {}, el("div", { className: "panel-head" }, el("div", {}, el("h3", { textContent: S.mode === "out" ? "Dove hai speso" : "Da chi" }), el("p", { textContent: "Clicca per vedere i singoli movimenti." }))), parties)),
    el("div", { className: "panel-head mt16" }, el("div", {}, el("h3", { textContent: "Movimenti più rilevanti" }), el("p", { textContent: "I più alti del periodo." }))),
    latest, el("div", { className: "inline-actions" }, toTable));
  columnChart(chart, {
    categories: months.map((ym, i) => ({ label: monthShort(ym), dim: i === 11, aria: monthLong(ym) })),
    series: [{ key: "v", cls: S.mode === "in" ? "in" : "out" }],
    values: (i) => series[i],
    selected: months.indexOf(S.period),
    onSelect: (i) => setPeriod(months[i]),
    tip: (i) => ({ title: cap(monthLong(months[i])) + (i === 11 ? " · in corso" : ""), rows: [{ swatch: S.mode === "in" ? "in" : "out", label: S.cat, value: money(series[i]) }] }),
  });
  const groups = aggregate(rows, partyKey).slice(0, 12);
  rankBars(parties, groups.map((g) => ({ key: g.key, label: g.label, value: g.total, cls: S.mode === "in" ? "in" : "",
    meta: [`${g.n} ${g.n === 1 ? "volta" : "volte"}`, `ultima ${fmtDay(g.last)}`, `${pct(ratioPct(g.total, total))}`] })),
  { onClick: (row) => { S.party = { key: row.key, label: row.label }; renderAnalysis(); }, empty: "Nessun movimento nel periodo." });
  const top = [...rows].sort((a, b) => (absC(cents(b.amount)) > absC(cents(a.amount)) ? 1 : -1)).slice(0, 6);
  latest.replaceChildren(...(top.length ? top.map(movementLine) : [emptyState("Nessun movimento nel periodo.")]));
}

function levelParty(box, rows, r) {
  const total = sumAbs(rows);
  const fact = (label, value, small) => el("div", { className: "fact" }, el("dt", { textContent: label }), el("dd", {}, value, small ? el("small", { textContent: small }) : null));
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? 1 : -1));
  box.replaceChildren(
    el("dl", { className: "facts mb12" }, fact("Totale", money(total)), fact("Movimenti", String(rows.length)),
      fact("Importo medio", rows.length ? money(total / BigInt(rows.length)) : "—"), fact("Periodo", r.label)),
    el("div", { className: "list" }, ...(sorted.length ? sorted.map(movementLine) : [emptyState("Nessun movimento.")])));
}

function movementLine(t) {
  return el("div", { className: "list-row" },
    el("span", {}, el("b", { textContent: partyOf(t) }), " · ", fmtDate(t.date), t.expense_nature === "extraordinary" ? [" ", tag("Straordinaria", "extra")] : null),
    el("strong", { className: isNeg(t.amount) ? "" : "pos", textContent: money(t.amount, { sign: true }) }),
    el("small", { textContent: t.description || "—" }));
}

// --- 4. Movimenti ----------------------------------------------------------------------------
function renderCategoryFilter() {
  const cats = [...new Set(S.txs.map((t) => t.category))].sort((a, b) => a.localeCompare(b, "it"));
  $("cat").replaceChildren(el("option", { value: "", textContent: "Tutte le categorie" }), ...cats.map((c) => el("option", { value: c, textContent: cap(c) })));
  for (const id of ["dir", "cat", "nature"]) $(id).onchange = () => { S.limit = 30; renderRows(); };
  $("q").oninput = () => { S.limit = 30; renderRows(); };
  $("moreRows").onclick = () => { S.limit += 30; renderRows(); };
}

function renderRows() {
  if (!S.d) return;
  const r = periodRange();
  const q = $("q").value.trim().toLowerCase(), dir = $("dir").value, cat = $("cat").value, nature = $("nature").value;
  $("movSub").textContent = `${r.label}: cambia periodo dall’analisi spese. Clicca un movimento per i dettagli.`;
  const rows = S.txs.filter((t) => inRange(t, r.from, r.to) &&
    (dir === "all" || (dir === "in" ? !isNeg(t.amount) : isNeg(t.amount))) &&
    (!cat || t.category === cat) && (!nature || t.expense_nature === nature) &&
    (!q || `${t.description} ${t.counterparty} ${t.amount} ${money(t.amount)} ${t.category}`.toLowerCase().includes(q)));
  const body = $("rows");
  if (!rows.length) body.replaceChildren(el("tr", {}, el("td", { colSpan: 4 }, emptyState("Nessun movimento con questi filtri."))));
  else body.replaceChildren(...rows.slice(0, S.limit).map(txRow));
  let inc = 0n, out = 0n;
  for (const t of rows) if (counted(t)) { const c = cents(t.amount); if (c > 0n) inc += c; else out += c; }
  $("rowsFoot").replaceChildren(rows.length ? el("tr", {}, el("td", { colSpan: 2, textContent: "Totale filtrato (senza giroconti né movimenti in attesa)" }), el("td", { className: "hide-sm" }),
    el("td", { className: "amt" }, inc ? el("div", { className: "pos", textContent: money(inc, { sign: true }) }) : null, out ? el("div", { textContent: money(out) }) : null)) : "");
  $("status").textContent = `${numberIT(String(Math.min(rows.length, S.limit)))} di ${numberIT(String(rows.length))} movimenti`;
  $("moreRows").classList.toggle("hidden", rows.length <= S.limit);
}

function txRow(t) {
  const acc = S.d.accounts[t.account] || {};
  const c = cents(t.amount);
  const head = el("div", { className: "tx-head" },
    el("span", { textContent: t.counterparty || (c < 0n ? "Uscita" : "Entrata") }),
    tag(cap(t.category)),
    t.expense_nature === "extraordinary" ? tag("Straordinaria", "extra") : null,
    t.internal ? tag("giroconto") : null, t.pending ? tag("in attesa", "warn") : null);
  const tr = el("tr", { className: "tx", tabIndex: 0, title: "Dettaglio" },
    el("td", { className: "date", textContent: fmtDate(t.date) }),
    el("td", {}, head, el("div", { className: "tx-desc", textContent: t.description || "—" })),
    el("td", { className: "hide-sm date", textContent: accountName(acc) }),
    el("td", { className: "amt " + (c > 0n ? "pos" : ""), textContent: money(c, { sign: true }) }));
  const toggle = () => {
    const next = tr.nextElementSibling;
    if (next && next.classList.contains("detail")) { next.remove(); tr.classList.remove("open"); return; }
    tr.classList.add("open");
    const dl = el("dl", { className: "kv" });
    for (const [k, v] of [
      ["Data contabile", fmtDate(t.date)], ["Data valuta", fmtDate(t.value_date)],
      ["Importo", money(c, { sign: true })], ["Stato", t.pending ? "In attesa" : "Contabilizzato"],
      ["Controparte", t.counterparty || "non indicata"], ["IBAN controparte", t.counterparty_iban || "non fornito"],
      ["Categoria", cap(t.category) + (t.internal ? " (esclusa da entrate e uscite)" : "")],
      ["Natura", t.expense_nature === "extraordinary" ? "Straordinaria" : t.expense_nature === "ordinary" ? "Ordinaria" : "—"],
      ["Causale", t.description || "—"], ["Riferimento (per correggere la categoria)", t.id],
    ]) dl.append(el("dt", { textContent: k }), el("dd", { textContent: v }));
    tr.after(el("tr", { className: "detail" }, el("td", { colSpan: 4 }, dl)));
  };
  tr.addEventListener("click", toggle);
  tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
  return tr;
}

// --- 5. Approfondimenti ----------------------------------------------------------------------
function renderMore() {
  const d = S.d, p = d.metrics.plan;
  if (p) {
    $("extraMeta").textContent = p.extraordinary_items.length ? `${p.extraordinary_items.length} · ${money(p.extraordinary_total, { whole: true })}` : "nessuna";
    $("expenseSummary").textContent = `Uscite complessive ${money(p.total_expenses)} · media con straordinarie ${money(p.avg_expenses)} al mese · margine dopo tutte le uscite ${money(p.cash_margin, { sign: true })} al mese.`;
    $("extraordinaryList").replaceChildren(...(p.extraordinary_items.length ? p.extraordinary_items.map((t) => el("div", { className: "list-row" },
      el("span", { textContent: `${fmtDate(t.date)} · ${t.description}` }), el("strong", { textContent: money(t.amount) }), el("small", { textContent: `${t.reason} · rif. ${t.id}` })))
      : [emptyState("Nessuna spesa straordinaria documentata nel periodo.")]));
    $("planMethod").textContent = p.method;
  }
  const recs = d.metrics.recurring || [];
  $("recMeta").textContent = recs.length ? String(recs.length) : "nessuna";
  $("recurring").replaceChildren(...(recs.length ? recs.map((r) => el("div", { className: "list-row" },
    el("span", { textContent: `${r.counterparty} · ${r.cadence}` }), el("strong", { textContent: money(r.typical_amount) }),
    el("small", { textContent: `${r.occurrences} volte, ultima il ${fmtDate(r.last_date)}` }))) : [emptyState("Nessuna ricorrenza individuata.")]));
  const items = d.metrics.anomalies || [];
  $("anomalies").replaceChildren(...(items.length ? items.map((a) => a.type === "categoria"
    ? el("div", { className: "list-row" }, el("span", { textContent: cap(a.category) }), el("strong", { textContent: money(a.amount) }), el("small", { textContent: `contro ${money(a.previous)} nei 30 giorni precedenti (+${numberIT(a.change_pct)}%)` }))
    : el("div", { className: "list-row" }, el("span", { textContent: `${fmtDate(a.date)} · ${a.counterparty || "controparte non indicata"}` }), el("strong", { textContent: money(a.amount) }), el("small", { textContent: a.reason })))
    : [emptyState("Niente da segnalare negli ultimi 30 giorni.")]));
  $("balances").replaceChildren(...(d.metrics.balances || []).map((b) => {
    const acc = d.accounts[b.account] || {};
    return el("div", { className: "fact" }, el("dt", { textContent: accountName(acc) }),
      el("dd", {}, money(b.amount, { whole: true }), b.reference_date || b.at ? el("small", { textContent: "al " + (b.reference_date ? fmtDay(b.reference_date) : fmtTime(b.at)) }) : null));
  }));
  renderAi(d);
}

function renderAi(d) {
  const ai = d.ai || {};
  if (!ai.enabled && !ai.commentary) { $("aiBox").classList.add("hidden"); return; }
  const c = ai.commentary;
  $("aiMeta").textContent = c ? `${fmtTime(c.created)} · dati al ${fmtDate(c.data_until)}` : ai.status;
  const out = $("aiOut");
  out.replaceChildren();
  if (c) renderText(out, c.text); else out.append(emptyState(ai.status || "Nessun commento."));
}

// Testo semplice -> titoli, liste e paragrafi, solo via textContent.
function renderText(container, text) {
  let list = null;
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const item = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (item) {
      if (!list) container.append((list = el("ul")));
      list.append(el("li", { textContent: financialText(item[1].replace(/\*\*/g, "")) }));
      continue;
    }
    list = null;
    if (!line.trim()) continue;
    const head = line.match(/^#{1,6}\s+(.*)$/);
    container.append(el(head ? "h3" : "p", { textContent: financialText((head ? head[1] : line).replace(/\*\*/g, "")) }));
  }
}

load();
