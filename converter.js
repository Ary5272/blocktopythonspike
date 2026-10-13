/*
 * SPIKE 3 Blocks -> Python converter
 * Reads a LEGO SPIKE App 3 word-block project (.llsp3) and produces
 * SPIKE 3 MicroPython (hub / motor / motor_pair / runloop API).
 *
 * Works in the browser (window.SpikeConverter) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- settings
  const SPEED_FACTOR = 10;          // block speed % -> deg/sec  (100% ~ 1000 deg/s)
  const DEFAULT_MOVE_SPEED = 50;    // SPIKE default "movement speed" %
  const DEFAULT_MOTOR_SPEED = 75;   // SPIKE default single-motor speed %
  const DEFAULT_CM_PER_ROTATION = 17.5; // standard 56mm SPIKE wheel
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
    'broadcasts', 'move_speed', 'motor_speeds', 'cm_per_rotation', 'timer_start', 'tempo', 'note_freq']);

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
    if (s.trim() !== '' && !isNaN(Number(s)) && /^\s*-?(\d+\.?\d*|\.\d+)\s*$/.test(s)) return fmtNum(Number(s));
    return JSON.stringify(s);
  }

  const wrap = (e) => (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(e) || isNum(e) ? e : '(' + e + ')');

  // multiply an expression by k; folds constants
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

  // ------------------------------------------------------------- converter
  class Converter {
    constructor(project, opts = {}) {
      this.project = project;
      this.projectName = opts.name || 'SPIKE project';
      this.blocks = {};
      this.comments = {};
      for (const t of project.targets || []) {
        Object.assign(this.blocks, t.blocks || {});
        Object.assign(this.comments, t.comments || {});
      }
      this.usedNames = new Set();
      this.vars = new Map();   // id -> {py, init}
      this.varByName = new Map();
      this.lists = new Map();
      this.listByName = new Map();
      this.procs = new Map();  // proccode -> {py, args:[py], argNames:[name]}
      this.hub = new Set();
      this.mods = new Set(['runloop']);
      this.flags = { move: false, setPair: false, moveSpeed: false, cm: false, timer: false, tempo: false, noteFreq: false };
      this.motorPorts = new Set();
      this.broadcasts = new Set();
      this.todos = [];
      this.notes = [];
      this.funcs = [];
      this.runList = [];
      this.cur = null;   // current function context
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

    // plain dropdown / literal text, or null when a reporter is plugged in
    raw(b, name) {
      if (b.fields && b.fields[name]) return String(b.fields[name][0]);
      const v = this.input(b, name);
      if (v == null) return null;
      if (Array.isArray(v)) return v[1] == null ? '' : String(v[1]);
      const sb = this.blocks[v];
      if (sb && sb.shadow) {
        const f = Object.values(sb.fields || {});
        if (f.length) return String(f[0][0]);
      }
      return null;
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
      return this.reporter(sb, v);
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
      if (!letters) { this.todo('Could not read the port on a "' + b.opcode + '" block, used port A'); return ['port.A']; }
      return [...new Set(letters)].map((l) => 'port.' + l);
    }
    port(b, name = 'PORT') { return this.ports(b, name)[0]; }

    todo(msg) { this.todos.push(msg); if (this.cur) this.cur.pending.push('# TODO: ' + msg); }
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

    moveSpeed() { this.flags.moveSpeed = true; this.flags.move = true; this.mods.add('motor_pair'); return 'move_speed'; }
    motorSpeed(p) { this.motorPorts.add(p); this.mods.add('motor'); return 'motor_speeds[' + p + ']'; }
    pct(e) { return scale(e, SPEED_FACTOR); }

    // degrees for a movement distance with a unit
    moveDegrees(valueExpr, unit) {
      unit = String(unit || 'cm').toLowerCase();
      if (unit.startsWith('rot')) return scale(valueExpr, 360);
      if (unit.startsWith('deg')) return scale(valueExpr, 1);
      this.flags.cm = true;
      if (unit.startsWith('in')) return 'int(' + wrap(valueExpr) + ' * 2.54 / cm_per_rotation * 360)';
      return 'int(' + wrap(valueExpr) + ' / cm_per_rotation * 360)';
    }

    noteFreq(e) {
      if (isNum(e)) return fmtNum(Math.round(440 * Math.pow(2, (Number(e) - 69) / 12)));
      this.flags.noteFreq = true;
      return 'note_freq(' + e + ')';
    }

    // ---------------------------------------------------- reporters
    reporter(b, id) {
      const op = b.opcode;
      if (b.shadow) {
        const f = Object.values(b.fields || {});
        if (!f.length) return '0';
        const val = f[0][0];
        if (op.includes('color-selector')) return this.colorConst(val);
        if (op === 'flippersound_custom-piano') return lit(val);
        return lit(val);
      }
      const E = (n, fb) => this.expr(b, n, fb);
      switch (op) {
        // operators
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
          this.mods.add('math');
          const map = {
            abs: 'abs(' + x + ')', floor: 'math.floor(' + x + ')', ceiling: 'math.ceil(' + x + ')',
            sqrt: 'math.sqrt(' + x + ')', sin: 'math.sin(math.radians(' + x + '))', cos: 'math.cos(math.radians(' + x + '))',
            tan: 'math.tan(math.radians(' + x + '))', asin: 'math.degrees(math.asin(' + x + '))',
            acos: 'math.degrees(math.acos(' + x + '))', atan: 'math.degrees(math.atan(' + x + '))',
            ln: 'math.log(' + x + ')', log: 'math.log(' + x + ', 10)', 'e ^': 'math.exp(' + x + ')', '10 ^': '10 ** ' + wrap(x)
          };
          return map[fn] || 'abs(' + x + ')';
        }
        case 'flipperoperator_isInBetween':
          return wrap(E('LOW')) + ' <= ' + wrap(E('VALUE')) + ' <= ' + wrap(E('HIGH'));

        // data
        case 'data_variable': return this.varName(b.fields.VARIABLE[1], b.fields.VARIABLE[0]);
        case 'data_listcontents': return '" ".join(str(i) for i in ' + this.listName(b.fields.LIST[1], b.fields.LIST[0]) + ')';
        case 'data_itemoflist': return this.listRef(b) + '[' + scale(E('INDEX', '1'), 1) + ' - 1]';
        case 'data_itemnumoflist': { const L = this.listRef(b), it = E('ITEM', '""'); return '(' + L + '.index(' + it + ') + 1 if ' + it + ' in ' + L + ' else 0)'; }
        case 'data_lengthoflist': return 'len(' + this.listRef(b) + ')';
        case 'data_listcontainsitem': return E('ITEM', '""') + ' in ' + this.listRef(b);

        // my-block arguments
        case 'argument_reporter_string_number':
        case 'argument_reporter_boolean': {
          const name = b.fields.VALUE[0];
          if (this.cur && this.cur.args && this.cur.args.has(name)) return this.cur.args.get(name);
          this.todo('My Block input "' + name + '" used outside its define block');
          return '0';
        }

        // sensors
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

        // motors
        case 'flippermotor_absolutePosition': this.mods.add('motor'); return 'motor.absolute_position(' + this.port(b) + ')';
        case 'flippermoremotor_position': this.mods.add('motor'); return 'motor.relative_position(' + this.port(b) + ')';
        case 'flippermotor_speed': this.mods.add('motor'); return 'int(motor.velocity(' + this.port(b) + ') / ' + SPEED_FACTOR + ')';

        // music
        case 'flippermusic_getTempo': this.flags.tempo = true; return 'tempo';
      }
      this.todo('No Python version for reporter block "' + op + '" yet (used 0)');
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

    distanceCond(p, comparator, value, unit) {
      this.mods.add('distance_sensor');
      const op = this.cmp(comparator);
      // distance() returns -1 when nothing is in range
      return '0 <= ' + this.distanceExpr(p, unit) + ' ' + op + ' ' + wrap(value);
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
      return released ? 'button.pressed(' + B + ') == 0' : 'button.pressed(' + B + ') > 0';
    }

    tiltExpr(axis) {
      this.hub.add('motion_sensor');
      const a = String(axis || 'yaw').toLowerCase();
      // tilt_angles() -> (yaw, pitch, roll) in tenths of a degree.
      // Python yaw counts the opposite way to the block, so it is flipped here.
      if (a.startsWith('p')) return 'motion_sensor.tilt_angles()[1] / 10';
      if (a.startsWith('r')) return 'motion_sensor.tilt_angles()[2] / 10';
      return '-motion_sensor.tilt_angles()[0] / 10';
    }

    axisIdx(a) { a = String(a || 'x').toLowerCase(); return a.startsWith('y') ? 1 : a.startsWith('z') ? 2 : 0; }

    faceCond(v) {
      this.hub.add('motion_sensor');
      const s = String(v || 'up').toLowerCase();
      const map = { front: 'FRONT', back: 'BACK', up: 'TOP', top: 'TOP', down: 'BOTTOM', bottom: 'BOTTOM',
        leftside: 'LEFT', left: 'LEFT', rightside: 'RIGHT', right: 'RIGHT' };
      const k = Object.keys(map).find((x) => s.replace(/[\s_-]/g, '') === x) || 'up';
      return 'motion_sensor.up_face() == motion_sensor.' + map[k];
    }

    gestureCond(v) {
      this.hub.add('motion_sensor');
      const s = String(v || 'tapped').toLowerCase().replace(/[\s_-]/g, '');
      const map = { tapped: 'TAPPED', doubletapped: 'DOUBLE_TAPPED', shake: 'SHAKE', shaken: 'SHAKE', freefall: 'FREEFALL', falling: 'FREEFALL' };
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
      if (!lines.some((l) => !l.trim().startsWith('#'))) lines.push(this.ind(depth) + 'pass');
      return lines;
    }

    ind(d) { return '    '.repeat(d); }

    statement(b, id, d) {
      if (b.shadow) return [];
      this.cur.pending = [];
      const out = this.stmtLines(b, id, d) || [];
      const pre = [];
      const c = Object.values(this.comments).find((cm) => cm.blockId === id);
      if (c && c.text) for (const t of String(c.text).split('\n')) pre.push(this.ind(d) + '# ' + t);
      for (const p of this.cur.pending) pre.push(this.ind(d) + p);
      this.cur.pending = [];
      return pre.concat(out);
    }

    // fires each command once per port; the last one is awaited
    multi(ports, d, make) {
      return ports.map((p, i) => this.ind(d) + (i === ports.length - 1 ? 'await ' : '') + make(p));
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
          this.mods.add('sys');
          return [I + 'raise SystemExit  # stop program'];
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
          return [I + v + ' += ' + E('VALUE', '1')];
        }
        case 'data_showvariable': case 'data_hidevariable': case 'data_showlist': case 'data_hidelist':
          return [];
        case 'data_addtolist': return [I + this.listRef(b) + '.append(' + E('ITEM', '""') + ')'];
        case 'data_deleteoflist': {
          const L = this.listRef(b), idx = this.raw(b, 'INDEX');
          if (idx === 'all') return [I + L + '.clear()'];
          if (idx === 'last') return [I + L + '.pop()'];
          return [I + 'del ' + L + '[' + scale(E('INDEX', '1'), 1) + ' - 1]'];
        }
        case 'data_deletealloflist': return [I + this.listRef(b) + '.clear()'];
        case 'data_insertatlist': return [I + this.listRef(b) + '.insert(' + scale(E('INDEX', '1'), 1) + ' - 1, ' + E('ITEM', '""') + ')'];
        case 'data_replaceitemoflist': return [I + this.listRef(b) + '[' + scale(E('INDEX', '1'), 1) + ' - 1] = ' + E('ITEM', '""')];

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
          const ps = this.ports(b, 'PAIR');
          this.flags.setPair = true; this.flags.move = true; this.mods.add('motor_pair');
          if (ps.length < 2) { this.todo('Movement motors need two ports'); ps.push('port.B'); }
          return [I + 'motor_pair.pair(' + PAIR + ', ' + ps[0] + ', ' + ps[1] + ')'];
        }
        case 'flippermove_movementSpeed':
          this.moveSpeed(); this.assign('move_speed');
          return [I + 'move_speed = ' + this.pct(E('SPEED', '50'))];
        case 'flippermove_setDistance': {
          this.flags.cm = true; this.assign('cm_per_rotation');
          const u = String(this.raw(b, 'UNIT') || 'cm').toLowerCase();
          const v = E('DISTANCE', '17.5');
          return [I + 'cm_per_rotation = ' + (u.startsWith('in') ? scale(v, 2.54, false) : v)];
        }
        case 'flippermove_move': {
          const dir = String(this.raw(b, 'DIRECTION') || 'forward').toLowerCase();
          const steer = dir.startsWith('counter') ? -100 : dir.startsWith('clock') ? 100 : 0;
          const vel = dir.startsWith('back') ? '-' + this.moveSpeed() : this.moveSpeed();
          return [this.pairMove(I, E('VALUE', '10'), this.raw(b, 'UNIT'), String(steer), vel)];
        }
        case 'flippermove_steer':
          return [this.pairMove(I, E('VALUE', '10'), this.raw(b, 'UNIT'), E('STEERING', '0'), this.moveSpeed())];
        case 'flippermove_startMove': {
          const dir = String(this.raw(b, 'DIRECTION') || 'forward').toLowerCase();
          const steer = dir.startsWith('counter') ? -100 : dir.startsWith('clock') ? 100 : 0;
          const vel = dir.startsWith('back') ? '-' + this.moveSpeed() : this.moveSpeed();
          return [I + 'motor_pair.move(' + PAIR + ', ' + steer + ', velocity=' + vel + ')'];
        }
        case 'flippermove_startSteer':
          return [I + 'motor_pair.move(' + PAIR + ', ' + E('STEERING', '0') + ', velocity=' + this.moveSpeed() + ')'];
        case 'flippermove_stopMove':
          this.flags.move = true; this.mods.add('motor_pair');
          return [I + 'motor_pair.stop(' + PAIR + ')'];
        case 'flippermoremove_startSteerAtSpeed':
          this.flags.move = true; this.mods.add('motor_pair');
          return [I + 'motor_pair.move(' + PAIR + ', ' + E('STEERING', '0') + ', velocity=' + this.pct(E('SPEED', '50')) + ')'];
        case 'flippermoremove_startSteerAtPower':
          this.flags.move = true; this.mods.add('motor_pair');
          this.note('power % converted to speed; Python motor_pair has no power mode');
          return [I + 'motor_pair.move(' + PAIR + ', ' + E('STEERING', '0') + ', velocity=' + this.pct(E('POWER', '50')) + ')'];
        case 'flippermoremove_startDualSpeed':
        case 'flippermoremove_startDualPower':
          this.flags.move = true; this.mods.add('motor_pair');
          if (op.endsWith('Power')) this.note('power % converted to speed; Python motor_pair has no power mode');
          return [I + 'motor_pair.move_tank(' + PAIR + ', ' + this.pct(E('LEFT', '50')) + ', ' + this.pct(E('RIGHT', '50')) + ')'];
        case 'flippermoremove_steerDistanceAtSpeed':
          this.flags.move = true; this.mods.add('motor_pair');
          return [this.pairMove(I, E('DISTANCE', '10'), this.raw(b, 'UNIT'), E('STEERING', '0'), this.pct(E('SPEED', '50')))];
        case 'flippermoremove_moveDistanceAtSpeed': {
          this.flags.move = true; this.mods.add('motor_pair');
          const l = this.pct(E('LEFT', '50')), r = this.pct(E('RIGHT', '50'));
          const unit = String(this.raw(b, 'UNIT') || 'cm').toLowerCase();
          if (unit.startsWith('sec')) return [I + 'await motor_pair.move_tank_for_time(' + PAIR + ', ' + l + ', ' + r + ', ' + scale(E('DISTANCE', '1'), 1000) + ')'];
          return [I + 'await motor_pair.move_tank_for_degrees(' + PAIR + ', ' + this.moveDegrees(E('DISTANCE', '10'), unit) + ', ' + l + ', ' + r + ')'];
        }
        case 'flippermoremove_movementSetStopMethod':
        case 'flippermoremove_movementSetAcceleration':
          this.note('"' + op.split('_')[1] + '" has no global setting in Python; pass stop=/acceleration= to each motor_pair call instead');
          return [];

        // ---------------- single motors
        case 'flippermotor_motorTurnForDirection': {
          const dir = String(this.raw(b, 'DIRECTION') || 'clockwise').toLowerCase();
          const unit = String(this.raw(b, 'UNIT') || 'rotations').toLowerCase();
          const v = E('VALUE', '1');
          return this.multi(this.ports(b), d, (p) => {
            const sp = dir.startsWith('counter') ? '-' + this.motorSpeed(p) : this.motorSpeed(p);
            if (unit.startsWith('sec')) return 'motor.run_for_time(' + p + ', ' + scale(v, 1000) + ', ' + sp + ')';
            return 'motor.run_for_degrees(' + p + ', ' + (unit.startsWith('deg') ? scale(v, 1) : scale(v, 360)) + ', ' + sp + ')';
          });
        }
        case 'flippermotor_motorStartDirection': {
          const dir = String(this.raw(b, 'DIRECTION') || 'clockwise').toLowerCase();
          return this.ports(b).map((p) => I + 'motor.run(' + p + ', ' + (dir.startsWith('counter') ? '-' : '') + this.motorSpeed(p) + ')');
        }
        case 'flippermotor_motorStop':
          this.mods.add('motor');
          return this.ports(b).map((p) => I + 'motor.stop(' + p + ')');
        case 'flippermotor_motorSetSpeed': {
          const s = this.pct(E('SPEED', '75'));
          return this.ports(b).map((p) => I + this.motorSpeed(p) + ' = ' + s);
        }
        case 'flippermotor_motorGoDirectionToPosition': {
          const dir = String(this.raw(b, 'DIRECTION') || 'shortest').toLowerCase();
          const path = dir.includes('counter') ? 'motor.COUNTERCLOCKWISE' : dir.includes('clock') ? 'motor.CLOCKWISE'
            : dir.includes('long') ? 'motor.LONGEST_PATH' : 'motor.SHORTEST_PATH';
          const pos = E('POSITION', '0');
          return this.multi(this.ports(b), d, (p) => 'motor.run_to_absolute_position(' + p + ', ' + pos + ', ' + this.motorSpeed(p) + ', direction=' + path + ')');
        }
        case 'flippermoremotor_motorStartSpeed': {
          this.mods.add('motor');
          const s = this.pct(E('SPEED', '75'));
          return this.ports(b).map((p) => I + 'motor.run(' + p + ', ' + s + ')');
        }
        case 'flippermoremotor_motorStartPower': {
          this.mods.add('motor');
          const pw = scale(E('POWER', '75'), 100);
          return this.ports(b).map((p) => I + 'motor.set_duty_cycle(' + p + ', ' + pw + ')');
        }
        case 'flippermoremotor_motorTurnForSpeed': {
          this.mods.add('motor');
          const unit = String(this.raw(b, 'UNIT') || 'rotations').toLowerCase();
          const v = E('VALUE', '1'), s = this.pct(E('SPEED', '75'));
          return this.multi(this.ports(b), d, (p) => unit.startsWith('sec')
            ? 'motor.run_for_time(' + p + ', ' + scale(v, 1000) + ', ' + s + ')'
            : 'motor.run_for_degrees(' + p + ', ' + (unit.startsWith('deg') ? scale(v, 1) : scale(v, 360)) + ', ' + s + ')');
        }
        case 'flippermoremotor_motorGoToRelativePosition': {
          this.mods.add('motor');
          const pos = E('POSITION', '0'), s = this.pct(E('SPEED', '75'));
          return this.multi(this.ports(b), d, (p) => 'motor.run_to_relative_position(' + p + ', ' + pos + ', ' + s + ')');
        }
        case 'flippermoremotor_motorSetDegreeCounted': {
          this.mods.add('motor');
          const v = E('VALUE', '0');
          return this.ports(b).map((p) => I + 'motor.reset_relative_position(' + p + ', ' + v + ')');
        }
        case 'flippermoremotor_motorSetStopMethod':
        case 'flippermoremotor_motorSetAcceleration':
        case 'flippermoremotor_motorSetStallDetection':
          this.note('"' + op.split('_')[1] + '" has no global setting in Python; pass stop=/acceleration= to each motor call instead');
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
            I + 'await runloop.sleep_ms(' + scale(E('VALUE', '2'), 1000) + ')',
            I + 'light_matrix.clear()'];
        case 'flipperlight_lightDisplayOff':
          this.hub.add('light_matrix');
          return [I + 'light_matrix.clear()'];
        case 'flipperlight_lightDisplaySetPixel': {
          this.hub.add('light_matrix');
          return [I + 'light_matrix.set_pixel(' + this.minus1(E('X', '1')) + ', ' + this.minus1(E('Y', '1')) + ', ' + E('BRIGHTNESS', '100') + ')'];
        }
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
          this.hub.add('light_matrix');
          const o = String(this.raw(b, 'ORIENTATION') || '1').toLowerCase();
          const map = { '1': 'ORIENTATION_UPRIGHT', upright: 'ORIENTATION_UPRIGHT', '2': 'ORIENTATION_LEFT', left: 'ORIENTATION_LEFT',
            '3': 'ORIENTATION_UPSIDEDOWN', upsidedown: 'ORIENTATION_UPSIDEDOWN', '4': 'ORIENTATION_RIGHT', right: 'ORIENTATION_RIGHT' };
          return [I + 'light_matrix.set_orientation(light_matrix.' + (map[o.replace(/[\s-]/g, '')] || 'ORIENTATION_UPRIGHT') + ')'];
        }

        // ---------------- sound
        case 'flippersound_beepForTime':
          this.hub.add('sound');
          return [I + 'await sound.beep(' + this.noteFreq(E('NOTE', '60')) + ', ' + scale(E('DURATION', '0.2'), 1000) + ', 100)'];
        case 'flippersound_beep':
          this.hub.add('sound');
          return [I + 'sound.beep(' + this.noteFreq(E('NOTE', '60')) + ', 60000, 100)  # keeps playing until stopped'];
        case 'flippersound_stopSound':
          this.hub.add('sound');
          return [I + 'sound.stop()'];
        case 'flippermusic_playNoteForBeats':
          this.hub.add('sound'); this.flags.tempo = true;
          return [I + 'await sound.beep(' + this.noteFreq(E('NOTE', '60')) + ', int(' + wrap(E('BEATS', '0.25')) + ' * 60000 / tempo), 100)'];
        case 'flippermusic_restForBeats':
          this.flags.tempo = true;
          return [I + 'await runloop.sleep_ms(int(' + wrap(E('BEATS', '0.25')) + ' * 60000 / tempo))'];
        case 'flippermusic_setTempo':
          this.flags.tempo = true; this.assign('tempo');
          return [I + 'tempo = ' + E('TEMPO', '60')];
        case 'flippermusic_changeTempo':
          this.flags.tempo = true; this.assign('tempo');
          return [I + 'tempo += ' + E('TEMPO', '20')];
        case 'sound_setvolumeto':
          this.hub.add('sound');
          return [I + 'sound.volume(' + E('VOLUME', '100') + ')'];

        // ---------------- sensors (commands)
        case 'flippersensors_resetYaw':
          this.hub.add('motion_sensor');
          return [I + 'motion_sensor.reset_yaw(0)'];
        case 'flippersensors_resetTimer':
          this.flags.timer = true; this.mods.add('time'); this.assign('timer_start');
          return [I + 'timer_start = time.ticks_ms()'];
      }

      this.todo('No Python version for block "' + op + '" yet');
      return [];
    }

    yieldingBody(b, name, d) {
      const lines = this.body(b, name, d);
      if (!lines.some((l) => l.includes('await '))) {
        const i = lines.findIndex((l) => l.trim() === 'pass');
        const y = this.ind(d) + 'await runloop.sleep_ms(10)  # let other stacks run';
        if (i >= 0) lines[i] = y; else lines.push(y);
      }
      return lines;
    }

    pairMove(I, value, unit, steering, velocity) {
      this.flags.move = true; this.mods.add('motor_pair');
      const u = String(unit || 'cm').toLowerCase();
      if (u.startsWith('sec')) return I + 'await motor_pair.move_for_time(' + PAIR + ', ' + scale(value, 1000) + ', ' + steering + ', velocity=' + velocity + ')';
      return I + 'await motor_pair.move_for_degrees(' + PAIR + ', ' + this.moveDegrees(value, u) + ', ' + steering + ', velocity=' + velocity + ')';
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
          return { name: 'when_distance', cond: this.distanceCond(this.port(b), this.raw(b, 'COMPARATOR'), E('VALUE', '10'), this.raw(b, 'UNIT')) };
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

    compileFunction(name, hatBlock, makeHeader, wrapBody) {
      this.cur = { pending: [], assigned: new Set(), args: hatBlock.__args || null };
      const result = wrapBody();
      const assigned = [...this.cur.assigned];
      const lines = [makeHeader()];
      if (assigned.length) lines.push('    global ' + assigned.join(', '));
      lines.push(...result);
      this.cur = null;
      return lines.join('\n');
    }

    convert() {
      this.collectData();
      const tops = Object.entries(this.blocks).filter(([, b]) => b.topLevel && !b.shadow);
      tops.sort((a, b) => ((a[1].y || 0) - (b[1].y || 0)) || ((a[1].x || 0) - (b[1].x || 0)));

      // register My Blocks first so calls resolve in any order
      for (const [, b] of tops) {
        if (b.opcode !== 'procedures_definition') continue;
        const protoId = this.input(b, 'custom_block');
        const proto = this.blocks[protoId];
        if (!proto || !proto.mutation) continue;
        const m = proto.mutation;
        const argNames = stripJson(m.argumentnames) || [];
        const label = String(m.proccode).replace(/%[snb]/g, ' ');
        const py = this.uniq(label, 'my_block');
        const args = argNames.map((n) => this.uniq(n, 'arg'));
        this.procs.set(m.proccode, { py, args, argNames });
        b.__proc = m.proccode;
      }

      let starts = 0;
      const procFuncs = [], hatFuncs = [];
      let loose = 0;

      for (const [id, b] of tops) {
        const op = b.opcode;
        if (op === 'procedures_definition') {
          const proc = this.procs.get(b.__proc);
          if (!proc) continue;
          b.__args = new Map(proc.argNames.map((n, i) => [n, proc.args[i]]));
          procFuncs.push(this.compileFunction(proc.py, b,
            () => 'async def ' + proc.py + '(' + proc.args.join(', ') + '):',
            () => { const ls = this.stack(b.next, 1); if (!ls.some((l) => !l.trim().startsWith('#'))) ls.push('    pass'); return ls; }));
          continue;
        }
        if (op === 'flipperevents_whenProgramStarts' || op === 'event_whenflagclicked') {
          const name = this.uniq(starts++ === 0 ? 'main' : 'main', 'main');
          hatFuncs.push(this.compileFunction(name, b, () => 'async def ' + name + '():',
            () => { const ls = this.stack(b.next, 1); if (!ls.some((l) => !l.trim().startsWith('#'))) ls.push('    pass'); return ls; }));
          this.runList.push(name + '()');
          continue;
        }
        if (op === 'event_whenbroadcastreceived') {
          const msg = this.raw(b, 'BROADCAST_OPTION') || 'message1';
          this.broadcasts.add(msg);
          const name = this.uniq('when_i_receive_' + msg, 'on_message');
          const key = JSON.stringify(msg);
          hatFuncs.push(this.compileFunction(name, b, () => 'async def ' + name + '():', () => [
            '    while True:',
            '        await runloop.until(lambda: broadcasts[' + key + '])',
            '        broadcasts[' + key + '] = False',
            ...this.bodyFrom(b.next, 2)]));
          this.runList.push(name + '()');
          continue;
        }
        if (op.startsWith('flipperevents_when') || op.startsWith('event_when')) {
          let hc;
          this.cur = { pending: [], assigned: new Set() };
          hc = this.hatCondition(b);
          const hatTodos = this.cur.pending; this.cur = null;
          if (!hc) { this.todos.push('Event block "' + op + '" is not supported yet; its stack was skipped'); continue; }
          const name = this.uniq(hc.name, 'when');
          hatFuncs.push(this.compileFunction(name, b, () => 'async def ' + name + '():', () => [
            ...hatTodos.map((t) => '    ' + t),
            '    while True:',
            '        await runloop.until(lambda: ' + hc.cond + ')',
            ...this.bodyFrom(b.next, 2),
            '        await runloop.until(lambda: not ' + wrap(hc.cond) + ')']));
          this.runList.push(name + '()');
          continue;
        }
        loose++;
      }
      if (loose) this.notes.push(loose + ' loose block stack' + (loose > 1 ? 's' : '') + ' (not under a "when" block) skipped, same as the SPIKE app.');

      return this.assemble(procFuncs, hatFuncs);
    }

    bodyFrom(next, d) {
      const ls = next ? this.stack(next, d) : [];
      if (!ls.some((l) => !l.trim().startsWith('#'))) ls.push(this.ind(d) + 'pass');
      return ls;
    }

    assemble(procFuncs, hatFuncs) {
      const out = [];
      out.push('# Converted from "' + this.projectName.replace(/[\r\n]/g, ' ') + '" (SPIKE 3 word blocks -> Python)');
      const hubOrder = ['port', 'light_matrix', 'sound', 'motion_sensor', 'button', 'light'];
      const hub = hubOrder.filter((h) => this.hub.has(h));
      if (this.flags.move || this.motorPorts.size) { if (!hub.includes('port')) hub.unshift('port'); }
      if (hub.length) out.push('from hub import ' + hub.join(', '));
      const modOrder = ['motor', 'motor_pair', 'color_sensor', 'distance_sensor', 'force_sensor', 'color', 'runloop'];
      const mods = modOrder.filter((m) => this.mods.has(m));
      out.push('import ' + mods.join(', '));
      const extra = ['math', 'random', 'time'].filter((m) => this.mods.has(m));
      if (extra.length) out.push('import ' + extra.join(', '));
      out.push('');

      const setup = [];
      if (this.flags.move && !this.flags.setPair) setup.push('motor_pair.pair(' + PAIR + ', port.A, port.B)  # SPIKE default movement motors');
      if (this.flags.moveSpeed) setup.push('move_speed = ' + DEFAULT_MOVE_SPEED * SPEED_FACTOR + '  # movement speed in deg/sec (' + DEFAULT_MOVE_SPEED + '%)');
      if (this.motorPorts.size) setup.push('motor_speeds = {' + [...this.motorPorts].sort().map((p) => p + ': ' + DEFAULT_MOTOR_SPEED * SPEED_FACTOR).join(', ') + '}  # deg/sec (' + DEFAULT_MOTOR_SPEED + '%)');
      if (this.flags.cm) setup.push('cm_per_rotation = ' + DEFAULT_CM_PER_ROTATION + '  # wheel travel for 1 rotation');
      if (this.flags.timer) setup.push('timer_start = time.ticks_ms()');
      if (this.flags.tempo) setup.push('tempo = 60  # beats per minute');
      if (this.broadcasts.size) setup.push('broadcasts = {' + [...this.broadcasts].map((m) => JSON.stringify(m) + ': False').join(', ') + '}');
      if (setup.length) { out.push('# --- setup ---', ...setup, ''); }

      if (this.vars.size || this.lists.size) {
        out.push('# --- variables ---');
        for (const v of this.vars.values()) out.push(v.py + ' = ' + v.init);
        for (const l of this.lists.values()) out.push(l.py + ' = ' + l.init);
        out.push('');
      }

      if (this.flags.noteFreq) {
        out.push('def note_freq(note):', '    return int(440 * 2 ** ((note - 69) / 12))', '');
      }

      for (const f of procFuncs) out.push(f, '');
      for (const f of hatFuncs) out.push(f, '');

      if (this.runList.length) out.push('runloop.run(' + this.runList.join(', ') + ')');
      else out.push('# No "when program starts" or other event blocks were found.');

      return { python: out.join('\n') + '\n', todos: this.todos, notes: this.notes };
    }
  }

  // ------------------------------------------------------------- file I/O
  async function convertFile(data, fileName, JSZipLib) {
    const JSZ = JSZipLib || (typeof JSZip !== 'undefined' ? JSZip : null);
    if (!JSZ) throw new Error('JSZip is not loaded');
    let zip;
    try { zip = await JSZ.loadAsync(data); } catch (e) {
      throw new Error('That file isn\'t a SPIKE project (could not open it as a .llsp3 file).');
    }
    let manifest = {};
    if (zip.file('manifest.json')) manifest = JSON.parse(await zip.file('manifest.json').async('string'));
    const name = manifest.name || String(fileName || 'SPIKE project').replace(/\.[^.]+$/, '');

    if (manifest.type === 'python' && zip.file('projectbody.json')) {
      const body = JSON.parse(await zip.file('projectbody.json').async('string'));
      return { python: body.main || '', todos: [], notes: ['This file is already a Python project, so here is its code as-is.'], name, alreadyPython: true };
    }

    let projectText = null;
    if (zip.file('scratch.sb3')) {
      const inner = await JSZ.loadAsync(await zip.file('scratch.sb3').async('uint8array'));
      if (inner.file('project.json')) projectText = await inner.file('project.json').async('string');
    } else if (zip.file('project.json')) {
      projectText = await zip.file('project.json').async('string');
    }
    if (!projectText) throw new Error('No block code found inside this file.');
    const project = JSON.parse(projectText);
    const res = new Converter(project, { name }).convert();
    res.name = name;
    return res;
  }

  const api = { Converter, convertFile, convertProject: (p, o) => new Converter(p, o).convert() };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpikeConverter = api;
})(typeof window !== 'undefined' ? window : globalThis);
