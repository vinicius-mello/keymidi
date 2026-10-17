var HID = require("node-hid");
var easymidi = require("easymidi");
var blessed = require("blessed");
var { identifyChord } = require("./chord");

// Current MIDI output; may be null and can be changed at runtime (key 'm').
var output = null;
var outputName = null;

let notes = [
  [ 'Db1', 'E1' , 'G1' , 'Bb1'],
  [ 'C1' , 'Eb1', 'Gb1', 'A1' ],
  [ 'B0' , 'D1' , 'F1' , 'Ab1'],
  [ 'Bb0', 'Db1', 'E1' , 'G1' ],
  [ 'A0' , 'C1' , 'Eb1', 'Gb1'],
  [ 'Ab0', 'B0' , 'D1' , 'F1' ],
];

const pitches = {
  'C' : 0,
  'C#' : 1,
  'Db' : 1,
  'D' : 2,
  'D#' : 3,
  'Eb' : 3,
  'E' : 4,
  'F' : 5,
  'F#' : 6,
  'Gb' : 6,
  'G' : 7,
  'G#' : 8,
  'Ab' : 8,
  'A' : 9,
  'A#' : 10,
  'Bb' : 10,
  'B' : 11,
};

// SayoDevice O3C: three height-sensing keys play extra notes (left to right)
// and the dial sets the note-on velocity. In the left mode the keys extend the
// bass below the grid; in the right mode they extend the treble above the
// highest device (key 'o' toggles).
const o3cModes = {
  left:  { notes: [ 'F0', 'Gb0', 'G0' ], channel: 0 },
  right: { notes: [ 'Db2', 'C2', 'B1' ], channel: 1 },
};
let o3cMode = 'left';
const O3C_ON = 13000;  // key travel (0..65535) that triggers the note
const O3C_OFF = 6500;  // hysteresis: release below this
// Note sent by each key while held (null when released), so a mode switch
// still releases the right note.
const o3cHeld = [ null, null, null ];

const DEFAULT_VELOCITY = 100;
const VELOCITY_STEP = 4;
let velocity = DEFAULT_VELOCITY;

function notePitch(n) {
  let octave = parseInt(n.substr(-1));
  let name = n.substr(0, n.length-1);
  return 24+12*octave+pitches[name];
}

function pitch(k, i, j) {
  let n = notes[i][j];
  let octave = parseInt(n.substr(-1));
  let name = n.substr(0, n.length-1);
  return 24+12*k+12*octave+pitches[name];
}

// ---------- TUI ----------

const screen = blessed.screen({
  smartCSR: true,
  title: 'aclav - keymidi',
  fullUnicode: true,
});

const header = blessed.box({
  top: 0,
  left: 0,
  width: '100%',
  height: 3,
  tags: true,
  content: '',
  style: { fg: 'brightwhite', bg: 'blue' },
});

const GRID_HEIGHT = 9;
const CHORD_HEIGHT = 5;

const gridsContainer = blessed.box({
  top: 3,
  left: 0,
  width: '100%',
  height: GRID_HEIGHT,
});

const chordBox = blessed.box({
  label: ' acorde ',
  top: 3 + GRID_HEIGHT,
  left: 0,
  width: '100%',
  height: CHORD_HEIGHT,
  border: { type: 'line' },
  style: { border: { fg: 'brightmagenta' }, label: { fg: 'brightmagenta', bold: true } },
  tags: true,
  content: '',
});

const log = blessed.log({
  label: ' events ',
  top: 3 + GRID_HEIGHT + CHORD_HEIGHT,
  left: 0,
  width: '100%',
  height: `100%-${3 + GRID_HEIGHT + CHORD_HEIGHT + 1}`,
  border: { type: 'line' },
  style: { border: { fg: 'brightwhite' }, label: { fg: 'brightwhite', bold: true } },
  tags: true,
  scrollback: 500,
  scrollbar: { ch: ' ', inverse: true },
});

const statusBar = blessed.box({
  bottom: 0,
  left: 0,
  width: '100%',
  height: 1,
  tags: true,
  content: ' {bright-yellow-fg}m{/bright-yellow-fg} MIDI out  {bright-yellow-fg}o{/bright-yellow-fg} modo O3C  {bright-yellow-fg}q/C-c{/bright-yellow-fg} sair',
  style: { fg: 'brightwhite', bg: 'black' },
});

screen.append(header);
screen.append(gridsContainer);
screen.append(chordBox);
screen.append(log);
screen.append(statusBar);

screen.key(['q', 'C-c'], () => process.exit(0));
screen.key(['m'], () => openOutputPicker());
screen.key(['o'], () => toggleO3CMode());

function updateHeader() {
  const name = outputName
    ? `{bright-cyan-fg}${outputName}{/bright-cyan-fg}`
    : '{bright-red-fg}(nenhum){/bright-red-fg}';
  const o3c = o3cModes[o3cMode].notes.map((n, b) => o3cHeld[b]
    ? `{black-fg}{bright-green-bg}{bold} ${n.padEnd(3)} {/bold}{/bright-green-bg}{/black-fg}`
    : `{black-fg}{white-bg} ${n.padEnd(3)} {/white-bg}{/black-fg}`).join(' ');
  header.setContent(`{bold}aclav{/bold} - MIDI out: ${name}\n` +
    `{bold}velocity{/bold} {black-fg}{bright-yellow-bg}{bold} ${String(velocity).padStart(3)} {/bold}{/bright-yellow-bg}{/black-fg}` +
    `   {bold}O3C{/bold} {black-fg}{bright-cyan-bg}{bold} ${o3cMode === 'left' ? 'esquerdo' : 'direito'} {/bold}{/bright-cyan-bg}{/black-fg} ${o3c}`);
}

function midiSend(type, msg) {
  if (output) output.send(type, msg);
}

// Releases every held note on the current output (used before switching).
function releaseHeldNotes() {
  for (let idev = 0; idev < deviceTables.length; ++idev) {
    const table = deviceTables[idev];
    if (!table) continue;
    for (let i = 0; i < 6; ++i)
      for (let j = 0; j < 4; ++j)
        if (table[i][j])
          midiSend('noteon', { note: pitch(idev, i, j), velocity: 0, channel: i>=3 ? 0 : 1 });
  }
  for (const held of o3cHeld)
    if (held) midiSend('noteon', { note: held.note, velocity: 0, channel: held.channel });
}

function setOutput(name) {
  releaseHeldNotes();
  if (output) {
    try { output.close(); } catch (err) {}
  }
  output = null;
  outputName = null;
  if (name) {
    try {
      output = new easymidi.Output(name);
      outputName = name;
      log.log(`{bright-cyan-fg}MIDI out: ${name}{/bright-cyan-fg}`);
    } catch (err) {
      log.log(`{bright-red-fg}{bold}MIDI out ${name}: ${err.message}{/bold}{/bright-red-fg}`);
    }
  } else {
    log.log('{bright-cyan-fg}MIDI out desconectado{/bright-cyan-fg}');
  }
  updateHeader();
  screen.render();
}

let picker = null;

function openOutputPicker() {
  if (picker) return;
  const names = easymidi.getOutputs();
  const items = ['(nenhum)', ...names];
  picker = blessed.list({
    parent: screen,
    label: ' MIDI out (enter seleciona, esc cancela) ',
    top: 'center',
    left: 'center',
    width: '60%',
    height: Math.min(items.length + 2, 20),
    border: { type: 'line' },
    style: {
      border: { fg: 'brightyellow' },
      label: { fg: 'brightyellow', bold: true },
      selected: { fg: 'black', bg: 'brightyellow', bold: true },
    },
    keys: true,
    items,
  });
  const current = outputName ? names.indexOf(outputName) + 1 : 0;
  picker.select(Math.max(current, 0));
  const close = () => {
    picker.destroy();
    picker = null;
    screen.render();
  };
  picker.on('select', (item, index) => {
    close();
    setOutput(index === 0 ? null : names[index - 1]);
  });
  picker.key(['escape'], close);
  picker.focus();
  screen.render();
}

// One grid box per connected device, laid out side by side.
const deviceGrids = [];

// One key-state table per device; chord detection combines all of them.
const deviceTables = [];

function computeAllPitches() {
  const active = [];
  for (let idev = 0; idev < deviceTables.length; ++idev) {
    const table = deviceTables[idev];
    if (!table) continue;
    for (let ti = 0; ti < 6; ++ti)
      for (let tj = 0; tj < 4; ++tj)
        if (table[ti][tj]) active.push(pitch(idev, ti, tj));
  }
  for (const held of o3cHeld)
    if (held) active.push(held.note);
  return active;
}

function updateChordDisplay() {
  const chordName = identifyChord(computeAllPitches());
  const rendered = chordName
    ? `{bright-yellow-fg}{bold}${chordName}{/bold}{/bright-yellow-fg}`
    : '{grey-fg}-{/grey-fg}';
  chordBox.setContent(` ${rendered}`);
  screen.render();
}

function labelFor(k, i, j) {
  return notes[i][j];
}

function makeDeviceGrid(idev, deviceName, total) {
  const widthPct = Math.floor(100 / total);
  const box = blessed.box({
    parent: gridsContainer,
    label: ` device ${idev}: ${deviceName || '?'} `,
    top: 0,
    left: `${widthPct * idev}%`,
    width: idev === total - 1 ? `${100 - widthPct * idev}%` : `${widthPct}%`,
    height: GRID_HEIGHT,
    border: { type: 'line' },
    style: { border: { fg: 'brightcyan' }, label: { fg: 'brightcyan', bold: true } },
    tags: true,
  });

  const cells = [];
  for (let i = 0; i < 6; ++i) {
    cells[i] = [];
    for (let j = 0; j < 4; ++j) {
      const cell = blessed.box({
        parent: box,
        top: i,
        left: `${j * 25}%`,
        width: '25%',
        height: 1,
        tags: true,
        content: renderCell(labelFor(idev, i, j), false),
      });
      cells[i][j] = cell;
    }
  }
  return { box, cells };
}

function renderCell(label, active) {
  const text = ` ${label.padEnd(4)} `;
  return active
    ? `{black-fg}{bright-green-bg}{bold}${text}{/bold}{/bright-green-bg}{/black-fg}`
    : `{bright-white-fg}${text}{/bright-white-fg}`;
}

function setCell(idev, i, j, active) {
  const grid = deviceGrids[idev];
  if (!grid) return;
  grid.cells[i][j].setContent(renderCell(labelFor(idev, i, j), active));
  screen.render();
}

function logEvent(kind, idev, i, j) {
  const label = labelFor(idev, i, j);
  if (kind === 'on') {
    log.log(`{bright-green-fg}{bold}on {/bold}{/bright-green-fg} dev${idev} ${label}`);
  } else {
    log.log(`{bright-white-fg}off{/bright-white-fg} dev${idev} ${label}`);
  }
}

async function connectToDevice() {
  try {
    let devices = await HID.devicesAsync();
    devices = devices.filter(dev =>
      dev.vendorId == 32905 && dev.productId == 8 && dev.usage == 4);
    devices.sort((a, b) => a.product < b.product ? -1 : 1);

    if (devices.length === 0) {
      log.log('{bright-red-fg}{bold}nenhum dispositivo encontrado{/bold}{/bright-red-fg}');
      screen.render();
      return;
    }

    devices.forEach(async (dev, idev) => {
      deviceGrids[idev] = makeDeviceGrid(idev, dev.product, devices.length);
      screen.render();

      let device;
      try {
        device = await HID.HIDAsync.open(dev.path);
      } catch (err) {
        log.log(`{bright-red-fg}{bold}device ${idev} (${dev.product}): ${err.message}{/bold}{/bright-red-fg}`);
        screen.render();
        return;
      }
      deviceTables[idev] =
      [
        [ 0, 0 , 0, 0 ],
        [ 0, 0 , 0, 0 ],
        [ 0, 0 , 0, 0 ],
        [ 0, 0 , 0, 0 ],
        [ 0, 0 , 0, 0 ],
        [ 0, 0 , 0, 0 ],
      ];
      var table = deviceTables[idev];
      device.on("data", function(data) {
        if(data[0] == 0x21) return;
        for(let i=0; i<3; ++i) {
          for(let j=0;j<4;++j)
            if((data[i+1] & (1<<j)) != 0 ) {
              if(table[2*i][j] == 0) noteOn(idev, 2*i, j);
              table[2*i][j] = 1;
            } else {
              if(table[2*i][j] == 1) noteOff(idev, 2*i, j);
              table[2*i][j] = 0;
            }
          for(let j=0;j<4;++j)
            if((data[i+1] & (1<<(j+4))) != 0 ) {
              if(table[2*i+1][j] == 0) noteOn(idev, 2*i+1, j);
              table[2*i+1][j] = 1;
            } else {
              if(table[2*i+1][j] == 1) noteOff(idev, 2*i+1, j);
              table[2*i+1][j] = 0;
            }
        }
        updateChordDisplay();
      });
    });

  } catch (err) {
    log.log(`{bright-red-fg}{bold}HID Error: ${err.message}{/bold}{/bright-red-fg}`);
    screen.render();
  }
}

function noteOn(k, i, j) {
  logEvent('on', k, i, j);
  setCell(k, i, j, true);
  midiSend('noteon', {
    note: pitch(k, i, j),
    velocity: velocity,
    channel: i>=3 ? 0 : 1
  });
}

function noteOff(k, i, j) {
  logEvent('off', k, i, j);
  setCell(k, i, j, false);
  midiSend('noteon', {
    note: pitch(k, i, j),
    velocity: 0,
    channel: i>=3 ? 0 : 1
  });
}

function setVelocity(v) {
  velocity = Math.min(127, Math.max(1, v));
  updateHeader();
  screen.render();
}

function toggleO3CMode() {
  o3cMode = o3cMode === 'left' ? 'right' : 'left';
  log.log(`{bright-cyan-fg}O3C modo ${o3cMode === 'left' ? 'esquerdo' : 'direito'}{/bright-cyan-fg}`);
  updateHeader();
  screen.render();
}

function o3cKey(b, value) {
  const held = o3cHeld[b];
  if (!held && value >= O3C_ON) {
    const mode = o3cModes[o3cMode];
    // The right mode continues above the highest device's octave.
    const shift = o3cMode === 'right' ? 12 * Math.max(deviceGrids.length - 1, 0) : 0;
    const name = mode.notes[b];
    o3cHeld[b] = { name, note: notePitch(name) + shift, channel: mode.channel };
    log.log(`{bright-green-fg}{bold}on {/bold}{/bright-green-fg} O3C ${name}`);
    midiSend('noteon', { note: o3cHeld[b].note, velocity: velocity, channel: mode.channel });
  } else if (held && value < O3C_OFF) {
    o3cHeld[b] = null;
    log.log(`{bright-white-fg}off{/bright-white-fg} O3C ${held.name}`);
    midiSend('noteon', { note: held.note, velocity: 0, channel: held.channel });
  } else {
    return;
  }
  updateHeader();
  updateChordDisplay();
}

// Report 0x09: key travel as little-endian 16-bit values (left, middle, right).
// Report 0x21: list of events; 0x8x tags carry a 16-bit value, 0xc0 is a
// status block, other tags carry one byte. Tag 0x10 is a key press: 5 and 4
// = dial steps (5 lowers the velocity, 4 raises it), 3 = dial button.
function o3cData(data) {
  if (data[0] == 0x09) {
    o3cKey(0, data[1] | (data[2] << 8));
    o3cKey(1, data[3] | (data[4] << 8));
    o3cKey(2, data[9] | (data[10] << 8));
  } else if (data[0] == 0x21) {
    const end = Math.min(data.length, 4 + data[4]);
    for (let i = 8; i < end; ) {
      const tag = data[i];
      if (tag == 0xc0) break;
      if (tag & 0x80) { i += 3; continue; }
      if (tag == 0x10) {
        const key = data[i+1];
        if (key == 5) setVelocity(velocity - VELOCITY_STEP);
        else if (key == 4) setVelocity(velocity + VELOCITY_STEP);
        else if (key == 3) setVelocity(DEFAULT_VELOCITY);
      }
      i += 2;
    }
  }
}

async function connectO3C() {
  try {
    const dev = (await HID.devicesAsync()).find(dev =>
      dev.vendorId == 32905 && dev.productId == 9 && dev.interface == 1);
    if (!dev) {
      log.log('{bright-yellow-fg}O3C não encontrado{/bright-yellow-fg}');
      screen.render();
      return;
    }
    const device = await HID.HIDAsync.open(dev.path);
    device.on('data', o3cData);
    device.on('error', err => {
      log.log(`{bright-red-fg}{bold}O3C: ${err.message}{/bold}{/bright-red-fg}`);
      screen.render();
    });
    log.log(`{bright-cyan-fg}O3C conectado (${dev.path}){/bright-cyan-fg}`);
  } catch (err) {
    log.log(`{bright-red-fg}{bold}O3C: ${err.message}{/bold}{/bright-red-fg}`);
  }
  screen.render();
}

{
  // Keep the previous default (second output) if present.
  const outputs = easymidi.getOutputs();
  const initial = outputs[1];
  if (initial) setOutput(initial);
  else { updateHeader(); log.log('{bright-yellow-fg}nenhum MIDI out; pressione m para escolher{/bright-yellow-fg}'); }
}
screen.render();
connectToDevice();
connectO3C();
