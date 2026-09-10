// Copies the app's engine and Sleeper layer into functions/shared before each
// deploy, so the server job runs exactly the same rules as the app.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(__dirname, 'shared');
fs.mkdirSync(out, {recursive: true});
for (const f of ['engine.js', 'sleeper.js']) fs.copyFileSync(path.join(root, f), path.join(out, f));
console.log('copied engine.js and sleeper.js into functions/shared');
