/*
 * "Yumas Import" — run by the bookmark from inside a logged-in MY orderbird tab.
 *
 * For each restaurant it asks the Yumas app for the last Z-report on file,
 * fetches every Z-report after it (CSV plus the shift's opening time) the same
 * way the "Export" button does, and sends them to the app. MY orderbird turns
 * away requests from servers, so this has to run in the user's own browser.
 *
 * Loaded fresh on every click (the bookmark adds a timestamp), so changes here
 * reach the bookmark without setting it up again.
 */
(function () {
  var self = document.currentScript;
  var src = new URL(self.src);
  var APP = src.origin;
  var TOKEN = src.searchParams.get('t') || '';
  var MAX_PER_VENUE = 60;

  if (window.__yumasImportRunning) return;

  if (location.hostname !== 'my.orderbird.com') {
    alert('Open my.orderbird.com and log in first, then click "Yumas Import" again.');
    return;
  }
  var switchForm = document.querySelector('form[action*="switch"]');
  var csrfInput = switchForm && switchForm.querySelector('[name=csrfmiddlewaretoken]');
  if (!switchForm || !csrfInput) {
    alert('Please log in to MY orderbird first, then click "Yumas Import" again.');
    return;
  }
  window.__yumasImportRunning = true;

  // ── A small progress box ────────────────────────────────────────────────
  var box = document.createElement('div');
  box.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;width:340px;max-height:70vh;overflow:auto;' +
    'background:#fff;border:2px solid #1B5E20;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);' +
    'font:13px/1.45 system-ui,sans-serif;color:#1f2937;padding:14px 16px';
  box.innerHTML = '<div style="font-weight:700;color:#1B5E20;margin-bottom:6px">Yumas Import</div><div id="yumas-log"></div>';
  document.body.appendChild(box);
  var logEl = box.querySelector('#yumas-log');
  function log(text, color) {
    var p = document.createElement('div');
    p.textContent = text;
    if (color) p.style.color = color;
    logEl.appendChild(p);
    box.scrollTop = box.scrollHeight;
  }
  function finish(ok) {
    var b = document.createElement('button');
    b.textContent = 'Close';
    b.style.cssText = 'margin-top:10px;padding:5px 14px;border-radius:8px;border:1px solid #1B5E20;background:' + (ok ? '#1B5E20;color:#fff' : '#fff;color:#1B5E20') + ';cursor:pointer;font-weight:600';
    b.onclick = function () { box.remove(); };
    box.appendChild(b);
    window.__yumasImportRunning = false;
  }

  var current = switchForm.querySelector('.venue-select__option--selected');
  var originalVenue = current ? current.value : null;

  function switchTo(venueId) {
    var body = new URLSearchParams({ csrfmiddlewaretoken: csrfInput.value, venue_id: venueId, next: '/reports' });
    return fetch('/switch/', { method: 'POST', credentials: 'include', body: body }).then(function (r) {
      if (!r.ok) throw new Error('could not switch restaurant (HTTP ' + r.status + ')');
    });
  }

  /* The shift page reads "05.10.2026 11:33 - 05.10.2026 15:05"; only the start is needed. */
  function shiftStart(z) {
    return fetch('/reports/shift/' + z, { credentials: 'include' }).then(function (r) {
      return r.ok ? r.text() : '';
    }).then(function (html) {
      var m = html.match(/(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})\s*-\s*\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}/);
      return m ? m[3] + '-' + m[2] + '-' + m[1] + ' ' + m[4] + ':' + m[5] : null;
    });
  }

  async function fetchVenue(v) {
    var shifts = [];
    await switchTo(v.venueId);
    for (var z = v.lastZ + 1, n = 0; n < MAX_PER_VENUE; z++, n++) {
      var r = await fetch('/reports/csv/shift/' + z, { credentials: 'include' });
      if (r.status === 404) break; // not closed yet
      var type = r.headers.get('content-type') || '';
      if (!r.ok || type.indexOf('csv') === -1) throw new Error('Z-report ' + z + ' could not be fetched (HTTP ' + r.status + ')');
      shifts.push({ z: z, csv: await r.text(), start: await shiftStart(z) });
    }
    return shifts;
  }

  (async function run() {
    try {
      log('Asking the Yumas app where to start…');
      var st = await fetch(APP + '/api/webhooks/orderbird-shifts', { headers: { 'X-Import-Token': TOKEN } });
      var status = await st.json();
      if (!st.ok) throw new Error(status.error || ('HTTP ' + st.status));

      var payload = [];
      for (var i = 0; i < status.venues.length; i++) {
        var v = status.venues[i];
        if (v.lastZ == null) {
          payload.push({ venueId: v.venueId, shifts: [], error: v.location + ': no Z-report on file yet — upload one by hand first' });
          log(v.location + ': skipped (nothing on file yet)', '#b45309');
          continue;
        }
        try {
          var shifts = await fetchVenue(v);
          payload.push({ venueId: v.venueId, shifts: shifts });
          log(v.location + ': ' + (shifts.length ? shifts.length + ' new Z-report' + (shifts.length === 1 ? '' : 's') : 'up to date'));
        } catch (e) {
          payload.push({ venueId: v.venueId, shifts: [], error: v.location + ': ' + e.message });
          log(v.location + ': ' + e.message, '#b91c1c');
        }
      }

      if (originalVenue) await switchTo(originalVenue).catch(function () {});

      log('Sending to the Yumas app…');
      var res = await fetch(APP + '/api/webhooks/orderbird-shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Import-Token': TOKEN },
        body: JSON.stringify({ venues: payload }),
      });
      var out = await res.json();
      (out.imported || []).forEach(function (s) {
        log('✓ ' + s.location + ' · ' + s.date.split('-').reverse().join('.') + ' · ' + (s.shift === 'lunch' ? 'Lunch' : 'Dinner') +
          ' · € ' + Number(s.gross).toFixed(2).replace('.', ','), '#166534');
      });
      if (out.error) {
        log('Problem: ' + out.error, '#b91c1c');
        finish(false);
      } else {
        log(out.imported && out.imported.length ? 'Done — ' + out.imported.length + ' shift(s) imported.' : 'Done — everything was already up to date.', '#1B5E20');
        finish(true);
      }
    } catch (e) {
      if (originalVenue) await switchTo(originalVenue).catch(function () {});
      log('Failed: ' + e.message, '#b91c1c');
      finish(false);
    }
  })();
})();
