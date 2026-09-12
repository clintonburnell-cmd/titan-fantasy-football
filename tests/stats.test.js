// stats.js: the website counts visits with Cloudflare Web Analytics; the app never does.
const fs = require('fs');
const path = require('path');
const T = require('./lib');
const S = T.app('stats.js');
const {check, section} = T;

// A browser window as stats.js sees it.
const win = (url, o = {}) => {
  const u = new URL(url);
  return {
    location: {hostname: u.hostname, pathname: u.pathname, search: u.search},
    document: {referrer: o.referrer || ''},
    navigator: {standalone: o.standalone},
    sessionStorage: {getItem: k => (o.play && k === 'titan.play' ? '1' : null)},
    matchMedia: q => ({matches: !!o.installed && q === '(display-mode: standalone)'})
  };
};
const site = 'https://titanfantasyfootball.com';
const counts = (url, o) => S.counts(win(url, o), 'test-token');

section('which visits count');
check(counts(site + '/'), 'the home page counts');
check(counts(site + '/guides/sleeper-start-sit.html') && counts(site + '/privacy.html'), 'guides and the privacy page count');
check(counts(site + '/?home'), '/?home in a browser counts');
check(!counts(site + '/app/') && !counts(site + '/app/lineups') && !counts(site + '/app/?demo'), 'the app never counts');
check(!counts(site + '/?source=play'), 'the Android app opening the home page does not count');
check(!counts(site + '/', {referrer: 'android-app://com.titanfantasyfootball.app/'}), 'the Android app without its query does not count');
check(!counts(site + '/privacy.html', {play: true}), 'a page opened later in an Android app session does not count');
check(!counts(site + '/', {installed: true}) && !counts(site + '/', {standalone: true}), 'home-screen copies do not count');
check(!counts('https://titan-fantasy-football.web.app/') && !counts('http://localhost:8080/'), 'other addresses (web.app, tests) do not count');
check(!S.counts(win(site + '/'), ''), 'nothing loads without a token');
const blocked = win(site + '/');
blocked.sessionStorage = {getItem: () => { throw new Error('blocked'); }};
check(S.counts(blocked, 'test-token'), 'blocked storage does not break it');

section('which pages load it');
const has = f => /<script src="\/stats\.js" defer><\/script>/.test(fs.readFileSync(path.join(T.ROOT, f), 'utf8'));
const pages = ['index.html', 'privacy.html', 'terms.html',
  ...fs.readdirSync(path.join(T.ROOT, 'guides')).filter(f => f.endsWith('.html')).map(f => 'guides/' + f)];
pages.forEach(f => check(has(f), f + ' loads stats.js'));
check(!has('app/index.html'), 'the app page does not load stats.js');
T.done();
