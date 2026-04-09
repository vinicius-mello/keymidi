var HID = require('node-hid');
HID.setDriverType('hidraw');
var devices = HID.devices();
var easymidi = require('easymidi');
var outputs = easymidi.getOutputs();
var output = new easymidi.Output(outputs[1]);
console.log(outputs);
let keys = new Array(24).fill('0');

devices = devices.filter( dev => 
  dev.vendorId == 32905 && dev.productId == 8 && dev.usage == 4);
devices.sort( (a,b) => a.product < b.product ? -1 : 1);
console.log(devices);
devices.forEach( (dev, idev) => {
  var device = new HID.HID( dev.path );
  device.on("data", function(data) {
    if(data[0] == 0x21) return;
    for(let i=0; i<3; ++i) {
      for(let j=0;j<4;++j) 
        if((data[i+1] & (1<<j)) != 0 ) { 
          keys[2*i*4+j] = '1';
        } else {
          keys[2*i*4+j] = '0'; 
        }
      for(let j=0;j<4;++j) 
        if((data[i+1] & (1<<(j+4))) != 0 ) { 
          keys[(2*i+1)*4+j] = '1'; 
        } else {
          keys[(2*i+1)*4+j] = '0'; 
        }
    }
  });
});

const fingering = {
  '0000 0000 1000 1001 1001 1001' : 'G3',
  '0000 0000 1000 1001 1001 1000' : 'Ab3',
  '0000 0000 1000 1000 1001 1001' : 'A3',
  '0000 0000 1000 1001 1000 1001' : 'Bb3',
  '0000 0000 1000 1000 1000 1001' : 'B3',
  '0000 0000 1001 1001 1001 1001' : 'B3',
  '0000 0000 1000 1000 1000 1000' : 'C4',
  '0000 0000 0001 1001 1001 1001' : 'C4',
  '0000 0000 0001 1001 1001 1000' : 'C#4',
  '0000 0000 0000 1001 1001 1000' : 'C#4',
  '0000 0000 0000 1001 1001 1001' : 'D4',
  '0000 0000 0000 1001 1000 1001' : 'Eb4',
  '0000 0000 0000 1000 1001 1001' : 'E4',
  '0000 0000 0000 1000 1000 1001' : 'F4',
  '0000 0000 0000 1000 1001 1000' : 'F#4',
  '0000 0000 0000 1000 1000 1000' : 'G4',
  '0000 0000 0000 0000 1001 1000' : 'Ab4',
  '0000 0000 0000 0000 1000 1000' : 'A4',
  '0000 0000 0000 0000 0001 1000' : 'Bb4',
  '0000 0000 0000 1000 0000 1000' : 'Bb4',
  '0000 0000 0000 0000 0000 1000' : 'B4',
  '0000 0000 0000 0000 1000 0000' : 'C5',
  '0000 0000 0000 0001 1001 0000' : 'C#5',
  '0000 0000 0000 0001 1001 0001' : 'D5',
  '0000 0000 0000 0001 1000 0001' : 'Eb5',
  '0000 0000 0000 0000 1001 0001' : 'E5',
  '0000 0000 0000 0000 1000 0001' : 'F5',
  '0000 0000 0000 0000 1001 0000' : 'F#5',
  '0000 0000 0000 1000 0000 0000' : 'G5',
  '0000 0000 0001 1000 0000 0000' : 'G5',
  '0000 0000 0001 1000 1000 1000' : 'G5',
  '0000 0000 0001 0000 1001 1000' : 'Ab5',
  '0000 0000 0001 0000 1000 1000' : 'A5',
  '0000 0000 0001 1000 0000 1000' : 'Bb5',
  '0000 0000 0001 0000 0000 1000' : 'B5',
  '0000 0000 0001 0000 1000 0000' : 'C6',
  '0000 0000 0001 0001 1001 0000' : 'C#6',
  '0000 0000 0001 0001 1001 0001' : 'D6',
  '0000 0000 0001 0001 1000 0000' : 'D6',
  '0000 0000 0001 0001 1000 0001' : 'Eb6',
  '0000 0000 0001 0000 1001 0001' : 'E6',
  '0000 0000 0001 0000 1000 0001' : 'F6',
  '0000 0000 0001 0000 1001 0000' : 'F#6',
  '0000 0000 0001 1000 1001 0000' : 'G6',
};

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


function pitch(n) {
  let octave = parseInt(n.substr(-1));
  let name = n.substr(0, n.length-1);
  return 12+12*octave+pitches[name];
}  


let curNote = null;

function noteOn(k) {
  output.send('noteon', {
    note: pitch(k),
    velocity: 100,
    channel: 1
  });
  curNote = k;
}

function noteOff() {
  if(curNote == null) return;
  output.send('noteon', {
    note: pitch(curNote),
    velocity: 0,
    channel: 1
  });
  curNote = null;
}

const format4x6 = (keys) => {
  let s = '';
  for(let i=0; i<6; ++i) {
    for(let j=0; j<4; ++j) {
      s += keys[i*4+j];
    }
    if (i < 5) s += ' ';
  }
  return s;
}

const intervalId = setInterval(
  ()=> {
    let k = fingering[format4x6(keys)];
    if(k != curNote && k != null) {
      console.log(`Playing ${k}`);
      noteOn(k);
    } else {
      noteOff();
    }
  }
  , 10); 