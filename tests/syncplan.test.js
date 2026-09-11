// syncplan.js: which copy wins when a device and the person's account disagree.
const T = require('./lib');
const P = T.app('syncplan.js');
const {check, section} = T;
const acc = (t, user = 'a') => ({userId: user, prefs: {}, updatedAt: t});
const wk = t => ({rows: [{name: 'x'}], savedAt: t});

section('account');
check(P.accountAction(null, null) === 'none', 'nothing anywhere: nothing to do');
check(P.accountAction(acc(5), null) === 'push', 'only this device has it: push');
check(P.accountAction(null, acc(5)) === 'pull', 'only the account has it (a new phone): pull');
check(P.accountAction(acc(5), acc(9)) === 'pull', 'the account is newer: pull');
check(P.accountAction(acc(9), acc(5)) === 'push', 'the device is newer: push');
check(P.accountAction(acc(5), acc(5)) === 'none', 'same time: nothing to do');
check(P.accountAction({userId: 'a', prefs: {}}, acc(5)) === 'pull', 'a device copy from before sync (no time): pull');
check(P.accountAction(acc(5), {userId: 'a'}) === 'push', 'an account copy without a time: push');

section('rankings');
const plan = P.ranksPlan({1: wk(10), 2: wk(30), 3: wk(5)}, {1: wk(20), 2: wk(25), 4: wk(7)});
check(JSON.stringify(Object.keys(plan.pull).sort()) === '["1","4"]', 'pull week 1 (account newer) and week 4 (only in the account)');
check(JSON.stringify(plan.push.sort()) === '["2","3"]', 'push week 2 (device newer) and week 3 (only on the device)');
const same = P.ranksPlan({1: wk(10)}, {1: wk(10)});
check(!Object.keys(same.pull).length && !same.push.length, 'identical weeks: nothing to do');
check(P.ranksPlan(undefined, undefined).push.length === 0, 'missing inputs are handled');

section('live changes from another device');
check(P.acceptRemoteWeek(undefined, wk(5)) === true, 'a new week from another device: take it');
check(P.acceptRemoteWeek(wk(5), wk(9)) === true, 'a newer version: take it');
check(P.acceptRemoteWeek(wk(9), wk(5)) === false, 'an older version (an echo of a stale write): ignore it');
check(P.acceptRemoteWeek(wk(9), wk(9)) === false, 'the same version (an echo of our own write): ignore it');
check(P.acceptRemoteDelete(wk(5), wk(5)) === true, 'deleted on the other device: delete here');
check(P.acceptRemoteDelete(wk(9), wk(5)) === false, 'deleted there but saved newer here: keep it');
check(P.acceptRemoteDelete(undefined, wk(5)) === false, 'deleted there, not here: nothing to do');
T.done();
