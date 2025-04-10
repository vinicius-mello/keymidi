var HID = require('node-hid');
HID.setDriverType('hidraw');
var devices = HID.devices();
var easymidi = require('easymidi');
var outputs = easymidi.getOutputs();
var output = new easymidi.Output(outputs[0]);
console.log(outputs)
let notes = [];
notes[0] = [
  [ 'G#6', 'G6' , 'B6' , 'Bb6' ], 
  [ 'C#6', 'C6' , 'E6' , 'Eb6' ], 
  [ 'F#5', 'F5' , 'A5' , 'Ab5' ], 
  [ 'Bb4', 'B4' , 'D5' , 'D#5' ], 
  [ 'Eb4', 'E4' , 'G4' , 'G#4' ], 
  [ 'Ab3', 'A3' , 'C4' , 'C#4' ], 
];
notes[1] = [
  [ 'F#6', 'F6' , 'A6' , 'C7'  ], 
  [ 'Bb5', 'B5' , 'D6' , 'D#6' ], 
  [ 'Eb5', 'E5' , 'G5' , 'G#5' ], 
  [ 'Ab4', 'A4' , 'C5' , 'C#5' ], 
  [ 'D#4', 'D4' , 'F4' , 'F#4' ], 
  [ 'G#3', 'G3' , 'B3' , 'Bb3' ], 
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

devices = devices.filter( dev => 
  dev.vendorId == 32905 && dev.productId == 8 && dev.usage == 4);
devices.sort( (a,b) => a.product < b.product ? -1 : 1);
devices = devices.slice(0, 2);
console.log(devices);
devices.forEach( (dev, idev) => {
  var device = new HID.HID( dev.path );
  var table = 
  [
    [ 0, 0 , 0, 0 ], 
    [ 0, 0 , 0, 0 ], 
    [ 0, 0 , 0, 0 ], 
    [ 0, 0 , 0, 0 ], 
    [ 0, 0 , 0, 0 ], 
    [ 0, 0 , 0, 0 ], 
  ];
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
  });
});

function pitch(k, i, j) {
  let n = notes[k][i][j];
  let octave = parseInt(n.substr(-1));
  let name = n.substr(0, n.length-1);
  return 12+12*octave+pitches[name];
}
  

function noteOn(k, i, j) {
  console.log(`${k}: note on ${i},${j} ${notes[k][i][j]}`);
  output.send('noteon', {
    note: pitch(k, i, j),
    velocity: 100,
    channel: 1
  });
}

function noteOff(k, i, j) {
  console.log(`${k}: note off ${i},${j} ${notes[k][i][j]}`);
  output.send('noteon', {
    note: pitch(k, i, j),
    velocity: 0,
    channel: 1
  });
}
