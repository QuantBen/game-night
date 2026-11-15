// Storyteller: one guesser, several storytellers, one real story.
import {
  setup, el, S, ID, mine, sendInput, hostAct, go, sayDone, byPid, nm, isBot, now, T, rid, shuffle, hash, enc, dec,
  listJoin, narr, keepAwake, same, Host, render, ask,
} from '../shared/kit.js';
import { SHORT, STORIES } from './cards.js';

/* ---------- cards ---------- */
const card = ref => (ref[0] === 's' ? SHORT : STORIES)[+ref.slice(2)];
const kindOf = ref => (ref[0] === 's' ? 'short' : 'story');
const thing = ref => (kindOf(ref) === 'short' ? 'meaning' : 'story');
function pool(mode) {
  const out = [];
  if (mode !== 'story') SHORT.forEach((_, i) => out.push('s:' + i));
  if (mode !== 'short') STORIES.forEach((_, i) => out.push('l:' + i));
  return out;
}

/* ---------- made-up stories the bots tell (the narrator reads them out) ---------- */
const pickH = (list, seed) => list[hash(seed) % list.length];
function botStory(ref, pid) {
  const c = card(ref); const seed = pid + ref;
  if (kindOf(ref) === 'short') {
    const what = pickH(['a sudden gust of wind that steals your hat', 'the last biscuit left in the tin', 'someone who laughs at their own joke before the punchline',
      'the burnt crust stuck to the bottom of a pie dish', 'a dog that only ever barks at the postman', 'a small lie told to get out of a party early',
      'the itch you get right after washing your hands', 'a person who always sits in the front row', 'a cold cup of tea you forgot about',
      'the noise a door makes when it swings open by itself'], seed + 'a');
    return pickH([`An old sailors’ word for ${what}.`, `It’s what Victorian doctors called ${what}.`, `A Scottish word for ${what}.`,
      `Farmers in Yorkshire use it for ${what}.`], seed + 'b');
  }
  const year = 1600 + hash(seed + 'y') % 330;
  const who = pickH(['a group of bakers', 'the town council', 'two rival bishops', 'a travelling circus', 'a retired admiral',
    'a family of goat herders', 'the local schoolteachers', 'a secret society of chess players'], seed + 'w');
  const where = pickH(['a small town in Belgium', 'the Scottish Highlands', 'northern Italy', 'a fishing village in Norway',
    'rural Ohio', 'the outskirts of Vienna', 'a Greek island', 'a market town in Wales'], seed + 'p');
  const did = pickH(['declared war on the next village over a stolen cheese', 'tried to ban Mondays for an entire year',
    'built a tower out of bread to impress a visiting king', 'put a goat on trial for theft', 'refused to speak above a whisper for a whole summer',
    'painted every house in town the same shade of green'], seed + 'd');
  const end = pickH(['It only ended when it rained for nine days straight.', 'Historians still argue about who started it.',
    'There’s a statue there to remember it.', 'The whole thing lasted exactly forty days.', 'Hardly anyone wrote it down, which is why so few people know about it.'], seed + 'e');
  return `In ${year}, ${who} in ${where} ${did}, and that’s what people now call ${c.t}. ${end}`;
}

/* ---------- helpers ---------- */
const realOf = s => (s.r ? dec(s.r.real, s.r.salt) : null);
const rk = (s, x) => `${s.r.id}-${x}`;
const active = s => s.players.filter(p => !p.left);
const score = (s, pid) => (s.scores && s.scores[pid]) || 0;

/* ---------- engine (narrator device only) ---------- */
function startGame(s) {
  const n = active(s).length;
  let avail = pool(s.cfg.mode).filter(r => !(s.used || []).includes(r));
  if (avail.length < n) { s.used = []; avail = pool(s.cfg.mode); }
  const deck = shuffle(avail).slice(0, n);
  s.used = (s.used || []).concat(deck);
  s.deck = deck;
  s.order = shuffle(active(s).map(p => p.pid));
  s.total = s.order.length;
  s.scores = {}; for (const p of s.players) s.scores[p.pid] = 0;
  s.history = []; s.round = 0; s.r = null;
  startRound(s);
}
function startRound(s) {
  let guesser = null;
  while (s.round < s.total) {
    s.round++;
    const g = byPid(s, s.order[s.round - 1]);
    if (g && !g.left) { guesser = g.pid; break; }
  }
  const pool_ = active(s).filter(p => p.pid !== guesser).map(p => p.pid);
  if (!guesser || pool_.length < 2) { finish(s); return; }
  let tellers = shuffle(pool_.slice());
  if (s.cfg.tellers && tellers.length > s.cfg.tellers) tellers = tellers.slice(0, s.cfg.tellers);
  const real = tellers[crypto.getRandomValues(new Uint32Array(1))[0] % tellers.length];
  const ref = s.deck[s.round - 1];
  const salt = rid(5);
  s.r = { id: rid(5), n: s.round, ref, guesser, tellers, real: enc(real, salt), salt, turn: -1, ready: [], fakes: {} };
  for (const pid of tellers) if (isBot(pid) && pid !== real) s.r.fakes[pid] = botStory(ref, pid);
  const c = card(ref);
  go(s, 'play', 'prep',
    `Round ${s.round} of ${s.total}. ${nm(s, guesser)} is the guesser. ${kindOf(ref) === 'short' ? 'The word is' : 'The story is'}: ${c.t}. ` +
    `Storytellers, check your phone. One of you has the real ${thing(ref)}. Everyone else, make one up. Tap ready when you’re set.`);
}
function tellTurn(s) {
  const pid = s.r.tellers[s.r.turn]; const name = nm(s, pid);
  if (isBot(pid)) {
    const story = pid === realOf(s) ? card(s.r.ref).d : s.r.fakes[pid];
    go(s, 'play', 'tell', `${name}, your turn. ${name} says: ${story}`);
  } else {
    go(s, 'play', 'tell', s.r.turn === 0 ? `${name}, you go first. Tell us about ${card(s.r.ref).t}.` : `Thank you. ${name}, your turn.`);
  }
}
function nextTurn(s) {
  s.r.turn++;
  if (s.r.turn < s.r.tellers.length) { tellTurn(s); return; }
  go(s, 'play', 'guess', `That’s everyone. ${nm(s, s.r.guesser)}, who has the real ${thing(s.r.ref)}? Make your pick on your phone.`);
}
function resolve(s, pick) {
  const real = realOf(s); const c = card(s.r.ref); const g = s.r.guesser;
  const correct = !!pick && pick === real;
  if (correct) s.scores[g] = score(s, g) + 1;
  else if (pick) s.scores[pick] = score(s, pick) + 1;
  s.r.pick = pick || null; s.r.correct = correct; s.r.shown = real;
  s.history.push({ n: s.r.n, ref: s.r.ref, guesser: g, real, pick: pick || null, correct });
  const fact = kindOf(s.r.ref) === 'short'
    ? (c.real ? 'And believe it or not, that’s a real word.' : 'And no, that word isn’t real.')
    : (c.real ? 'And believe it or not, that really happened.' : 'That one was made up for the game.');
  const head = pick
    ? `${nm(s, g)} picked ${nm(s, pick)}. And the real ${thing(s.r.ref)} belonged to... ${nm(s, real)}! ` +
      (correct ? `Well spotted. ${nm(s, g)} gets a point.` : `${nm(s, pick)} fooled ${nm(s, g)} and gets a point.`)
    : `No pick this time. The real ${thing(s.r.ref)} belonged to ${nm(s, real)}.`;
  go(s, 'play', 'reveal', `${head} Here’s the real ${thing(s.r.ref)}: ${c.d} ${fact}`);
}
function ranking(s) {
  return s.players.filter(p => !p.left || score(s, p.pid) > 0).map(p => ({ p, sc: score(s, p.pid) })).sort((a, b) => b.sc - a.sc);
}
function finish(s) {
  const rk_ = ranking(s); const top = rk_.length ? rk_[0].sc : 0;
  const winners = rk_.filter(x => x.sc === top).map(x => x.p.name);
  s.r = null;
  go(s, 'over', 'end', winners.length === 1
    ? `That’s the game! ${winners[0]} wins with ${top} point${top === 1 ? '' : 's'}. Well played, everyone.`
    : `That’s the game! It’s a tie between ${listJoin(winners)}, with ${top} point${top === 1 ? '' : 's'} each.`);
}
function engine(s, inp) {
  if (s.phase !== 'play' || !s.r) return false;
  const r = s.r;
  switch (s.step) {
    case 'prep': {
      const ready = r.tellers.filter(pid => { const i = inp(pid); return i && i.rdy === rk(s, 'rdy'); });
      let ch = false;
      if (!same(ready, r.ready || [])) { r.ready = ready; ch = true; }
      if (ready.length === r.tellers.length && sayDone(s)) { r.turn = -1; nextTurn(s); return true; }
      return ch;
    }
    case 'tell': {
      const pid = r.tellers[r.turn]; const i = inp(pid); const gi = inp(r.guesser);
      const done = isBot(pid) ? sayDone(s, T(1200))
        : sayDone(s) && ((i && i.done === rk(s, 'done' + r.turn)) || (gi && gi.next === rk(s, 'next' + r.turn)));
      if (done) { nextTurn(s); return true; }
      return false;
    }
    case 'guess': {
      const gi = inp(r.guesser); const p = gi && gi.pick;
      if (p && p.k === rk(s, 'pick') && r.tellers.includes(p.t) && sayDone(s)) { resolve(s, p.t); return true; }
      return false;
    }
    case 'reveal': {
      const go_ = s.players.some(p => { const i = inp(p.pid); return i && i.next === rk(s, 'round'); });
      if (go_ && sayDone(s, T(1500))) { if (s.round >= s.total) finish(s); else startRound(s); return true; }
      return false;
    }
  }
  return false;
}
function force(s, inp) {
  if (s.phase !== 'play' || !s.r) return false;
  switch (s.step) {
    case 'prep': s.r.turn = -1; nextTurn(s); return;
    case 'tell': nextTurn(s); return;
    case 'guess': resolve(s, null); return;
    case 'reveal': if (s.round >= s.total) finish(s); else startRound(s); return;
  }
  return false;
}
function removePlayer(s, pid) {
  const p = byPid(s, pid); if (!p || p.left) return false;
  p.left = true;
  if (s.phase !== 'play' || !s.r) return;
  const r = s.r;
  if (pid === r.guesser || pid === realOf(s)) {
    // The round can't work without them: skip it without points.
    if (s.round >= s.total) finish(s); else startRound(s);
    return;
  }
  const idx = r.tellers.indexOf(pid);
  if (idx >= 0) {
    r.tellers.splice(idx, 1);
    if (s.step === 'tell') {
      if (idx < r.turn) r.turn--;
      else if (idx === r.turn) { r.turn--; nextTurn(s); }
    }
  }
}
function toLobby(s) {
  s.round = 0; s.total = 0; s.r = null; s.scores = {}; s.history = []; s.deck = []; s.order = [];
  s.players = s.players.filter(p => !p.left);
}
function botAct(s, B) {
  if (s.phase !== 'play' || !s.r) return;
  const r = s.r; const el_ = now() - s.stepAt;
  for (const p of s.players) {
    if (!isBot(p.pid) || p.left) continue;
    const pid = p.pid;
    if (s.step === 'prep' && r.tellers.includes(pid) && el_ > B.delay(pid, r.id + 'rdy', 1500, 4000)) B.set(s, pid, { rdy: rk(s, 'rdy') });
    if (s.step === 'guess' && r.guesser === pid && el_ > B.delay(pid, r.id + 'pick', 3000, 4000)) B.set(s, pid, { pick: { k: rk(s, 'pick'), t: B.pick(r.tellers, pid, r.id) } });
  }
}

/* ---------- screens ---------- */
function termCard(s, extra) {
  const c = card(s.r.ref); const k = kindOf(s.r.ref);
  return el('section', { class: 'term' },
    el('div', { class: 'term-kind' }, k === 'short' ? 'Mystery word' : 'Mystery story'),
    el('div', { class: 'term-t' }, c.t),
    el('div', { class: 'term-sub' }, `Round ${s.round} of ${s.total} · ${nm(s, s.r.guesser)} is guessing`),
    extra || null);
}
function myCard(s, compact) {
  const r = s.r; const c = card(r.ref); const real = realOf(s) === ID.pid;
  if (real) return el('div', { class: 'secret real' + (compact ? ' compact' : '') },
    el('div', { class: 'secret-h' }, '🎯 You have the REAL ' + thing(r.ref)),
    el('p', { class: 'secret-d' }, c.d),
    compact ? null : el('p', { class: 'small' }, 'Tell it in your own words, don’t just read it out. Add a little colour so you sound as believable as the liars.'));
  return el('div', { class: 'secret fake' + (compact ? ' compact' : '') },
    el('div', { class: 'secret-h' }, '🎭 Make it up!'),
    el('p', { class: 'secret-d' }, `Invent a convincing ${thing(r.ref)} for “${c.t}”.`),
    compact ? null : el('p', { class: 'small' }, kindOf(r.ref) === 'short'
      ? 'Tip: say where the word comes from and use it in a sentence.'
      : 'Tip: give a year, a place, a number and one oddly specific detail.'));
}
function tellersList(s) {
  const r = s.r;
  return el('section', { class: 'card' },
    el('h3', {}, 'Storytellers'),
    r.tellers.map((pid, i) => {
      const status = s.step === 'prep' ? ((r.ready || []).includes(pid) ? '✓ ready' : 'getting ready…')
        : s.step === 'tell' ? (i < r.turn ? '✓ told' : i === r.turn ? '🎙 telling now' : 'waiting')
        : '';
      return el('div', { class: 'prow' + (s.step === 'tell' && i === r.turn ? ' now' : '') },
        el('span', { class: 'num' }, String(i + 1)),
        el('span', { class: 'pn' }, nm(s, pid) + (pid === ID.pid ? ' (you)' : '')),
        status ? el('span', { class: 'pm' }, status) : null);
    }));
}
function scoreBoard(s, highlight) {
  const rows = ranking(s);
  return el('section', { class: 'card' },
    el('h3', {}, 'Scores'),
    rows.map(({ p, sc }, i) => el('div', { class: 'prow' },
      el('span', { class: 'num' }, String(i + 1)),
      el('span', { class: 'pn' }, p.name + (p.pid === ID.pid ? ' (you)' : '') + (p.left ? ' · left' : '')),
      highlight && highlight === p.pid ? el('span', { class: 'plus' }, '+1') : null,
      el('span', { class: 'sc' }, String(sc)))));
}
function playView(s, me) {
  const r = s.r; const step = s.step;
  const amG = r.guesser === ID.pid; const amT = r.tellers.includes(ID.pid);
  const k = kindOf(r.ref);
  const out = [step === 'reveal' ? null : narr(s)];
  if (step === 'prep') {
    if (amT) {
      const isReady = mine().rdy === rk(s, 'rdy');
      out.push(termCard(s), myCard(s),
        el('button', { class: 'btn big ' + (isReady ? '' : 'primary'), onclick: () => { keepAwake(); sendInput({ rdy: isReady ? null : rk(s, 'rdy') }); } },
          isReady ? '✓ Ready — tap to undo' : 'I’m ready'));
    } else if (amG) {
      out.push(termCard(s, el('div', { class: 'role-note' }, '🕵️ You’re the guesser. Listen to every storyteller, ask questions, then pick who has the real one.')));
    } else {
      out.push(termCard(s, el('div', { class: 'role-note' }, me ? '🍿 You’re in the audience this round. Enjoy the show.' : 'You’re watching this game.')));
    }
    out.push(tellersList(s));
  } else if (step === 'tell') {
    const cur = r.tellers[r.turn]; const myTurn = cur === ID.pid;
    out.push(termCard(s));
    if (myTurn) {
      out.push(el('section', { class: 'card center turn' },
        el('div', { class: 'big-emoji' }, '🎙'),
        el('h2', {}, 'Your turn!'),
        el('p', { class: 'muted' }, 'Tell your ' + thing(r.ref) + ' out loud, then tap Done.'),
        myCard(s, true),
        el('button', { class: 'btn primary big', onclick: () => sendInput({ done: rk(s, 'done' + r.turn) }) }, 'Done')));
    } else {
      out.push(el('section', { class: 'card center' },
        el('p', { class: 'muted' }, 'Now telling'),
        el('h2', {}, nm(s, cur) + (isBot(cur) ? ' (read out by the narrator)' : '')),
        amG && !isBot(cur) ? el('button', { class: 'btn big', onclick: () => sendInput({ next: rk(s, 'next' + r.turn) }) }, 'Next storyteller') : null));
      if (amT) out.push(myCard(s, true));
    }
    out.push(tellersList(s));
  } else if (step === 'guess') {
    out.push(termCard(s));
    if (amG) {
      const sel = S.sel[rk(s, 'pick')]; const locked = mine().pick && mine().pick.k === rk(s, 'pick');
      out.push(el('section', { class: 'card' },
        el('h2', {}, `Who has the real ${thing(r.ref)}?`),
        el('div', { class: 'targets' }, r.tellers.map(pid => el('button', {
          class: 'target' + ((locked ? mine().pick.t : sel) === pid ? ' sel' : ''), disabled: locked ? true : null,
          onclick: () => { S.sel[rk(s, 'pick')] = pid; render(); } }, el('span', { class: 'tname' }, nm(s, pid))))),
        locked ? el('p', { class: 'hint center' }, 'Locked in. Here comes the reveal…')
          : el('button', { class: 'btn primary big', disabled: sel ? null : true, onclick: () => sendInput({ pick: { k: rk(s, 'pick'), t: sel } }) }, sel ? `Lock in ${nm(s, sel)}` : 'Choose someone')));
    } else {
      out.push(el('section', { class: 'card center' },
        el('div', { class: 'big-emoji' }, '🤔'),
        el('h2', {}, `${nm(s, r.guesser)} is deciding…`),
        amT ? el('p', { class: 'muted' }, realOf(s) === ID.pid ? 'Keep a straight face. You’re the real one.' : 'Keep a straight face. You might just fool them.') : null));
    }
  } else if (step === 'reveal') {
    const c = card(r.ref); const real = r.shown; const pick = r.pick;
    const pointTo = pick ? (r.correct ? r.guesser : pick) : null;
    const tag = k === 'short' ? (c.real ? '📖 Real word' : '🎭 Made-up word') : (c.real ? '🤯 This really happened' : '🎭 Made up for the game');
    out.push(el('section', { class: 'reveal-box ' + (r.correct ? 'right' : 'wrong') },
      el('div', { class: 'term-kind' }, c.t),
      el('div', { class: 'rv-line' }, pick ? `${nm(s, r.guesser)} picked ${nm(s, pick)}` : 'No pick this round'),
      el('div', { class: 'rv-big' }, (r.correct ? '✅ ' : '❌ ') + `The real one was ${nm(s, real)}`),
      el('div', { class: 'rv-pts' }, pointTo ? (r.correct ? `+1 to ${nm(s, r.guesser)} for spotting it` : `+1 to ${nm(s, pick)} for the convincing lie`) : 'No points this round'),
      el('div', { class: 'rv-card' }, el('p', {}, c.d), el('span', { class: 'badge' }, tag))),
      scoreBoard(s, pointTo),
      me ? el('button', { class: 'btn primary big', onclick: () => sendInput({ next: rk(s, 'round') }) }, s.round >= s.total ? 'See final scores' : 'Next round')
        : null);
  }
  return out;
}
function overView(s) {
  const rows = ranking(s); const top = rows.length ? rows[0].sc : 0;
  const winners = rows.filter(x => x.sc === top).map(x => x.p.name);
  return [
    el('section', { class: 'win' },
      el('div', { class: 'big-emoji' }, '🏆'),
      el('h1', {}, winners.length === 1 ? `${winners[0]} wins!` : 'It’s a tie!'),
      el('p', {}, winners.length === 1 ? `${top} point${top === 1 ? '' : 's'}` : `${listJoin(winners)} · ${top} point${top === 1 ? '' : 's'} each`)),
    scoreBoard(s),
    el('section', { class: 'card' },
      el('h3', {}, 'Every round'),
      (s.history || []).map(h => { const c = card(h.ref); return el('div', { class: 'hrow' },
        el('div', { class: 'h-t' }, `${h.n}. ${c.t}`, el('span', { class: 'h-real' }, c.real ? ' · real' : ' · made up')),
        el('div', { class: 'small muted' }, `${nm(s, h.guesser)} guessed ${h.pick ? nm(s, h.pick) : 'nobody'}; the real one was ${nm(s, h.real)} ${h.correct ? '✅' : '❌'}`)); })),
    Host.active
      ? el('div', { class: 'stack' },
          el('button', { class: 'btn primary big', onclick: () => hostAct(x => { x.players = x.players.filter(p => !p.left); startGame(x); }) }, 'Play again — new cards'),
          el('button', { class: 'btn', onclick: () => hostAct(x => { toLobby(x); go(x, 'lobby', '', null); }) }, 'Back to lobby (change players or settings)'))
      : el('p', { class: 'center muted' }, 'Waiting for the narrator to start another game…')];
}
function seg(options, cur, onpick) {
  return el('div', { class: 'seg' }, options.map(([v, label]) => el('button', { class: cur === v ? 'on' : '', onclick: () => onpick(v) }, label)));
}
function lobbyHost(s) {
  const n = s.players.length; const c = s.cfg;
  const setCfg = patch => hostAct(x => { x.cfg = Object.assign({}, x.cfg, patch); });
  return el('section', { class: 'card' },
    el('h3', {}, 'Game settings'),
    el('div', { class: 'lbl' }, 'Cards'),
    seg([['mix', 'Mix'], ['short', 'Weird words'], ['story', 'Strange stories']], c.mode, v => setCfg({ mode: v })),
    el('div', { class: 'lbl' }, 'Storytellers each round'),
    seg([[0, 'Everyone'], [3, '3'], [4, '4']], c.tellers, v => setCfg({ tellers: v })),
    el('p', { class: 'small muted' }, n >= 3
      ? `${n} rounds, so everyone is the guesser once. ${c.tellers && n - 1 > c.tellers ? `Each round, ${c.tellers} random players tell stories and the rest watch.` : 'Everyone else tells a story each round.'}`
      : 'You need at least 3 players.'),
    el('button', { class: 'btn primary big', disabled: n >= 3 ? null : true, onclick: () => hostAct(x => startGame(x)) }, 'Start game'));
}
function rules() {
  return [
    el('h4', {}, 'Each round'),
    el('ul', {},
      el('li', {}, 'One player is the guesser. Everyone else sees the same mystery word or story title.'),
      el('li', {}, 'One storyteller secretly gets the real meaning or story. The others have to make one up.'),
      el('li', {}, 'The narrator calls each storyteller in turn, and they tell it out loud. The guesser can ask questions.'),
      el('li', {}, 'The guesser picks who they think has the real one.')),
    el('h4', {}, 'Points'),
    el('ul', {},
      el('li', {}, 'Guesser picks the real storyteller: +1 for the guesser.'),
      el('li', {}, 'Guesser picks a bluffer: +1 for that bluffer.')),
    el('h4', {}, 'Winning'),
    el('p', {}, 'Everyone is the guesser once. Most points at the end wins. Some cards are genuinely real, others were invented for the game; the reveal tells you which.'),
  ];
}

setup({
  id: 'storyteller',
  name: 'Storyteller',
  icon: '📜',
  tagline: 'One real story, a room full of liars. Spot the truth, or fool the guesser with your best bluff.',
  howTo: [
    'One device hosts and narrates. Put it in the middle, volume up.',
    'Everyone scans the QR code or opens the link, then types their name.',
    'Each round one player guesses. Everyone else gets the same strange word or story title.',
    'One storyteller has the real version. The rest make one up and tell it convincingly.',
    'The guesser picks who’s telling the truth. Everyone guesses once; most points wins.',
  ],
  botFill: 5,
  initialState: () => ({ cfg: { mode: 'mix', tellers: 0 }, used: [], deck: [], order: [], round: 0, total: 0, r: null, scores: {}, history: [] }),
  engine, force, removePlayer, toLobby, botAct, lobbyHost, rules,
  theme: () => 'dusk',
  chip: s => (s.phase === 'play' ? `Round ${s.round}/${s.total}` : s.phase === 'over' ? 'Game over' : ''),
  stepLabel: s => (s.phase === 'over' ? 'Game over' : { prep: 'Getting ready', tell: s.r ? `Storyteller ${s.r.turn + 1} of ${s.r.tellers.length}` : '', guess: 'Guessing', reveal: 'Reveal' }[s.step] || ''),
  progress: s => (s.phase === 'play' && s.step === 'prep' && s.r ? `${(s.r.ready || []).length}/${s.r.tellers.length} ready` : ''),
  forceLabel: s => (s.phase === 'play' ? { prep: 'Start telling now', tell: 'Skip this storyteller', guess: 'Reveal without a pick', reveal: s.round >= s.total ? 'Finish game' : 'Next round' }[s.step] : null),
  forceHelp: s => ({ prep: 'Starts the storytelling even if not everyone tapped Ready.', tell: 'Moves on to the next storyteller.', guess: 'Reveals the answer with no pick and no points.', reveal: 'Moves on.' }[s.step] || ''),
  main: (s, me) => (s.phase === 'over' ? overView(s) : s.r ? playView(s, me) : []),
});
