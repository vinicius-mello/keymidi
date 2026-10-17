#!/usr/bin/env python3
"""Generate Surge XT patches (.fxp) that emulate acoustic instruments.

The patches are built on top of Surge XT's own "Init Karplus-Strong" template
(so every parameter Surge expects is present) and then individual parameters
are overridden.  Run it with `python3 patches/build_patches.py`; it writes the
.fxp files next to this script.

Units used by Surge parameters (as stored in the patch XML):
  * envelope / LFO times and reverb times: log2(seconds)
  * filter cutoff / EQ frequencies: semitones relative to A440
  * filter env mod, cutoff modulation depth: semitones
  * oscillator/noise levels and FX sends: cubic taper, see db()
  * mixes, percentages: 0..1 (bipolar ones -1..1)
"""

import math
import os
import struct
import sys
import xml.etree.ElementTree as ET

TEMPLATE = '/usr/share/surge-xt/patches_factory/Templates/Init Karplus-Strong.fxp'
OUT_DIR = os.path.dirname(os.path.abspath(__file__))

# Oscillator types
OSC_CLASSIC, OSC_SINE, OSC_MODERN, OSC_STRING = 0, 1, 8, 9
# Filter types
F_OFF, F_LP12, F_LP24, F_HP12, F_HP24, F_BP12, F_COMB = 0, 1, 2, 4, 5, 6, 8
# FX types
FX_EQ, FX_REVERB2 = 6, 11
# FX slots (fxN in the XML): 1-2 scene A inserts, 3-4 scene B, 5-6 sends, 7-8 global
FX_A1, FX_A2, FX_B1, FX_B2, FX_SEND1, FX_SEND2, FX_GLOBAL1 = 1, 2, 3, 4, 5, 6, 7
# LFO shapes
LFO_NOISE, LFO_ENVELOPE = 4, 6
# Modulation sources
MS_VELOCITY, MS_KEYTRACK, MS_AFTERTOUCH, MS_MODWHEEL = 1, 2, 4, 6
MS_AMPEG, MS_FILTEREG, MS_LFO1, MS_LFO2, MS_SLFO1 = 15, 16, 17, 18, 23
MS_BREATH, MS_EXPRESSION, MS_SUSTAIN = 35, 36, 37


def secs(s):
    """Seconds -> Surge log2 time."""
    return math.log2(s)


def hz(f):
    """Hz -> semitones relative to A440."""
    return 12 * math.log2(f / 440.0)


def db(x):
    """dB -> Surge level/send knob value (Surge levels use a cubic taper)."""
    return 10 ** (x / 60.0)


def fmt(v):
    return str(int(v)) if isinstance(v, int) else '%.14f' % v


def read_template(path):
    data = open(path, 'rb').read()
    start = data.find(b'<?xml')
    end = data.find(b'</patch>') + len(b'</patch>')
    return ET.fromstring(data[start:end])


class Patch:
    def __init__(self, name, category, comment=''):
        self.root = read_template(TEMPLATE)
        self.params = self.root.find('parameters')
        meta = self.root.find('meta')
        meta.attrib.update(name=name, category=category, comment=comment,
                           author='keymidi', license='CC0')
        self.name = name

    def set(self, key, value, mods=(), **attrs):
        el = self.params.find(key)
        if el is None:
            el = ET.SubElement(self.params, key)
        el.set('type', '0' if isinstance(value, int) else '2')
        el.set('value', fmt(value))
        for k, v in attrs.items():
            el.set(k, str(v))
        for child in list(el):
            el.remove(child)
        for src, depth in mods:
            ET.SubElement(el, 'modrouting', source=str(src), depth='%.6f' % depth,
                          muted='0', source_index='0')

    def scene(self, **kv):
        for k, v in kv.items():
            if isinstance(v, tuple):
                self.set('a_' + k, v[0], v[1])
            else:
                self.set('a_' + k, v)

    def fx(self, slot, fxtype, values):
        self.set('fx%d_type' % slot, fxtype)
        for i in range(12):
            v = values[i] if i < len(values) else 0
            self.set('fx%d_p%d' % (slot, i), v)

    def reverb(self, slot, predelay, room, decay, diffusion=0.8, buildup=0.6,
               modulation=0.2, lf_damp=0.2, hf_damp=0.4, width=0.0, mix=1.0):
        self.fx(slot, FX_REVERB2,
                [secs(predelay), room, secs(decay), diffusion, buildup,
                 modulation, lf_damp, hf_damp, width, mix])

    def eq(self, slot, bands, gain=0.0, mix=1.0):
        """bands: three (gain_db, freq_hz, bandwidth_octaves) tuples."""
        vals = []
        for g, f, bw in bands:
            vals += [g, hz(f), bw]
        self.fx(slot, FX_EQ, vals + [gain, mix])
        # band gains are switchable; without this flag the bands are off
        for i in (0, 3, 6):
            self.params.find('fx%d_p%d' % (slot, i)).set('deactivated', '0')

    def copy_scene(self, src, dst):
        for el in list(self.params):
            if el.tag.startswith(src):
                other = self.params.find(dst + el.tag[len(src):])
                if other is not None:
                    other.attrib = dict(el.attrib)
                    for child in list(other):
                        other.remove(child)
                    for child in el:
                        other.append(ET.fromstring(ET.tostring(child)))

    def write(self, path=None):
        path = path or os.path.join(OUT_DIR, self.name + '.fxp')
        xml = b'<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n' + \
            ET.tostring(self.root, encoding='utf-8')
        # Surge patch header: tag, xml size, 6 wavetable sizes (little endian)
        chunk = b'sub3' + struct.pack('<I', len(xml)) + b'\0' * 24 + xml
        name = self.name.encode()[:27].ljust(28, b'\0')
        # VST2 FXP "opaque chunk" container (big endian)
        header = b'CcnK' + struct.pack('>I', 0) + b'FPCh' + \
            struct.pack('>III', 1, 0x636a7333, 1) + struct.pack('>I', 1) + \
            name + struct.pack('>I', len(chunk))
        with open(path, 'wb') as f:
            f.write(header + chunk)
        return path


def base(p):
    """Neutral starting point: one oscillator, no filters, no noise."""
    p.set('polylimit', 16)
    p.set('fx_disable', 0)
    for o in (1, 2, 3):
        p.scene(**{'mute_o%d' % o: 1, 'level_o%d' % o: 1.0})
    p.scene(mute_o1=0, mute_noise=1, level_noise=0.0, noisecol=0.0,
            fb_config=0, filter1_type=F_OFF, filter2_type=F_OFF,
            filter1_keytrack=0.0, filter2_keytrack=0.0,
            filter1_envmod=0.0, filter2_envmod=0.0,
            vca_level=0.0, vca_velsense=0.0, level_pfg=0.0, drift=0.0,
            send_fx_1=0.0, send_fx_2=0.0, lowcut=-72.0)


def concertina(saw=0.3, pulse=0.9, width=0.42, cutoff=3000, formant=(8.0, 1350, 1.3),
               low=(-12.0, 300, 1.6), high=(-3.0, 5000, 1.5), attack=0.045):
    """Free-reed English concertina.

    Measured on recordings of Stuart Eydmann (English concertina): the timbre
    comes from a fixed resonance of the reed chamber, not from filters that
    follow the note.  Odd harmonics are strong (the 3rd often louder than
    the fundamental around G4-B4), there is little energy above ~3 kHz, the
    reeds take 25-65 ms to speak and the pitch is very steady.
    """
    p = Patch('English Concertina', 'Winds',
              'Free-reed English concertina. Mod wheel / breath = bellows '
              'pressure (louder, brighter). Send FX 1 = Reverb 2.')
    base(p)
    p.scene(
        osc1_type=OSC_MODERN,
        # Modern osc: saw level, pulse level, multi level, width, sync, detune, voices
        # a near-square pulse: strong odd harmonics, some even ones
        osc1_param0=saw, osc1_param1=pulse, osc1_param2=0.0,
        osc1_param3=width, osc1_param4=0.0, osc1_param5=0.0, osc1_param6=1,
        level_o1=db(0),
        # a little reed/air noise
        mute_noise=0, level_noise=db(-40), noisecol=0.0,
        drift=0.015,
        lowcut=hz(120),
        # fixed (not key-tracked) low-pass: the reed chamber
        filter1_type=F_LP24, filter1_subtype=0,
        filter1_cutoff=(hz(cutoff) - 12.0, [(MS_MODWHEEL, 7.0), (MS_BREATH, 7.0),
                                            (MS_VELOCITY, 4.0)]),
        filter1_resonance=0.1, filter1_keytrack=0.0,
        # the reed gets brighter as it builds up amplitude
        filter1_envmod=12.0,
        env1_attack=secs(attack), env1_attack_shape=1, env1_decay=secs(0.5),
        env1_sustain=1.0, env1_release=secs(0.07), env1_mode=0,
        env2_attack=secs(attack * 1.6), env2_decay=secs(0.5), env2_sustain=1.0,
        env2_release=secs(0.07), env2_mode=0,
        level_pfg=(0.0, [(MS_MODWHEEL, 6.0), (MS_BREATH, 6.0),
                         (MS_SLFO1, 0.6)]),
        # scene LFO 1: slow random wobble of the bellows pressure
        lfo6_shape=LFO_NOISE, lfo6_rate=math.log2(1.5), lfo6_magnitude=1.0,
        lfo6_deform=0.0, lfo6_trigmode=0, lfo6_unipolar=0,
        vca_level=4.0,
        send_fx_1=db(-9),
    )
    # reed chamber formant, less fundamental box, darker top
    p.eq(FX_A1, [low, formant, high], gain=-4.0)
    p.reverb(FX_SEND1, predelay=0.022, room=0.25, decay=1.7, diffusion=0.85,
             buildup=0.55, modulation=0.15, lf_damp=0.25, hf_damp=0.45)
    return p


def plucked(p, cutoff, brightness, excite, noisecol, ring):
    """Karplus-Strong string: a short noise burst excites a comb filter tuned
    to the played note (filter 1), followed by a low-pass whose cutoff falls
    after the attack so the upper partials die first, as on a gut string.

    cutoff: low-pass cutoff (Hz) at middle C once the pluck has faded
    brightness: how far the attack opens the low-pass (semitones)
    excite: length of the pluck noise burst (seconds)
    noisecol: colour of the burst, negative = darker (flesh/thumb)
    ring: comb feedback, 1.0 = the longest sustain
    """
    base(p)
    p.scene(
        # exciter: noise gated by voice LFO 1 used as a one-shot envelope
        mute_noise=0, noisecol=noisecol,
        level_noise=(0.0, [(MS_LFO1, 0.75)]),
        lfo0_shape=LFO_ENVELOPE, lfo0_trigmode=1, lfo0_unipolar=1, lfo0_magnitude=1.0,
        lfo0_deform=0.0, lfo0_delay=-8.0, lfo0_attack=secs(0.0015),
        lfo0_hold=-8.0, lfo0_decay=secs(excite), lfo0_sustain=0.0,
        lfo0_release=-8.0,
        mute_o1=1,
        drift=0.02,
        lowcut=hz(40),
        fb_config=0,
        # comb tuned to the note (A440-relative -9 st = C4 at key 60)
        filter1_type=F_COMB, filter1_subtype=0, filter1_cutoff=-9.0,
        filter1_resonance=ring, filter1_keytrack=1.0,
        filter2_type=F_LP12, filter2_subtype=0,
        filter2_cutoff=(hz(cutoff), [(MS_VELOCITY, 10.0)]),
        filter2_resonance=0.0, filter2_keytrack=1.0,
        filter2_envmod=brightness,
        # amp: let the string ring, damp it on key release (unless sustain pedal)
        env1_attack=-8.0, env1_decay=secs(1.0), env1_sustain=1.0,
        env1_release=(secs(0.35), [(MS_SUSTAIN, 3.0)]), env1_mode=0,
        # brightness envelope
        env2_attack=-8.0, env2_decay=secs(0.6), env2_sustain=0.0,
        env2_release=secs(0.6), env2_decay_shape=2, env2_mode=0,
        vca_level=12.0,
    )


def double_course(p, cents, spread=0.35):
    """Layer scene B as the second string of a course, slightly detuned."""
    p.copy_scene('a_', 'b_')
    p.set('scenemode', 1)                       # layer A + B
    p.set('a_pitch', -cents / 200.0)
    p.set('b_pitch', cents / 200.0)
    p.set('a_pan', -spread)
    p.set('b_pan', spread)


def theorbo():
    p = Patch('Theorbo', 'Plucks',
              'Gut-strung theorbo / chitarrone: warm thumb pluck, big low body, '
              'long-ringing basses. Sustain pedal lets notes ring. '
              'Send FX 1 = Reverb 2 (church).')
    plucked(p, cutoff=520, brightness=16.0, excite=0.012, noisecol=-0.65,
            ring=0.995)
    p.scene(send_fx_1=db(-6))
    p.reverb(FX_SEND1, predelay=0.03, room=0.55, decay=2.8, diffusion=0.9,
             buildup=0.7, modulation=0.2, lf_damp=0.35, hf_damp=0.55)
    return p


def lute():
    p = Patch('Renaissance Lute', 'Plucks',
              'Gut-strung lute with paired courses (scenes A and B are the two '
              'strings, slightly detuned). Sustain pedal lets notes ring. '
              'Send FX 1 = Reverb 2.')
    plucked(p, cutoff=750, brightness=18.0, excite=0.008, noisecol=-0.55,
            ring=0.993)
    p.scene(send_fx_1=db(-7))
    p.reverb(FX_SEND1, predelay=0.025, room=0.4, decay=2.2, diffusion=0.85,
             buildup=0.6, modulation=0.2, lf_damp=0.3, hf_damp=0.5)
    double_course(p, cents=4.0)
    return p


PATCHES = [concertina, theorbo, lute]

if __name__ == '__main__':
    for make in PATCHES:
        print(make().write())
