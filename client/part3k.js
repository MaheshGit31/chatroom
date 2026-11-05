(() => {
'use strict';
const C = window.__core, U = window.__ui, X = window.__ext;
const { S, el, ic, toast, api } = C;
const { modal } = U;

const FIX = {"teh":"the","adn":"and","taht":"that","thier":"their","recieve":"receive","recieved":"received","wierd":"weird","freind":"friend","freinds":"friends","becuase":"because","becasue":"because","beacuse":"because","definately":"definitely","defintely":"definitely","seperate":"separate","occured":"occurred","untill":"until","wich":"which","whcih":"which","alot":"a lot","thats":"that's","dont":"don't","doesnt":"doesn't","didnt":"didn't","cant":"can't","wont":"won't","isnt":"isn't","arent":"aren't","wasnt":"wasn't","werent":"weren't","havent":"haven't","hasnt":"hasn't","hadnt":"hadn't","wouldnt":"wouldn't","couldnt":"couldn't","shouldnt":"shouldn't","ive":"i've","youre":"you're","theyre":"they're","its'":"it's","whats":"what's","hows":"how's","wheres":"where's","theres":"there's","heres":"here's","goign":"going","gonig":"going","doign":"doing","haveing":"having","makeing":"making","takeing":"taking","comeing":"coming","writting":"writing","runing":"running","geting":"getting","stoped":"stopped","beleive":"believe","belive":"believe","acheive":"achieve","arguement":"argument","begining":"beginning","calender":"calendar","collegue":"colleague","comming":"coming","completly":"completely","concious":"conscious","embarass":"embarrass","enviroment":"environment","existance":"existence","foriegn":"foreign","goverment":"government","gaurd":"guard","grammer":"grammar","happend":"happened","harrass":"harass","immediatly":"immediately","independant":"independent","interupt":"interrupt","knowlege":"knowledge","libary":"library","lisence":"license","maintainance":"maintenance","millenium":"millennium","mispell":"misspell","neccessary":"necessary","necesary":"necessary","noticable":"noticeable","occassion":"occasion","occurence":"occurrence","persistant":"persistent","posession":"possession","prefered":"preferred","privelege":"privilege","probly":"probably","publically":"publicly","realy":"really","reccomend":"recommend","refered":"referred","relevent":"relevant","religous":"religious","remeber":"remember","rember":"remember","resistence":"resistance","responsability":"responsibility","rythm":"rhythm","sieze":"seize","succesful":"successful","sucess":"success","suprise":"surprise","tommorow":"tomorrow","tomorow":"tomorrow","tounge":"tongue","truely":"truly","tyrany":"tyranny","wether":"whether","whereever":"wherever","yesturday":"yesterday","youself":"yourself","waht":"what","wnat":"want","hte":"the","nad":"and","tht":"that","jsut":"just","abotu":"about","aobut":"about","liek":"like","hapy":"happy","frist":"first","thnk":"think","konw":"know","knwo":"know","shoudl":"should","woudl":"would","coudl":"could","peple":"people","poeple":"people","pepole":"people","togehter":"together","toghether":"together","diffrent":"different","diferent":"different","intresting":"interesting","interresting":"interesting","importent":"important","beautifull":"beautiful","beatiful":"beautiful","excersize":"exercise","excercise":"exercise","favorit":"favorite","favourit":"favourite","freinly":"friendly","geniune":"genuine","hieght":"height","humourous":"humorous","idnetity":"identity","kindergarden":"kindergarten","langauge":"language","mathmatics":"mathematics","mischievious":"mischievous","ocassionally":"occasionally","oppurtunity":"opportunity","paralel":"parallel","pasttime":"pastime","peice":"piece","plesant":"pleasant","pronounciation":"pronunciation","questionaire":"questionnaire","recieving":"receiving","rediculous":"ridiculous","resturant":"restaurant","sargent":"sergeant","scedule":"schedule","shedule":"schedule","sincerly":"sincerely","speach":"speech","strenght":"strength","temperture":"temperature","thourough":"thorough","tought":"thought","vaccum":"vacuum","vegtable":"vegetable","wensday":"wednesday","wendsday":"wednesday","thursay":"thursday","saturady":"saturday","febuary":"february","wierdo":"weirdo","accomodate":"accommodate","adress":"address","agressive":"aggressive","apparant":"apparent","assasin":"assassin","basicly":"basically","buisness":"business","catagory":"category","cemetary":"cemetery","changable":"changeable","cheif":"chief","commited":"committed","compatability":"compatibility","congradulations":"congratulations","dilema":"dilemma","dissapear":"disappear","dissapoint":"disappoint","ecstacy":"ecstasy","embarassed":"embarrassed","exagerate":"exaggerate","existant":"existent","firey":"fiery","flourescent":"fluorescent","fourty":"forty","gratefull":"grateful","guidence":"guidance","heirarchy":"hierarchy","hygeine":"hygiene","ignorence":"ignorance","incidently":"incidentally","jewelery":"jewelry","judgement":"judgment","liason":"liaison","lollypop":"lollipop","manuever":"maneuver","medeval":"medieval","miniscule":"minuscule","neice":"niece","ommit":"omit","pavillion":"pavilion","perseverence":"perseverance","playwrite":"playwright","pursuade":"persuade","reciept":"receipt","reccommend":"recommend","sandwhich":"sandwich","secratary":"secretary","supercede":"supersede","threshhold":"threshold","tomatos":"tomatoes","twelth":"twelfth","unforseen":"unforeseen","wellcome":"welcome","whith":"with","wiht":"with","wih":"with"};

const match = (w) => {
  const hit = FIX[w.toLowerCase()];
  if (!hit) return null;
  if (w === w.toUpperCase() && w.length > 2) return hit.toUpperCase();
  if (w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase()) return hit[0].toUpperCase() + hit.slice(1);
  return hit;
};

function attachAutocorrect(input) {
  let undo = null;
  input.addEventListener('keydown', (e) => {
    if (S.prefs.autocorrect === false) return;
    if (e.key === 'Backspace' && undo && undo.at === input.selectionStart && input.value === undo.after) {
      e.preventDefault();
      input.value = undo.before; input.setSelectionRange(undo.caret, undo.caret); undo = null;
      input.dispatchEvent(new Event('input'));
      return;
    }
    undo = null;
    if (e.key !== ' ' && e.key !== 'Enter') return;
    if (input.selectionStart !== input.selectionEnd) return;
    const pos = input.selectionStart, before = input.value.slice(0, pos);
    const m = /([A-Za-z']+)$/.exec(before);
    if (!m || /^[/@:]/.test(before.slice(0, m.index).slice(-1))) return;
    const start = m.index;
    if (start > 0 && /[/@:#]/.test(before[start - 1])) return;
    const fixed = match(m[1]);
    if (!fixed) return;
    const orig = input.value;
    input.value = orig.slice(0, start) + fixed + orig.slice(pos);
    const caret = start + fixed.length;
    input.setSelectionRange(caret, caret);
    if (e.key === ' ') {
      e.preventDefault();
      input.setRangeText(' ', caret, caret, 'end');
      undo = { before: orig.slice(0, pos) + ' ' + orig.slice(pos), after: input.value, at: input.selectionStart, caret: pos + 1 };
      input.dispatchEvent(new Event('input'));
    }
  });
}

async function smartFix(input) {
  const text = input.value.trim();
  if (text.length < 3) return toast('type something first', 'info');
  let ok = false;
  try { ok = S.prefs.smartFixOk === true; } catch {}
  if (!ok) {
    ok = await new Promise((done) => {
      const m = modal('smart fix', el('div', { class: 'col gap-s' },
        el('p', { style: 'margin:0' }, 'this sends what you typed to an outside ai service so it can fix your spelling and grammar. it is not end to end encrypted.'),
        el('div', { class: 'form-err' }, 'do not use it on anything private. only the draft is sent, nothing else about you.'),
        el('div', { class: 'row gap end' }, el('button', { class: 'btn ghost', onclick: () => { m.close(); done(false); } }, 'cancel'), el('button', { class: 'btn primary', onclick: () => { m.close(); done(true); } }, 'fix it'))));
    });
    if (!ok) return;
    S.prefs.smartFixOk = true; try { localStorage.setItem('chatroom.prefs', JSON.stringify(S.prefs)); } catch {}
  }
  try {
    const d = await api('POST', '/api/ai/fix', { text });
    input.value = d.text; input.dispatchEvent(new Event('input')); input.focus();
    toast('fixed, check it before sending', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

Object.assign(window.__ext, { attachAutocorrect, smartFix });
})();
