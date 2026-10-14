/*
 * SPIKE 3 Blocks -> Python converter  (v2)
 * Reads a LEGO SPIKE App 3 word-block project (.llsp3) and produces
 * SPIKE 3 MicroPython (hub / motor / motor_pair / runloop API).
 *
 * Output style follows LEGO's own SPIKE 3 Python examples:
 *   motor_pair.pair(...) at the top, speeds written as deg/sec (30% -> 300),
 *   distances as wheel degrees (10 cm -> 206), reverse = negative degrees.
 *
 * Works in the browser (window.SpikeConverter) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- settings
  const SPEED_FACTOR = 10;             // block speed % -> deg/sec (LEGO: 30% == velocity=300)
  const DEFAULT_MOVE_SPEED = 50;       // SPIKE default movement speed %
  const DEFAULT_MOTOR_SPEED = 75;      // SPIKE default single-motor speed %
  const DEFAULT_CM_PER_ROTATION = 17.5; // standard SPIKE wheel
  const PAIR = 'motor_pair.PAIR_1';

  const COLOR_NAMES = {
    '-1': 'UNKNOWN', '0': 'BLACK', '1': 'MAGENTA', '2': 'PURPLE', '3': 'BLUE',
    '4': 'AZURE', '5': 'TURQUOISE', '6': 'GREEN', '7': 'YELLOW', '8': 'ORANGE',
    '9': 'RED', '10': 'WHITE'
  };

  const PY_KEYWORDS = new Set(('False None True and as assert async await break class continue def del elif else ' +
    'except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield ' +
    'print len int str float list dict range abs round min max sum type id input open map filter set').split(' '));

  const RESERVED = new Set(['motor', 'motor_pair', 'port', 'runloop', 'color', 'color_sensor', 'distance_sensor',
    'force_sensor', 'motion_sensor', 'light_matrix', 'sound', 'button', 'light', 'hub', 'math', 'random', 'time',
    'orientation', 'broadcasts', 'move_speed', 'motor_speeds', 'cm_per_rotation', 'timer_start', 'tempo', 'note_freq', 'main']);

  // --------------------------------------------------------- block catalog
  // Category colours (close to the SPIKE App palette)
  const CATS = {
    events: '#ffbf00', control: '#ffab19', motors: '#0090f5', movement: '#ff4ccd', light: '#9a5cff',
    sound: '#cf63cf', sensors: '#38c1ff', operators: '#59c059', variables: '#ff8c1a', lists: '#ff661a',
    myblocks: '#ff6680', other: '#8c8c8c'
  };
  function catOf(op) {
    if (/^(flipperevents|event)_/.test(op)) return 'events';
    if (/^(flippercontrol|control)_/.test(op)) return 'control';
    if (/^flipper(more)?motor_/.test(op)) return 'motors';
    if (/^flipper(more)?move_/.test(op)) return 'movement';
    if (/^flipperlight_/.test(op)) return 'light';
    if (/^(flippersound|flippermusic|sound)_/.test(op)) return 'sound';
    if (/^flipper(more)?sensors_/.test(op)) return 'sensors';
    if (/^(flipperoperator|operator)_/.test(op)) return 'operators';
    if (/^data_.*list/.test(op)) return 'lists';
    if (/^data_/.test(op)) return 'variables';
    if (/^(procedures|argument)_/.test(op)) return 'myblocks';
    return 'other';
  }

  // Block wording as shown in the SPIKE App. {NAME} = an input or dropdown.
  const TPL = {
    flipperevents_whenProgramStarts: 'when program starts',
    flipperevents_whenColor: '{PORT} when color is {OPTION}',
    flipperevents_whenPressed: '{PORT} when {OPTION}',
    flipperevents_whenDistance: '{PORT} when {COMPARATOR} {VALUE} {UNIT}',
    flipperevents_whenButton: 'when {BUTTON} Button {EVENT}',
    flipperevents_whenTimer: 'when timer > {VALUE}',
    flipperevents_whenCondition: 'when {CONDITION}',
    flipperevents_whenOrientation: 'when {VALUE} is up',
    flipperevents_whenGesture: 'when {EVENT}',
    flipperevents_whenTilted: 'when tilted {VALUE}',
    flipperevents_whenGreaterThan: 'when {OPTION} > {VALUE}',
    event_whenbroadcastreceived: 'when I receive {BROADCAST_OPTION}',
    event_whenflagclicked: 'when program starts',
    event_broadcast: 'broadcast {BROADCAST_INPUT}',
    event_broadcastandwait: 'broadcast {BROADCAST_INPUT} and wait',
    control_wait: 'wait {DURATION} seconds',
    control_repeat: 'repeat {TIMES}',
    control_forever: 'forever',
    control_if: 'if {CONDITION} then',
    control_if_else: 'if {CONDITION} then',
    control_wait_until: 'wait until {CONDITION}',
    control_repeat_until: 'repeat until {CONDITION}',
    flippercontrol_stop: 'stop {STOP_OPTION}',
    control_stop: 'stop {STOP_OPTION}',
    flippercontrol_stopOtherStacks: 'stop other stacks',
    data_setvariableto: 'set {VARIABLE} to {VALUE}',
    data_changevariableby: 'change {VARIABLE} by {VALUE}',
    data_showvariable: 'show variable {VARIABLE}',
    data_hidevariable: 'hide variable {VARIABLE}',
    data_variable: '{VARIABLE}',
    data_listcontents: '{LIST}',
    data_addtolist: 'add {ITEM} to {LIST}',
    data_deleteoflist: 'delete {INDEX} of {LIST}',
    data_deletealloflist: 'delete all of {LIST}',
    data_insertatlist: 'insert {ITEM} at {INDEX} of {LIST}',
    data_replaceitemoflist: 'replace item {INDEX} of {LIST} with {ITEM}',
    data_itemoflist: 'item {INDEX} of {LIST}',
    data_itemnumoflist: 'item # of {ITEM} in {LIST}',
    data_lengthoflist: 'length of {LIST}',
    data_listcontainsitem: '{LIST} contains {ITEM} ?',
    operator_add: '{NUM1} + {NUM2}',
    operator_subtract: '{NUM1} - {NUM2}',
    operator_multiply: '{NUM1} * {NUM2}',
    operator_divide: '{NUM1} / {NUM2}',
    operator_mod: '{NUM1} mod {NUM2}',
    operator_round: 'round {NUM}',
    operator_random: 'pick random {FROM} to {TO}',
    operator_gt: '{OPERAND1} > {OPERAND2}',
    operator_lt: '{OPERAND1} < {OPERAND2}',
    operator_equals: '{OPERAND1} = {OPERAND2}',
    operator_and: '{OPERAND1} and {OPERAND2}',
    operator_or: '{OPERAND1} or {OPERAND2}',
    operator_not: 'not {OPERAND}',
    operator_join: 'join {STRING1} {STRING2}',
    operator_letter_of: 'letter {LETTER} of {STRING}',
    operator_length: 'length of {STRING}',
    operator_contains: '{STRING1} contains {STRING2} ?',
    operator_mathop: '{OPERATOR} of {NUM}',
    flipperoperator_isInBetween: 'is {VALUE} in between {LOW} and {HIGH} ?',
    flippermotor_motorTurnForDirection: '{PORT} run {DIRECTION} for {VALUE} {UNIT}',
    flippermotor_motorGoDirectionToPosition: '{PORT} go {DIRECTION} to position {POSITION}',
    flippermotor_motorStartDirection: '{PORT} start motor {DIRECTION}',
    flippermotor_motorStop: '{PORT} stop motor',
    flippermotor_motorSetSpeed: '{PORT} set speed to {SPEED} %',
    flippermotor_absolutePosition: '{PORT} position',
    flippermotor_speed: '{PORT} speed',
    flippermoremotor_motorTurnForSpeed: '{PORT} run for {VALUE} {UNIT} at {SPEED} % speed',
    flippermoremotor_motorGoToRelativePosition: '{PORT} go to relative position {POSITION} at {SPEED} % speed',
    flippermoremotor_motorStartSpeed: '{PORT} start motor at {SPEED} % speed',
    flippermoremotor_motorStartPower: '{PORT} start motor at {POWER} % power',
    flippermoremotor_motorSetDegreeCounted: '{PORT} set relative position to {VALUE}',
    flippermoremotor_motorSetStopMethod: '{PORT} set motor to {STOP} at stop',
    flippermoremotor_motorSetAcceleration: '{PORT} set acceleration to {ACCELERATION}',
    flippermoremotor_motorSetStallDetection: '{PORT} turn stall detection {ENABLED}',
    flippermoremotor_position: '{PORT} relative position',
    flippermoremotor_power: '{PORT} power',
    flippermoremotor_motorDidMovement: '{PORT} was the motor interrupted?',
    flippermove_setMovementPair: 'set movement motors to {PAIR}',
    flippermove_move: 'move {DIRECTION} for {VALUE} {UNIT}',
    flippermove_steer: 'move {STEERING} for {VALUE} {UNIT}',
    flippermove_startMove: 'start moving {DIRECTION}',
    flippermove_startSteer: 'start moving {STEERING}',
    flippermove_stopMove: 'stop moving',
    flippermove_movementSpeed: 'set movement speed to {SPEED} %',
    flippermove_setDistance: 'set 1 motor rotation to {DISTANCE} {UNIT} moved',
    flippermoremove_startSteerAtSpeed: 'start moving {STEERING} at {SPEED} % speed',
    flippermoremove_startSteerAtPower: 'start moving {STEERING} at {POWER} % power',
    flippermoremove_startDualSpeed: 'start moving at {LEFT} {RIGHT} % speed',
    flippermoremove_startDualPower: 'start moving at {LEFT} {RIGHT} % power',
    flippermoremove_steerDistanceAtSpeed: 'move {STEERING} for {DISTANCE} {UNIT} at {SPEED} % speed',
    flippermoremove_moveDistanceAtSpeed: 'move for {DISTANCE} {UNIT} at {LEFT} {RIGHT} % speed',
    flippermoremove_movementSetStopMethod: 'set movement motors to {STOP} at stop',
    flippermoremove_movementSetAcceleration: 'set movement acceleration to {ACCELERATION}',
    flipperlight_lightDisplayText: 'write {TEXT}',
    flipperlight_lightDisplayImageOn: 'turn on {MATRIX}',
    flipperlight_lightDisplayImageOnForTime: 'turn on {MATRIX} for {VALUE} seconds',
    flipperlight_lightDisplayOff: 'turn off pixels',
    flipperlight_lightDisplaySetPixel: 'set pixel at {X} , {Y} to {BRIGHTNESS} %',
    flipperlight_lightDisplaySetBrightness: 'set pixel brightness to {BRIGHTNESS} %',
    flipperlight_lightDisplayRotate: 'rotate {DIRECTION}',
    flipperlight_lightDisplaySetOrientation: 'set orientation to {ORIENTATION}',
    flipperlight_centerButtonLight: 'set Power Button light to {COLOR}',
    flipperlight_ultrasonicLightUp: '{PORT} light up {VALUE}',
    flippersound_beep: 'start playing beep {NOTE}',
    flippersound_beepForTime: 'play beep {NOTE} for {DURATION} seconds',
    flippersound_playSound: 'start sound {SOUND}',
    flippersound_playSoundUntilDone: 'play sound {SOUND} until done',
    flippersound_stopSound: 'stop all sounds',
    flippermusic_playNoteForBeats: 'play note {NOTE} for {BEATS} beats',
    flippermusic_restForBeats: 'rest for {BEATS} beats',
    flippermusic_setTempo: 'set tempo to {TEMPO}',
    flippermusic_changeTempo: 'change tempo by {TEMPO}',
    flippermusic_getTempo: 'tempo',
    sound_setvolumeto: 'set volume to {VOLUME} %',
    sound_changevolumeby: 'change volume by {VOLUME}',
    flippersensors_color: '{PORT} color',
    flippersensors_isColor: '{PORT} is color {VALUE} ?',
    flippersensors_reflectivity: '{PORT} reflected light',
    flippersensors_isReflectivity: '{PORT} reflection {COMPARATOR} {VALUE} % ?',
    flippersensors_distance: '{PORT} distance in {UNIT}',
    flippersensors_isDistance: '{PORT} is {COMPARATOR} {VALUE} {UNIT} ?',
    flippersensors_force: '{PORT} pressure in {UNIT}',
    flippersensors_isPressed: '{PORT} is {OPTION} ?',
    flippersensors_buttonIsPressed: 'is {BUTTON} Button {EVENT} ?',
    flippersensors_orientationAxis: '{AXIS} angle',
    flippersensors_isorientation: 'is {ORIENTATION} up ?',
    flippersensors_ismotion: 'is {MOTION} ?',
    flippersensors_isTilted: 'is tilted {VALUE} ?',
    flippersensors_resetYaw: 'set yaw angle to 0',
    flippersensors_timer: 'timer',
    flippersensors_resetTimer: 'reset timer',
    flippersensors_loudness: 'loudness',
    flippermoresensors_rawColor: '{PORT} raw {COLOR}',
    flippermoresensors_orientation: 'orientation',
    flippermoresensors_motion: 'gesture',
    flippermoresensors_acceleration: 'acceleration {AXIS}',
    flippermoresensors_angularVelocity: 'angular velocity {AXIS}',
    flippermoresensors_setOrientation: 'set yaw axis to {UP}'
  };

  const HAT_OPS = (op) => /^(flipperevents_when|event_when)/.test(op) || op === 'procedures_definition';
  const C_OPS = new Set(['control_repeat', 'control_forever', 'control_if', 'control_if_else', 'control_repeat_until']);
  const BOOL_OPS = /(_is[A-Z]|_is[a-z]|operator_(gt|lt|equals|and|or|not|contains)|listcontainsitem|buttonIsPressed|isInBetween|DidMovement|argument_reporter_boolean)/;

  // ---------------------------------------------------------------- helpers
  const NUM_RE = /^-?\d+(\.\d+)?$/;
  const isNum = (e) => typeof e === 'string' && NUM_RE.test(e);

  function fmtNum(n) {
    if (!isFinite(n)) return '0';
    if (Number.isInteger(n)) return String(n);
    return String(Math.round(n * 10000) / 10000);
  }

  function lit(v) {
    if (v === null || v === undefined) return '""';
    if (typeof v === 'number') return fmtNum(v);
    if (typeof v === 'boolean') return v ? 'True' : 'False';
    const s = String(v);
    if (/^\s*-?(\d+\.?\d*|\.\d+)\s*$/.test(s)) return fmtNum(Number(s));
    return JSON.stringify(s);
  }

  // numbers hidden inside dropdown values such as "straight: 0"
  function numIn(v) {
    if (v == null) return null;
    const m = String(v).match(/-?\d+(\.\d+)?/g);
    return m ? m[m.length - 1] : null;
  }

  const wrap = (e) => (/^[A-Za-z_][A-Za-z0-9_.]*(\[[^\]]*\])?$/.test(e) || isNum(e) || /^[A-Za-z_][\w.]*\([^()]*\)$/.test(e) ? e : '(' + e + ')');

  function scale(e, k, asInt = true) {
    if (isNum(e)) {
      const n = Number(e) * k;
      return fmtNum(asInt ? Math.round(n) : n);
    }
    if (k === 1) return asInt ? 'int(' + e + ')' : e;
    return asInt ? 'int(' + wrap(e) + ' * ' + k + ')' : wrap(e) + ' * ' + k;
  }

  function negate(e) {
    if (isNum(e)) return fmtNum(-Number(e));
    if (e.startsWith('-') && /^-[\w.\[\]]+$/.test(e)) return e.slice(1);
    return '-' + wrap(e);
  }

  function snake(s) {
    return String(s).normalize('NFKD').replace(/[^\w\s]/g, ' ').trim().replace(/\s+/g, '_')
      .replace(/[^A-Za-z0-9_]/g, '').replace(/_+/g, '_').toLowerCase();
  }

  function stripJson(v) {
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch (e) { return v; }
  }

  function humanize(op) {
    return String(op).replace(/^[a-z]+_/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').toLowerCase();
  }

  // ------------------------------------------------------------- converter
  class Converter {
    constructor(project, opts = {}) {
      this.project = project;
      this.projectName = opts.name || 'SPIKE project';
      this.explain = !!opts.explain;
      this.blocks = {};
      this.comments = {};
      for (const t of project.targets || []) {
        for (const [id, b] of Object.entries(t.blocks || {})) if (b && !Array.isArray(b)) this.blocks[id] = b;
        Object.assign(this.comments, t.comments || {});
      }
      this.usedNames = new Set();
      this.vars = new Map();
      this.varByName = new Map();
      this.lists = new Map();
      this.listByName = new Map();
      this.procs = new Map();
      this.hub = new Set();
      this.mods = new Set(['runloop']);
      this.flags = { move: false, cmVar: false, moveVar: false, timer: false, tempo: false, noteFreq: false };
      this.motorVarPorts = new Set();
      this.broadcasts = new Set();
      this.todos = [];
      this.todoIds = new Set();
      this.notes = [];
      this.runList = [];
      this.cur = null;
      this.curId = null;
      this.blockCount = 0;
    }

    // ---- naming
    uniq(base, fallback) {
      let n = snake(base) || fallback;
      if (/^\d/.test(n)) n = fallback + '_' + n;
      if (PY_KEYWORDS.has(n) || RESERVED.has(n)) n = n + '_' + fallback;
      let out = n, i = 2;
      while (this.usedNames.has(out)) out = n + '_' + (i++);
      this.usedNames.add(out);
      return out;
    }

    collectData() {
      for (const t of this.project.targets || []) {
        for (const [id, v] of Object.entries(t.variables || {})) {
          if (this.vars.has(id)) continue;
          const py = this.uniq(v[0], 'var');
          this.vars.set(id, { py, init: lit(v[1]) });
          this.varByName.set(v[0], py);
        }
        for (const [id, v] of Object.entries(t.lists || {})) {
          if (this.lists.has(id)) continue;
          const py = this.uniq(v[0], 'list');
          const items = (v[1] || []).map(lit).join(', ');
          this.lists.set(id, { py, init: '[' + items + ']' });
          this.listByName.set(v[0], py);
        }
      }
    }

    varName(id, name) {
      if (this.vars.has(id)) return this.vars.get(id).py;
      if (this.varByName.has(name)) return this.varByName.get(name);
      const py = this.uniq(name, 'var');
      this.vars.set(id, { py, init: '0' });
      this.varByName.set(name, py);
      return py;
    }

    listName(id, name) {
      if (this.lists.has(id)) return this.lists.get(id).py;
      if (this.listByName.has(name)) return this.listByName.get(name);
      const py = this.uniq(name, 'list');
      this.lists.set(id, { py, init: '[]' });
      this.listByName.set(name, py);
      return py;
    }

    // ---- input access
    input(b, name) {
      const inp = b.inputs && b.inputs[name];
      if (!inp) return null;
      return inp[1] == null ? null : inp[1];
    }

    // plain dropdown / literal text, or null when a reporter or variable is plugged in
    raw(b, name) {
      if (b.fields && b.fields[name]) return String(b.fields[name][0]);
      const v = this.input(b, name);
      if (v == null) return null;
      if (Array.isArray(v)) {
        if (v[0] === 12 || v[0] === 13) return null;
        return v[1] == null ? '' : String(v[1]);
      }
      const sb = this.blocks[v];
      if (sb && sb.shadow) {
        const f = Object.values(sb.fields || {});
        if (f.length) return String(f[0][0]);
      }
      return null;
    }

    // literal number on an input (dropdown numbers such as "straight: 0" included)
    litNum(b, name) {
      const r = this.raw(b, name);
      if (r === null) return null;
      const t = String(r).trim();
      if (isNum(t)) return t;
      const n = numIn(t);
      return n !== null && t.includes(':') ? n : null;
    }

    expr(b, name, fallback = '0') {
      if (b.fields && b.fields[name]) return lit(b.fields[name][0]);
      const v = this.input(b, name);
      if (v == null) return fallback;
      if (Array.isArray(v)) {
        if (v[0] === 12) return this.varName(v[2], v[1]);
        if (v[0] === 13) return this.listName(v[2], v[1]);
        return lit(v[1]);
      }
      const sb = this.blocks[v];
      if (!sb) return fallback;
      if (sb.shadow) {
        const f = Object.values(sb.fields || {});
        if (!f.length) return fallback;
        const val = f[0][0];
        if (sb.opcode.includes('color-selector')) return this.colorConst(val);
        if (sb.opcode.includes('rotation-wheel') || sb.opcode.includes('custom-angle')) return lit(numIn(val) ?? val);
        return lit(val);
      }
      const prev = this.curId;
      this.curId = v;
      const out = this.reporter(sb, v);
      this.curId = prev;
      return out;
    }

    num(b, name, fallback) {
      const e = this.expr(b, name, fallback);
      if (e.startsWith('"')) { const n = numIn(JSON.parse(e)); return n !== null ? n : fallback; }
      return e;
    }

    cond(b, name) {
      const v = this.input(b, name);
      if (v == null) return 'False';
      return this.expr(b, name, 'False');
    }

    ports(b, name = 'PORT') {
      const r = this.raw(b, name);
      const letters = (r || '').toUpperCase().match(/[A-F]/g);
      this.hub.add('port');
      if (!letters) { this.todo('Could not read the port on a "' + humanize(b.opcode) + '" block, used port A'); return ['port.A']; }
      return [...new Set(letters)].map((l) => 'port.' + l);
    }
    port(b, name = 'PORT') { return this.ports(b, name)[0]; }

    todo(msg) {
      const id = this.curId;
      this.todos.push({ msg, id });
      if (id) this.todoIds.add(id);
      if (this.cur) this.cur.pending.push('# TODO: ' + msg);
    }
    note(msg) { if (this.cur) this.cur.pending.push('# NOTE: ' + msg); }
    assign(name) { if (this.cur) this.cur.assigned.add(name); }

    colorConst(v) {
      this.mods.add('color');
      const key = String(v).trim();
      if (COLOR_NAMES[key]) return 'color.' + COLOR_NAMES[key];
      const up = key.toUpperCase();
      if (Object.values(COLOR_NAMES).includes(up)) return 'color.' + up;
      return lit(v);
    }

    colorExpr(b, name) {
      const r = this.raw(b, name);
      if (r !== null) return this.colorConst(r);
      return this.expr(b, name);
    }

    // ---------------------------------------------------- analysis (constant folding)
    walk(id, fn) {
      let cur = id;
      while (cur) {
        const b = this.blocks[cur];
        if (!b) break;
        fn(b, cur);
        for (const s of ['SUBSTACK', 'SUBSTACK2']) {
          const sub = this.input(b, s);
          if (sub && !Array.isArray(sub)) this.walk(sub, fn);
        }
        cur = b.next;
      }
    }

    analyze() {
      const pairs = [], speeds = [], cms = [], mspeeds = {};
      let speedUnsafe = false, cmUnsafe = false; const motorUnsafe = new Set();
      const MOVE_USES_SPEED = new Set(['flippermove_move', 'flippermove_steer', 'flippermove_startMove', 'flippermove_startSteer']);
      const CM_MOVES = new Set(['flippermove_move', 'flippermove_steer', 'flippermoremove_steerDistanceAtSpeed', 'flippermoremove_moveDistanceAtSpeed']);
      const MOTOR_USES_SPEED = new Set(['flippermotor_motorTurnForDirection', 'flippermotor_motorStartDirection', 'flippermotor_motorGoDirectionToPosition']);
      const letters = (s) => ((s || '').toUpperCase().match(/[A-F]/g) || []);

      for (const [id, b] of Object.entries(this.blocks)) {
        if (!b.topLevel || b.shadow) continue;
        let moveSeen = false, cmSeen = false; const motorSeen = new Set();
        this.walk(id, (blk) => {
          const op = blk.opcode;
          if (op === 'flippermove_setMovementPair') pairs.push(letters(this.raw(blk, 'PAIR')).join(''));
          if (op === 'flippermove_movementSpeed') { speeds.push(this.litNum(blk, 'SPEED')); if (moveSeen) speedUnsafe = true; }
          if (op === 'flippermove_setDistance') {
            let v = this.litNum(blk, 'DISTANCE');
            if (v !== null && String(this.raw(blk, 'UNIT') || '').toLowerCase().startsWith('in')) v = fmtNum(Number(v) * 2.54);
            cms.push(v); if (cmSeen) cmUnsafe = true;
          }
          if (op === 'flippermotor_motorSetSpeed') {
            const v = this.litNum(blk, 'SPEED');
            for (const p of letters(this.raw(blk, 'PORT'))) { (mspeeds[p] = mspeeds[p] || []).push(v); if (motorSeen.has(p)) motorUnsafe.add(p); }
          }
          if (MOVE_USES_SPEED.has(op)) moveSeen = true;
          if (CM_MOVES.has(op)) { const u = String(this.raw(blk, 'UNIT') || 'cm').toLowerCase(); if (u.startsWith('cm') || u.startsWith('in')) cmSeen = true; }
          if (MOTOR_USES_SPEED.has(op)) for (const p of letters(this.raw(blk, 'PORT'))) motorSeen.add(p);
        });
      }
      const same = (arr) => arr.length > 0 && arr.every((x) => x !== null && Number(x) === Number(arr[0]));

      this.pairPorts = pairs.length === 0 ? ['A', 'B'] : (pairs.every((p) => p === pairs[0]) && pairs[0].length >= 2 ? pairs[0].slice(0, 2).split('') : null);
      this.pairDefault = pairs.length === 0;
      this.moveSpeedConst = speeds.length === 0 ? String(DEFAULT_MOVE_SPEED * SPEED_FACTOR)
        : (same(speeds) && !speedUnsafe ? fmtNum(Math.round(Number(speeds[0]) * SPEED_FACTOR)) : null);
      this.cmConst = cms.length === 0 ? DEFAULT_CM_PER_ROTATION : (same(cms) && !cmUnsafe ? Number(cms[0]) : null);
      this.motorSpeedConst = {};
      for (const p of 'ABCDEF') {
        const arr = mspeeds[p];
        if (!arr) this.motorSpeedConst[p] = String(DEFAULT_MOTOR_SPEED * SPEED_FACTOR);
        else if (same(arr) && !motorUnsafe.has(p)) this.motorSpeedConst[p] = fmtNum(Math.round(Number(arr[0]) * SPEED_FACTOR));
        else this.motorSpeedConst[p] = null;
      }
    }

    moveSpeed() {
      this.flags.move = true; this.mods.add('motor_pair');
      if (this.moveSpeedConst !== null) return this.moveSpeedConst;
      this.flags.moveVar = true; return 'move_speed';
    }
    motorSpeed(p) {
      this.mods.add('motor');
      const L = p.replace('port.', '');
      if (this.motorSpeedConst[L] != null) return this.motorSpeedConst[L];
      this.motorVarPorts.add(p);
      return 'motor_speeds[' + p + ']';
    }
    pct(e) { return scale(e, SPEED_FACTOR); }

    // wheel degrees for a distance; returns [expr, comment]
    moveDegrees(valueExpr, unit) {
      unit = String(unit || 'cm').toLowerCase();
      if (unit.startsWith('rot')) return [scale(valueExpr, 360), isNum(valueExpr) ? valueExpr + ' rotation' + (valueExpr === '1' ? '' : 's') : ''];
      if (unit.startsWith('deg')) return [scale(valueExpr, 1), ''];
      const inch = unit.startsWith('in');
      const cmExpr = inch ? (isNum(valueExpr) ? fmtNum(Number(valueExpr) * 2.54) : wrap(valueExpr) + ' * 2.54') : valueExpr;
      if (this.cmConst !== null) {
        if (isNum(cmExpr)) return [fmtNum(Math.round(Number(cmExpr) / this.cmConst * 360)), valueExpr + (inch ? ' in' : ' cm')];
        return ['round(' + wrap(cmExpr) + ' / ' + fmtNum(this.cmConst) + ' * 360)', ''];
      }
      this.flags.cmVar = true;
      return ['round(' + wrap(cmExpr) + ' / cm_per_rotation * 360)', ''];
    }

    noteFreq(e) {
      if (isNum(e)) return fmtNum(Math.round(440 * Math.pow(2, (Number(e) - 69) / 12)));
      this.flags.noteFreq = true;
      return 'note_freq(' + e + ')';
    }

    // ---------------------------------------------------- reporters
    reporter(b, id) {
      const op = b.opcode;
      const E = (n, fb) => this.expr(b, n, fb);
      switch (op) {
        case 'operator_add': return E('NUM1') + ' + ' + E('NUM2');
        case 'operator_subtract': return E('NUM1') + ' - ' + wrap(E('NUM2'));
        case 'operator_multiply': return wrap(E('NUM1')) + ' * ' + wrap(E('NUM2'));
        case 'operator_divide': return wrap(E('NUM1')) + ' / ' + wrap(E('NUM2'));
        case 'operator_mod': return wrap(E('NUM1')) + ' % ' + wrap(E('NUM2'));
        case 'operator_round': return 'round(' + E('NUM') + ')';
        case 'operator_random': {
          const a = E('FROM', '1'), c = E('TO', '10');
          this.mods.add('random');
          if ((isNum(a) && a.includes('.')) || (isNum(c) && c.includes('.'))) return 'random.uniform(' + a + ', ' + c + ')';
          return 'random.randint(' + (isNum(a) ? a : 'int(' + a + ')') + ', ' + (isNum(c) ? c : 'int(' + c + ')') + ')';
        }
        case 'operator_gt': return wrap(E('OPERAND1')) + ' > ' + wrap(E('OPERAND2'));
        case 'operator_lt': return wrap(E('OPERAND1')) + ' < ' + wrap(E('OPERAND2'));
        case 'operator_equals': return wrap(E('OPERAND1')) + ' == ' + wrap(E('OPERAND2'));
        case 'operator_and': return wrap(this.cond(b, 'OPERAND1')) + ' and ' + wrap(this.cond(b, 'OPERAND2'));
        case 'operator_or': return wrap(this.cond(b, 'OPERAND1')) + ' or ' + wrap(this.cond(b, 'OPERAND2'));
        case 'operator_not': return 'not ' + wrap(this.cond(b, 'OPERAND'));
        case 'operator_join': return this.toStr(E('STRING1', '""')) + ' + ' + this.toStr(E('STRING2', '""'));
        case 'operator_letter_of': return 'str(' + E('STRING', '""') + ')[' + scale(E('LETTER', '1'), 1) + ' - 1]';
        case 'operator_length': return 'len(str(' + E('STRING', '""') + '))';
        case 'operator_contains': return 'str(' + E('STRING2', '""') + ').lower() in str(' + E('STRING1', '""') + ').lower()';
        case 'operator_mathop': {
          const fn = (this.raw(b, 'OPERATOR') || 'abs').toLowerCase();
          const x = E('NUM');
          if (fn === 'abs') return 'abs(' + x + ')';
          this.mods.add('math');
          const map = {
            floor: 'math.floor(' + x + ')', ceiling: 'math.ceil(' + x + ')',
            sqrt: 'math.sqrt(' + x + ')', sin: 'math.sin(math.radians(' + x + '))', cos: 'math.cos(math.radians(' + x + '))',
            tan: 'math.tan(math.radians(' + x + '))', asin: 'math.degrees(math.asin(' + x + '))',
            acos: 'math.degrees(math.acos(' + x + '))', atan: 'math.degrees(math.atan(' + x + '))',
            ln: 'math.log(' + x + ')', log: 'math.log(' + x + ', 10)', 'e ^': 'math.exp(' + x + ')', '10 ^': '10 ** ' + wrap(x)
          };
          return map[fn] || 'abs(' + x + ')';
        }
        case 'flipperoperator_isInBetween':
          return wrap(E('LOW')) + ' <= ' + wrap(E('VALUE')) + ' <= ' + wrap(E('HIGH'));

        case 'data_variable': return this.varName(b.fields.VARIABLE[1], b.fields.VARIABLE[0]);
        case 'data_listcontents': return '" ".join(str(i) for i in ' + this.listName(b.fields.LIST[1], b.fields.LIST[0]) + ')';
        case 'data_itemoflist': return this.listRef(b) + '[' + this.minus1(E('INDEX', '1')) + ']';
        case 'data_itemnumoflist': { const L = this.listRef(b), it = E('ITEM', '""'); return '(' + L + '.index(' + it + ') + 1 if ' + it + ' in ' + L + ' else 0)'; }
        case 'data_lengthoflist': return 'len(' + this.listRef(b) + ')';
        case 'data_listcontainsitem': return E('ITEM', '""') + ' in ' + this.listRef(b);

        case 'argument_reporter_string_number':
        case 'argument_reporter_boolean': {
          const name = b.fields.VALUE[0];
          if (this.cur && this.cur.args && this.cur.args.has(name)) return this.cur.args.get(name);
          this.todo('My Block input "' + name + '" used outside its define block');
          return '0';
        }

        case 'flippersensors_color': this.mods.add('color_sensor'); return 'color_sensor.color(' + this.port(b) + ')';
        case 'flippersensors_isColor': this.mods.add('color_sensor'); return 'color_sensor.color(' + this.port(b) + ') == ' + this.colorExpr(b, 'VALUE');
        case 'flippersensors_reflectivity': this.mods.add('color_sensor'); return 'color_sensor.reflection(' + this.port(b) + ')';
        case 'flippersensors_isReflectivity': this.mods.add('color_sensor');
          return 'color_sensor.reflection(' + this.port(b) + ') ' + this.cmp(this.raw(b, 'COMPARATOR')) + ' ' + wrap(E('VALUE'));
        case 'flippermoresensors_rawColor': {
          this.mods.add('color_sensor');
          const ch = (this.raw(b, 'COLOR') || 'red').toLowerCase();
          const idx = ch.startsWith('g') ? 1 : ch.startsWith('b') ? 2 : 0;
          return 'color_sensor.rgbi(' + this.port(b) + ')[' + idx + ']';
        }
        case 'flippersensors_distance': return this.distanceExpr(this.port(b), this.raw(b, 'UNIT'));
        case 'flippersensors_isDistance': return this.distanceCond(this.port(b), this.raw(b, 'COMPARATOR'), E('VALUE'), this.raw(b, 'UNIT'));
        case 'flippersensors_force': {
          this.mods.add('force_sensor');
          const u = (this.raw(b, 'UNIT') || '%').toLowerCase();
          const p = this.port(b);
          return u.startsWith('n') ? 'force_sensor.force(' + p + ') / 10' : 'force_sensor.force(' + p + ')';
        }
        case 'flippersensors_isPressed': return this.forceCond(this.port(b), this.raw(b, 'OPTION'));
        case 'flippersensors_orientationAxis': return this.tiltExpr(this.raw(b, 'AXIS'));
        case 'flippersensors_timer': this.flags.timer = true; this.mods.add('time');
          return 'time.ticks_diff(time.ticks_ms(), timer_start) / 1000';
        case 'flippersensors_buttonIsPressed': return this.buttonCond(this.raw(b, 'BUTTON'), this.raw(b, 'EVENT'));
        case 'flippersensors_isorientation': return this.faceCond(this.raw(b, 'ORIENTATION'));
        case 'flippersensors_ismotion': return this.gestureCond(this.raw(b, 'MOTION'));
        case 'flippermoresensors_orientation': this.hub.add('motion_sensor'); return 'motion_sensor.up_face()';
        case 'flippermoresensors_motion': this.hub.add('motion_sensor'); return 'motion_sensor.gesture()';
        case 'flippermoresensors_acceleration': this.hub.add('motion_sensor'); return 'motion_sensor.acceleration()[' + this.axisIdx(this.raw(b, 'AXIS')) + ']';
        case 'flippermoresensors_angularVelocity': this.hub.add('motion_sensor'); return 'motion_sensor.angular_velocity()[' + this.axisIdx(this.raw(b, 'AXIS')) + ']';

        case 'flippermotor_absolutePosition': this.mods.add('motor'); return 'motor.absolute_position(' + this.port(b) + ')';
        case 'flippermoremotor_position': this.mods.add('motor'); return 'motor.relative_position(' + this.port(b) + ')';
        case 'flippermotor_speed': this.mods.add('motor'); return 'int(motor.velocity(' + this.port(b) + ') / ' + SPEED_FACTOR + ')';
        case 'flippermoremotor_power': this.mods.add('motor'); return 'int(motor.get_duty_cycle(' + this.port(b) + ') / 100)';
        case 'flippersensors_isTilted': {
          this.hub.add('motion_sensor');
          const t = String(this.raw(b, 'VALUE') || 'any').toLowerCase();
          this.note('tilt direction signs may need flipping on your hub; "tilted" here means more than 15 degrees');
          if (t.startsWith('forw')) return 'motion_sensor.tilt_angles()[1] < -150';
          if (t.startsWith('back')) return 'motion_sensor.tilt_angles()[1] > 150';
          if (t.startsWith('left')) return 'motion_sensor.tilt_angles()[2] < -150';
          if (t.startsWith('right')) return 'motion_sensor.tilt_angles()[2] > 150';
          return 'max(abs(a) for a in motion_sensor.tilt_angles()[1:]) > 150';
        }

        case 'flippermusic_getTempo': this.flags.tempo = true; return 'tempo';
      }
      this.todo('No Python version for the "' + humanize(op) + '" block yet (used 0)');
      return '0';
    }

    listRef(b) {
      const f = b.fields && b.fields.LIST;
      if (!f) return '[]';
      return this.listName(f[1], f[0]);
    }

    cmp(c) {
      c = String(c || '<').trim();
      if (c === '=' || c === '==') return '==';
      if (c === '>' || c === '<' || c === '>=' || c === '<=') return c;
      if (c.startsWith('close') || c === 'less') return '<';
      if (c.startsWith('far') || c === 'greater') return '>';
      return '<';
    }

    distanceExpr(p, unit) {
      this.mods.add('distance_sensor');
      const u = String(unit || 'cm').toLowerCase();
      if (u.startsWith('in')) return 'distance_sensor.distance(' + p + ') / 25.4';
      if (u === '%') return 'distance_sensor.distance(' + p + ') / 20';
      return 'distance_sensor.distance(' + p + ') / 10';
    }

    // distance_sensor.distance() is in mm and returns -1 when nothing is in range
    distanceCond(p, comparator, value, unit) {
      this.mods.add('distance_sensor');
      const op = this.cmp(comparator);
      const u = String(unit || 'cm').toLowerCase();
      const k = u.startsWith('in') ? 25.4 : u === '%' ? 20 : 10;
      const mm = isNum(value) ? fmtNum(Math.round(Number(value) * k)) : wrap(value) + ' * ' + k;
      const d = 'distance_sensor.distance(' + p + ')';
      if (op === '<' || op === '<=') return '-1 < ' + d + ' ' + op + ' ' + mm;
      if (op === '>' || op === '>=') return 'not (-1 < ' + d + ' ' + (op === '>' ? '<=' : '<') + ' ' + mm + ')';
      return d + ' == ' + mm;
    }

    forceCond(p, option) {
      this.mods.add('force_sensor');
      const o = String(option || 'pressed').toLowerCase();
      if (o.startsWith('hard')) return 'force_sensor.force(' + p + ') > 90';
      if (o.startsWith('release')) return 'not force_sensor.pressed(' + p + ')';
      return 'force_sensor.pressed(' + p + ')';
    }

    buttonCond(btn, ev) {
      this.hub.add('button');
      const B = String(btn || 'left').toLowerCase().startsWith('r') ? 'button.RIGHT' : 'button.LEFT';
      const released = String(ev || 'pressed').toLowerCase().startsWith('rel');
      return released ? 'not button.pressed(' + B + ')' : 'button.pressed(' + B + ')';
    }

    tiltExpr(axis) {
      this.hub.add('motion_sensor');
      const a = String(axis || 'yaw').toLowerCase();
      // tilt_angles() -> (yaw, pitch, roll) in tenths of a degree.
      // Python yaw counts the opposite way to the blocks, so it is flipped (same as LEGO's own examples).
      if (a.startsWith('p')) return 'motion_sensor.tilt_angles()[1] / 10';
      if (a.startsWith('r')) return 'motion_sensor.tilt_angles()[2] / 10';
      return 'motion_sensor.tilt_angles()[0] * -0.1';
    }

    axisIdx(a) { a = String(a || 'x').toLowerCase(); return a.startsWith('y') ? 1 : a.startsWith('z') ? 2 : 0; }

    faceCond(v) {
      this.hub.add('motion_sensor');
      const s = String(v || 'up').toLowerCase().replace(/[\s_-]/g, '');
      const map = { front: 'FRONT', back: 'BACK', up: 'TOP', top: 'TOP', down: 'BOTTOM', bottom: 'BOTTOM',
        leftside: 'LEFT', left: 'LEFT', rightside: 'RIGHT', right: 'RIGHT' };
      return 'motion_sensor.up_face() == motion_sensor.' + (map[s] || 'TOP');
    }

    gestureCond(v) {
      this.hub.add('motion_sensor');
      const s = String(v || 'tapped').toLowerCase().replace(/[\s_-]/g, '');
      const map = { tapped: 'TAPPED', doubletapped: 'DOUBLE_TAPPED', shake: 'SHAKEN', shaken: 'SHAKEN', freefall: 'FALLING', falling: 'FALLING' };
      return 'motion_sensor.gesture() == motion_sensor.' + (map[s] || 'TAPPED');
    }

    // ---------------------------------------------------- statements
    stack(id, depth) {
      const lines = [];
      let cur = id;
      while (cur) {
        const b = this.blocks[cur];
        if (!b) break;
        lines.push(...this.statement(b, cur, depth));
        cur = b.next;
      }
      return lines;
    }

    body(b, name, depth) {
      const id = this.input(b, name);
      const lines = id && !Array.isArray(id) ? this.stack(id, depth) : [];
      if (!lines.some((l) => !l.t.trim().startsWith('#'))) lines.push({ t: this.ind(depth) + 'pass', id: null });
      return lines;
    }

    ind(d) { return '    '.repeat(d); }

    statement(b, id, d) {
      if (b.shadow) return [];
      this.blockCount++;
      const prevId = this.curId;
      this.curId = id;
      this.cur.pending = [];
      const out = (this.stmtLines(b, id, d) || []).map((l) => (typeof l === 'string' ? { t: l, id } : l));
      const pre = [];
      const c = Object.values(this.comments).find((cm) => cm.blockId === id);
      if (c && c.text) for (const t of String(c.text).split('\n')) pre.push({ t: this.ind(d) + '# ' + t, id });
      if (this.explain && out.length) pre.push({ t: this.ind(d) + '# ▸ ' + this.label(id), id, explain: true });
      for (const p of this.cur.pending) pre.push({ t: this.ind(d) + p, id });
      this.cur.pending = [];
      this.curId = prevId;
      return pre.concat(out);
    }

    // run a command on several ports at once; the last one is awaited
    multi(ports, d, make) {
      return ports.map((p, i) => this.ind(d) + (i === ports.length - 1 ? 'await ' : '') + make(p));
    }

    direction(raw) {
      const s = String(raw || 'forward').toLowerCase();
      if (s.startsWith('counter')) return { steer: '-100', rev: false };
      if (s.startsWith('clock')) return { steer: '100', rev: false };
      if (s.startsWith('back')) return { steer: '0', rev: true };
      return { steer: '0', rev: false };
    }

    stmtLines(b, id, d) {
      const I = this.ind(d);
      const E = (n, fb) => this.expr(b, n, fb);
      const op = b.opcode;
      switch (op) {
        // ---------------- control
        case 'control_wait':
          return [I + 'await runloop.sleep_ms(' + scale(E('DURATION', '1'), 1000) + ')'];
        case 'control_repeat': {
          const n = E('TIMES', '10');
          return [I + 'for _ in range(' + (isNum(n) ? fmtNum(Math.round(Number(n))) : 'int(' + n + ')') + '):', ...this.body(b, 'SUBSTACK', d + 1)];
        }
        case 'control_forever':
          return [I + 'while True:', ...this.yieldingBody(b, 'SUBSTACK', d + 1)];
        case 'control_repeat_until':
          return [I + 'while not ' + wrap(this.cond(b, 'CONDITION')) + ':', ...this.yieldingBody(b, 'SUBSTACK', d + 1)];
        case 'control_if':
          return [I + 'if ' + this.cond(b, 'CONDITION') + ':', ...this.body(b, 'SUBSTACK', d + 1)];
        case 'control_if_else':
          return [I + 'if ' + this.cond(b, 'CONDITION') + ':', ...this.body(b, 'SUBSTACK', d + 1),
            I + 'else:', ...this.body(b, 'SUBSTACK2', d + 1)];
        case 'control_wait_until':
          return [I + 'await runloop.until(lambda: ' + this.cond(b, 'CONDITION') + ')'];
        case 'flippercontrol_stop':
        case 'control_stop': {
          const o = String(this.raw(b, 'STOP_OPTION') || 'all').toLowerCase();
          if (o.includes('this')) return [I + 'return'];
          if (o.includes('other')) { this.todo('"stop other stacks" has no Python equivalent'); return []; }
          return [I + 'raise SystemExit  # stop the program'];
        }
        case 'flippercontrol_stopOtherStacks':
          this.todo('"stop other stacks" has no direct Python equivalent');
          return [];

        // ---------------- events
        case 'event_broadcast': case 'event_broadcastandwait': {
          const name = this.raw(b, 'BROADCAST_INPUT') || 'message1';
          this.broadcasts.add(name);
          const lines = [I + 'broadcasts[' + JSON.stringify(name) + '] = True'];
          if (op === 'event_broadcastandwait') {
            lines.push(I + 'await runloop.until(lambda: not broadcasts[' + JSON.stringify(name) + '])');
            this.note('"broadcast and wait" here waits until the message is received, not until the receiver finishes');
          }
          return lines;
        }

        // ---------------- variables & lists
        case 'data_setvariableto': {
          const v = this.varName(b.fields.VARIABLE[1], b.fields.VARIABLE[0]);
          this.assign(v);
          return [I + v + ' = ' + E('VALUE', '0')];
        }
        case 'data_changevariableby': {
          const v = this.varName(b.fields.VARIABLE[1], b.fields.VARIABLE[0]);
          this.assign(v);
          const by = E('VALUE', '1');
          if (isNum(by) && Number(by) < 0) return [I + v + ' -= ' + fmtNum(-Number(by))];
          return [I + v + ' += ' + by];
        }
        case 'data_showvariable': case 'data_hidevariable': case 'data_showlist': case 'data_hidelist':
          return [];
        case 'data_addtolist': return [I + this.listRef(b) + '.append(' + E('ITEM', '""') + ')'];
        case 'data_deleteoflist': {
          const L = this.listRef(b), idx = this.raw(b, 'INDEX');
          if (idx === 'all') return [I + L + '.clear()'];
          if (idx === 'last') return [I + L + '.pop()'];
          return [I + 'del ' + L + '[' + this.minus1(E('INDEX', '1')) + ']'];
        }
        case 'data_deletealloflist': return [I + this.listRef(b) + '.clear()'];
        case 'data_insertatlist': return [I + this.listRef(b) + '.insert(' + this.minus1(E('INDEX', '1')) + ', ' + E('ITEM', '""') + ')'];
        case 'data_replaceitemoflist': return [I + this.listRef(b) + '[' + this.minus1(E('INDEX', '1')) + '] = ' + E('ITEM', '""')];

        // ---------------- my blocks
        case 'procedures_call': {
          const m = b.mutation || {};
          const proc = this.procs.get(m.proccode);
          if (!proc) { this.todo('Unknown My Block "' + m.proccode + '"'); return []; }
          const ids = stripJson(m.argumentids) || [];
          const args = ids.map((aid) => this.expr(b, aid, 'False'));
          return [I + 'await ' + proc.py + '(' + args.join(', ') + ')'];
        }

        // ---------------- movement (motor pair)
        case 'flippermove_setMovementPair': {
          this.flags.move = true; this.mods.add('motor_pair');
          if (this.pairPorts) return [];          // hoisted to the top of the program
          const ps = this.ports(b, 'PAIR');
          if (ps.length < 2) { this.todo('Movement motors need two ports'); ps.push('port.B'); }
          return [I + 'motor_pair.pair(' + PAIR + ', ' + ps[0] + ', ' + ps[1] + ')'];
        }
        case 'flippermove_movementSpeed':
          this.flags.move = true; this.mods.add('motor_pair');
          if (this.moveSpeedConst !== null) return [];  // written straight into each move
          this.flags.moveVar = true; this.assign('move_speed');
          return [I + 'move_speed = ' + this.pct(this.num(b, 'SPEED', '50'))];
        case 'flippermove_setDistance': {
          if (this.cmConst !== null) return [];
          this.flags.cmVar = true; this.assign('cm_per_rotation');
          const u = String(this.raw(b, 'UNIT') || 'cm').toLowerCase();
          const v = E('DISTANCE', '17.5');
          return [I + 'cm_per_rotation = ' + (u.startsWith('in') ? scale(v, 2.54, false) : v)];
        }
        case 'flippermove_move': {
          const dir = this.direction(this.raw(b, 'DIRECTION'));
          return [this.pairMove(I, this.num(b, 'VALUE', '10'), this.raw(b, 'UNIT'), dir.steer, this.moveSpeed(), dir.rev)];
        }
        case 'flippermove_steer':
          return [this.pairMove(I, this.num(b, 'VALUE', '10'), this.raw(b, 'UNIT'), this.num(b, 'STEERING', '0'), this.moveSpeed(), false)];
        case 'flippermove_startMove': {
          const dir = this.direction(this.raw(b, 'DIRECTION'));
          const v = this.moveSpeed();
          return [I + 'motor_pair.move(' + PAIR + ', ' + dir.steer + ', velocity=' + (dir.rev ? negate(v) : v) + ')'];
        }
        case 'flippermove_startSteer':
          return [I + 'motor_pair.move(' + PAIR + ', ' + this.num(b, 'STEERING', '0') + ', velocity=' + this.moveSpeed() + ')'];
        case 'flippermove_stopMove':
          this.flags.move = true; this.mods.add('motor_pair');
          return [I + 'motor_pair.stop(' + PAIR + ')'];
        case 'flippermoremove_startSteerAtSpeed':
          this.flags.move = true; this.mods.add('motor_pair');
          return [I + 'motor_pair.move(' + PAIR + ', ' + this.num(b, 'STEERING', '0') + ', velocity=' + this.pct(this.num(b, 'SPEED', '50')) + ')'];
        case 'flippermoremove_startSteerAtPower':
          this.flags.move = true; this.mods.add('motor_pair');
          this.note('power % converted to speed; Python motor_pair has no power mode');
          return [I + 'motor_pair.move(' + PAIR + ', ' + this.num(b, 'STEERING', '0') + ', velocity=' + this.pct(this.num(b, 'POWER', '50')) + ')'];
        case 'flippermoremove_startDualSpeed':
        case 'flippermoremove_startDualPower':
          this.flags.move = true; this.mods.add('motor_pair');
          if (op.endsWith('Power')) this.note('power % converted to speed; Python motor_pair has no power mode');
          return [I + 'motor_pair.move_tank(' + PAIR + ', ' + this.pct(this.num(b, 'LEFT', '50')) + ', ' + this.pct(this.num(b, 'RIGHT', '50')) + ')'];
        case 'flippermoremove_steerDistanceAtSpeed':
          return [this.pairMove(I, this.num(b, 'DISTANCE', '10'), this.raw(b, 'UNIT'), this.num(b, 'STEERING', '0'), this.pct(this.num(b, 'SPEED', '50')), false)];
        case 'flippermoremove_moveDistanceAtSpeed': {
          this.flags.move = true; this.mods.add('motor_pair');
          const l = this.pct(this.num(b, 'LEFT', '50')), r = this.pct(this.num(b, 'RIGHT', '50'));
          const unit = String(this.raw(b, 'UNIT') || 'cm').toLowerCase();
          if (unit.startsWith('sec')) return [I + 'await motor_pair.move_tank_for_time(' + PAIR + ', ' + l + ', ' + r + ', ' + scale(this.num(b, 'DISTANCE', '1'), 1000) + ')'];
          const [deg, cm] = this.moveDegrees(this.num(b, 'DISTANCE', '10'), unit);
          return [I + 'await motor_pair.move_tank_for_degrees(' + PAIR + ', ' + deg + ', ' + l + ', ' + r + ')' + (cm ? '  # ' + cm : '')];
        }
        case 'flippermoremove_movementSetStopMethod':
        case 'flippermoremove_movementSetAcceleration':
          this.note('"' + humanize(op) + '" has no global setting in Python; add stop= / acceleration= to each motor_pair call if you need it');
          return [];

        // ---------------- single motors
        case 'flippermotor_motorTurnForDirection': {
          const ccw = String(this.raw(b, 'DIRECTION') || 'clockwise').toLowerCase().startsWith('counter');
          const unit = String(this.raw(b, 'UNIT') || 'rotations').toLowerCase();
          const v = this.num(b, 'VALUE', '1');
          return this.multi(this.ports(b), d, (p) => {
            const sp = this.motorSpeed(p);
            if (unit.startsWith('sec')) return 'motor.run_for_time(' + p + ', ' + scale(v, 1000) + ', ' + (ccw ? negate(sp) : sp) + ')';
            const deg = unit.startsWith('deg') ? scale(v, 1) : scale(v, 360);
            return 'motor.run_for_degrees(' + p + ', ' + (ccw ? negate(deg) : deg) + ', ' + sp + ')';
          });
        }
        case 'flippermotor_motorStartDirection': {
          const ccw = String(this.raw(b, 'DIRECTION') || 'clockwise').toLowerCase().startsWith('counter');
          return this.ports(b).map((p) => { const sp = this.motorSpeed(p); return I + 'motor.run(' + p + ', ' + (ccw ? negate(sp) : sp) + ')'; });
        }
        case 'flippermotor_motorStop':
          this.mods.add('motor');
          return this.ports(b).map((p) => I + 'motor.stop(' + p + ')');
        case 'flippermotor_motorSetSpeed': {
          const ps = this.ports(b);
          this.mods.add('motor');
          const out = [];
          const s = this.pct(this.num(b, 'SPEED', '75'));
          for (const p of ps) {
            if (this.motorSpeedConst[p.replace('port.', '')] != null) continue; // written straight into each motor call
            this.motorVarPorts.add(p);
            out.push(I + 'motor_speeds[' + p + '] = ' + s);
          }
          return out;
        }
        case 'flippermotor_motorGoDirectionToPosition': {
          const dir = String(this.raw(b, 'DIRECTION') || 'shortest').toLowerCase();
          const path = dir.includes('counter') ? 'motor.COUNTERCLOCKWISE' : dir.includes('clock') ? 'motor.CLOCKWISE'
            : dir.includes('long') ? 'motor.LONGEST_PATH' : 'motor.SHORTEST_PATH';
          const pos = this.num(b, 'POSITION', '0');
          return this.multi(this.ports(b), d, (p) => 'motor.run_to_absolute_position(' + p + ', ' + pos + ', ' + this.motorSpeed(p) + ', direction=' + path + ')');
        }
        case 'flippermoremotor_motorStartSpeed': {
          this.mods.add('motor');
          const s = this.pct(this.num(b, 'SPEED', '75'));
          return this.ports(b).map((p) => I + 'motor.run(' + p + ', ' + s + ')');
        }
        case 'flippermoremotor_motorStartPower': {
          this.mods.add('motor');
          const pw = scale(this.num(b, 'POWER', '75'), 100);
          return this.ports(b).map((p) => I + 'motor.set_duty_cycle(' + p + ', ' + pw + ')');
        }
        case 'flippermoremotor_motorTurnForSpeed': {
          this.mods.add('motor');
          const unit = String(this.raw(b, 'UNIT') || 'rotations').toLowerCase();
          const v = this.num(b, 'VALUE', '1'), s = this.pct(this.num(b, 'SPEED', '75'));
          return this.multi(this.ports(b), d, (p) => unit.startsWith('sec')
            ? 'motor.run_for_time(' + p + ', ' + scale(v, 1000) + ', ' + s + ')'
            : 'motor.run_for_degrees(' + p + ', ' + (unit.startsWith('deg') ? scale(v, 1) : scale(v, 360)) + ', ' + s + ')');
        }
        case 'flippermoremotor_motorGoToRelativePosition': {
          this.mods.add('motor');
          const pos = this.num(b, 'POSITION', '0'), s = this.pct(this.num(b, 'SPEED', '75'));
          return this.multi(this.ports(b), d, (p) => 'motor.run_to_relative_position(' + p + ', ' + pos + ', ' + s + ')');
        }
        case 'flippermoremotor_motorSetDegreeCounted': {
          this.mods.add('motor');
          const v = this.num(b, 'VALUE', '0');
          return this.ports(b).map((p) => I + 'motor.reset_relative_position(' + p + ', ' + v + ')');
        }
        case 'flippermoremotor_motorSetStopMethod':
        case 'flippermoremotor_motorSetAcceleration':
        case 'flippermoremotor_motorSetStallDetection':
          this.note('"' + humanize(op) + '" has no global setting in Python; add stop= / acceleration= to each motor call if you need it');
          return [];

        // ---------------- light
        case 'flipperlight_lightDisplayText':
          this.hub.add('light_matrix');
          return [I + 'await light_matrix.write(' + this.strExpr(E('TEXT', '"Hello"')) + ')'];
        case 'flipperlight_lightDisplayImageOn':
          this.hub.add('light_matrix');
          return [I + 'light_matrix.show(' + this.imageExpr(b) + ')'];
        case 'flipperlight_lightDisplayImageOnForTime':
          this.hub.add('light_matrix');
          return [I + 'light_matrix.show(' + this.imageExpr(b) + ')',
            I + 'await runloop.sleep_ms(' + scale(this.num(b, 'VALUE', '2'), 1000) + ')',
            I + 'light_matrix.clear()'];
        case 'flipperlight_lightDisplayOff':
          this.hub.add('light_matrix');
          return [I + 'light_matrix.clear()'];
        case 'flipperlight_lightDisplaySetPixel':
          this.hub.add('light_matrix');
          return [I + 'light_matrix.set_pixel(' + this.minus1(this.num(b, 'X', '1')) + ', ' + this.minus1(this.num(b, 'Y', '1')) + ', ' + this.num(b, 'BRIGHTNESS', '100') + ')'];
        case 'flipperlight_centerButtonLight':
          this.hub.add('light');
          return [I + 'light.color(light.POWER, ' + this.colorExpr(b, 'COLOR') + ')'];
        case 'flipperlight_ultrasonicLightUp': {
          this.mods.add('distance_sensor');
          const v = this.raw(b, 'VALUE');
          const vals = (v || '100 100 100 100').trim().split(/\s+/).map((x) => fmtNum(Number(x) || 0));
          while (vals.length < 4) vals.push('0');
          return [I + 'distance_sensor.show(' + this.port(b) + ', [' + vals.slice(0, 4).join(', ') + '])'];
        }
        case 'flipperlight_lightDisplaySetOrientation': {
          this.hub.add('light_matrix'); this.mods.add('orientation');
          const o = String(this.raw(b, 'ORIENTATION') || '1').toLowerCase().replace(/[\s-]/g, '');
          const map = { '1': 'UP', upright: 'UP', up: 'UP', '2': 'LEFT', left: 'LEFT', '3': 'DOWN', upsidedown: 'DOWN', down: 'DOWN', '4': 'RIGHT', right: 'RIGHT' };
          return [I + 'light_matrix.set_orientation(orientation.' + (map[o] || 'UP') + ')'];
        }

        // ---------------- sound
        case 'flippersound_beepForTime':
          this.hub.add('sound');
          return [I + 'await sound.beep(' + this.noteFreq(this.num(b, 'NOTE', '60')) + ', ' + scale(this.num(b, 'DURATION', '0.2'), 1000) + ')'];
        case 'flippersound_beep':
          this.hub.add('sound');
          return [I + 'sound.beep(' + this.noteFreq(this.num(b, 'NOTE', '60')) + ', 60000)  # keeps playing until stopped'];
        case 'flippersound_stopSound':
          this.hub.add('sound');
          return [I + 'sound.stop()'];
        case 'flippermusic_playNoteForBeats':
          this.hub.add('sound'); this.flags.tempo = true;
          return [I + 'await sound.beep(' + this.noteFreq(this.num(b, 'NOTE', '60')) + ', int(' + wrap(this.num(b, 'BEATS', '0.25')) + ' * 60000 / tempo))'];
        case 'flippermusic_restForBeats':
          this.flags.tempo = true;
          return [I + 'await runloop.sleep_ms(int(' + wrap(this.num(b, 'BEATS', '0.25')) + ' * 60000 / tempo))'];
        case 'flippermusic_setTempo':
          this.flags.tempo = true; this.assign('tempo');
          return [I + 'tempo = ' + this.num(b, 'TEMPO', '60')];
        case 'flippermusic_changeTempo':
          this.flags.tempo = true; this.assign('tempo');
          return [I + 'tempo += ' + this.num(b, 'TEMPO', '20')];
        case 'sound_setvolumeto':
          this.hub.add('sound');
          return [I + 'sound.volume(' + this.num(b, 'VOLUME', '100') + ')'];
        case 'flippersound_playSound':
        case 'flippersound_playSoundUntilDone':
          this.todo('SPIKE Python can\'t play app sounds; use sound.beep() instead');
          return [];

        // ---------------- sensors (commands)
        case 'flippersensors_resetYaw':
          this.hub.add('motion_sensor');
          return [I + 'motion_sensor.reset_yaw(0)'];
        case 'flippermoresensors_setOrientation': {
          this.hub.add('motion_sensor');
          const s = String(this.raw(b, 'UP') || 'front').toLowerCase().replace(/[\s_-]/g, '');
          const map = { front: 'FRONT', back: 'BACK', top: 'TOP', up: 'TOP', bottom: 'BOTTOM', down: 'BOTTOM', left: 'LEFT', leftside: 'LEFT', right: 'RIGHT', rightside: 'RIGHT' };
          return [I + 'motion_sensor.set_yaw_face(motion_sensor.' + (map[s] || 'FRONT') + ')'];
        }
        case 'flippersensors_resetTimer':
          this.flags.timer = true; this.mods.add('time'); this.assign('timer_start');
          return [I + 'timer_start = time.ticks_ms()'];
      }

      this.todo('No Python version for the "' + humanize(op) + '" block yet');
      return [];
    }

    yieldingBody(b, name, d) {
      const lines = this.body(b, name, d);
      if (!lines.some((l) => l.t.includes('await '))) {
        const i = lines.findIndex((l) => l.t.trim() === 'pass');
        const y = { t: this.ind(d) + 'await runloop.sleep_ms(10)  # let other stacks run', id: null };
        if (i >= 0) lines[i] = y; else lines.push(y);
      }
      return lines;
    }

    pairMove(I, value, unit, steering, velocity, reverse) {
      this.flags.move = true; this.mods.add('motor_pair');
      const u = String(unit || 'cm').toLowerCase();
      if (u.startsWith('sec')) return I + 'await motor_pair.move_for_time(' + PAIR + ', ' + scale(value, 1000) + ', ' + steering + ', velocity=' + (reverse ? negate(velocity) : velocity) + ')';
      const [deg, comment] = this.moveDegrees(value, u);
      return I + 'await motor_pair.move_for_degrees(' + PAIR + ', ' + (reverse ? negate(deg) : deg) + ', ' + steering + ', velocity=' + velocity + ')' + (comment ? '  # ' + (reverse ? 'back ' : '') + comment : '');
    }

    strExpr(e) { return e.startsWith('"') || /^str\(/.test(e) ? e : 'str(' + e + ')'; }
    toStr(e) { return e.startsWith('"') && e.endsWith('"') ? e : 'str(' + e + ')'; }
    minus1(e) { return isNum(e) ? fmtNum(Number(e) - 1) : 'int(' + e + ') - 1'; }

    imageExpr(b) {
      const r = this.raw(b, 'MATRIX');
      if (r && /^\d{25}$/.test(r)) {
        const px = r.split('').map((c) => String(Math.round(Number(c) * 100 / 9)));
        return '[' + px.join(', ') + ']';
      }
      this.todo('Could not read the image on a "turn on" light block');
      return '[100] * 25';
    }

    // ---------------------------------------------------- hats / functions
    hatCondition(b) {
      const op = b.opcode;
      const E = (n, fb) => this.expr(b, n, fb);
      switch (op) {
        case 'flipperevents_whenColor':
          this.mods.add('color_sensor');
          return { name: 'when_color_' + snake(COLOR_NAMES[this.raw(b, 'OPTION')] || this.raw(b, 'OPTION') || 'color'),
            cond: 'color_sensor.color(' + this.port(b) + ') == ' + this.colorExpr(b, 'OPTION') };
        case 'flipperevents_whenPressed':
          return { name: 'when_force_' + snake(this.raw(b, 'OPTION') || 'pressed'), cond: this.forceCond(this.port(b), this.raw(b, 'OPTION')) };
        case 'flipperevents_whenDistance':
          return { name: 'when_distance', cond: this.distanceCond(this.port(b), this.raw(b, 'COMPARATOR'), this.num(b, 'VALUE', '10'), this.raw(b, 'UNIT')) };
        case 'flipperevents_whenButton':
          return { name: 'when_' + snake(this.raw(b, 'BUTTON') || 'left') + '_button_' + snake(this.raw(b, 'EVENT') || 'pressed'),
            cond: this.buttonCond(this.raw(b, 'BUTTON'), this.raw(b, 'EVENT')) };
        case 'flipperevents_whenTimer':
          this.flags.timer = true; this.mods.add('time');
          return { name: 'when_timer', cond: 'time.ticks_diff(time.ticks_ms(), timer_start) / 1000 > ' + wrap(E('VALUE', '5')) };
        case 'flipperevents_whenCondition':
          return { name: 'when_condition', cond: this.cond(b, 'CONDITION') };
        case 'flipperevents_whenOrientation':
          return { name: 'when_face_up', cond: this.faceCond(this.raw(b, 'VALUE')) };
        case 'flipperevents_whenGesture':
          return { name: 'when_' + snake(this.raw(b, 'EVENT') || 'tapped'), cond: this.gestureCond(this.raw(b, 'EVENT')) };
        case 'flipperevents_whenGreaterThan': {
          const o = String(this.raw(b, 'OPTION') || 'timer').toLowerCase();
          if (o.includes('timer')) {
            this.flags.timer = true; this.mods.add('time');
            return { name: 'when_timer', cond: 'time.ticks_diff(time.ticks_ms(), timer_start) / 1000 > ' + wrap(E('VALUE', '5')) };
          }
          this.todo('"when ' + o + ' >" has no Python equivalent on SPIKE Prime');
          return { name: 'when_' + snake(o), cond: 'False' };
        }
        case 'flipperevents_whenTilted':
          this.todo('"when tilted" was approximated with the tilt angles; check the direction');
          this.hub.add('motion_sensor');
          return { name: 'when_tilted', cond: 'max(abs(a) for a in motion_sensor.tilt_angles()[1:]) > 150' };
      }
      return null;
    }

    compileFunction(hatId, args, header, makeBody) {
      this.cur = { pending: [], assigned: new Set(), args };
      this.curId = hatId;
      const body = makeBody();
      const assigned = [...this.cur.assigned];
      const lines = [];
      if (this.explain) lines.push({ t: '# ▸ ' + this.label(hatId), id: hatId, explain: true });
      lines.push({ t: header, id: hatId });
      if (assigned.length) lines.push({ t: '    global ' + assigned.join(', '), id: hatId });
      for (const p of this.cur.pending) lines.push({ t: '    ' + p, id: hatId });
      lines.push(...body);
      this.cur = null; this.curId = null;
      return lines;
    }

    bodyFrom(next, d) {
      const ls = next ? this.stack(next, d) : [];
      if (!ls.some((l) => !l.t.trim().startsWith('#'))) ls.push({ t: this.ind(d) + 'pass', id: null });
      return ls;
    }

    convert() {
      this.collectData();
      this.analyze();
      const tops = Object.entries(this.blocks).filter(([, b]) => b.topLevel && !b.shadow);
      tops.sort((a, b) => ((a[1].y || 0) - (b[1].y || 0)) || ((a[1].x || 0) - (b[1].x || 0)));
      this.topOrder = tops.map(([id]) => id);

      // register My Blocks first so calls resolve in any order
      for (const [, b] of tops) {
        if (b.opcode !== 'procedures_definition') continue;
        const proto = this.blocks[this.input(b, 'custom_block')];
        if (!proto || !proto.mutation) continue;
        const m = proto.mutation;
        const argNames = stripJson(m.argumentnames) || [];
        const label = String(m.proccode).replace(/%[snb]/g, ' ');
        const py = this.uniq(label, 'my_block');
        const args = argNames.map((n) => this.uniq(n, 'arg'));
        this.procs.set(m.proccode, { py, args, argNames });
        b.__proc = m.proccode;
      }

      const procFuncs = [], hatFuncs = [];
      let loose = 0, starts = 0;
      this.looseIds = new Set();

      for (const [id, b] of tops) {
        const op = b.opcode;
        if (op === 'procedures_definition') {
          const proc = this.procs.get(b.__proc);
          if (!proc) continue;
          const args = new Map(proc.argNames.map((n, i) => [n, proc.args[i]]));
          procFuncs.push(this.compileFunction(id, args, 'async def ' + proc.py + '(' + proc.args.join(', ') + '):', () => this.bodyFrom(b.next, 1)));
          continue;
        }
        if (op === 'flipperevents_whenProgramStarts' || op === 'event_whenflagclicked') {
          const fn = this.compileFunction(id, null, '__HEADER__', () => this.bodyFrom(b.next, 1));
          const real = fn.filter((l) => l.t !== '__HEADER__' && !l.explain);
          // every block was moved to the top (pair / speed settings) -> no function needed
          if (real.length === 1 && real[0].t.trim() === 'pass') { this.foldedStarts = (this.foldedStarts || 0) + 1; continue; }
          starts++;
          let name = starts === 1 ? 'main' : 'main_' + starts;
          while (this.usedNames.has(name)) name += '_';
          this.usedNames.add(name);
          for (const l of fn) if (l.t === '__HEADER__') l.t = 'async def ' + name + '():';
          hatFuncs.push(fn);
          this.runList.push(name + '()');
          continue;
        }
        if (op === 'event_whenbroadcastreceived') {
          const msg = this.raw(b, 'BROADCAST_OPTION') || 'message1';
          this.broadcasts.add(msg);
          const name = this.uniq('when_i_receive_' + msg, 'on_message');
          const key = JSON.stringify(msg);
          hatFuncs.push(this.compileFunction(id, null, 'async def ' + name + '():', () => [
            { t: '    while True:', id },
            { t: '        await runloop.until(lambda: broadcasts[' + key + '])', id },
            { t: '        broadcasts[' + key + '] = False', id },
            ...this.bodyFrom(b.next, 2)]));
          this.runList.push(name + '()');
          continue;
        }
        if (HAT_OPS(op)) {
          this.cur = { pending: [], assigned: new Set() }; this.curId = id;
          const hc = this.hatCondition(b);
          const hatPending = this.cur.pending.map((t) => ({ t: '    ' + t, id }));
          this.cur = null; this.curId = null;
          if (!hc) { this.todos.push({ msg: 'The "' + humanize(op) + '" event isn\'t supported yet; its stack was skipped', id }); this.todoIds.add(id); continue; }
          const name = this.uniq(hc.name, 'when');
          hatFuncs.push(this.compileFunction(id, null, 'async def ' + name + '():', () => [
            ...hatPending,
            { t: '    while True:', id },
            { t: '        await runloop.until(lambda: ' + hc.cond + ')', id },
            ...this.bodyFrom(b.next, 2),
            { t: '        await runloop.until(lambda: not ' + wrap(hc.cond) + ')  # wait to be triggered again', id }]));
          this.runList.push(name + '()');
          continue;
        }
        loose++;
        this.looseIds.add(id);
      }
      if (loose) this.notes.push(loose + ' loose block stack' + (loose > 1 ? 's' : '') + ' (not under a "when" block) skipped, same as the SPIKE App does.');

      return this.assemble(procFuncs, hatFuncs);
    }

    assemble(procFuncs, hatFuncs) {
      const out = [];
      const add = (t, id = null) => out.push({ t, id });
      const pairBlock = Object.entries(this.blocks).find(([, b]) => b.opcode === 'flippermove_setMovementPair');

      add('# ' + this.projectName.replace(/[\r\n]/g, ' ') + ' (converted from SPIKE word blocks)');
      const hubOrder = ['port', 'light_matrix', 'sound', 'motion_sensor', 'button', 'light'];
      const usesPort = this.hub.has('port') || this.flags.move || this.motorVarPorts.size;
      const hub = hubOrder.filter((h) => this.hub.has(h) || (h === 'port' && usesPort));
      if (hub.length) add('from hub import ' + hub.join(', '));
      const modOrder = ['motor', 'motor_pair', 'color_sensor', 'distance_sensor', 'force_sensor', 'color', 'orientation', 'runloop'];
      add('import ' + modOrder.filter((m) => this.mods.has(m)).join(', '));
      const extra = ['math', 'random', 'time'].filter((m) => this.mods.has(m));
      if (extra.length) add('import ' + extra.join(', '));
      add('');

      const setup = [];
      if (this.flags.move && this.pairPorts) {
        setup.push({ t: 'motor_pair.pair(' + PAIR + ', port.' + this.pairPorts[0] + ', port.' + this.pairPorts[1] + ')' +
          (this.pairDefault ? '  # SPIKE default movement motors' : ''), id: pairBlock ? pairBlock[0] : null });
      }
      if (this.flags.moveVar) setup.push({ t: 'move_speed = ' + DEFAULT_MOVE_SPEED * SPEED_FACTOR + '  # movement speed in deg/sec (' + DEFAULT_MOVE_SPEED + '%)', id: null });
      if (this.motorVarPorts.size) setup.push({ t: 'motor_speeds = {' + [...this.motorVarPorts].sort().map((p) => p + ': ' + DEFAULT_MOTOR_SPEED * SPEED_FACTOR).join(', ') + '}  # deg/sec', id: null });
      if (this.flags.cmVar) setup.push({ t: 'cm_per_rotation = ' + DEFAULT_CM_PER_ROTATION + '  # how far the robot moves in 1 wheel rotation', id: null });
      if (this.flags.timer) setup.push({ t: 'timer_start = time.ticks_ms()', id: null });
      if (this.flags.tempo) setup.push({ t: 'tempo = 60  # beats per minute', id: null });
      if (this.broadcasts.size) setup.push({ t: 'broadcasts = {' + [...this.broadcasts].map((m) => JSON.stringify(m) + ': False').join(', ') + '}', id: null });
      for (const v of this.vars.values()) setup.push({ t: v.py + ' = ' + v.init, id: null });
      for (const l of this.lists.values()) setup.push({ t: l.py + ' = ' + l.init, id: null });
      if (setup.length) { out.push(...setup); add(''); }

      if (this.flags.noteFreq) { add('def note_freq(note):'); add('    return int(440 * 2 ** ((note - 69) / 12))'); add(''); }

      for (const f of procFuncs) { out.push(...f); add(''); }
      for (const f of hatFuncs) { out.push(...f); add(''); }

      if (this.runList.length) add('runloop.run(' + this.runList.join(', ') + ')');
      else add('# No "when program starts" or other event blocks were found.');

      const python = out.map((l) => l.t).join('\n') + '\n';
      return {
        python,
        lineIds: out.map((l) => l.id || null),
        todos: this.todos,
        todoIds: [...this.todoIds],
        notes: this.notes,
        stacks: this.blockTree(),
        stats: { blocks: this.blockCount, stacks: this.runList.length + procFuncs.length }
      };
    }

    // ---------------------------------------------------- block view model
    pretty(name, value, opcode) {
      let v = String(value);
      if (/PAIR/.test(name) || /port-selector|sensor-selector|single-motor|multiple-port/.test(opcode)) {
        const letters = v.toUpperCase().match(/[A-F]/g);
        if (letters) return letters.join('+');
      }
      if (/color-selector/.test(opcode) || ((name === 'OPTION' || name === 'COLOR' || name === 'VALUE') && COLOR_NAMES[v] && /Color|color|centerButton/.test(opcode))) {
        return COLOR_NAMES[v] ? COLOR_NAMES[v].toLowerCase() : v;
      }
      if (/rotation-wheel|custom-angle/.test(opcode)) { const n = numIn(v); return n !== null ? n : v; }
      if (/matrix-5x5|matrix-3x3|color-matrix/.test(opcode)) return '▦';
      if (/sound-selector/.test(opcode)) { try { return JSON.parse(v).name || v; } catch (e) { return v; } }
      return v;
    }

    inputPart(b, name) {
      if (b.fields && b.fields[name]) {
        const f = b.fields[name];
        if (name === 'VARIABLE' || name === 'LIST' || name === 'BROADCAST_OPTION') return { k: 'menu', v: String(f[0]) };
        return { k: 'menu', v: this.pretty(name, f[0], b.opcode) };
      }
      const inp = b.inputs && b.inputs[name];
      if (!inp) return { k: 'empty', v: '' };
      const v = inp[1];
      if (v == null) return { k: BOOL_OPS.test(b.opcode) || name.startsWith('CONDITION') || name.startsWith('OPERAND') ? 'bool' : 'empty', v: '' };
      if (Array.isArray(v)) {
        if (v[0] === 12) return { k: 'node', node: { id: v[2], cat: 'variables', shape: 'reporter', parts: [v[1]] } };
        if (v[0] === 13) return { k: 'node', node: { id: v[2], cat: 'lists', shape: 'reporter', parts: [v[1]] } };
        if (v[0] === 11) return { k: 'menu', v: String(v[1]) };
        return { k: v[0] === 10 ? 'text' : 'num', v: String(v[1] ?? '') };
      }
      const sb = this.blocks[v];
      if (!sb) return { k: 'empty', v: '' };
      if (sb.shadow) {
        const f = Object.entries(sb.fields || {});
        if (!f.length) return { k: 'empty', v: '' };
        return { k: 'menu', v: this.pretty(f[0][0], f[0][1][0], sb.opcode) };
      }
      return { k: 'node', node: this.node(v, true) };
    }

    node(id, asReporter = false) {
      const b = this.blocks[id];
      if (!b) return null;
      const op = b.opcode;
      const cat = catOf(op);
      let shape = HAT_OPS(op) ? 'hat' : C_OPS.has(op) ? 'c' : 'stack';
      if (asReporter) shape = BOOL_OPS.test(op) ? 'boolean' : 'reporter';
      const parts = [];
      if (op === 'procedures_definition') {
        const proto = this.blocks[this.input(b, 'custom_block')];
        const m = (proto && proto.mutation) || {};
        const names = stripJson(m.argumentnames) || [];
        let i = 0;
        parts.push('define');
        for (const piece of String(m.proccode || 'my block').split(/(%[snb])/)) {
          if (/^%[snb]$/.test(piece)) parts.push({ k: 'node', node: { id: null, cat: 'myblocks', shape: piece === '%b' ? 'boolean' : 'reporter', parts: [names[i++] || ''] } });
          else if (piece.trim()) parts.push(piece.trim());
        }
      } else if (op === 'procedures_call') {
        const m = b.mutation || {};
        const ids = stripJson(m.argumentids) || [];
        let i = 0;
        for (const piece of String(m.proccode || 'my block').split(/(%[snb])/)) {
          if (/^%[snb]$/.test(piece)) parts.push(this.inputPart(b, ids[i++]));
          else if (piece.trim()) parts.push(piece.trim());
        }
      } else if (op === 'argument_reporter_string_number' || op === 'argument_reporter_boolean') {
        parts.push(String(b.fields.VALUE[0]));
      } else {
        const tpl = TPL[op];
        if (!tpl) parts.push(humanize(op), ...Object.keys(b.inputs || {}).filter((n) => !/^SUBSTACK/.test(n)).map((n) => this.inputPart(b, n)));
        else for (const piece of tpl.split(/(\{[A-Za-z_0-9]+\})/)) {
          const m = piece.match(/^\{(\w+)\}$/);
          if (m) parts.push(this.inputPart(b, m[1]));
          else if (piece.trim()) parts.push(piece.trim());
        }
      }
      const n = { id, op, cat, shape, parts, todo: this.todoIds.has(id) };
      if (C_OPS.has(op)) {
        n.sub = this.chain(this.input(b, 'SUBSTACK'));
        if (op === 'control_if_else') n.sub2 = this.chain(this.input(b, 'SUBSTACK2'));
        n.cap = op === 'control_forever';
      }
      return n;
    }

    chain(id) {
      const out = [];
      let cur = id && !Array.isArray(id) ? id : null;
      while (cur) {
        const b = this.blocks[cur];
        if (!b) break;
        if (!b.shadow) out.push(this.node(cur));
        cur = b.next;
      }
      return out;
    }

    blockTree() {
      return (this.topOrder || []).map((id) => ({ blocks: this.chain(id), loose: this.looseIds && this.looseIds.has(id) }));
    }

    // plain-text version of a block (for explain comments)
    label(id) {
      const n = this.node(id);
      const flat = (node) => (node.parts || []).map((p) => {
        if (typeof p === 'string') return p;
        if (p.k === 'node' && p.node) return '(' + flat(p.node) + ')';
        if (p.k === 'bool' || p.k === 'empty') return '( )';
        return p.v;
      }).join(' ');
      return n ? flat(n).replace(/\s+/g, ' ').trim() : '';
    }
  }

  // ------------------------------------------------------------- file I/O
  async function readProject(data, fileName, JSZipLib) {
    const JSZ = JSZipLib || (typeof JSZip !== 'undefined' ? JSZip : null);
    if (!JSZ) throw new Error('JSZip is not loaded');
    let zip;
    try { zip = await JSZ.loadAsync(data); } catch (e) {
      throw new Error('That file isn\'t a SPIKE project (could not open it as a .llsp3 file).');
    }
    let manifest = {};
    if (zip.file('manifest.json')) { try { manifest = JSON.parse(await zip.file('manifest.json').async('string')); } catch (e) { manifest = {}; } }
    const name = manifest.name || String(fileName || 'SPIKE project').replace(/\.[^.]+$/, '');

    if (manifest.type === 'python' && zip.file('projectbody.json')) {
      const body = JSON.parse(await zip.file('projectbody.json').async('string'));
      return { name, python: body.main || '', alreadyPython: true };
    }
    let projectText = null;
    if (zip.file('scratch.sb3')) {
      const inner = await JSZ.loadAsync(await zip.file('scratch.sb3').async('uint8array'));
      if (inner.file('project.json')) projectText = await inner.file('project.json').async('string');
    } else if (zip.file('project.json')) {
      projectText = await zip.file('project.json').async('string');
    }
    if (!projectText) throw new Error('No block code found inside this file.');
    return { name, project: JSON.parse(projectText) };
  }

  function convertProject(project, opts) { return new Converter(project, opts).convert(); }

  // Build a SPIKE App 3 Python project file (.llsp3) holding the given code.
  // Same layout the SPIKE App saves: manifest.json + projectbody.json + icon.svg
  async function makePythonProject(code, name, JSZipLib) {
    const JSZ = JSZipLib || (typeof JSZip !== 'undefined' ? JSZip : null);
    const now = new Date().toISOString();
    const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let pid = '';
    for (let i = 0; i < 12; i++) pid += abc[Math.floor(Math.random() * abc.length)];
    const body = JSON.stringify({ main: code });
    const icon = '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60"><rect width="60" height="60" rx="8" fill="#ffcd1f"/>' +
      '<text x="30" y="38" font-family="monospace" font-size="20" font-weight="bold" text-anchor="middle" fill="#1c1b18">py</text></svg>';
    const manifest = {
      type: 'python', appType: 'llsp3', autoDelete: false, created: now, id: pid, lastsaved: now,
      size: body.length + icon.length, name: (name || 'Converted program') + ' (Python)', slotIndex: 0,
      workspaceX: 0, workspaceY: 0, zoomLevel: 0.5, hardware: {},
      state: { canvasDrawerOpen: false, playMode: 'download', hasMonitors: false },
      extraFiles: [], lastConnectedHubType: 'flipper'
    };
    const zip = new JSZ();
    zip.file('manifest.json', JSON.stringify(manifest));
    zip.file('projectbody.json', body);
    zip.file('icon.svg', icon);
    return zip.generateAsync({ type: typeof window !== 'undefined' ? 'blob' : 'nodebuffer', compression: 'DEFLATE' });
  }

  async function convertFile(data, fileName, JSZipLib, opts = {}) {
    const p = await readProject(data, fileName, JSZipLib);
    if (p.alreadyPython) {
      return { name: p.name, python: p.python, alreadyPython: true, todos: [], todoIds: [], notes: ['This file is already a Python project, so here is its code as-is.'], lineIds: [], stacks: [], stats: { blocks: 0, stacks: 0 } };
    }
    const res = convertProject(p.project, Object.assign({ name: p.name }, opts));
    res.name = p.name;
    res.project = p.project;
    return res;
  }

  const api = { Converter, convertFile, convertProject, readProject, makePythonProject, CATS, SPEED_FACTOR };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpikeConverter = api;
})(typeof window !== 'undefined' ? window : globalThis);
