/* The Titan Waiver Wire, Titan's free weekly email: every signup box (a <form data-newsletter> inside a
   [data-newsletter-box]) sends the email address to Kit, the newsletter service. Kit's form endpoint takes a plain
   form post with no key, so this posts it in the background (no-cors: the answer can't be read, so the box says
   "check your inbox") and Kit sends the confirmation email. Without JavaScript the boxes stay hidden.
   FORM_ID is Kit's form number (public: it's in every signup form on the web). Until it's set, every box stays
   hidden, so nothing half-working shows. A device that has joined is remembered (localStorage titan.newsletter):
   boxes marked data-hide-joined, and the app's cards, stop asking. The UI test sets window.TitanNewsletterForm. */
(function () {
  var FORM_ID = '';
  var KEY = 'titan.newsletter';

  function formId() { return String(window.TitanNewsletterForm || FORM_ID || ''); }
  function endpoint() { return 'https://app.kit.com/forms/' + encodeURIComponent(formId()) + '/subscriptions'; }
  function joined() { try { return localStorage.getItem(KEY) === 'joined'; } catch (e) { return false; } }
  function remember() { try { localStorage.setItem(KEY, 'joined'); } catch (e) { /* private window: it just asks again */ } }

  // Shows the boxes once there's a form to post to; hides the ones marked data-hide-joined on a device that joined.
  function prep(root) {
    var ready = !!formId(), done = joined();
    (root || document).querySelectorAll('[data-newsletter-box]').forEach(function (box) {
      box.hidden = !ready || (done && box.hasAttribute('data-hide-joined'));
    });
    (root || document).querySelectorAll('form[data-newsletter]').forEach(function (f) {
      if (ready) { f.action = endpoint(); f.method = 'post'; }
    });
  }

  document.addEventListener('submit', function (e) {
    var f = e.target && e.target.closest ? e.target.closest('form[data-newsletter]') : null;
    if (!f || !formId() || !window.fetch) return;
    e.preventDefault();
    var input = f.querySelector('input[name="email_address"]'), btn = f.querySelector('button[type="submit"]');
    var note = f.querySelector('[data-newsletter-note]');
    if (!input || !input.checkValidity()) { if (input) input.reportValidity(); return; }
    var body = new URLSearchParams();
    body.set('email_address', input.value.trim());
    if (btn) btn.disabled = true;
    fetch(endpoint(), {method: 'POST', mode: 'no-cors', body: body}).then(function () {
      remember();
      input.value = '';
      f.classList.add('nl-done');
      if (note) note.textContent = 'Almost done: check your inbox and tap the link in Kit\'s email to confirm.';
    }, function () {
      if (note) note.textContent = 'That didn\'t go through. Check your connection and try again.';
    }).then(function () { if (btn) btn.disabled = false; });
  });

  // Back from Kit's confirmation link or the no-JavaScript post: /newsletter/?joined=1.
  function welcome() {
    if (!/[?&]joined=1\b/.test(location.search)) return;
    remember();
    document.querySelectorAll('[data-newsletter-joined]').forEach(function (el) { el.hidden = false; });
  }

  window.TitanNewsletter = {ready: function () { return !!formId(); }, joined: joined, prep: prep};
  function start() { prep(); welcome(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
