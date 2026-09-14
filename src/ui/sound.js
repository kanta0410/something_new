// チップチューン風の効果音。AudioContext は最初のユーザー操作で作る。
let ctx = null, enabled = true;
export function setSoundEnabled(v) { enabled = !!v; }
export function soundEnabled() { return enabled; }
function ac() { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { ctx = null; } } if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
function tone(freq, t0, dur, type = 'square', gain = 0.05) {
  const c = ac(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.02);
}
/** @param {'tick'|'check'|'win'|'lose'|'alamo'|'reborn'|'streak'} kind */
export function play(kind) {
  if (!enabled) return;
  const c = ac(); if (!c) return;
  const t = c.currentTime;
  switch (kind) {
    case 'tick': tone(440, t, 0.06); tone(660, t + 0.07, 0.08); break;
    case 'check': tone(880, t, 0.05, 'square', 0.04); break;
    case 'win': [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.07, 0.12)); break;
    case 'lose': tone(220, t, 0.12, 'sawtooth', 0.04); tone(180, t + 0.12, 0.18, 'sawtooth', 0.04); break;
    case 'alamo': tone(55, t, 0.9, 'sawtooth', 0.08); tone(58, t + 0.05, 0.9, 'sawtooth', 0.06); tone(110, t + 0.5, 0.5, 'square', 0.04); break;
    case 'reborn': [392, 494, 587, 784, 988].forEach((f, i) => tone(f, t + i * 0.09, 0.25, 'triangle', 0.06)); break;
    case 'streak': [660, 880, 1320].forEach((f, i) => tone(f, t + i * 0.06, 0.15)); break;
  }
}
