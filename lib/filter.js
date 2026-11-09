// lib/filter.js - word filter that runs the same on the server and in the browser (build.js inlines it)
// it is a best-effort guard: exact words, simple l33t, repeated letters, f.u.c.k and "f u c k" spacing
function makeFilter(words0) {
  const EXTRA_WORDS = ['dih', 'dihh', 'diddle', 'diddler', 'diddling', 'kys', 'horny', 'pedo', 'pedos', 'pedophile', 'paedo', 'nudes', 'sexting', 'boner', 'jerkoff', 'cumshot', 'milf', 'rapist', 'molest', 'molester', 'incest', 'onlyfans', 'dickpic', 'dickhead', 'cocksucker', 'cumming', 'tranny', 'beaner', 'coon', 'wetback', 'chink', 'spastic', 'mongoloid'];
  const PHRASES = ['kill yourself', 'kill your self', 'go die', 'go kill yourself', 'hang yourself', 'neck yourself', 'end yourself', 'drink bleach', 'send nudes', 'i will rape', 'ill rape', 'touch kids', 'touch children'];
  const COMPOUND = ['fuck', 'shit', 'bitch', 'cunt', 'pussy', 'whore', 'slut', 'nigga', 'nigger', 'faggot', 'retard', 'cocksuck', 'dickhead', 'dickpic', 'blowjob', 'dildo', 'pedophil', 'motherfuck'];
  const SAFE = ['shiitake', 'shitake', 'scunthorpe', 'octopussy', 'pussycat', 'pussyfoot', 'pussywillow', 'slutsky', 'retardant', 'retardation', 'bullshiitake'];
  const NAME_SUB = ['dih', 'diddl', 'dick', 'cock', 'penis', 'vagina', 'nazi', 'hitler', 'porn', 'sexy', 'nude', 'boob', 'tits', 'anus', 'pedo', 'horny', 'whore', 'slut', 'rapist', 'molest', 'cumshot', 'jizz', 'bukake', 'fap'];
  const NAME_SAFE = ['peacock', 'hancock', 'cocktail', 'cockpit', 'woodcock', 'shuttlecock', 'cockatoo', 'cockatiel', 'cockney', 'dickens', 'dickinson', 'dickson', 'benedick', 'dickerson', 'hitchcock', 'babycock', 'ashkenazi', 'benazir', 'dihya', 'sindih', 'nudelman', 'fapa', 'fapi', 'rapidfap', 'cockburn', 'cockrell', 'sexyback'];
  const words = [...words0, ...EXTRA_WORDS];
  const squash = (s) => s.replace(/(.)\1+/g, '$1');                          // sshhiit -> shit
  const single = new Set(), squashed = new Set();
  for (const w of words) { const n = String(w).toLowerCase().replace(/[^a-z0-9]/g, ''); if (n.length > 1) { single.add(n); squashed.add(squash(n)); } }
  const LEET = { '@': 'a', '4': 'a', '0': 'o', '1': 'i', '!': 'i', '3': 'e', '$': 's', '5': 's', '7': 't', '+': 't', '8': 'b' };
  const SPLIT = /([\s,;:/\\|()\[\]{}"<>]+)/;                                   // what separates words (kept so we can rebuild the text)
  const fold = (t) => t.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const hit = (s) => s.length > 1 && (single.has(s) || squashed.has(squash(s)));
  const badToken = (raw) => {                                                // one word, tried a few ways
    const t = fold(raw);
    if (!t) return false;
    const trimmed = t.replace(/^[^a-z0-9@$!+]+|[^a-z0-9@$!+]+$/g, '');       // "shit!" -> "shit!" without outer junk
    const lettersOnly = trimmed.replace(/[^a-z]/g, '');                       // f.u.c.k -> fuck
    const leet = trimmed.replace(/[@4013$578+!]/g, (c) => LEET[c]).replace(/[^a-z]/g, ''); // f*ck handled by next line
    const stripEnd = trimmed.replace(/[!$+@]+$/g, '').replace(/[@4013$578+!]/g, (c) => LEET[c]).replace(/[^a-z]/g, ''); // shit! -> shit
    if (hit(lettersOnly) || hit(leet) || hit(stripEnd) || hit(leet.replace(/v/g, 'u'))) return true;
    if (leet.length >= 4 && hasCompound(leet)) return true;
    if (leet.replace(/v/g, 'u') !== leet && hasCompound(leet.replace(/v/g, 'u'))) return true;
    if (MASK.test(trimmed) && skeletons.has(skel(leet))) return true;
    return false;
  };
  const MASK = /[*#_.\-]/;
  const skel = (w) => w.replace(/[aeiou]/g, '');
  const skeletons = new Set();
  for (const w of single) if (w.length >= 4) { const k = skel(w); if (k.length >= 3) skeletons.add(k); }
  const flat = (t) => fold(t).replace(/[@4013$578+!]/g, (c) => LEET[c]).replace(/[^a-z]/g, '');
  const flatV = (t) => flat(t).replace(/v/g, 'u');
  const hasCompound = (v) => {
    let x = v;
    for (const sf of SAFE) x = x.split(sf).join('');
    return COMPOUND.some((c) => x.includes(c) || (squash(c) === c && squash(x).includes(c)));
  };
  const parts = (text) => String(text || '').split(SPLIT);                    // [word, sep, word, sep ...]
  function check(text) {
    const p = parts(text), words = p.filter((_, i) => i % 2 === 0);
    if (words.some(badToken)) return true;
    const norm = ' ' + words.map((w) => flat(w)).filter(Boolean).join(' ') + ' ';
    if (PHRASES.some((ph) => norm.includes(' ' + ph + ' ') || norm.includes(' ' + squash(ph) + ' ') || norm.includes(' ' + squash(ph).replace(/ /g, '') + ' '))) return true;
    for (let i = 0; i < words.length; i++) {                                  // "f u c k" - runs of single letters
      let run = '', j = i;
      while (j < words.length && words[j].length === 1 && /[a-z0-9@$]/i.test(words[j])) { run += words[j]; j++; }
      if (run.length >= 3 && badToken(run)) return true;
      if (j > i) i = j - 1;
    }
    return false;
  }
  function clean(text) {                                                      // swap bad words for stars when showing
    return parts(text).map((w, i) => (i % 2 === 0 && badToken(w) ? w.replace(/[A-Za-z0-9@$!+]/g, '*') : w)).join('');
  }
  function checkName(text) {
    if (check(text)) return true;
    let x = flatV(text).replace(/u/g, 'u');
    const y = flat(text);
    for (const v of [x, y]) {
      let z = v;
      for (const sf of NAME_SAFE) z = z.split(sf).join('');
      if (NAME_SUB.some((n) => z.includes(n)) || hasCompound(v)) return true;
    }
    return false;
  }
  return { check, clean, checkName };
}
if (typeof module !== 'undefined') module.exports = { makeFilter };
