// lib/filter.js - word filter that runs the same on the server and in the browser (build.js inlines it)
// it is a best-effort guard: exact words, simple l33t, repeated letters, f.u.c.k and "f u c k" spacing
function makeFilter(words) {
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
    return hit(lettersOnly) || hit(leet) || hit(stripEnd);
  };
  const parts = (text) => String(text || '').split(SPLIT);                    // [word, sep, word, sep ...]
  function check(text) {
    const p = parts(text), words = p.filter((_, i) => i % 2 === 0);
    if (words.some(badToken)) return true;
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
  return { check, clean };
}
if (typeof module !== 'undefined') module.exports = { makeFilter };
