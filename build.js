// build.js - glues client/part1..4 into public/index.html (no bundler needed)
const fs = require('fs');                                     // file access
const read = (f) => fs.readFileSync(__dirname + '/client/' + f, 'utf8'); // read a part
fs.mkdirSync(__dirname + '/public', { recursive: true });     // make sure output dir exists
// the word filter runs in the browser too: inline lib/filter.js and the word list where part2 asks for it
const filterSrc = fs.readFileSync(__dirname + '/lib/filter.js', 'utf8').replace(/^if \(typeof module.*$/m, '') + '\nconst WORDS = ' + fs.readFileSync(__dirname + '/lib/badwords.json', 'utf8').trim() + ';\n';
const out = read('part1.html') + read('part2.js').replace('/*__FILTER__*/', () => filterSrc) + '\n' + read('part3.js') + '\n' + read('part3b.js') + '\n' + read('part3c.js') + '\n' + read('part3d.js') + '\n' + read('part3f.js') + '\n' + read('part3g.js') + '\n' + read('part3e.js') + '\n' + read('part4.html'); // stitch parts together
if (out.includes('</scr' + 'ipt>', out.indexOf('<script>') + 8) && out.split('</scr' + 'ipt>').length !== 2) throw new Error('stray closing script tag inside the js'); // would break document.write loading
fs.writeFileSync(__dirname + '/public/index.html', out);      // write the finished page
console.log('built public/index.html', out.length, 'bytes');
