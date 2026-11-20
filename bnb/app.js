"use strict";
// Dashboard B&B (separata da quella dei conti personali), in sola lettura.
// Il link contiene la chiave dopo "#k=": il frammento non viene mai inviato al server; la pagina scarica
// data.enc e lo decifra qui (AES-256-GCM). I numeri arrivano già calcolati in Python con Decimal; le sole
// somme fatte qui (totali dei filtri) usano centesimi interi. Il DOM è costruito con textContent.

const KEY = new URLSearchParams(location.hash.slice(1)).get("k");
const EXCLUDED_LABEL = "Escluso (giroconti, soci)";
const S = { d: null, p: null, a: null, labels: {}, month: null, limit: 50 };

const ADMIN_URL = "https://github.com/leonardobuffoni/ca-aggregator/actions/workflows/admin.yml";
const TAG_LINES = ["revenue", "pulizia", "luce_gas", "spese_fisse", "mutuo", "cedolare", "commissioni", "tassa_soggiorno", "cassa", "altro", "escluso"];
const loadTags = () => { try { return JSON.parse(localStorage.getItem("ca-bnb-tags") || "{}"); } catch { return {}; } };
const saveTags = () => { try { localStorage.setItem("ca-bnb-tags", JSON.stringify(S.tags)); } catch { /* ignore */ } };
S.tags = loadTags();

// Comparison year: any past year with covered months, chosen in the page (default: the most recent).
const histYears = () => Object.keys((S.p && S.p.history) || {}).filter((y) => Object.keys(S.p.history[y]).length).sort().reverse();
const prevRev = (ym) => {
  const h = S.cmp && S.p.history[S.cmp];
  const v = h && h[ym.slice(5, 7)];
  return v ? cents(v.revenue) : null;
};
function yoy() {
  if (!S.cmp) return null;
  let cur = 0n, prev = 0n, n = 0;
  for (const m of S.p.months.filter((x) => x.available && !x.forecast)) {
    const pv = prevRev(m.month);
    if (pv == null) continue;
    cur += cents(m.revenue); prev += pv; n += 1;
  }
  return n ? { year: S.cmp, months: n, current: cur, previous: prev, pct: prev ? ratioPct(cur - prev, prev) : null } : null;
}

const lineLabel = (key) => (key === "escluso" ? EXCLUDED_LABEL : key === "extraordinary" ? "Spese straordinarie" : S.labels[key] || key);
const nowYM = () => new Date((S.d.generated_at || Date.now() / 1000) * 1000).toISOString().slice(0, 7);

function render(d) {
  S.d = d; S.p = d.bnb.management; S.a = S.p && S.p.analysis; S.r = S.p && S.p.reconciliation; S.labels = d.bnb.labels || {};
  const consent = d.bank && d.bank.valid_until ? `Consenso ${d.bank.bank} fino al ${fmtDate(d.bank.valid_until.slice(0, 10))}` : "";
  setStatus(d, consent);
  if (!S.p || !S.a || !S.r) throw new Error("dati di gestione non disponibili: aggiorna la pubblicazione");
  $("subtitle").textContent = `Conto economico gestionale ${d.bnb.year}: incassi, costi del periodo e previsione di fine anno.`;
  renderFilters();
  const years = histYears();
  S.cmp = years[0] || null;
  $("cmpYear").replaceChildren(...(years.length ? years : ["—"]).map((y) => el("option", { value: y === "—" ? "" : y, textContent: y })));
  $("cmpYear").disabled = !years.length;
  $("cmpYear").onchange = () => { S.cmp = $("cmpYear").value || null; renderAll(); };
  $("tagSave").onclick = saveTagsFlow;
  $("tagReset").onclick = () => { S.tags = {}; saveTags(); renderAll(); };
  renderAll();
  setupPrivacy(renderAll);
  navSpy();
}

// Everything that shows amounts: re-run when the privacy toggle changes.
function renderAll() {
  renderSummary(S.d.bnb.year);
  renderChart();
  renderComposition();
  renderRecon();
  renderMovements();
  renderMore();
  renderTagBar();
}

// --- 1. Sintesi --------------------------------------------------------------------------------
function renderSummary(year) {
  const a = S.a, p = S.p, py = yoy();
  const active = p.months.filter((m) => m.available && !m.forecast);
  const lastM = active.at(-1);
  $("ytdTitle").textContent = `Da inizio ${year}`;
  $("ytdSub").textContent = lastM ? `Gennaio – ${monthLong(lastM.month)}${lastM.month === nowYM() ? " (mese in corso)" : ""} · ${a.months} mesi con dati verificati` : "";
  const extra = cents(p.extraordinary_ytd);
  const forecastMonths = p.months.filter((m) => m.forecast).length;
  const series = (key) => active.map((m) => cents(m[key]));
  const all = p.months.filter((m) => m.available || m.forecast);
  let run = 0n;
  const cumulative = all.map((m) => (run += cents(m.net)));
  $("kpis").replaceChildren(
    kpi({ label: "Margine da inizio anno", value: money(p.net_ytd, { whole: true }), emphasis: true,
      spark: { values: series("net"), label: "margine mese per mese" },
      delta: { text: a.margin_pct != null ? `${pct(a.margin_pct)} degli incassi` : "" },
      foot: "Dopo tutti i costi, straordinari compresi" }),
    kpi({ label: "Incassi netti", value: money(a.revenue, { whole: true }),
      delta: py && py.pct != null ? { text: `${pct(py.pct, { sign: true })} vs ${py.year}`, tone: py.pct < 0 ? "neg" : "pos" } : null,
      foot: "Già al netto di commissioni e ritenute", spark: { values: series("revenue"), label: "incassi mese per mese" } }),
    kpi({ label: "Costi del periodo", value: money(a.cost, { whole: true }), spark: { values: series("cost"), cls: "out", label: "costi mese per mese" },
      delta: a.cost_pct != null ? { text: `${pct(a.cost_pct)} degli incassi` } : null,
      foot: extra > 0n ? `Di cui straordinari ${money(extra, { whole: true })}` : "Nessuna spesa straordinaria" }),
    kpi({ label: "Previsione fine anno", value: money(p.forecast_net, { whole: true }), valueClass: tone(p.forecast_net) === "neg" ? "neg" : "",
      foot: forecastMonths ? `Margine annuo con ${forecastMonths} ${forecastMonths === 1 ? "mese stimato" : "mesi stimati"}` : "Anno completo",
      spark: { values: cumulative, future: forecastMonths, label: "margine cumulato" } }));

  const fact = (label, value, small, cls = "") => el("div", { className: "fact" }, el("dt", { textContent: label }), el("dd", { className: cls }, value, small ? el("small", { textContent: small }) : null));
  $("facts").replaceChildren(
    fact("Pareggio mensile", money(a.breakeven, { whole: true }), "di incassi"),
    fact("Incasso medio", money(a.avg_revenue, { whole: true }), "/ mese"),
    fact("Mese migliore", a.best ? cap(monthLong(a.best.month).split(" ")[0]) : "—", a.best ? money(a.best.net, { whole: true, sign: true }) : ""),
    fact("Mese più debole", a.worst ? cap(monthLong(a.worst.month).split(" ")[0]) : "—", a.worst ? money(a.worst.net, { whole: true, sign: true }) : ""),
    fact("Da accantonare", money(p.reserve, { whole: true }), "costi maturati"),
    fact("Saldo conto", S.d.balance ? money(S.d.balance.amount, { whole: true }) : "—", S.d.balance && S.d.balance.reference_date ? "al " + fmtDay(S.d.balance.reference_date) : ""));

  const items = [];
  const li = (cls, ...parts) => items.push(el("li", { className: cls }, ...parts));
  const b = (t) => el("b", { textContent: t });
  if (a.margin_pct != null) {
    const kept = Math.round(Number(a.margin_pct));
    if (kept >= 0) li("good", "Su 100 € incassati ne restano ", b(kept + " €"), " dopo tutti i costi, mutuo compreso.");
    else li("bad", "Ogni 100 € incassati costano ", b(-kept + " €"), " in più: i costi superano gli incassi.");
  }
  if (py && py.pct != null) {
    li(py.pct >= 0 ? "good" : "bad", "Incassi ", b(pct(py.pct, { sign: true })), ` rispetto agli stessi ${py.months} mesi del ${py.year} (`, b(money(py.current, { whole: true })), " contro ", b(money(py.previous, { whole: true })), ").");
  }
  const top = [...S.r.lines].filter((c) => c.key !== "extraordinary").sort((x, y) => (cents(y.cost) > cents(x.cost) ? 1 : -1))[0];
  if (top) li("", b(cap(top.label)), " è la prima voce di costo: ", b(money(top.cost, { whole: true })), `, il ${pct(ratioPct(cents(top.cost), cents(a.revenue)))} degli incassi.`);
  if (a.below_breakeven.length) {
    li("warn", `In ${a.below_breakeven.length === 1 ? "un mese" : a.below_breakeven.length + " mesi"} gli incassi non hanno coperto i costi ordinari: `, b(a.below_breakeven.map((m) => monthShort(m)).join(", ")), `. Sotto i ${money(a.breakeven, { whole: true })} al mese la casa è in perdita.`);
  }
  if (extra > 0n) {
    li("", "Spese straordinarie per ", b(money(extra, { whole: true })), ": senza di esse il margine sarebbe ", b(money(p.ordinary_net_ytd, { whole: true })), ".");
  }
  if (a.negative.length) li("bad", `Margine negativo in ${a.negative.map((m) => monthLong(m).split(" ")[0]).join(", ")}: apri il mese per vedere la causa.`);
  if (cents(p.reserve) > 0n) li("warn", "Tieni da parte ", b(money(p.reserve, { whole: true })), ": costi di competenza già maturati ma non ancora pagati (pulizie registrate, quote di utenze e spese fisse).");
  const fm = p.months.filter((m) => m.forecast);
  if (fm.length) li("", "Chiusura prevista ", b(money(p.forecast_net, { whole: true })), `: ${fm.map((m) => monthShort(m.month)).join(", ")} stimati ${fm[0].revenue_basis === "media 12 mesi" ? "sulla media degli ultimi 12 mesi" : "sugli incassi dello stesso mese dell’anno scorso"}, senza ripetere le spese straordinarie.`);
  $("reading").replaceChildren(...items);
}

// --- 2. Mese per mese --------------------------------------------------------------------------
function shownMonths() { return S.p.months.filter((m) => m.available || m.forecast); }

function renderChart() {
  const months = shownMonths();
  const hasPrev = months.some((m) => prevRev(m.month) != null);
  $("chartLegend").replaceChildren(legend([
    { cls: "in", label: "Incassi" }, { cls: "out", label: "Costi ordinari" }, { cls: "extra", label: "Straordinari" },
    ...(hasPrev ? [{ cls: "prev", label: `Incassi ${S.cmp}` }] : [])]));
  if (!S.month) {
    const done = months.filter((m) => !m.forecast && m.month < nowYM());
    S.month = (done.at(-1) || months.filter((m) => !m.forecast).at(-1) || months[0]).month;
  }
  const sel = $("monthSelect");
  sel.replaceChildren(...months.map((m) => el("option", { value: m.month, textContent: cap(monthLong(m.month)) + (m.forecast ? " · stima" : m.month === nowYM() ? " · in corso" : "") })));
  sel.value = S.month;
  sel.onchange = () => selectMonth(sel.value);
  drawChart();
  renderMonth();
}

function drawChart() {
  const months = shownMonths();
  columnChart($("monthChart"), {
    categories: months.map((m) => ({ label: monthShort(m.month), dim: m.forecast, aria: `${monthLong(m.month)}: margine ${money(m.net)}` })),
    series: [{ key: "revenue", cls: "in" }, { key: "ordinary_cost", cls: "out", stack: "c" }, { key: "extraordinary_cost", cls: "extra", stack: "c" }],
    values: (i, k) => cents(months[i][k]),
    marker: { cls: "prev", value: (i) => prevRev(months[i].month) },
    strip: { label: "Margine", value: (i) => cents(months[i].net) },
    selected: months.findIndex((m) => m.month === S.month),
    onSelect: (i) => selectMonth(months[i].month),
    tip: (i) => {
      const m = months[i];
      const rows = [
        { swatch: "in", label: m.forecast ? "Incassi stimati" : "Incassi", value: money(m.revenue) },
        { swatch: "out", label: "Costi ordinari", value: money(m.ordinary_cost) },
      ];
      if (cents(m.extraordinary_cost) > 0n) rows.push({ swatch: "extra", label: "Straordinari", value: money(m.extraordinary_cost) });
      if (prevRev(m.month) != null) rows.push({ swatch: "prev", label: `Incassi ${S.cmp}`, value: money(prevRev(m.month)) });
      rows.push({ strong: true, label: "Margine", value: money(m.net, { sign: true }) });
      return { title: cap(monthLong(m.month)) + (m.forecast ? " · stima" : m.month === nowYM() ? " · in corso" : ""), rows };
    },
  });
}

function selectMonth(ym) {
  S.month = ym;
  $("monthSelect").value = ym;
  drawChart();
  renderMonth();
}

function renderMonth() {
  const m = S.p.months.find((x) => x.month === S.month);
  if (!m) return;
  const current = m.month === nowYM();
  $("monthKind").textContent = m.forecast ? "Previsione" : current ? "Mese in corso" : "Conto economico";
  $("monthTitle").textContent = cap(monthLong(m.month));
  const net = cents(m.net);
  const hero = el("div", { className: "pl-hero" },
    el("div", {}, el("div", { className: "kpi-label", textContent: "Margine del mese" }), el("strong", { className: tone(net), textContent: money(net, { sign: true }) })),
    el("div", {}, m.forecast ? tag("Stima", "est") : current ? tag("Parziale", "warn") : tag("Chiuso", "ok")));
  const rows = [];
  const row = (cls, label, small, value, onClick) => {
    const tr = el("tr", { className: cls + (onClick ? " link" : ""), tabIndex: onClick ? 0 : null, title: onClick ? "Vedi i movimenti" : "" },
      el("td", { className: cls.includes("line") ? "indent" : "" }, label, small ? el("small", { textContent: small }) : null),
      el("td", { className: "amt", textContent: value }));
    if (onClick) {
      tr.addEventListener("click", onClick);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } });
    }
    rows.push(tr);
  };
  const go = (line) => (m.forecast ? null : () => showMovements(m.month, line));
  row("sub", m.forecast ? "Incassi stimati" : "Incassi netti", m.forecast ? `Stima: ${m.revenue_basis}` : "Payout portali, già netti", money(m.revenue), go("revenue"));
  const lines = m.lines.filter((l) => l.key !== "extraordinary" && (cents(l.cost) !== 0n || cents(l.paid) !== 0n));
  for (const l of lines) {
    const paid = cents(l.paid), cost = cents(l.cost);
    const small = cap(l.basis) + (paid !== cost && paid !== 0n ? ` · pagato nel mese ${money(paid)}` : "");
    row("line", cap(l.label), small, money(-cost), go(l.key));
  }
  if (!lines.length) row("line zero", "Nessun costo ordinario", "", money(0n));
  row("sub", "Costi ordinari", "", money(-cents(m.ordinary_cost)));
  const extra = cents(m.extraordinary_cost);
  if (extra > 0n) row("sub", "Spese straordinarie", "Pagate nel mese, fuori dalla media", money(-extra), go("extraordinary"));
  row("sum", "Margine", "", money(net, { sign: true }));
  const table = el("table", { className: "pl" }, el("tbody", {}, ...rows));

  const cmp = [];
  if (prevRev(m.month) != null) {
    const diff = cents(m.revenue) - prevRev(m.month);
    cmp.push(el("div", {}, `Incassi ${monthShort(m.month)} ${S.cmp}`, el("b", {}, money(prevRev(m.month)), " ", el("span", { className: tone(diff), textContent: `(${money(diff, { sign: true, whole: true })})` }))));
  }
  if (!m.forecast) cmp.push(el("div", { title: "Entrate meno uscite effettive sul conto nel mese, senza stime né quote" }, "Flusso di cassa del mese", el("b", { className: tone(m.cash_net), textContent: money(m.cash_net, { sign: true }) })));
  const actions = m.forecast ? note("Mese futuro: incassi stimati e costi dalla media storica. Le spese straordinarie non vengono ripetute.")
    : el("div", { className: "inline-actions" }, (() => { const bt = el("button", { type: "button", textContent: "Vedi i movimenti del mese" }); bt.onclick = () => showMovements(m.month, ""); return bt; })());
  $("monthDetail").replaceChildren(hero, table, cmp.length ? el("div", { className: "compare" }, ...cmp) : null, actions);
}

// --- 3. Costi ----------------------------------------------------------------------------------
function renderComposition() {
  const a = S.a, r = S.r;
  $("costsSub").textContent = `Costo del periodo per voce, su ${money(a.revenue, { whole: true })} di incassi. “Pagato dal conto” è la somma dei movimenti con quella voce: clicca per vederli.`;
  const total = cents(a.cost);
  const rows = r.lines.filter((l) => cents(l.cost) !== 0n || cents(l.paid) !== 0n).sort((x, y) => (cents(y.cost) > cents(x.cost) ? 1 : -1)).map((l) => {
    const cost = cents(l.cost), paid = cents(l.paid), diff = cents(l.difference);
    const meta = [`${pct(ratioPct(cost, total))} dei costi`, `${pct(ratioPct(cost, cents(a.revenue)))} degli incassi`,
      `pagato dal conto ${money(paid, { whole: true })} in ${l.movements} ${l.movements === 1 ? "movimento" : "movimenti"}`];
    return { key: l.key, label: l.label, value: cost, valueText: money(cost, { whole: true }), meta, cls: l.key === "extraordinary" ? "extra" : "",
      tag: l.key === "extraordinary" ? tag("una tantum", "extra") : diff !== 0n ? tag(`${diff > 0n ? "+" : "−"}${money(absC(diff), { whole: true })} sul pagato`, "est") : tag("= pagato", "ok") };
  });
  rankBars($("composition"), rows, { onClick: (row) => showMovements("", row.key), empty: "Nessun costo registrato." });
}

// --- Quadratura ---------------------------------------------------------------------------------
function renderRecon() {
  const r = S.r;
  $("reconCheck").replaceChildren(el("span", { className: "check " + (r.balanced ? "ok" : "ko"), textContent: r.balanced ? "Quadra al centesimo" : "Non quadra: da verificare" }));
  $("bridgeSub").textContent = `${r.months} mesi con dati verificati. Ogni riga spiega una differenza tra conto e margine.` +
    (r.unassigned ? ` ${r.unassigned} movimenti cadono in mesi senza copertura completa e restano fuori.` : "");
  let running = 0n;
  const rows = r.steps.map((st, i) => {
    const v = cents(st.amount); running += v;
    return el("tr", {},
      el("td", {}, el("span", { className: "op", textContent: i === 0 ? "=" : v === 0n ? "·" : v < 0n ? "−" : "+" }), st.label, el("small", { textContent: financialText(st.note) })),
      el("td", { className: "amt " + (i ? "" : tone(v)), textContent: i === 0 ? money(v, { sign: true }) : v === 0n ? "—" : money(absC(v)) }),
      el("td", { className: "run", textContent: money(running, { sign: true }) }));
  });
  rows.push(el("tr", { className: "total" }, el("td", { textContent: "Margine gestionale" }),
    el("td", { className: "amt " + tone(r.result), textContent: money(r.result, { sign: true }) }), el("td", { className: "run" })));
  $("bridge").replaceChildren(el("tbody", {}, ...rows));

  const fact = (label, value, small) => el("div", { className: "fact" }, el("dt", { textContent: label }), el("dd", {}, value, small ? el("small", { textContent: small }) : null));
  $("taxFacts").replaceChildren(fact("Incassata dagli ospiti", money(r.tax.collected, { whole: true })), fact("Versata al Comune", money(r.tax.paid, { whole: true })),
    fact(cents(r.tax.balance) < 0n ? "Anticipata dal conto" : "Da versare", money(absC(cents(r.tax.balance)), { whole: true })));
  $("taxNote").textContent = "Gli accrediti Vikey Pay / Stripe sono la tassa di soggiorno pagata online dagli ospiti; i bonifici al Comune la versano. Il saldo resta sul conto fino al prossimo versamento.";

  const head = el("tr", {}, ...["Voce", "Pagato dal conto", "Costo del periodo", "Differenza"].map((h, i) => el("th", { className: i ? "amt" : "", textContent: h })));
  const body = r.lines.map((l) => {
    const diff = cents(l.difference);
    const tr = el("tr", { className: "link", tabIndex: 0, title: "Vedi i movimenti" },
      el("td", {}, cap(l.label), el("small", { textContent: l.note })),
      el("td", { className: "amt", textContent: money(l.paid) }),
      el("td", { className: "amt", textContent: money(l.cost) }),
      el("td", { className: "amt diff " + (diff === 0n ? "" : "foot-diff"), textContent: diff === 0n ? "—" : money(diff, { sign: true }) }));
    const go = () => showMovements("", l.key);
    tr.addEventListener("click", go);
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    return tr;
  });
  const sum = (k) => r.lines.reduce((t, l) => t + cents(l[k]), 0n);
  const foot = el("tr", {}, el("td", { textContent: "Totale costi" }), el("td", { className: "amt", textContent: money(sum("paid")) }),
    el("td", { className: "amt", textContent: money(sum("cost")) }), el("td", { className: "amt", textContent: money(sum("difference"), { sign: true }) }));
  $("reconTable").replaceChildren(el("thead", {}, head), el("tbody", {}, ...body), el("tfoot", {}, foot));
}

// --- 4. Movimenti ------------------------------------------------------------------------------
function renderFilters() {
  const mv = S.p.movements || [];
  const months = [...new Set(mv.map((t) => t.date.slice(0, 7)))].sort().reverse();
  $("fMonth").replaceChildren(el("option", { value: "", textContent: "Tutto l’anno" }), ...months.map((m) => el("option", { value: m, textContent: cap(monthLong(m)) })));
  const keys = [...new Set(mv.map((t) => t.line))];
  const order = ["revenue", ...(S.d.bnb.cost_keys || []), "escluso"];
  keys.sort((x, y) => order.indexOf(x) - order.indexOf(y));
  const opts = [el("option", { value: "", textContent: "Tutte le voci" }), ...keys.map((k) => el("option", { value: k, textContent: lineLabel(k) }))];
  if (mv.some((t) => t.nature === "extraordinary")) opts.push(el("option", { value: "extraordinary", textContent: "Spese straordinarie" }));
  $("fLine").replaceChildren(...opts);
  for (const id of ["fMonth", "fLine"]) $(id).onchange = () => { S.limit = 50; renderMovements(); };
  $("fText").oninput = () => { S.limit = 50; renderMovements(); };
  $("txMore").onclick = () => { S.limit += 50; renderMovements(); };
}

function showMovements(month, line) {
  $("fMonth").value = month;
  $("fLine").value = [...$("fLine").options].some((o) => o.value === line) ? line : "";
  $("fText").value = "";
  S.limit = 50;
  renderMovements();
  scrollToEl($("movimenti"));
}

function renderMovements() {
  const month = $("fMonth").value, line = $("fLine").value, q = $("fText").value.trim().toLowerCase();
  const rows = (S.p.movements || []).filter((t) => (!month || t.date.startsWith(month)) &&
    (!line || (line === "extraordinary" ? t.nature === "extraordinary" : t.line === line && t.nature !== "extraordinary")) &&
    (!q || `${t.description} ${t.amount} ${money(t.amount)} ${lineLabel(t.line)}`.toLowerCase().includes(q)));
  let inc = 0n, out = 0n;
  for (const t of rows) { if (t.line === "escluso") continue; const c = cents(t.amount); if (c > 0n) inc += c; else out += c; }
  const body = $("txRows");
  if (!rows.length) {
    body.replaceChildren(el("tr", {}, el("td", { colSpan: 3 }, emptyState("Nessun movimento con questi filtri."))));
  } else {
    body.replaceChildren(...rows.slice(0, S.limit).map(txRow));
  }
  $("txFoot").replaceChildren(rows.length ? el("tr", {}, el("td", { colSpan: 2, textContent: `Totale filtrato${rows.some((t) => t.line === "escluso") ? " (esclusi giroconti)" : ""}` }),
    el("td", { className: "amt" }, inc ? el("div", { className: "pos", textContent: money(inc, { sign: true }) }) : null, out ? el("div", { textContent: money(out) }) : null)) : "");
  const ref = !month && line ? S.r.lines.find((l) => l.key === line) : null;
  const shown = `${numberIT(String(Math.min(rows.length, S.limit)))} di ${numberIT(String(rows.length))} movimenti`;
  if (ref && !q) {
    // Same months as the reconciliation (covered, not future): movements outside them are reported apart.
    const active = new Set(S.p.months.filter((m) => m.available && !m.forecast).map((m) => m.month));
    const sumOut = -rows.filter((t) => active.has(t.date.slice(0, 7))).reduce((acc, t) => acc + cents(t.amount), 0n);
    const ok = sumOut === cents(ref.paid);
    $("txCount").replaceChildren(shown + " · ", el("span", { className: ok ? "foot-check" : "foot-diff",
      textContent: ok ? `somma = pagato dal conto (${money(ref.paid)})` : `somma ${money(sumOut)} ≠ pagato ${money(ref.paid)}` }),
      cents(ref.difference) !== 0n ? ` · costo del periodo ${money(ref.cost)}: ${ref.note}` : "");
  } else $("txCount").textContent = shown;
  $("txMore").classList.toggle("hidden", rows.length <= S.limit);
}

function txRow(t) {
  const c = cents(t.amount);
  const head = el("div", { className: "tx-head" },
    el("span", { textContent: lineLabel(t.line) }),
    S.tags[t.id] ? tag(`→ ${lineLabel(S.tags[t.id])} · da salvare`, "est") : null,
    t.manual ? tag("corretta a mano") : null,
    t.nature === "extraordinary" ? tag("Straordinaria", "extra") : null,
    t.review ? tag("da verificare", "warn") : null);
  const tr = el("tr", { className: "tx", tabIndex: 0, title: "Dettaglio" },
    el("td", { className: "date", textContent: fmtDate(t.date) }),
    el("td", {}, head, el("div", { className: "tx-desc", textContent: t.description || "—" })),
    el("td", { className: "amt " + (c > 0n ? "pos" : ""), textContent: money(c, { sign: true }) }));
  const toggle = () => {
    const next = tr.nextElementSibling;
    if (next && next.classList.contains("detail")) { next.remove(); tr.classList.remove("open"); return; }
    tr.classList.add("open");
    const dl = el("dl", { className: "kv" });
    for (const [k, v] of [["Data", fmtDate(t.date)], ["Voce", lineLabel(t.line)],
      ["Natura", t.nature === "extraordinary" ? "Straordinaria (fuori dalla media)" : t.nature === "ordinary" ? "Ordinaria" : "—"],
      ["Causale", t.description || "—"], ["Riferimento (per correggere la voce)", t.id]]) dl.append(el("dt", { textContent: k }), el("dd", { textContent: v }));
    tr.after(el("tr", { className: "detail" }, el("td", { colSpan: 3 }, dl, tagPicker(t))));
  };
  tr.addEventListener("click", toggle);
  tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
  return tr;
}

// --- 5. Approfondimenti ------------------------------------------------------------------------
function renderMore() {
  const p = S.p, b = S.d.bnb;
  const extras = p.extraordinary_items || [];
  $("extraMeta").textContent = extras.length ? `${extras.length} · ${money(p.extraordinary_ytd, { whole: true })}` : "nessuna";
  $("extraList").replaceChildren(...(extras.length ? extras.map((t) => el("div", { className: "list-row" },
    el("span", { textContent: `${fmtDate(t.date)} · ${t.description}` }), el("strong", { textContent: money(t.amount) }),
    el("small", { textContent: `${t.reason} · rif. ${t.id}` }))) : [emptyState("Nessuna spesa straordinaria documentata nell’anno.")]));

  const checks = b.unlabelled || [];
  $("checkMeta").textContent = checks.length ? String(checks.length) : "nessuno";
  const byId = new Map((S.p.movements || []).map((m) => [m.id, m]));
  $("checkList").replaceChildren(...(checks.length ? checks.map((u) => el("div", { className: "list-row tag-row" },
    el("span", { textContent: `${fmtDate(u.date)} · ${u.description}` }), el("strong", { textContent: money(u.amount) }),
    tagPicker(byId.get(u.id) || { id: u.id, line: "altro" }))) : [emptyState("Nessuno: tutti i movimenti hanno una voce.")]));

  const t = b.totals || {};
  const fact = (label, value, cls = "") => el("div", { className: "fact" }, el("dt", { textContent: label }), el("dd", { className: cls, textContent: value }));
  $("bankFacts").replaceChildren(fact(`Entrate ${b.year}`, money(t.revenue || "0", { whole: true })), fact(`Uscite ${b.year}`, money(t.costi || "0", { whole: true })),
    fact("Netto di cassa", money(t.netto || "0", { whole: true, sign: true }), tone(t.netto || "0")),
    fact("Saldo conto", S.d.balance ? money(S.d.balance.amount, { whole: true }) : "—"));
  $("bankHead").replaceChildren(el("tr", {}, ...["Mese", "Entrate", "Uscite", "Netto", "Esclusi"].map((h, i) => el("th", { className: i ? "amt" : "", textContent: h }))));
  const months = (b.months || []).filter((m) => m.has_data);
  $("bankRows").replaceChildren(...months.map((m) => el("tr", { className: "month" },
    el("td", {}, cap(monthLong(m.month)), m.status === "in corso" ? [" ", tag("in corso", "warn")] : null),
    el("td", { className: "amt", textContent: money(m.values.revenue) }),
    el("td", { className: "amt", textContent: money(-cents(m.values.costi)) }),
    el("td", { className: "amt " + tone(m.values.netto), textContent: money(m.values.netto, { sign: true }) }),
    el("td", { className: "amt", textContent: cents(m.excluded) ? money(m.excluded) : "—" }))));
  $("bankFoot").replaceChildren(el("tr", {}, el("td", { textContent: `Totale ${b.year}` }), el("td", { className: "amt", textContent: money(t.revenue || "0") }),
    el("td", { className: "amt", textContent: money(-cents(t.costi || "0")) }), el("td", { className: "amt", textContent: money(t.netto || "0", { sign: true }) }), el("td", {})));

  $("method").replaceChildren(note(p.payout_basis), ...p.notes.map((n) => note(n)),
    note(`Previsioni: incassi dei mesi futuri dallo stesso mese dell’anno precedente se coperto, altrimenti dalla media dei ${p.baseline_months} mesi storici; costi dalla media storica. I pagamenti già avvenuti sostituiscono le stime, non si sommano due volte.`),
    note("Pareggio mensile = costi ordinari medi dei mesi chiusi: l’incasso minimo per non andare in perdita, mutuo compreso."),
    note("Movimenti: ogni giorno alle 23:00 (ora italiana), salvo coda di GitHub."));
}

if (!KEY) failPage(new Error("manca la chiave nel link (#k=…): usa il link personale della dashboard B&B"));
else decryptPage(KEY, "ca-bnb-v1").then(render).catch(failPage);

// --- Etichettatura manuale -----------------------------------------------------------------------
// The page is static and encrypted: choices stay in this browser until "Salva" hands them to the
// Amministrazione workflow, which validates them and republishes the dashboards.
function tagPicker(t) {
  const sel = el("select", { className: "tag-select", ariaLabel: "Voce del movimento" },
    el("option", { value: "", textContent: `Voce: ${lineLabel(t.line)} (com’è)` }),
    ...TAG_LINES.filter((k) => k !== t.line).map((k) => el("option", { value: k, textContent: lineLabel(k) })),
    t.manual ? el("option", { value: "auto", textContent: "Torna alla voce automatica" }) : null);
  sel.value = S.tags[t.id] || "";
  sel.addEventListener("click", (e) => e.stopPropagation());
  sel.onchange = () => {
    if (sel.value) S.tags[t.id] = sel.value; else delete S.tags[t.id];
    saveTags();
    renderTagBar();
    const row = sel.closest(".tag-row");
    if (row) row.classList.toggle("tagged", !!sel.value);
  };
  return el("label", { className: "tag-pick" }, el("span", { textContent: "Cambia voce" }), sel);
}

function renderTagBar() {
  const mv = new Map((S.p.movements || []).map((m) => [m.id, m]));
  // Choices already applied by a later publication are dropped automatically.
  // Drop choices already applied by a later publication, and refs no longer in this year's data.
  for (const [ref, line] of Object.entries(S.tags)) {
    const m = mv.get(ref);
    if (!m || m.line === line || (line === "auto" && !m.manual)) delete S.tags[ref];
  }
  saveTags();
  const n = Object.keys(S.tags).length;
  $("tagBar").classList.toggle("hidden", !n);
  $("tagCount").textContent = `${n} ${n === 1 ? "etichetta" : "etichette"} da salvare`;
}

async function saveTagsFlow() {
  const code = Object.entries(S.tags).map(([ref, line]) => `${ref}=${line}`).join(" ");
  let copied = false;
  try { await navigator.clipboard.writeText(code); copied = true; } catch { /* manual copy below */ }
  const box = $("tagHelp");
  const area = el("textarea", { className: "tag-code", readOnly: true, value: code, rows: 3, ariaLabel: "Codice delle etichette" });
  const open = el("a", { className: "button primary ext", href: ADMIN_URL, target: "_blank", rel: "noopener noreferrer", textContent: "Apri Amministrazione" });
  box.replaceChildren(
    el("strong", { textContent: copied ? "Codice copiato. Ultimo passo su GitHub:" : "Copia il codice qui sotto, poi su GitHub:" }),
    el("ol", {}, el("li", { textContent: "Apri Amministrazione e premi Run workflow." }),
      el("li", { textContent: "Comando: etichette-bnb · Argomenti: incolla il codice." }),
      el("li", { textContent: "Premi Run workflow: in un paio di minuti la dashboard si aggiorna con le nuove voci." })),
    area, el("div", { className: "inline-actions" }, open));
  box.classList.remove("hidden");
  area.addEventListener("focus", () => area.select());
}
