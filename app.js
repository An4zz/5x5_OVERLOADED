/* ============================================================
   5x5 Lifts — StrongLifts 5x5 PWA
   Single-file vanilla JS app: state, program rules, UI, timer.
   Persists to localStorage. Works offline via sw.js.
   ============================================================ */

// ---------- Program definition ----------

const EXERCISES = {
  squat:    { name: 'Squat',          sets: 5, reps: 5, defaultStart: 45,  defaultInc: 5,  bar: 45 },
  bench:    { name: 'Bench Press',    sets: 5, reps: 5, defaultStart: 45,  defaultInc: 5,  bar: 45 },
  row:      { name: 'Barbell Row',    sets: 5, reps: 5, defaultStart: 65,  defaultInc: 5,  bar: 45 },
  ohp:      { name: 'Overhead Press', sets: 5, reps: 5, defaultStart: 45,  defaultInc: 5,  bar: 45 },
  deadlift: { name: 'Deadlift',       sets: 1, reps: 5, defaultStart: 95,  defaultInc: 10, bar: 45 },
};

// Workout A: Squat, Bench, Row
// Workout B: Squat, OHP, Deadlift
const WORKOUTS = {
  A: ['squat', 'bench', 'row'],
  B: ['squat', 'ohp', 'deadlift'],
};

const DEFAULT_REST_SECS = 180; // 3 minutes — canonical StrongLifts default
const DEFAULT_UNIT = 'lb';     // 'lb' or 'kg'
const STORAGE_KEY = 'fivebyfive.v1';

// Available plates per side (lb). User can edit in settings later if needed.
const DEFAULT_PLATES_LB = [45, 35, 25, 10, 5, 2.5];
const DEFAULT_PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25];

// ---------- State ----------

function defaultState() {
  const exercises = {};
  for (const [key, def] of Object.entries(EXERCISES)) {
    exercises[key] = {
      weight: def.defaultStart,
      start: def.defaultStart,
      increment: def.defaultInc,
      failStreak: 0,
    };
  }
  return {
    unit: DEFAULT_UNIT,
    barWeight: 45,
    plates: DEFAULT_PLATES_LB.slice(),
    restSecs: DEFAULT_REST_SECS,
    nextWorkout: 'A',        // alternates A/B
    exercises,
    activeSession: null,     // { workout: 'A', startedAt, lifts: { [key]: { weight, sets: [reps...] } } }
    history: [],             // [ { date, workout, lifts: [{key, weight, sets, success}] } ]
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    // Shallow-merge defaults to be forward-compatible
    const fresh = defaultState();
    return Object.assign({}, fresh, parsed, {
      exercises: Object.assign({}, fresh.exercises, parsed.exercises || {}),
    });
  } catch (e) {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadState();
let currentTab = 'workout';

// ---------- Program rules ----------

// Round to nearest valid increment (smallest plate * 2 = 5 lb / 2.5 kg)
function roundWeight(w) {
  const step = state.unit === 'lb' ? 5 : 2.5;
  return Math.round(w / step) * step;
}

function applyResult(exerciseKey, success) {
  const ex = state.exercises[exerciseKey];
  const def = EXERCISES[exerciseKey];
  if (success) {
    ex.weight = ex.weight + ex.increment;
    ex.failStreak = 0;
  } else {
    ex.failStreak += 1;
    if (ex.failStreak >= 3) {
      // Deload 10% of current, rounded to nearest valid increment, floor at start weight
      const deloaded = Math.max(def.bar, roundWeight(ex.weight * 0.9));
      ex.weight = deloaded;
      ex.failStreak = 0;
    }
    // else: same weight next time
  }
}

// ---------- Rest timer ----------

const restTimer = {
  endsAt: null,
  intervalId: null,
  totalSecs: 0,

  start(secs) {
    this.cancel();
    this.totalSecs = secs;
    this.endsAt = Date.now() + secs * 1000;
    this.intervalId = setInterval(() => this.tick(), 250);
    this.tick();
  },

  add(extraSecs) {
    if (!this.endsAt) return;
    this.endsAt += extraSecs * 1000;
    this.tick();
  },

  cancel() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;
    this.endsAt = null;
    renderRestBar();
  },

  tick() {
    renderRestBar();
    const remain = this.remaining();
    if (remain <= 0) {
      // Beep once, keep bar visible in "done" state until cancelled
      if (this.intervalId) {
        playCue();
        try { navigator.vibrate && navigator.vibrate([200, 80, 200]); } catch (e) {}
        clearInterval(this.intervalId);
        this.intervalId = null;
      }
    }
  },

  remaining() {
    if (!this.endsAt) return 0;
    return Math.max(0, Math.ceil((this.endsAt - Date.now()) / 1000));
  },

  isActive() { return this.endsAt !== null; },
  isDone()   { return this.endsAt !== null && this.remaining() <= 0; },
};

// Audio cue via WebAudio (no asset file needed)
let audioCtx = null;
function playCue() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtx;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, now);
    o.frequency.setValueAtTime(1320, now + 0.18);
    g.gain.setValueAtTime(0.001, now);
    g.gain.exponentialRampToValueAtTime(0.4, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    o.connect(g).connect(ctx.destination);
    o.start(now);
    o.stop(now + 0.6);
  } catch (e) {}
}

// ---------- DOM helpers ----------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function fmtTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ---------- Session helpers ----------

function startSessionIfNeeded() {
  if (state.activeSession) return;
  const workout = state.nextWorkout;
  const lifts = {};
  for (const key of WORKOUTS[workout]) {
    lifts[key] = { sets: [] };
  }
  state.activeSession = {
    workout,
    startedAt: Date.now(),
    lifts,
  };
  saveState();
}

// Single source of truth for the weight to use on a given lift right now.
function currentWeight(exerciseKey) {
  return state.exercises[exerciseKey].weight;
}

function setResult(exerciseKey, setIndex, reps) {
  const lift = state.activeSession.lifts[exerciseKey];
  lift.sets[setIndex] = reps;
  saveState();
}

function isExerciseComplete(exerciseKey) {
  const def = EXERCISES[exerciseKey];
  const lift = state.activeSession.lifts[exerciseKey];
  for (let i = 0; i < def.sets; i++) {
    if (lift.sets[i] == null) return false;
  }
  return true;
}

function isExerciseSuccess(exerciseKey) {
  const def = EXERCISES[exerciseKey];
  const lift = state.activeSession.lifts[exerciseKey];
  for (let i = 0; i < def.sets; i++) {
    if (lift.sets[i] !== def.reps) return false;
  }
  return true;
}

function isSessionComplete() {
  if (!state.activeSession) return false;
  return WORKOUTS[state.activeSession.workout].every(isExerciseComplete);
}

function finishSession() {
  if (!state.activeSession) return;
  const liftsLog = [];
  for (const key of WORKOUTS[state.activeSession.workout]) {
    const lift = state.activeSession.lifts[key];
    const def = EXERCISES[key];
    const success = isExerciseSuccess(key);
    const usedWeight = currentWeight(key); // capture BEFORE applyResult mutates it
    applyResult(key, success);
    liftsLog.push({
      key,
      name: def.name,
      weight: usedWeight,
      sets: lift.sets.slice(),
      success,
    });
  }
  state.history.unshift({
    date: new Date(state.activeSession.startedAt).toISOString(),
    workout: state.activeSession.workout,
    lifts: liftsLog,
  });
  if (state.history.length > 500) state.history.length = 500;
  state.nextWorkout = state.activeSession.workout === 'A' ? 'B' : 'A';
  state.activeSession = null;
  restTimer.cancel();
  saveState();
}

function discardSession() {
  state.activeSession = null;
  restTimer.cancel();
  saveState();
}

// ---------- Plate calculator ----------

function platesForWeight(targetW) {
  const perSide = (targetW - state.barWeight) / 2;
  if (perSide <= 0) return [];
  const out = [];
  let remaining = perSide;
  for (const p of state.plates) {
    while (remaining >= p - 1e-6) {
      out.push(p);
      remaining = +(remaining - p).toFixed(3);
    }
  }
  return out;
}

function plateClass(p) {
  if (p >= 35) return 'heavy';
  if (p >= 10) return 'med';
  return 'lite';
}

// ---------- Rendering ----------

const root = () => document.getElementById('app');

function render() {
  const r = root();
  r.innerHTML = '';
  if (currentTab === 'workout') r.appendChild(renderWorkoutTab());
  else if (currentTab === 'history') r.appendChild(renderHistoryTab());
  else if (currentTab === 'settings') r.appendChild(renderSettingsTab());
  renderRestBar();
}

// ----- Workout tab -----

function renderWorkoutTab() {
  startSessionIfNeeded();
  const wrap = el('div');
  const session = state.activeSession;
  const workoutName = `Workout ${session.workout}`;
  const lifts = WORKOUTS[session.workout];

  wrap.appendChild(el('div', { class: 'header' }, [
    el('div', {}, [
      el('h1', {}, ['Today']),
      el('p', { class: 'small' }, [
        `${lifts.map(k => EXERCISES[k].name).join(' · ')}`
      ]),
    ]),
    el('div', { class: 'day-tag' }, [workoutName]),
  ]));

  for (const key of lifts) {
    wrap.appendChild(renderExerciseCard(key));
  }

  // Footer actions
  const complete = isSessionComplete();
  wrap.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'row between' }, [
      el('div', {}, [
        el('div', { class: 'small muted' }, ['When you finish all sets:']),
        el('div', { class: 'small' }, [
          complete ? 'Ready to log — weights will progress based on your results.'
                   : 'Mark every set first, then come back.',
        ]),
      ]),
      el('button', {
        class: `btn primary ${complete ? '' : 'ghost'}`,
        disabled: !complete,
        onClick: () => {
          finishSession();
          currentTab = 'workout';
          render();
        },
      }, ['Finish workout']),
    ]),
    el('div', { class: 'row', style: 'margin-top:10px' }, [
      el('button', {
        class: 'btn ghost sm',
        onClick: () => {
          if (confirm('Discard this session? Your progression will not change.')) {
            discardSession();
            render();
          }
        },
      }, ['Discard session']),
    ]),
  ]));

  return wrap;
}

function renderExerciseCard(key) {
  const def = EXERCISES[key];
  const ex = state.exercises[key];
  const lift = state.activeSession.lifts[key];
  const w = currentWeight(key);

  const card = el('div', { class: 'card' });

  // Header
  const head = el('div', { class: 'exercise-head' }, [
    el('div', {}, [
      el('div', { class: 'name' }, [
        def.name,
        ex.failStreak > 0 ? el('span', { class: 'deload-tag' }, [`fail streak ${ex.failStreak}`]) : null,
      ]),
      el('div', { class: 'target' }, [`${def.sets}×${def.reps}`]),
    ]),
    el('div', { class: 'right' }, [
      el('div', { class: 'weight' }, [`${w} ${state.unit}`]),
      el('div', { class: 'small muted' }, [`+${ex.increment} ${state.unit} on success`]),
    ]),
  ]);
  card.appendChild(head);

  // Plate breakdown
  const pl = platesForWeight(w);
  if (pl.length) {
    card.appendChild(el('div', { class: 'plates', style: 'margin-bottom:10px' },
      pl.map(p => el('span', { class: `plate ${plateClass(p)}` }, [`${p}`]))
    ));
  } else {
    card.appendChild(el('p', { class: 'small muted', style: 'margin-bottom:10px' },
      [`Empty bar (${state.barWeight} ${state.unit})`]));
  }

  // Sets grid
  const grid = el('div', { class: 'sets' });
  for (let i = 0; i < def.sets; i++) {
    const result = lift.sets[i];
    let cls = 'set';
    let label = String(def.reps);
    let sub = null;
    if (result != null) {
      if (result === def.reps) {
        cls += ' done';
        label = String(result);
      } else {
        cls += ' fail';
        label = String(result);
        sub = '/' + def.reps;
      }
    }
    const tile = el('div', {
      class: cls,
      onClick: () => onSetTap(key, i),
    }, [
      el('div', {}, [label]),
      sub ? el('div', { class: 'reps-sub' }, [sub]) : null,
    ]);
    grid.appendChild(tile);
  }
  card.appendChild(grid);

  return card;
}

function onSetTap(exerciseKey, setIndex) {
  const def = EXERCISES[exerciseKey];
  const lift = state.activeSession.lifts[exerciseKey];
  const current = lift.sets[setIndex];

  if (current == null) {
    // First tap: mark as success (full reps), start rest timer
    setResult(exerciseKey, setIndex, def.reps);
    restTimer.start(state.restSecs);
    render();
  } else {
    // Already set: open modal to change to partial reps or clear
    openRepsModal(exerciseKey, setIndex);
  }
}

function openRepsModal(exerciseKey, setIndex) {
  const def = EXERCISES[exerciseKey];
  const modalBg = el('div', { class: 'modal-bg', onClick: (e) => {
    if (e.target === modalBg) document.body.removeChild(modalBg);
  }});
  const grid = el('div', { class: 'grid-5' });
  for (let r = 0; r <= def.reps; r++) {
    grid.appendChild(el('button', {
      class: 'btn',
      onClick: () => {
        setResult(exerciseKey, setIndex, r);
        document.body.removeChild(modalBg);
        // Restart rest for the set just edited
        restTimer.start(r === def.reps ? state.restSecs : Math.max(state.restSecs, 300));
        render();
      },
    }, [String(r)]));
  }
  const modal = el('div', { class: 'modal' }, [
    el('h3', {}, [`${EXERCISES[exerciseKey].name} — Set ${setIndex + 1}`]),
    el('p', { class: 'small muted' }, ['How many reps did you actually complete?']),
    grid,
    el('div', { class: 'row between' }, [
      el('button', {
        class: 'btn ghost',
        onClick: () => {
          state.activeSession.lifts[exerciseKey].sets[setIndex] = null;
          saveState();
          document.body.removeChild(modalBg);
          render();
        },
      }, ['Clear']),
      el('button', {
        class: 'btn',
        onClick: () => document.body.removeChild(modalBg),
      }, ['Cancel']),
    ]),
  ]);
  modalBg.appendChild(modal);
  document.body.appendChild(modalBg);
}

// ----- Rest bar -----

function renderRestBar() {
  let bar = document.getElementById('restbar');
  if (!restTimer.isActive()) {
    if (bar) bar.remove();
    return;
  }
  if (!bar) {
    bar = el('div', { id: 'restbar', class: 'rest-bar' });
    document.body.appendChild(bar);
  }
  bar.innerHTML = '';
  const done = restTimer.isDone();
  bar.className = `rest-bar${done ? ' done' : ''}`;
  bar.appendChild(el('div', {}, [
    el('div', { class: 'small', style: 'opacity:0.85' }, [done ? 'Rest done — go!' : 'Rest']),
    el('div', { class: 'timer-time' }, [fmtTime(restTimer.remaining())]),
  ]));
  bar.appendChild(el('div', {}, [
    el('button', { onClick: () => { restTimer.add(30); } }, ['+30s']),
    el('button', { onClick: () => { restTimer.add(-30); if (restTimer.remaining() <= 0) restTimer.cancel(); } }, ['-30s']),
    el('button', { onClick: () => restTimer.cancel() }, [done ? 'Dismiss' : 'Skip']),
  ]));
}

// ----- History tab -----

function renderHistoryTab() {
  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'header' }, [
    el('h1', {}, ['History']),
    el('div', { class: 'day-tag' }, [`${state.history.length} sessions`]),
  ]));

  if (state.history.length === 0) {
    wrap.appendChild(el('div', { class: 'card' }, [
      el('p', {}, ['Nothing logged yet. Finish a workout and it shows up here.']),
    ]));
    return wrap;
  }

  for (const h of state.history.slice(0, 100)) {
    const date = new Date(h.date);
    const item = el('div', { class: 'card' }, [
      el('div', { class: 'row between' }, [
        el('div', { class: 'date' }, [date.toLocaleDateString(undefined, {
          weekday: 'short', month: 'short', day: 'numeric',
        }) + `  ·  Workout ${h.workout}`]),
        el('div', { class: 'small muted' }, [date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })]),
      ]),
      ...h.lifts.map(l => el('div', { class: 'line' }, [
        el('span', {}, [`${l.name}  ${l.weight} ${state.unit}`]),
        el('span', { class: 'right' }, [
          el('span', { class: 'muted' }, [l.sets.join('-') + '  ']),
          el('span', { class: `result ${l.success ? 'ok' : 'bad'}` }, [l.success ? '✓' : '✗']),
        ]),
      ])),
    ]);
    wrap.appendChild(item);
  }
  return wrap;
}

// ----- Settings tab -----

function renderSettingsTab() {
  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'header' }, [
    el('h1', {}, ['Settings']),
  ]));

  // Units + rest + bar weight
  const general = el('div', { class: 'card' }, [
    el('h2', {}, ['General']),
    field('Units', el('select', {
      onChange: (e) => {
        const u = e.target.value;
        if (u === state.unit) return;
        state.unit = u;
        if (u === 'lb') {
          state.barWeight = 45;
          state.plates = DEFAULT_PLATES_LB.slice();
        } else {
          state.barWeight = 20;
          state.plates = DEFAULT_PLATES_KG.slice();
        }
        saveState();
        render();
      },
    }, [
      optionEl('lb', 'Pounds (lb)', state.unit),
      optionEl('kg', 'Kilograms (kg)', state.unit),
    ])),
    field('Rest timer (seconds)', el('input', {
      type: 'number',
      min: '30', step: '15',
      value: state.restSecs,
      onChange: (e) => {
        state.restSecs = Math.max(30, parseInt(e.target.value || '180', 10));
        saveState();
      },
    })),
    field(`Bar weight (${state.unit})`, el('input', {
      type: 'number',
      min: '0', step: state.unit === 'lb' ? '5' : '2.5',
      value: state.barWeight,
      onChange: (e) => {
        state.barWeight = parseFloat(e.target.value || '0');
        saveState();
      },
    })),
  ]);
  wrap.appendChild(general);

  // Per-exercise
  const exCard = el('div', { class: 'card' }, [
    el('h2', {}, ['Exercises']),
    el('div', { class: 'field-grid' }, [
      el('div', { class: 'h' }, ['Lift']),
      el('div', { class: 'h' }, ['Current']),
      el('div', { class: 'h' }, ['Start']),
      el('div', { class: 'h' }, [`+${state.unit}`]),
    ]),
  ]);
  for (const [key, def] of Object.entries(EXERCISES)) {
    const ex = state.exercises[key];
    exCard.appendChild(el('div', { class: 'field-grid', style: 'margin-top:8px' }, [
      el('div', {}, [def.name]),
      el('input', {
        type: 'number', step: state.unit === 'lb' ? '5' : '2.5', value: ex.weight,
        onChange: (e) => { ex.weight = parseFloat(e.target.value || '0'); saveState(); },
      }),
      el('input', {
        type: 'number', step: state.unit === 'lb' ? '5' : '2.5', value: ex.start,
        onChange: (e) => { ex.start = parseFloat(e.target.value || '0'); saveState(); },
      }),
      el('input', {
        type: 'number', step: state.unit === 'lb' ? '5' : '2.5', value: ex.increment,
        onChange: (e) => { ex.increment = parseFloat(e.target.value || '0'); saveState(); },
      }),
    ]));
  }
  wrap.appendChild(exCard);

  // Reset / data
  wrap.appendChild(el('div', { class: 'card' }, [
    el('h2', {}, ['Data']),
    el('div', { class: 'row', style: 'flex-wrap:wrap; gap:8px' }, [
      el('button', {
        class: 'btn',
        onClick: () => {
          if (!confirm('Reset weights to starting values? History is kept.')) return;
          for (const [key, def] of Object.entries(EXERCISES)) {
            const ex = state.exercises[key];
            ex.weight = ex.start;
            ex.failStreak = 0;
          }
          state.activeSession = null;
          saveState(); render();
        },
      }, ['Reset weights']),
      el('button', {
        class: 'btn danger',
        onClick: () => {
          if (!confirm('Wipe ALL data including history? This cannot be undone.')) return;
          localStorage.removeItem(STORAGE_KEY);
          state = loadState();
          render();
        },
      }, ['Erase everything']),
      el('button', {
        class: 'btn ghost',
        onClick: () => {
          const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `5x5-backup-${new Date().toISOString().slice(0,10)}.json`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        },
      }, ['Export JSON']),
    ]),
    el('p', { class: 'small muted', style: 'margin-top:10px' }, [
      'StrongLifts 5x5 rules: add weight on a clean ',
      '5×5 (1×5 for Deadlift). Same weight after a miss. After 3 consecutive misses on a lift, weight deloads 10%.',
    ]),
  ]));

  return wrap;
}

function field(label, control) {
  return el('label', { class: 'field' }, [label, control]);
}
function optionEl(value, label, currentVal) {
  const attrs = { value };
  if (value === currentVal) attrs.selected = true;
  return el('option', attrs, [label]);
}

// ---------- Tab bar wiring ----------

function wireTabs() {
  for (const btn of $$('#tabbar .tab')) {
    btn.addEventListener('click', () => {
      currentTab = btn.dataset.tab;
      for (const b of $$('#tabbar .tab')) b.classList.toggle('active', b === btn);
      render();
    });
  }
}

// ---------- Service worker ----------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// ---------- Boot ----------

document.addEventListener('DOMContentLoaded', () => {
  wireTabs();
  render();
  // Keep timer ticking even when re-rendering pauses
  setInterval(() => { if (restTimer.isActive()) renderRestBar(); }, 500);
});
