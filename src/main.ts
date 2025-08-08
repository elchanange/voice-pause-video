import { Waveform } from './waveform';
import { Exporter, PauseRange } from './exporter';
import pkg from '../package.json' assert { type: 'json' };

// App State
type HistoryItem = { type: 'trim'; from: { start: number; end: number }; to: { start: number; end: number } };

const videoEl = document.getElementById('video') as HTMLVideoElement;
const badge = document.getElementById('recordBadge') as HTMLDivElement;
const startRecBtn = document.getElementById('startRec') as HTMLButtonElement;
const togglePauseBtn = document.getElementById('togglePause') as HTMLButtonElement;
const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;
const fileInput = document.getElementById('videoFile') as HTMLInputElement;
const dropzone = document.getElementById('dropzone') as HTMLDivElement;
const playerArea = document.getElementById('playerArea') as HTMLDivElement;
const progressWrap = document.getElementById('progressWrap') as HTMLDivElement;
const progressBar = document.getElementById('progress') as HTMLDivElement;
const progressText = document.getElementById('progressText') as HTMLDivElement;
const waveCanvas = document.getElementById('wave') as HTMLCanvasElement;
const trimSilenceBtn = document.getElementById('trimSilence') as HTMLButtonElement;
const undoBtn = document.getElementById('undoBtn') as HTMLButtonElement;
const redoBtn = document.getElementById('redoBtn') as HTMLButtonElement;
const normalizeChk = document.getElementById('normalizeChk') as HTMLInputElement;
const denoiseChk = document.getElementById('denoiseChk') as HTMLInputElement;
const autosaveChk = document.getElementById('autosaveChk') as HTMLInputElement;
const versionEl = document.getElementById('version') as HTMLSpanElement;
versionEl.textContent = `v${pkg.version}`;

const waveform = new Waveform(waveCanvas);
const audioChunks: Blob[] = [];
let mediaRecorder: MediaRecorder | null = null;
let audioBlob: Blob | null = null;
let audioPCM: Float32Array | null = null;
let stream: MediaStream | null = null;
let audioCtx: AudioContext | null = null;
let denoiseNode: BiquadFilterNode | null = null;
let compNode: DynamicsCompressorNode | null = null;

const pauses: PauseRange[] = []; // ranges where the video was paused while recording
let isRecording = false;
let undoStack: HistoryItem[] = [];
let redoStack: HistoryItem[] = [];
let trimRange = { start: 0, end: 1 }; // as fraction of total samples

// --- Utils ---
function show(el: HTMLElement){ el.classList.remove('hidden'); }
function hide(el: HTMLElement){ el.classList.add('hidden'); }
function setProgress(p:number){
  show(progressWrap);
  progressBar.style.width = `${p}%`;
  progressText.textContent = `${Math.round(p)}%`;
}
function dataURLOfCurrentFrame(video: HTMLVideoElement) : string {
  const c = document.createElement('canvas');
  const w = video.videoWidth, h = video.videoHeight;
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
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

// --- File upload / DnD ---
dropzone.addEventListener('dragover', (e)=>{ e.preventDefault(); dropzone.classList.add('drag'); });
dropzone.addEventListener('dragleave', ()=> dropzone.classList.remove('drag'));
dropzone.addEventListener('drop', async (e)=> {
  e.preventDefault();
  dropzone.classList.remove('drag');
  const f = e.dataTransfer?.files?.[0];
  if (f) await loadVideoFile(f);
});
fileInput.addEventListener('change', async ()=> {
  const f = fileInput.files?.[0];
  if (f) await loadVideoFile(f);
});

async function loadVideoFile(file: File) {
  const url = URL.createObjectURL(file);
  videoEl.src = url;
  await videoEl.play().catch(()=>{});
  videoEl.pause();
  show(playerArea);
  saveProject();
}

// --- Recording ---
async function startRecording() {
  if (isRecording) return;
  const constraints: MediaStreamConstraints = { audio: { echoCancellation: true, noiseSuppression: true }, video: false };
  stream = await navigator.mediaDevices.getUserMedia(constraints);
  audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);

  // Optional denoise & normalize chain
  let lastNode: AudioNode = source;
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
  mediaRecorder.ondataavailable = (e)=>{ if (e.data.size) audioChunks.push(e.data); };
  mediaRecorder.onstop = async ()=> {
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
  mediaRecorder?.stop();
  stream?.getTracks().forEach(t => t.stop());
  audioCtx?.close();
  isRecording = false;
  badge.classList.add('hidden');
}

function togglePause() {
  if (!isRecording) return;
  if (!videoEl.paused) {
    const frame = dataURLOfCurrentFrame(videoEl);
    (window as any)._vpv_lastPause = { t: videoEl.currentTime, frame };
    videoEl.pause();
  } else {
    const lp = (window as any)._vpv_lastPause as { t: number; frame: string };
    if (lp) {
      const prev = (window as any)._vpv_pauseStartAt as number;
      const dur = prev ? (performance.now() - prev) / 1000 : 0.01;
      pauses.push({ startVideoTime: lp.t, pauseDuration: Math.max(0.01, dur), frameDataURL: lp.frame });
    }
    videoEl.play();
  }
}

videoEl.addEventListener('pause', ()=> {
  if (isRecording) (window as any)._vpv_pauseStartAt = performance.now();
});
videoEl.addEventListener('play', ()=> {
  (window as any)._vpv_pauseStartAt = 0;
});

startRecBtn.addEventListener('click', ()=> {
  if (isRecording) { stopRecording(); startRecBtn.textContent = '🎙️ התחל הקלטה (R)'; }
  else { startRecording(); startRecBtn.textContent = '⏹️ עצור הקלטה (R)'; }
});
togglePauseBtn.addEventListener('click', togglePause);
exportBtn.addEventListener('click', doExport);

window.addEventListener('keydown', (e)=>{
  if (e.code === 'Space') { e.preventDefault(); togglePause(); }
  if (e.key.toLowerCase() === 'r') { e.preventDefault(); startRecBtn.click(); }
  if (e.key.toLowerCase() === 'e') { e.preventDefault(); exportBtn.click(); }
});

trimSilenceBtn.addEventListener('click', ()=> {
  if (!audioPCM) return;
  const threshold = 0.02;
  let i = 0, j = audioPCM.length - 1;
  while (i < audioPCM.length && Math.abs(audioPCM[i]) < threshold) i++;
  while (j > 0 && Math.abs(audioPCM[j]) < threshold) j--;
  const prev = { ...trimRange };
  trimRange = { start: i / audioPCM.length, end: (j+1) / audioPCM.length };
  undoStack.push({ type:'trim', from: prev, to: trimRange });
  redoStack.length = 0;
  const sliced = audioPCM.slice(Math.floor(i), Math.ceil(j+1));
  waveform.drawFromPCM(sliced);
  saveProject();
});

undoBtn.addEventListener('click', ()=> {
  const item = undoStack.pop();
  if (!item) return;
  redoStack.push(item);
  trimRange = item.from;
  if (audioPCM) waveform.drawFromPCM(audioPCM);
  saveProject();
});
redoBtn.addEventListener('click', ()=> {
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
async function doExport() {
  if (!audioBlob) { alert('אין קריינות מוקלטת'); return; }
  setProgress(1);
  const exporter = new Exporter((p)=> setProgress(p));
  try {
    let trimmed: Blob = audioBlob;
    if (audioPCM) {
      const start = Math.floor(trimRange.start * audioPCM.length);
      const end = Math.floor(trimRange.end * audioPCM.length);
      const offline = new OfflineAudioContext(1, end-start, 48000);
      const buf = offline.createBuffer(1, end-start, 48000);
      const ch = buf.getChannelData(0);
      ch.set(audioPCM.slice(start, end));
      const src = offline.createBufferSource();
      src.buffer = buf;
      src.connect(offline.destination);
      src.start();
      const rendered = await offline.startRendering();
      const wav = bufferToWav(rendered);
      trimmed = new Blob([wav], { type:'audio/wav' });
    }

    const out = await exporter.export({
      videoBlob: await fetch(videoEl.src).then(r=>r.blob()),
      audioBlob: trimmed,
      pauses,
      normalize: normalizeChk.checked
    });
    setProgress(100);
    progressText.textContent = 'ההורדה הושלמה';
    const url = URL.createObjectURL(out);
    const a = document.createElement('a');
    a.href = url; a.download = 'voice-pause-video.mp4';
    a.click();
  } catch (e:any) {
    console.error(e);
    alert('שגיאה ביצוא: ' + e?.message);
  } finally {
    setTimeout(()=> hide(progressWrap), 2500);
  }
}

function bufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const out = new ArrayBuffer(length);
  const view = new DataView(out);
  const channels = [];
  let offset = 0;

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
  let index = 0;
  for (let i = 0; i < interleaved.length; i++) {
    const s = Math.max(-1, Math.min(1, interleaved[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }
  return out;
}
function writeUTFBytes(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

loadProjectFromLocalStorage();
