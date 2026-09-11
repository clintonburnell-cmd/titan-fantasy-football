// News: espn.js reading ESPN's news feed, and engine.js choosing news alerts for
// people's starters. Made-up stories, no network.
const T = require('./lib');
const SCC = T.app('engine.js');
const ESPN = T.app('espn.js');
const {check, section} = T;

section('ESPN\'s news feed');
const feed = {articles: [
  {id: 1, type: 'HeadlineNews', headline: 'Bears WR Odunze ready ', description: 'He says he is 100%.', published: '2026-09-11T21:58:09Z',
    links: {web: {href: 'https://www.espn.com/nfl/story/_/id/1/x'}}, images: [{url: 'https://a.espncdn.com/photo/1.jpg'}],
    categories: [{type: 'league', description: 'NFL'}, {type: 'team', description: 'Chicago Bears', team: {abbreviation: 'CHI'}},
      {type: 'athlete', athleteId: 4431299, description: 'Rome Odunze'}]},
  {id: 2, type: 'Media', headline: 'Highlights', published: '2026-09-11T22:10:00Z', premium: true, links: {web: {href: 'https://www.espn.com/video/clip?id=2'}}},
  {id: 3, headline: 'No link', published: '2026-09-11T22:00:00Z'},
  {id: 4, headline: 'Bad link', published: '2026-09-11T22:00:00Z', links: {web: {href: 'javascript:alert(1)'}}}]};
const news = ESPN.newsFrom(feed);
check(news.length === 2 && news[0].id === '2' && news[1].id === '1', 'newest first; stories without a proper https link are dropped');
check(news[1].headline === 'Bears WR Odunze ready' && news[1].athletes[0].name === 'Rome Odunze' && news[1].athletes[0].id === '4431299' &&
  news[1].teams.join() === 'CHI' && news[1].image === 'https://a.espncdn.com/photo/1.jpg', 'headline, the players and teams it tags, and its picture');
check(news[0].video && news[0].plus && news[0].athletes.length === 0 && news[0].image === '', 'videos and ESPN+ stories are marked');

section('news alerts');
const analysis = {leagues: [
  {cfg: {id: 'a', key: 'League A', name: 'League A'}, rows: [{p: {name: 'Rome Odunze'}}, {p: null}, {p: {name: 'Josh Allen'}}]},
  {cfg: {id: 'b', key: 'League B', name: 'League B'}, rows: [{p: {name: 'Rome Odunze'}}]}]};
const watch = SCC.newsWatch(analysis);
const odunze = watch.find(w => w.name === 'Rome Odunze');
check(watch.length === 2 && odunze.leagues.join() === 'League A,League B', 'the starters to watch, each with the leagues he starts in');
const sent = {};
const al = SCC.newsAlertsFor(news, watch, {week: 1, sent});
check(al.length === 1 && al[0].key === 'news|1|1|' + SCC.norm('Rome Odunze') && al[0].url === 'https://www.espn.com/nfl/story/_/id/1/x' &&
  al[0].title === 'News: Rome Odunze' && /League A and League B lineups/.test(al[0].body), 'a story about a starter becomes an alert that opens it: ' + (al[0] && al[0].body));
check(SCC.newsAlertsFor(news, watch, {week: 1, sent}).length === 0, 'and never twice');
const lots = Array.from({length: 8}, (_, i) => ({id: 'x' + i, at: i, headline: 'h' + i, url: 'https://e.com/' + i, athletes: [{name: 'Josh Allen'}]}));
check(SCC.newsAlertsFor(lots, watch, {week: 1, sent: {}}).length === 3, 'at most three at a time, so a busy news day doesn\'t flood the phone');

T.done();
