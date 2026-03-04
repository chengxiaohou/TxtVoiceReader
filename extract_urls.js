import fs from 'fs';
const code = fs.readFileSync('node_modules/phonemizer/dist/phonemizer.js', 'utf8');
const matches = code.match(/.{0,50}espeakng.{0,50}/g);
console.log(matches ? matches.slice(0, 10) : 'No matches');


