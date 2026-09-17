/* The scorecard page: reads public/scorecard (posted each Tuesday by titan-analytics' upload.js after the grader runs;
   anyone can read public/) and draws the grader's own summary lines. Aggregates only. */
(function () {
  'use strict';
  var DOC = 'https://firestore.googleapis.com/v1/projects/titan-fantasy-football/databases/(default)/documents/public/' +
    'scorecard?key=AIzaSyDjOaXVvwa9JxSjrLe3Ihnmlbd0Te4jS4Q';
  var meta = document.querySelector('[data-sc-meta]'), body = document.querySelector('[data-sc-body]');
  if (!meta || !body || !window.fetch) return;
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
  function when(ms) { try { return new Date(ms).toLocaleDateString(undefined, {weekday: 'short', month: 'short', day: 'numeric'}); } catch (e) { return ''; } }
  // The grader's markdown is a title line, a blank, then "- " lines with "  - " sub-lines: a two-level list.
  function draw(md) {
    var lines = md.split('\n').filter(function (l) { return l.trim() && !/^#/.test(l); });
    var html = '', open = false;
    lines.forEach(function (l) {
      var sub = /^\s+- /.test(l), text = esc(l.replace(/^\s*- /, '')).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
      if (!/^\s*- /.test(l)) { if (open) { html += '</ul>'; open = false; } html += '<p>' + text + '</p>'; return; }
      if (!sub) { if (open) html += '</ul>'; html += '<ul class="sc-list"><li>' + text; open = true; }
      else html += '<ul><li>' + text + '</li></ul>';
    });
    if (open) html += '</ul>';
    return html;
  }
  fetch(DOC).then(function (r) { if (r.status === 404) return null; if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then(function (d) {
    var f = d && d.fields || {}, md = f.md && f.md.stringValue, graded = f.graded ? Number(f.graded.integerValue) : 0;
    if (!d || !md) { meta.textContent = 'No grades yet: the first arrive after week 4, once two finished weeks follow a report.'; return; }
    meta.textContent = 'Season ' + (f.season ? f.season.integerValue : '') + ', graded through week ' + (f.finished ? f.finished.integerValue : '') +
      (f.at ? ', updated ' + when(Number(f.at.integerValue)) : '') + (graded ? '' : '. Nothing graded yet; the reports below are waiting for their weeks.');
    body.innerHTML = '<div class="sc-card">' + draw(md) + '</div>';
  }).catch(function () { meta.textContent = 'The scorecard could not be loaded right now.'; });
})();
