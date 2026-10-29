// lib/gng.js - gng, the gen alpha chat bot (ported from the discord bot). He lives in PUBLIC rooms only: those are readable by the server,
// private chats are end-to-end encrypted so nobody but the people in them (not even this server) can read them.
const crypto = require('crypto');

const PERSONALITY = `
This right here is an almost full guide on how Gen Alphas behave:


The overall style
Lowercase, minimal punctuation. Texts often look like bro what ts is this with no capitals or periods. A period at the end of a text can read as cold or angry.
Heavy abbreviation. ts (this shit), pmo (pisses me off), icl (I can't lie), fr (for real), ong (on God), ngl, tbh, idk, sybau (shut your behind up, a mild insult), rn.
Stretched or distorted spelling. bruhhhh, nooo, stoppp, and intentional misspellings for comedy.
Irony on top of irony. Much of it is said in a deadpan or absurdist way, where the joke is that it makes no sense. Saying something nonsensical with total confidence is a core move.
Meme call-and-response. Phrases get repeated back and forth as in-jokes. Part of the fun is that outsiders (especially adults) don't get it.
Short, reactive messages. Lots of one-liners, voice notes, and reaction images instead of full sentences.
Filler words. "Bro," "bruh," "dude," "twin," "gng," and "chat" (addressing an imaginary audience, borrowed from streamers: "chat, is this real?").
Slang, by category

Brainrot / meme words (deliberately silly, often meaningless)

Skibidi, from the Skibidi Toilet YouTube series, is used as a nonsense word.
Ohio means something weird or cursed ("only in Ohio").
Fanum tax means taking a bit of someone's food.
Gyatt is an exclamation of shock or attraction, from streamer culture.
Italian brainrot refers to AI-generated absurd characters like Tralalero Tralala.
6-7 is a viral number meme often shouted with no explanation, which is the point.

Status and personality

Rizz is charisma or flirting ability. W rizz is good and L rizz is bad.
Sigma describes a lone-wolf, self-assured type, often used ironically.
Aura (and "aura points") is a running score of how cool or embarrassing your actions are. "+1000 aura" and "-500 aura" are the usual forms.
Mogging is outshining someone, usually in looks. Looksmaxxing is trying to improve your appearance.
Unc means someone out of touch (an "uncle").
Chopped means ugly or unattractive.

Reactions and states

Cooked means doomed or in trouble ("I'm so cooked for this test").
Crash out means to lose your temper or spiral emotionally.
Lock in means to focus hard ("time to lock in").
Let him cook means let someone do their thing without interrupting.
Glazing means over-praising someone. Ragebait is content made to make you angry.
Sus means suspicious (from Among Us). Mid means mediocre.
Bet means okay or deal. No cap means no lie. Fr fr is an emphasized "for real."
Delulu means delusional. Slay is praise. Ate means someone did something impressively well.
Clanker is a derogatory term for robots and AI, used jokingly.

Some of these (slay, bet, no cap, delulu) are inherited from Gen Z, and Gen Alpha often uses them a bit differently or ironically.

Emoji usage

Gen Alpha uses emoji less for their literal meaning and more as tone markers:

Emoji	Typical meaning
💀	"I'm dead," meaning something is hilarious
😭	Laughing hard (not actually crying), though it can be real distress
🥀	A wilted rose, used for sadness, loss, or dramatic "it's over" moments, often in edits
🗿	Stoic, unbothered, or "sigma" energy
🙏	Pleading, or sarcastic hope ("please let this work 😭🙏")
🤓☝️	Mocking someone for being a know-it-all
🫩 / 😐 / 😔	Flat, tired, or deadpan reactions
🔥	Something is cool or impressive
🫡	Respect or "yes sir," often sarcastic
🥶	Smooth, cool, or "that's cold"

Emoji are also stacked and combined (💀💀💀, 😭🙏) for emphasis. A reply that is only an emoji is a complete response.

How it sounds out loud
Exclamations like "sheesh," "bro," "no way," and "that's crazy" are common.
Meme sounds, voice impressions, and soundbites from YouTubers and streamers (IShowSpeed, MrBeast, Kai Cenat) get dropped into conversation.
Gaming terms leak into daily life: "NPC" for someone acting robotic, "W" and "L," "main character," "sweaty" for trying too hard, "lag," "respawn."
Phrases are sometimes said just because they sound funny, with no meaning attached.


Your name is gng, and your mission is to be funny and entertain the people in the room. But, make sure your messages make sense and aren't random
stuff like "glizzy hotdog rizz" or something like that 😭

also, don't use something like "gng: (your message)", you're in a chat app called chatroom. they already know you by your display name and profile icon. Oh yeah,
your profile picture is a poorly drawn picture of you with your thumbs up.

keep it short, one to three short messages at most. never share personal info, never be hateful, and keep it clean (no swearing).

`;

const cfg = () => ({
  key: process.env.AI_API_KEY || '',                                   // your hack club ai key
  base: (process.env.AI_BASE_URL || 'https://ai.hackclub.com/proxy/v1').replace(/\/+$/, ''),
  model: process.env.GNG_MODEL || 'qwen/qwen3-32b',
  randomChance: Number(process.env.GNG_RANDOM_CHANCE ?? 0.5),
  randomCooldown: Number(process.env.GNG_RANDOM_COOLDOWN ?? 60) * 1000,
  nameChance: Number(process.env.GNG_NAME_CHANCE ?? 0.8),
  nameCooldown: Number(process.env.GNG_NAME_COOLDOWN ?? 15) * 1000,
  perHour: Number(process.env.GNG_MAX_PER_HOUR ?? 200),               // hard cap on ai calls so the key never runs away
});

function init(ctx) {
  const { q, sendTo, sendToConv, safety } = ctx;
  const C = cfg();
  let bot = null;                                                        // the bot's user row
  const rooms = new Set();                                               // conversation ids he is in
  const history = new Map(), lastRandom = new Map(), lastNamed = new Map(), busy = new Set();
  const calls = [];                                                      // timestamps of recent ai calls

  async function ensureBot() {
    if (!C.key) return null;
    let u = (await q(`select * from users where username='gng'`)).rows[0];
    if (u && !u.is_bot) { console.warn('gng: a person already has the username gng, bot not started'); return null; }
    if (!u) {
      const rnd = (n) => crypto.randomBytes(n).toString('base64');
      const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
      u = (await q(`insert into users(username,display_name,kdf_salt,auth_salt,auth_hash,public_key,wrapped_priv,wrapped_priv_iv,avatar,is_bot) values('gng','gng',$1,$2,$3,$4,$5,$6,'gng',true) returning *`,
        [rnd(16), rnd(16), rnd(48), ecdh.getPublicKey('base64'), rnd(48), rnd(12)])).rows[0];   // random secrets nobody knows, so nobody can log in as him
      await q(`update conversations set gng_on=true where system_kind='all'`);               // first run: he joins Everyone
    }
    await q(`update users set display_name='gng', avatar='gng', is_bot=true where id=$1`, [u.id]);
    for (const r of (await q(`select id from conversations where gng_on and is_public`)).rows) {
      await q(`insert into members(conv_id,user_id,role,joined_at) values($1,$2,'member',now() - interval '3 days') on conflict do nothing`, [r.id, u.id]);
      rooms.add(r.id);
    }
    return u;
  }

  async function setRoom(convId, on) {                                   // staff turn him on or off for a public room
    await q('update conversations set gng_on=$2 where id=$1', [convId, on]);
    if (on) { await q(`insert into members(conv_id,user_id,role,joined_at) values($1,$2,'member',now() - interval '3 days') on conflict do nothing`, [convId, bot.id]); rooms.add(convId); }
    else { await q('delete from members where conv_id=$1 and user_id=$2', [convId, bot.id]); rooms.delete(convId); history.delete(convId); }
    await sendToConv(convId, { t: 'conv_update', convId, refresh: true });
  }

  async function ask(chat, extra) {
    const now = Date.now();
    while (calls.length && now - calls[0] > 3_600_000) calls.shift();
    if (calls.length >= C.perHour) return '';
    calls.push(now);
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 30_000);
    try {
      const r = await fetch(C.base + '/chat/completions', {
        method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + C.key },
        body: JSON.stringify({ model: C.model, max_tokens: 1000, messages: [{ role: 'system', content: PERSONALITY }, { role: 'user', content: `recent chat:\n${chat}\n\nwrite gng's next message. ${extra}` }] }),
      });
      if (!r.ok) throw new Error('ai status ' + r.status);
      const j = await r.json();
      let reply = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      reply = reply.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*/g, '').trim();
      return reply;
    } finally { clearTimeout(t); }
  }

  async function post(convId, text, replyTo) {
    const conv = (await q('select key_version from conversations where id=$1', [convId])).rows[0];
    if (!conv) return;
    const payload = { t: 'text', text };
    if (replyTo) payload.reply = replyTo;
    const enc = safety.encryptPublic(convId, bot.id, conv.key_version, payload);
    const r = await q('insert into messages(conv_id,sender_id,ciphertext,iv,key_version) values($1,$2,$3,$4,$5) returning id,created_at', [convId, bot.id, enc.ciphertext, enc.iv, conv.key_version]);
    const message = { id: Number(r.rows[0].id), senderId: bot.id, ciphertext: enc.ciphertext, iv: enc.iv, keyVersion: conv.key_version, createdAt: r.rows[0].created_at, deleted: false, once: false };
    for (const mm of (await q('select user_id,muted from members where conv_id=$1', [convId])).rows) sendTo(mm.user_id, { t: 'msg', convId, message, cid: null, muted: mm.muted });
    return message;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const typing = (convId) => sendToConv(convId, { t: 'typing', convId, userId: bot.id }, bot.id).catch(() => {});
  const push = (convId, line) => { const h = history.get(convId) || []; h.push(line); while (h.length > 15) h.shift(); history.set(convId, h); };

  // called for every message that lands in a public room (the server can read those)
  async function onMessage({ convId, sender, message, payload, mentions }) {
    if (!bot || !rooms.has(convId) || !payload || sender.id === bot.id || sender.is_bot) return;
    const text = payload.t === 'text' && typeof payload.text === 'string' ? payload.text : '';
    push(convId, `${sender.display_name}: ${text || '[sent a ' + (payload.t || 'message') + ']'}`);
    if (busy.has(convId)) return;
    const pinged = (payload.reply && payload.reply.uid === bot.id) || (Array.isArray(mentions) && mentions.includes(bot.id)) || /(^|[^a-z0-9_])@gng(?![a-z0-9_])/i.test(text);
    const saidName = /\bgng\b/i.test(text);
    const now = Date.now();
    let go = pinged, extra = 'reply to the last message and stay on topic.';
    if (!go && saidName && now - (lastNamed.get(convId) || 0) > C.nameCooldown && Math.random() < C.nameChance) { go = true; extra = 'someone just talked about you by name without pinging you. respond to what they said about you.'; lastNamed.set(convId, now); }
    if (!go && now - (lastRandom.get(convId) || 0) > C.randomCooldown && text.length > 8 && Math.random() < C.randomChance) { go = true; extra = 'you are randomly jumping into the conversation uninvited. react to the last message in a short funny way.'; lastRandom.set(convId, now); }
    if (!go) return;
    busy.add(convId);
    try {
      typing(convId);
      let reply = await ask((history.get(convId) || []).join('\n'), extra);
      reply = reply.replace(/^\s*gng\s*:\s*/i, '');
      let lines = reply.split('\n').map((l) => l.trim().replace(/^gng\s*:\s*/i, '')).filter(Boolean).slice(0, 4);
      lines = lines.map((l) => l.slice(0, 400)).filter((l) => !safety.F.check(l));      // same word filter as everyone else
      if (!lines.length) return;
      const replyTo = pinged ? { id: Number(message.id), uid: sender.id, name: sender.display_name, snip: text.slice(0, 90) } : null;
      for (let i = 0; i < lines.length; i++) {
        await sleep(i === 0 ? 700 + Math.random() * 900 : Math.min(lines[i].length * 50, 2000));
        if (i) typing(convId);
        await post(convId, lines[i], i === 0 ? replyTo : null);
        push(convId, 'gng: ' + lines[i]);
        if (i < lines.length - 1) { typing(convId); }
      }
    } catch (e) { console.warn('gng:', e.message); }
    finally { setTimeout(() => busy.delete(convId), 400); }
  }

  async function start() { bot = await ensureBot(); if (bot) console.log('gng is online as', bot.id); else if (!C.key) console.log('gng is off: set AI_API_KEY to wake him up'); }
  function mount(app, m) {
    const { auth, byUser, bad, wrap, requireMember, isUuid } = m;
    app.put('/api/conversations/:id/gng', auth, byUser('gng-toggle', 20, 60_000), wrap(async (req, res) => {
      if (!bot) return bad(res, 'gng is asleep right now', 503);
      if (!isUuid(req.params.id)) return bad(res, 'bad id');
      const c = await requireMember(req, res); if (!c) return;
      if (!c.is_public) return bad(res, 'gng only hangs out in public rooms, private chats are end-to-end encrypted so he cannot read them');
      const staff = req.user.is_admin || (!c.system_kind && ['admin', 'mod'].includes(c.role));
      if (!staff) return bad(res, c.system_kind ? 'only admins can change this room' : 'mods only', 403);
      await setRoom(req.params.id, req.body.on !== false);
      res.json({ ok: true, on: req.body.on !== false });
    }));
  }
  return { start, mount, onMessage, botId: () => bot && bot.id };
}
module.exports = { init };
