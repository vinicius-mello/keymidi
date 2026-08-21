var HID = require("node-hid");
var easymidi = require("easymidi");
var blessed = require("blessed");
var { identifyChord } = require("./chord");

var outputs = easymidi.getOutputs();
var output = new easymidi.Output(outputs[1]);

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
  content: `{bold}aclav{/bold} - MIDI out: {bright-cyan-fg}${outputs[1] || '(none)'}{/bright-cyan-fg}`,
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
  content: ' {bright-yellow-fg}q/C-c{/bright-yellow-fg} sair',
  style: { fg: 'brightwhite', bg: 'black' },
});

screen.append(header);
screen.append(gridsContainer);
screen.append(chordBox);
screen.append(log);
screen.append(statusBar);

screen.key(['q', 'C-c'], () => process.exit(0));

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
  output.send('noteon', {
    note: pitch(k, i, j),
    velocity: 100,
    channel: i>=3 ? 0 : 1
  });
}

function noteOff(k, i, j) {
  logEvent('off', k, i, j);
  setCell(k, i, j, false);
  output.send('noteon', {
    note: pitch(k, i, j),
    velocity: 0,
    channel: i>=3 ? 0 : 1
  });
}

screen.render();
connectToDevice();
