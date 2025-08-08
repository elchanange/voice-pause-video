// Exporter module ported from the TypeScript implementation.
// Uses ffmpeg.wasm to merge a voice‑over track with a video and
// handles pauses by inserting still frames for the pause durations.

export class Exporter {
  /**
   * Create a new exporter.  Pass a callback to receive progress updates (0–100).
   * @param {function(number): void} onProgress
   */
  constructor(onProgress) {
    this.onProgress = onProgress;
    this.ffmpeg = null;
  }

  /**
   * Ensure ffmpeg.wasm is loaded.  Loads once on demand.
   */
  async ensureFFmpeg() {
    if (this.ffmpeg) return;
    // Attempt to obtain the FFmpeg class from the global scope.  Depending on the build
    // loaded in index.html, the UMD build attaches an object named `FFmpegWASM` to the
    // window with a `FFmpeg` property.  Earlier versions exposed `FFmpeg` directly on
    // window.  We poll a few times to allow the script to finish loading before giving up.
    let FFmpegClass = window.FFmpeg || (window.FFmpegWASM && window.FFmpegWASM.FFmpeg);
    // Poll up to 10 times with 500ms interval for the script to load
    for (let i = 0; !FFmpegClass && i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      FFmpegClass = window.FFmpeg || (window.FFmpegWASM && window.FFmpegWASM.FFmpeg);
    }
    if (!FFmpegClass) {
      throw new Error('ffmpeg script not loaded');
    }
    this.ffmpeg = new FFmpegClass();
    // Explicitly provide the URLs for the ffmpeg core files.  Without these
    // parameters, the library falls back to a default that may attempt to
    // dynamically import worker chunks from the @ffmpeg/ffmpeg package.  On
    // GitHub Pages this can trigger a CORS error because those chunk files are
    // not served from our origin.  Pointing coreURL/wasmURL/workerURL at the
    // @ffmpeg/core package (version 0.10.0) ensures a single bundle is loaded
    // without cross‑origin requests.
    await this.ffmpeg.load({
      coreURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.10.0/dist/ffmpeg-core.js',
      wasmURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.10.0/dist/ffmpeg-core.wasm',
      workerURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.10.0/dist/ffmpeg-core.worker.js',
      logger: ({ message }) => {
        const m = String(message || '');
        const match = m.match(/\s(\d{1,3})%/);
        if (match) this.onProgress(Number(match[1]));
      },
    });
  }

  /**
   * Write a file into ffmpeg's virtual FS.
   * Accepts Uint8Array, ArrayBuffer or Blob.
   */
  async writeFile(name, data) {
    let u8;
    if (data instanceof Uint8Array) u8 = data;
    else if (data instanceof ArrayBuffer) u8 = new Uint8Array(data);
    else u8 = new Uint8Array(await data.arrayBuffer());
    await this.ffmpeg.writeFile(name, u8);
  }

  /**
   * Export a new MP4 combining the original video and trimmed/paused voice‑over.
   * @param {Object} opts
   * @param {Blob} opts.videoBlob Original video file
   * @param {Blob} opts.audioBlob Recorded narration
   * @param {Array} opts.pauses Array of pause descriptors (startVideoTime, pauseDuration, frameDataURL)
   * @param {boolean} opts.normalize Whether to normalize audio loudness
   * @returns {Promise<Blob>} Final MP4 blob
   */
  async export({ videoBlob, audioBlob, pauses, normalize = false }) {
    await this.ensureFFmpeg();
    // copy inputs
    await this.writeFile('input.mp4', videoBlob);
    await this.writeFile('voice.m4a', audioBlob);

    let last = 0;
    let segIndex = 0;
    const concatList = [];

    const fmtTime = (t) => t.toFixed(3);

    for (const p of pauses) {
      const segStart = last;
      const segEnd = p.startVideoTime;
      if (segEnd > segStart + 0.001) {
        const out = `seg_${segIndex++}.mp4`;
        await this.ffmpeg.exec(['-i','input.mp4','-ss',fmtTime(segStart),'-to',fmtTime(segEnd),'-c','copy',out]);
        concatList.push(`file '${out}'`);
      }
      const stillPng = `still_${segIndex}.png`;
      const b = await (await fetch(p.frameDataURL)).arrayBuffer();
      await this.writeFile(stillPng, b);
      const stillMp4 = `seg_${segIndex++}.mp4`;
      const freezeFilters = ['-loop','1','-i',stillPng,'-t',fmtTime(p.pauseDuration),'-vf','format=yuv420p,scale=trunc(iw/2)*2:trunc(ih/2)*2','-r','30','-pix_fmt','yuv420p',stillMp4];
      await this.ffmpeg.exec(freezeFilters);
      concatList.push(`file '${stillMp4}'`);
      last = segEnd;
    }
    // tail segment
    const tailOut = `seg_${segIndex++}.mp4`;
    await this.ffmpeg.exec(['-i','input.mp4','-ss',fmtTime(last),'-c','copy',tailOut]);
    concatList.push(`file '${tailOut}'`);

    // write concat list
    const concatTxt = concatList.join('\n');
    await this.writeFile('list.txt', new TextEncoder().encode(concatTxt));

    // concat segments
    await this.ffmpeg.exec(['-f','concat','-safe','0','-i','list.txt','-c','copy','video_full.mp4']);

    // normalize voice if requested
    const audioOut = normalize ? ['-af','loudnorm=I=-16:TP=-1.5:LRA=11'] : [];
    await this.ffmpeg.exec(['-i','voice.m4a',...audioOut,'-c:a','aac','-b:a','192k','voice.aac']);

    // mux final
    await this.ffmpeg.exec(['-i','video_full.mp4','-i','voice.aac','-map','0:v:0','-map','1:a:0','-c:v','copy','-shortest','output.mp4']);
    const data = await this.ffmpeg.readFile('output.mp4');
    return new Blob([data.buffer], { type: 'video/mp4' });
  }
}