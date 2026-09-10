/* Titan Fantasy Football — sync decisions.
 *
 * Which copy wins when this device and the person's account disagree. Pure
 * functions, so the rules can be tested without Firebase: the newer copy
 * always wins, compared by the timestamp the app stamps on every save.
 */
(function (root) {
  'use strict';

  function stamp(x, key) { return (x && x[key]) || 0; }

  /* The linked Sleeper account and league switches: 'pull' the account's copy,
     'push' this device's copy, or 'none' when they already agree. */
  function accountAction(local, remote) {
    if (remote && (!local || stamp(remote, 'updatedAt') > stamp(local, 'updatedAt'))) return 'pull';
    if (local && (!remote || stamp(local, 'updatedAt') > stamp(remote, 'updatedAt'))) return 'push';
    return 'none';
  }

  /* Rankings, week by week: which weeks to take from the account and which to
     send up from this device. */
  function ranksPlan(localWeeks, remoteWeeks) {
    localWeeks = localWeeks || {};
    remoteWeeks = remoteWeeks || {};
    var weeks = {}, pull = {}, push = [];
    Object.keys(localWeeks).forEach(function (w) { weeks[w] = 1; });
    Object.keys(remoteWeeks).forEach(function (w) { weeks[w] = 1; });
    Object.keys(weeks).forEach(function (w) {
      var L = localWeeks[w], R = remoteWeeks[w];
      if (R && (!L || stamp(R, 'savedAt') > stamp(L, 'savedAt'))) pull[w] = R;
      else if (L && (!R || stamp(L, 'savedAt') > stamp(R, 'savedAt'))) push.push(w);
    });
    return {pull: pull, push: push};
  }

  /* A live change from another device is applied only if it is newer. */
  function acceptRemoteWeek(local, remote) {
    return !local || stamp(remote, 'savedAt') > stamp(local, 'savedAt');
  }

  /* A week deleted on another device is removed here unless this device has
     since saved a newer version of it. */
  function acceptRemoteDelete(local, removed) {
    return !!local && stamp(local, 'savedAt') <= stamp(removed, 'savedAt');
  }

  var api = {accountAction: accountAction, ranksPlan: ranksPlan,
    acceptRemoteWeek: acceptRemoteWeek, acceptRemoteDelete: acceptRemoteDelete};

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TitanSyncPlan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
