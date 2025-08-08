// Export logic using ffmpeg.wasm to merge voice-over (recorded audio) with video.
// Also inserts freeze segments for each pause range to keep A/V in sync.
export interface PauseRange { startVideoTime: number; pauseDuration: number; frameDataURL: string; }

export class Exporter {
  // initialize ffmpeg to undefined so property is defined under strict initialization
  private ffmpeg: any = undefined;
  constructor(private onProgress: (p: number) => void) {}

  async ensureFFmpeg() {
    // Load @ffmpeg/ffmpeg from global
    if (this.ffmpeg) return;
    const { FFmpeg } = window as any;
    if (!FFmpeg || !FFmpeg.createFFmpeg) throw new Error('ffmpeg script not loaded');
    const { createFFmpeg } = FFmpeg;
    this.ffmpeg = createFFmpeg({
      log: false,
      corePath: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.10.0/dist/ffmpeg-core.js',
      // Provide a type for the destructured message parameter to satisfy strict TypeScript settings.
      logger: ({ message }: { message?: any }) => {
        const m = String(message || '');
        const match = m.match(/\s(\d{1,3})%/);
        if (match) this.onProgress(Number(match[1]));
      },
    });
    await this.ffmpeg.load();
  }

  private async writeFile(name: string, data: Uint8Array | ArrayBuffer | Blob) {
    let u8: Uint8Array;
    if (data instanceof Uint8Array) u8 = data;
    else if (data instanceof ArrayBuffer) u8 = new Uint8Array(data);
    else u8 = new Uint8Array(await data.arrayBuffer());
    this.ffmpeg.FS('writeFile', name, u8);
  }

  // Build video segments (real + freezes) via concat
  async export({
    videoBlob,
    audioBlob,
    pauses,
    normalize = false
  }: {
    videoBlob: Blob;
    audioBlob: Blob;
    pauses: PauseRange[];
    normalize?: boolean;
  }): Promise<Blob> {
    await this.ensureFFmpeg();
    // Inputs
    await this.writeFile('input.mp4', videoBlob);
    await this.writeFile('voice.m4a', audioBlob);

    // Prepare commands
    let last = 0;
    let segIndex = 0;
    const concatList: string[] = [];

    function fmtTime(t:number){ return t.toFixed(3); }

    for (const p of pauses) {
      const segStart = last;
      const segEnd = p.startVideoTime;
      if (segEnd > segStart + 0.001) {
        // real segment
        const out = `seg_${segIndex++}.mp4`;
        await this.ffmpeg.run('-i','input.mp4','-ss',fmtTime(segStart),'-to',fmtTime(segEnd),'-c','copy',out);
        concatList.push(`file '${out}'`);
      }
      // freeze segment from frameDataURL for pauseDuration
      const stillPng = `still_${segIndex}.png`;
      const b = await (await fetch(p.frameDataURL)).arrayBuffer();
      await this.writeFile(stillPng, b);
      const stillMp4 = `seg_${segIndex++}.mp4`;
      const freezeFilters = ['-loop','1','-i',stillPng,'-t',fmtTime(p.pauseDuration),'-vf','format=yuv420p,scale=trunc(iw/2)*2:trunc(ih/2)*2','-r','30','-pix_fmt','yuv420p',stillMp4];
      await this.ffmpeg.run(...freezeFilters);
      concatList.push(`file '${stillMp4}'`);
      last = segEnd;
    }
    // Tail segment
    const tailOut = `seg_${segIndex++}.mp4`;
    await this.ffmpeg.run('-i','input.mp4','-ss',fmtTime(last),'-c','copy',tailOut);
    concatList.push(`file '${tailOut}'`);

    // Write concat list
    const concatTxt = concatList.join('\n');
    await this.writeFile('list.txt', new TextEncoder().encode(concatTxt));

    // Concat video segments
    await this.ffmpeg.run('-f','concat','-safe','0','-i','list.txt','-c','copy','video_full.mp4');

    // Optionally normalize voice (loudnorm)
    const audioOut = normalize ? ['-af','loudnorm=I=-16:TP=-1.5:LRA=11'] : [];
    await this.ffmpeg.run('-i','voice.m4a',...audioOut,'-c:a','aac','-b:a','192k','voice.aac');

    // Mux final
    await this.ffmpeg.run('-i','video_full.mp4','-i','voice.aac','-map','0:v:0','-map','1:a:0','-c:v','copy','-shortest','output.mp4');

    const data = this.ffmpeg.FS('readFile', 'output.mp4');
    return new Blob([data.buffer], { type: 'video/mp4' });
  }
}
