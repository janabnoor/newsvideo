/**
 * sound-engine.js
 * Plays page-turn sound effects with zero perceptible delay by
 * pre-decoding audio buffers via the Web Audio API rather than
 * relying on <audio> element latency. Supports mute + volume.
 */

let audioCtx = null;
let buffers = {};
let isMuted = false;
let masterVolume = 0.55;
let unlocked = false;

const SOUND_FILES = {
  flip: 'assets/sounds/pageflip.mp3',
  soft: 'assets/sounds/pageflip.mp3',
};

async function loadBuffer(ctx, url) {
  const res = await fetch(url);
  const arrayBuffer = await res.arrayBuffer();
  return ctx.decodeAudioData(arrayBuffer);
}

/**
 * Initializes the audio context and pre-loads all sound buffers.
 * Must be called (or lazily triggered) after a user gesture on
 * iOS/Safari to satisfy autoplay policies — see unlockAudio().
 */
export async function initSoundEngine() {
  if (audioCtx) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  audioCtx = new AudioContextClass();

  try {
    const [flipBuf, softBuf] = await Promise.all([
      loadBuffer(audioCtx, SOUND_FILES.flip),
      loadBuffer(audioCtx, SOUND_FILES.soft),
    ]);
    buffers.flip = flipBuf;
    buffers.soft = softBuf;
  } catch (err) {
    console.warn('Sound assets failed to load; continuing silently.', err);
  }
}

/**
 * Resumes a suspended AudioContext — call on first pointerdown/touchstart
 * to satisfy mobile browser autoplay restrictions.
 */
export function unlockAudio() {
  if (unlocked || !audioCtx) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  unlocked = true;
}

/**
 * Plays a page-turn sound. variant: 'flip' (crisp) or 'soft' (gentle).
 * No-op silently if muted, not yet loaded, or buffer missing.
 */
export function playPageTurn(variant = 'flip') {
  if (isMuted || !audioCtx || !buffers[variant]) return;
  if (audioCtx.state === 'suspended') return;

  const source = audioCtx.createBufferSource();
  source.buffer = buffers[variant];

  const gainNode = audioCtx.createGain();
  gainNode.gain.value = masterVolume;

  source.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  source.start(0);
}

export function setMuted(muted) {
  isMuted = muted;
}

export function getMuted() {
  return isMuted;
}

export function toggleMuted() {
  isMuted = !isMuted;
  return isMuted;
}

export function setVolume(v) {
  masterVolume = Math.max(0, Math.min(1, v));
}
