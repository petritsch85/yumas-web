/**
 * Yumas — Gmail → Bills auto-import
 *
 * Runs inside the admin@yumas.de Google account every 15 minutes. Each new
 * email with a PDF or picture attached is sent to the Yumas app, which reads
 * it, decides whether it is a bill, and files it under "Newly Received" on the
 * Bills page. Anything that is not a bill (Lieferschein, order confirmation …)
 * is listed under "Not imported" instead.
 *
 * Gmail labels show what happened:
 *   Yumas/Imported       — sent to the app
 *   Yumas/Import failed  — could not be sent after several tries; forward by hand
 *
 * SETUP (once):
 *   1. script.google.com → New project, logged in as admin@yumas.de
 *   2. Replace everything in Code.gs with this file
 *   3. Paste the webhook address into RELAY_URL below
 *   4. Choose "setup" in the function menu at the top → Run → allow access
 *
 * TO FETCH AN OLDER MONTH: see "backfill" near the bottom.
 */

// The inbound-relay address, including ?secret=…  (same as the old Postmark webhook URL)
const RELAY_URL = 'PASTE_WEBHOOK_URL_HERE';

const LABEL_DONE   = 'Yumas/Imported';
const LABEL_FAILED = 'Yumas/Import failed';
const MAX_TRIES    = 5;        // failed sends before an email is given up on
const WINDOW_DAYS  = 30;       // how far back each run looks
const BACKFILL_DAYS = 2;       // on setup, also pick up the last two days
const RUN_LIMIT_MS = 4.5 * 60 * 1000; // Google stops a run at 6 minutes

const WANTED = /\.(pdf|jpe?g|png|eml)$/i;

/** Run once by hand: stores the start date, creates the labels and the 15-minute timer. */
function setup() {
  if (RELAY_URL.indexOf('http') !== 0) throw new Error('Paste the webhook address into RELAY_URL first.');
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('start')) {
    const start = new Date(Date.now() - BACKFILL_DAYS * 86400000);
    props.setProperty('start', String(start.getTime()));
  }
  label_(LABEL_DONE);
  label_(LABEL_FAILED);
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'importBills')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('importBills').timeBased().everyMinutes(15).create();
  importBills();
  Logger.log('Set up. Imports every 15 minutes from ' + new Date(Number(props.getProperty('start'))));
}

/** The timer calls this. Safe to run by hand at any time. */
function importBills() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // the previous run is still going
  try {
    run_();
  } finally {
    lock.releaseLock();
  }
}

function run_() {
  const began = Date.now();
  const props = PropertiesService.getScriptProperties();
  const start = Number(props.getProperty('start') || 0);
  if (!start) throw new Error('Run setup first.');

  const seen  = loadSeen_(props);
  const tries = JSON.parse(props.getProperty('tries') || '{}');
  const me    = Session.getEffectiveUser().getEmail().toLowerCase();
  const done  = label_(LABEL_DONE);
  const failed = label_(LABEL_FAILED);

  const query = 'has:attachment -in:trash -in:spam -in:drafts newer_than:' + WINDOW_DAYS + 'd';
  const threads = GmailApp.search(query, 0, 200);
  let sent = 0;

  outer:
  for (const thread of threads) {
    for (const msg of thread.getMessages()) {
      if (Date.now() - began > RUN_LIMIT_MS) break outer; // the rest waits for the next run
      const id = msg.getId();
      if (seen[id]) continue;
      if (msg.getDate().getTime() < start || msg.isInTrash()) continue;
      if (msg.getFrom().toLowerCase().indexOf(me) !== -1) { seen[id] = Date.now(); continue; } // our own

      const files = msg.getAttachments({ includeInlineImages: false })
        .filter(a => WANTED.test(a.getName()) || a.getContentType() === 'application/pdf' || a.getContentType() === 'message/rfc822');
      if (files.length === 0) { seen[id] = Date.now(); continue; }

      const payload = {
        From:      msg.getFrom(),
        Subject:   msg.getSubject(),
        MessageID: id,
        Date:      msg.getDate().toISOString(),
        Attachments: files.map(a => ({
          Name:        a.getName(),
          ContentType: a.getContentType(),
          Content:     Utilities.base64Encode(a.getBytes()),
        })),
      };

      let code = 0, text = '';
      try {
        const res = UrlFetchApp.fetch(RELAY_URL, {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify(payload),
          muteHttpExceptions: true,
        });
        code = res.getResponseCode();
        text = res.getContentText().slice(0, 300);
      } catch (e) {
        text = String(e);
        if (/permission/i.test(text)) {
          // Not this email's fault: access to the internet has not been granted yet
          Logger.log('Missing permission — run "authorize" once. ' + text);
          break outer;
        }
      }

      if (code === 200) {
        seen[id] = Date.now();
        delete tries[id];
        thread.addLabel(done);
        sent++;
        Logger.log('Sent: ' + msg.getSubject() + ' → ' + text);
      } else if (code === 401 || code === 404) {
        // The address is wrong — no point trying the other emails
        Logger.log('The app refused the address (' + code + '). Check RELAY_URL. ' + text);
        break outer;
      } else {
        tries[id] = (tries[id] || 0) + 1;
        Logger.log('Failed (' + code + ', try ' + tries[id] + '): ' + msg.getSubject() + ' — ' + text);
        if (tries[id] >= MAX_TRIES) {
          seen[id] = Date.now();
          delete tries[id];
          thread.addLabel(failed);
        }
      }
    }
  }

  saveSeen_(props, seen);
  props.setProperty('tries', JSON.stringify(tries));
  if (sent) Logger.log(sent + ' email(s) sent to the app');
}

/* ────────────────────────────────────────────────────────────────────────────
 * Nachtrag — fetching an older month out of the mailbox
 *
 * The timer above only ever looks back WINDOW_DAYS, and only forward of the
 * date setup was run. That is right for the daily job and useless for closing
 * a month that is already past: by the time 66 September payments turned out
 * to have no invoice behind them, every one of those emails was outside the
 * window.
 *
 * So this sweeps a date range of its own, ignores the "already seen" list, and
 * sends everything with an attachment. Re-sending costs nothing: the app turns
 * away a file it has seen before, and turns away a bill whose supplier, number
 * and amount it already holds. Worst case it does the work twice.
 *
 * TO USE: set the two dates below, pick "backfill" in the function menu, Run.
 * Google stops a run after six minutes — if the log says it is not finished,
 * just run it again. It carries on where it stopped.
 * ──────────────────────────────────────────────────────────────────────────── */

// The emails to sweep, as yyyy/mm/dd. Start well before the month: an invoice
// dated 21 August is paid in September and arrived in the inbox in August.
const BACKFILL_FROM = '2026/08/20';
const BACKFILL_TO   = '2026/10/08';   // exclusive

const LABEL_BACKFILL = 'Yumas/Nachtrag';

function backfill() {
  if (RELAY_URL.indexOf('http') !== 0) throw new Error('Paste the webhook address into RELAY_URL first.');
  const began = Date.now();
  const props = PropertiesService.getScriptProperties();
  const tag = 'bf_' + BACKFILL_FROM + '_' + BACKFILL_TO;
  let at = Number(props.getProperty(tag) || 0);   // how many threads are behind us

  const me = Session.getEffectiveUser().getEmail().toLowerCase();
  const mark = label_(LABEL_BACKFILL);
  const query = 'has:attachment -in:trash -in:spam -in:drafts'
    + ' after:' + BACKFILL_FROM + ' before:' + BACKFILL_TO;

  let sent = 0, skipped = 0, failed = 0;

  outer:
  for (;;) {
    /* In pages, because search returns at most a few hundred at a time and
       seven weeks of attachments is more than that. */
    const threads = GmailApp.search(query, at, 50);
    if (threads.length === 0) {
      props.deleteProperty(tag);
      Logger.log('Nachtrag finished: ' + BACKFILL_FROM + ' to ' + BACKFILL_TO
        + ' — ' + sent + ' sent, ' + skipped + ' without attachments, ' + failed + ' failed.');
      return;
    }

    for (const thread of threads) {
      if (Date.now() - began > RUN_LIMIT_MS) {
        props.setProperty(tag, String(at));
        Logger.log('Paused at thread ' + at + ' (' + sent + ' sent so far). Run "backfill" again to carry on.');
        break outer;
      }
      at++;

      for (const msg of thread.getMessages()) {
        const d = msg.getDate();
        if (msg.isInTrash()) continue;
        if (msg.getFrom().toLowerCase().indexOf(me) !== -1) continue;   // our own
        /* The search is by thread, so a thread that qualifies can still hold
           messages from outside the range. Check each one. */
        if (d < new Date(BACKFILL_FROM) || d >= new Date(BACKFILL_TO)) continue;

        const files = msg.getAttachments({ includeInlineImages: false })
          .filter(a => WANTED.test(a.getName())
            || a.getContentType() === 'application/pdf'
            || a.getContentType() === 'message/rfc822');
        if (files.length === 0) { skipped++; continue; }

        const res = send_({
          From:      msg.getFrom(),
          Subject:   msg.getSubject(),
          MessageID: msg.getId(),
          Date:      d.toISOString(),
          Attachments: files.map(a => ({
            Name:        a.getName(),
            ContentType: a.getContentType(),
            Content:     Utilities.base64Encode(a.getBytes()),
          })),
        });

        if (res.code === 200) {
          sent++;
          thread.addLabel(mark);
        } else if (res.code === 401 || res.code === 404) {
          props.setProperty(tag, String(at - 1));
          Logger.log('The app refused the address (' + res.code + '). Check RELAY_URL. ' + res.text);
          break outer;
        } else {
          failed++;
          Logger.log('Failed (' + res.code + '): ' + msg.getSubject() + ' — ' + res.text);
        }
      }
    }
  }
}

/** Start the next backfill from the beginning, whatever the last one did. */
function backfillReset() {
  const props = PropertiesService.getScriptProperties();
  props.getKeys().filter(k => k.indexOf('bf_') === 0).forEach(k => props.deleteProperty(k));
  Logger.log('Nachtrag will start from the beginning.');
}

/** One POST to the app. Never throws — the caller decides what a failure means. */
function send_(payload) {
  try {
    const res = UrlFetchApp.fetch(RELAY_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    return { code: res.getResponseCode(), text: res.getContentText().slice(0, 300) };
  } catch (e) {
    return { code: 0, text: String(e) };
  }
}

/** Run by hand if the log says a permission is missing: Google then asks for it. */
function authorize() {
  UrlFetchApp.fetch('https://www.google.com');
  ScriptApp.getProjectTriggers();
  GmailApp.getUserLabels();
  PropertiesService.getScriptProperties().deleteProperty('tries');
  Logger.log('All permissions granted.');
}

function label_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

/* Which emails have been dealt with, by message id. Kept a little longer than
   the search window and spread over several properties, since one property
   holds at most 9 KB. */
function loadSeen_(props) {
  const seen = {};
  const n = Number(props.getProperty('seen_n') || 0);
  for (let i = 0; i < n; i++) Object.assign(seen, JSON.parse(props.getProperty('seen_' + i) || '{}'));
  return seen;
}

function saveSeen_(props, seen) {
  const cutoff = Date.now() - (WINDOW_DAYS + 5) * 86400000;
  const chunks = [{}];
  let size = 0;
  for (const id in seen) {
    if (seen[id] < cutoff) continue;
    const entry = id.length + 20;
    if (size + entry > 8000) { chunks.push({}); size = 0; }
    chunks[chunks.length - 1][id] = seen[id];
    size += entry;
  }
  const old = Number(props.getProperty('seen_n') || 0);
  chunks.forEach((c, i) => props.setProperty('seen_' + i, JSON.stringify(c)));
  for (let i = chunks.length; i < old; i++) props.deleteProperty('seen_' + i);
  props.setProperty('seen_n', String(chunks.length));
}
