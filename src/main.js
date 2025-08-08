// Main application script compiled from TypeScript by hand.
// Provides video upload, voice‑over recording with pause/resume and export functionality.

import { Waveform } from './waveform.js';
import { Exporter } from './exporter.js';

// DOM references
const videoEl = document.getElementById('video');
const badge = document.getElementById('recordBadge');
const startRecBtn = document.getElementById('startRec');
const togglePauseBtn = document.getElementById('togglePause');
const exportBtn = document.getElementById('exportBtn');
const fileInput = document.getElementById('videoFile');
const dropzone = document.getElementById('dropzone');
const playerArea = document.getElementById('playerArea');
const progressWrap = document.getElementById('progressWrap');
const progressBar = document.getElementById('progress');
const progressText = document.getElementById('progressText');
const waveCanvas = document.getElementById('wave');
const trimSilenceBtn = document.getElementById('trimSilence');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const normalizeChk = document.getElementById('normalizeChk');
const denoiseChk = document.getElementById('denoiseChk');
const autosaveChk = document.getElementById('autosaveChk');

// Instantiate waveform renderer
const waveform = new Waveform(waveCanvas);
// Recording buffers and state
const audioChunks = [];
let mediaRecorder = null;
let audioBlob = null;
let audioPCM = null;
let stream = null;
let audioCtx = null;
let denoiseNode = null;
let compNode = null;

// Pause bookkeeping and undo/redo stacks
const pauses = [];
let isRecording = false;
let undoStack = [];
let redoStack = [];
let trimRange = { start: 0, end: 1 };

// Utility functions
function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }
function setProgress(p) {
  show(progressWrap);
  progressBar.style.width = `${p}%`;
  progressText.textContent = `${Math.round(p)}%`;
}
function dataURLOfCurrentFrame(video) {
  const c = document.createElement('canvas');
  const w = video.videoWidth;
  const h = video.videoHeight;
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(video, 0, 0, w, h);
  return c.toDataURL('image/png');
}

function saveProject() {
  if (!autosaveChk.checked) return;
  const state = {
    video: videoEl.src.startsWith('blob:') ? null : videoEl.src,
    pauses,
    trimRange,
    normalize: normalizeChk.checked,
    denoise: denoiseChk.checked,
  };
  localStorage.setItem('vpv_state', JSON.stringify(state));
}

function loadProjectFromLocalStorage() {
  const raw = localStorage.getItem('vpv_state');
  if (!raw) return;
  try {
    const s = JSON.parse(raw);
    trimRange = s.trimRange || trimRange;
    normalizeChk.checked = !!s.normalize;
    denoiseChk.checked = !!s.denoise;
  } catch {}
}

// File upload / drag‑and‑drop
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
dropzone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropzone.classList.remove('drag');
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) await loadVideoFile(f);
});
fileInput.addEventListener('change', async () => {
  const f = fileInput.files && fileInput.files[0];
  if (f) await loadVideoFile(f);
});

async function loadVideoFile(file) {
  const url = URL.createObjectURL(file);
  videoEl.src = url;
  await videoEl.play().catch(() => {});
  videoEl.pause();
  show(playerArea);
  saveProject();
}

// Recording logic
async function startRecording() {
  if (isRecording) return;
  const constraints = { audio: { echoCancellation: true, noiseSuppression: true }, video: false };
  stream = await navigator.mediaDevices.getUserMedia(constraints);
  audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  let lastNode = source;
  if (denoiseChk.checked) {
    denoiseNode = audioCtx.createBiquadFilter();
    denoiseNode.type = 'highpass';
    denoiseNode.frequency.value = 80;
    lastNode.connect(denoiseNode);
    lastNode = denoiseNode;
  }
  if (normalizeChk.checked) {
    compNode = audioCtx.createDynamicsCompressor();
    compNode.threshold.value = -24;
    compNode.ratio.value = 3;
    lastNode.connect(compNode);
    lastNode = compNode;
  }
  const dest = audioCtx.createMediaStreamDestination();
  lastNode.connect(dest);
  mediaRecorder = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000 });
  audioChunks.length = 0;
  mediaRecorder.ondataavailable = (e) => { if (e.data.size) audioChunks.push(e.data); };
  mediaRecorder.onstop = async () => {
    audioBlob = new Blob(audioChunks, { type: 'audio/webm;codecs=opus' });
    const arr = await audioBlob.arrayBuffer();
    if (audioCtx) {
      const buf = await audioCtx.decodeAudioData(arr.slice(0));
      const ch0 = buf.getChannelData(0);
      audioPCM = new Float32Array(ch0.length);
      audioPCM.set(ch0);
      waveform.drawFromPCM(audioPCM);
    }
    saveProject();
  };
  mediaRecorder.start(100);
  isRecording = true;
  badge.classList.remove('hidden');
  await videoEl.play();
}

function stopRecording() {
  if (!isRecording) return;
  if (mediaRecorder) mediaRecorder.stop();
  if (stream) stream.getTracks().forEach((t) => t.stop());
  if (audioCtx) audioCtx.close();
  isRecording = false;
  badge.classList.add('hidden');
}

function togglePause() {
  if (!isRecording) return;
  if (!videoEl.paused) {
    const frame = dataURLOfCurrentFrame(videoEl);
    window._vpv_lastPause = { t: videoEl.currentTime, frame };
    videoEl.pause();
  } else {
    const lp = window._vpv_lastPause;
    if (lp) {
      const prev = window._vpv_pauseStartAt;
      const dur = prev ? (performance.now() - prev) / 1000 : 0.01;
      pauses.push({ startVideoTime: lp.t, pauseDuration: Math.max(0.01, dur), frameDataURL: lp.frame });
    }
    videoEl.play();
  }
}

videoEl.addEventListener('pause', () => {
  if (isRecording) window._vpv_pauseStartAt = performance.now();
});
videoEl.addEventListener('play', () => {
  window._vpv_pauseStartAt = 0;
});

startRecBtn.addEventListener('click', () => {
  if (isRecording) {
    stopRecording();
    startRecBtn.textContent = '🎙️ התחל הקלטה (R)';
  } else {
    startRecording();
    startRecBtn.textContent = '⏹️ עצור הקלטה (R)';
  }
});
togglePauseBtn.addEventListener('click', togglePause);
exportBtn.addEventListener('click', doExport);

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); togglePause(); }
  if (e.key.toLowerCase() === 'r') { e.preventDefault(); startRecBtn.click(); }
  if (e.key.toLowerCase() === 'e') { e.preventDefault(); exportBtn.click(); }
});

trimSilenceBtn.addEventListener('click', () => {
  if (!audioPCM) return;
  const threshold = 0.02;
  let i = 0, j = audioPCM.length - 1;
  while (i < audioPCM.length && Math.abs(audioPCM[i]) < threshold) i++;
  while (j > 0 && Math.abs(audioPCM[j]) < threshold) j--;
  const prev = { ...trimRange };
  trimRange = { start: i / audioPCM.length, end: (j + 1) / audioPCM.length };
  undoStack.push({ type: 'trim', from: prev, to: trimRange });
  redoStack.length = 0;
  const sliced = audioPCM.slice(Math.floor(i), Math.ceil(j + 1));
  waveform.drawFromPCM(sliced);
  saveProject();
});

undoBtn.addEventListener('click', () => {
  const item = undoStack.pop();
  if (!item) return;
  redoStack.push(item);
  trimRange = item.from;
  if (audioPCM) waveform.drawFromPCM(audioPCM);
  saveProject();
});
redoBtn.addEventListener('click', () => {
  const item = redoStack.pop();
  if (!item) return;
  undoStack.push(item);
  trimRange = item.to;
  if (audioPCM) {
    const start = Math.floor(trimRange.start * audioPCM.length);
    const end = Math.floor(trimRange.end * audioPCM.length);
    waveform.drawFromPCM(audioPCM.slice(start, end));
  }
  saveProject();
});

// Export logic
async function doExport() {
  if (!audioBlob) { alert('אין קריינות מוקלטת'); return; }
  setProgress(1);
  const exporter = new Exporter((p) => setProgress(p));
  try {
    // prepare trimmed audio
    let trimmed = audioBlob;
    if (audioPCM) {
      const start = Math.floor(trimRange.start * audioPCM.length);
      const end = Math.floor(trimRange.end * audioPCM.length);
      const offline = new OfflineAudioContext(1, end - start, 48000);
      const buf = offline.createBuffer(1, end - start, 48000);
      const ch = buf.getChannelData(0);
      ch.set(audioPCM.slice(start, end));
      const src = offline.createBufferSource();
      src.buffer = buf;
      src.connect(offline.destination);
      src.start();
      const rendered = await offline.startRendering();
      const wav = bufferToWav(rendered);
      trimmed = new Blob([wav], { type: 'audio/wav' });
    }
    const out = await exporter.export({
      videoBlob: await fetch(videoEl.src).then((r) => r.blob()),
      audioBlob: trimmed,
      pauses,
      normalize: normalizeChk.checked,
    });
    setProgress(100);
    progressText.textContent = 'ההורדה הושלמה';
    const url = URL.createObjectURL(out);
    const a = document.createElement('a');
    a.href = url; a.download = 'voice-pause-video.mp4';
    a.click();
  } catch (e) {
    console.error(e);
    alert('שגיאה ביצוא: ' + (e && e.message));
  } finally {
    setTimeout(() => hide(progressWrap), 2500);
  }
}

// Helper: convert AudioBuffer to a WAV ArrayBuffer
function bufferToWav(buffer) {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const out = new ArrayBuffer(length);
  const view = new DataView(out);
  const channels = [];
  let offset = 0;
  const writeUTFBytes = (view2, offset2, text) => {
    for (let i = 0; i < text.length; i++) {
      view2.setUint8(offset2 + i, text.charCodeAt(i));
    }
  };
  // RIFF header
  writeUTFBytes(view, offset, 'RIFF'); offset += 4;
  view.setUint32(offset, length - 8, true); offset += 4;
  writeUTFBytes(view, offset, 'WAVE'); offset += 4;
  writeUTFBytes(view, offset, 'fmt '); offset += 4;
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint16(offset, numOfChan, true); offset += 2;
  view.setUint32(offset, buffer.sampleRate, true); offset += 4;
  view.setUint32(offset, buffer.sampleRate * 2 * numOfChan, true); offset += 4;
  view.setUint16(offset, numOfChan * 2, true); offset += 2;
  view.setUint16(offset, 16, true); offset += 2;
  writeUTFBytes(view, offset, 'data'); offset += 4;
  view.setUint32(offset, length - offset - 4, true); offset += 4;
  for (let i = 0; i < numOfChan; i++) channels.push(buffer.getChannelData(i));
  let interleaved = new Float32Array(buffer.length * numOfChan);
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numOfChan; ch++) {
      interleaved[i * numOfChan + ch] = channels[ch][i];
    }
  }
  for (let i = 0; i < interleaved.length; i++) {
    const s = Math.max(-1, Math.min(1, interleaved[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }
  return out;
}

// Initial load
loadProjectFromLocalStorage();