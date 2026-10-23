"use strict";
// Browser-side freshness checks also work when the publishing workflow stops.
function serviceAlerts(data, now = Date.now()) {
  const s = data.status || {}, ai = data.ai_health || data.ai || {};
  const repo = "https://github.com/leonardobuffoni/ca-aggregator";
  const run = repo + "/actions/workflows/daily.yml";
  const connect = repo + "/actions/workflows/connect.yml";
  const bankHelp = repo + "/blob/main/MANUTENZIONE.md#rinnovare-un-consenso";
  const claudeHelp = repo + "/blob/main/MANUTENZIONE.md#token-claude";
  const alerts = [];
  const add = (service, title, message, label, href, level = "warning") => alerts.push({service,title,message,label,href,level});
  const age = (seconds) => seconds ? now / 1000 - seconds : Infinity;
  const fmt = (seconds) => seconds ? new Date(seconds * 1000).toLocaleString("it-IT", {dateStyle:"short",timeStyle:"short",timeZone:"Europe/Rome"}) : "mai";
  const banks = data.bank !== undefined ? (data.bank ? [data.bank] : []) : (s.banks || []);
  const expired = banks.filter(b => (b.state && b.state !== "active") || (b.valid_until && Date.parse(b.valid_until) <= now));
  if (!banks.length) {
    add("Banca", "Collega la banca", "I movimenti automatici non sono collegati. Gli estratti importati restano disponibili. Apri Collega banca, scegli la banca e avvia il passo 1.", "Collega banca ↗", connect, "error");
  } else if (expired.length || ["expired","revoked"].includes(s.session_state)) {
    add("Banca", "Consenso da rinnovare", (expired.map(b=>b.bank).filter(Boolean).join(", ") || "La banca") + ": accesso scaduto o revocato. I nuovi movimenti non arrivano finché non completi di nuovo il consenso nella banca.", "Ricollega banca ↗", connect, "error");
  } else if (s.workflow_sync_failed) {
    add("Automazione", "Esecuzione interrotta", "Il job di sincronizzazione è fallito prima di completare il giro. I movimenti mostrati possono essere precedenti all'errore. Controlla i log: non è necessariamente un problema di consenso bancario.", "Apri esecuzione ↗", run, "error");
  } else if (s.last_attempt_ok === false) {
    const limited = s.bank_error_code === "rate_limit" || /limite di accessi|rate.limit/i.test(s.last_attempt_summary || "");
    add("Banca", limited ? "Limite accessi raggiunto" : "Ultimo aggiornamento non riuscito", limited ? "Il giro bancario ha incontrato un limite di richieste in uno dei collegamenti. Non serve ricollegarla: il prossimo tentativo automatico è alle 23:00. Evita tentativi manuali ripetuti." : "L'ultimo tentativo non è riuscito. Il consenso risulta ancora valido: controlla l'esecuzione prima di ricollegare la banca.", "Controlla esecuzione ↗", run);
  } else if (age(s.last_success_at) > 36 * 3600) {
    add("Banca", "Movimenti automatici non aggiornati", "Ultima sincronizzazione riuscita: " + fmt(s.last_success_at) + ". Gli estratti caricati manualmente hanno una copertura separata. Controlla l'esecuzione: da questo ritardo non si può dedurre che il consenso sia scaduto.", "Controlla aggiornamento ↗", run);
  }
  if (!expired.length && banks.some(b => b.valid_until && Date.parse(b.valid_until) > now && Date.parse(b.valid_until) - now <= 7 * 864e5)) {
    add("Banca", "Consenso in scadenza", "Il consenso scade entro 7 giorni. Puoi rinnovarlo prima che si interrompano gli aggiornamenti.", "Come rinnovare ↗", bankHelp);
  }
  if (s.automation_enabled === false) add("Automazione", "Aggiornamenti automatici disattivati", "La cadenza delle 23:00 è sospesa. I dati rimangono all'ultimo aggiornamento disponibile.", "Apri impostazioni ↗", repo + "/settings/variables/actions");
  if (age(data.generated_at) > 36 * 3600) add("Automazione", "Stato del sito non aggiornato", "Questa pagina è stata generata il " + fmt(data.generated_at) + ". Il processo potrebbe essersi fermato: non posso verificare da questa copia eventuali errori nuovi di banca o Claude.", "Controlla GitHub Actions ↗", run);
  const status = ai.status || "";
  let code = ai.error_code || "";
  if (!code && /login|oauth|autenticaz/i.test(status)) code = "login";
  if (!code && /limite di utilizzo|quota/i.test(status)) code = "quota";
  if (!code && /non aggiornato|input non preparato/i.test(status)) code = "error";
  if (ai.enabled === false) add("Claude", "Commenti automatici disattivati", "I movimenti e i calcoli continuano a funzionare; il commento Claude non viene aggiornato.", "Apri impostazioni ↗", repo + "/settings/variables/actions");
  else if (code === "login") add("Claude", "Rinnova l'accesso a Claude", "Il token è scaduto o non è più valido. Sul PC esegui claude setup-token, poi aggiorna il Secret CLAUDE_CODE_OAUTH_TOKEN su GitHub. Infine avvia un'esecuzione con solo_ai.", "Istruzioni per riconnettere ↗", claudeHelp, "error");
  else if (code === "quota") add("Claude", "Quota Claude esaurita", "Il commento precedente resta visibile. Non serve rifare il login: attendi il ripristino della quota, poi riprova con solo_ai. I dati bancari continuano ad aggiornarsi.", "Controlla esecuzione ↗", run);
  else if (code) add("Claude", "Commento non aggiornato", "L'ultimo tentativo Claude non è riuscito. Controlla il job AI e riprova con solo_ai; questo errore non richiede automaticamente un nuovo login.", "Controlla Claude ↗", run);
  else if (ai.enabled && !ai.last_attempt_at) add("Claude", "Nessun aggiornamento ancora registrato", "Il commento verrà generato alla prossima esecuzione utile. Puoi avviarlo da GitHub scegliendo solo_ai.", "Avvia commento ↗", run);
  else if (ai.enabled && /in attesa/.test(status) && age(ai.last_attempt_at) > 36 * 3600) add("Claude", "Commento ancora in attesa", "La richiesta risulta in attesa da una copia non recente. Controlla il job AI.", "Controlla Claude ↗", run);
  return alerts;
}
function renderServiceHealth(data) {
  const target = document.getElementById("serviceAlerts");
  if (!target) return;
  const node = (tag, cls, text) => {const e=document.createElement(tag);e.className=cls;e.textContent=text;return e;};
  target.replaceChildren(...serviceAlerts(data).map(a => {
    const box=node("section", "service-alert " + a.level, "");
    box.append(node("div","eyebrow",a.service),node("strong","service-title",a.title),node("p","",a.message));
    const link=node("a","button",a.label);link.href=a.href;link.target="_blank";link.rel="noopener noreferrer";box.append(link);return box;
  }));
  document.getElementById("refreshSchedule").textContent = "Movimenti: ogni giorno alle 23:00 (ora italiana) · Claude: dopo il giro, se i dati sono cambiati. Orario soggetto alla coda di GitHub.";
}
