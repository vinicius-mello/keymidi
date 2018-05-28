#!/usr/bin/env node
const ioHook = require('iohook');
var easymidi = require('easymidi');
var outputs = easymidi.getOutputs();
console.log(outputs)
var output = new easymidi.Output(outputs[0]);

process.stdin.setRawMode(true);

const keyTable = {
    2 : "1", 3 : "2", 4 : "3", 5 : "4", 6 : "5",
    7 : "6", 8 : "7", 9 : "8", 10 : "9", 11 : "0",
    16 : "q", 17 : "w", 18 : "e", 19 : "r", 20 : "t",
    21 : "y", 22 : "u", 23 : "i", 24 : "o", 25 : "p",
    30 : "a", 31 : "s", 32 : "d", 33 : "f", 34 : "g",
    35 : "h", 36 : "j", 37 : "k", 38 : "l",
    44 : "z", 45 : "x", 46 : "c", 47 : "v",
    48 : "b", 49 : "n", 50 : "m", 
    51 : ",", 52 : ".", 26 : "[", 27 : "]", 13 : "="
}

const noteTable = {
    "0" : 0, "1" : 1, "2" : 2, "3" : 3, "4" : 4,
    "5" : 5, "6" : 6, "7" : 7, "8" : 8, "9" : 9,
    "a" : 10, "b" : 11, "c" : 12, "d" : 13, "e" : 14,
    "f" : 15, "g" : 16, "h" : 17, "i" : 18, "j" : 19,
    "k" : 20, "l" : 21, "m" : 22, "n" : 23, "o" : 24,
    "p" : 25, "q" : 26, "r" : 27, "s" : 28, "t" : 29,
    "u" : 30, "v" : 31, "w" : 32, "x" : 33, "y" : 34,
    "z" : 35, "," : 36, "." : 37, "[" : 38, "]" : 39,
    "=" : 40
};
var noteState = new Array(128).fill(false);
const transposition = 40;
var keyCount = 0;
ioHook.on('keydown', event => {
    if(event.keycode==1) {
        ioHook.stop();
        process.exit(0);
    }
    var key = keyTable[event.keycode];
    if (key===undefined) {
    } else {
        var note = noteTable[key] + transposition;
        if(noteState[note]) {
        } else {
            noteState[note] = true;
            keyCount = keyCount + 1;
            console.log("noteon: "+note);
            output.send('noteon', {
                note: note,
                velocity: 100,
                channel: 1
            });
            if (keyCount == 3) {
                output.send('cc', {
                    controller: 64,
                    value: 127,
                    channel: 1
                });
            }
        }
    }
});

ioHook.on('keyup', event => {
    var key = keyTable[event.keycode];
    if (key===undefined) {
    } else {
        var note = noteTable[key] + transposition;
        if (noteState[note]) {
            noteState[note] = false;
            keyCount = keyCount - 1;
            console.log("noteoff: "+note);
            output.send('noteoff', {
                note: note,
                velocity: 0,
                channel: 1
            });
            if (keyCount == 0) {
                output.send('cc', {
                    controller: 64,
                    value: 0,
                    channel: 1
                });
            }
        }
    }
});

// Register and start hook
ioHook.start();
