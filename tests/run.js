// Runs Titan's tests: `node tests/run.js`, or name some: `node tests/run.js engine espn`.
// Tests that need a real Sleeper account read it from TITAN_SLEEPER_USER and
// skip themselves without it. See tests/lib.js.
const {spawnSync} = require('child_process');
const path = require('path');

const FILES = ['syncplan', 'engine', 'espn', 'functions', 'live', 'ui'];
const pick = process.argv.slice(2);
const failed = [];
for (const name of FILES) {
  if (pick.length && !pick.includes(name)) continue;
  console.log('\n##### ' + name);
  const r = spawnSync(process.execPath, [path.join(__dirname, name + '.test.js')], {stdio: 'inherit', env: process.env});
  if (r.status !== 0) failed.push(name);
}
console.log(failed.length ? '\nFAILED: ' + failed.join(', ') : '\nevery test passed');
process.exit(failed.length ? 1 : 0);
