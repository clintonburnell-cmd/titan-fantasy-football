// Copies the app's engine, Sleeper, ESPN and Yahoo layers into functions/shared
// before each deploy, so the server job runs exactly the same rules as the app.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(__dirname, 'shared');
const FILES = ['engine.js', 'espn.js', 'sleeper.js', 'yahoo.js'];
fs.mkdirSync(out, {recursive: true});
for (const f of FILES) fs.copyFileSync(path.join(root, f), path.join(out, f));
console.log('copied ' + FILES.join(', ') + ' into functions/shared');
