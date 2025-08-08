export class Waveform {
  // non-null assertion on ctx allows strict property initialization
  // width/height are initialized to 0 to satisfy TypeScript strict checks
  private ctx!: CanvasRenderingContext2D;
  private width: number = 0;
  private height: number = 0;
  private pixelRatio = Math.min(2, window.devicePixelRatio || 1);

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not available');
    this.ctx = ctx;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.width = Math.floor(this.canvas.clientWidth * this.pixelRatio);
    this.height = Math.floor(this.canvas.clientHeight * this.pixelRatio);
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.clear();
  }

  clear() {
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, this.width, this.height);
    this.ctx.strokeStyle = '#4f46e5';
  }

  drawFromPCM(float32: Float32Array) {
    this.clear();
    const { ctx, width, height } = this;
    const step = Math.max(1, Math.floor(float32.length / width));
    ctx.beginPath();
    for (let x = 0; x < width; x++) {
      const start = x * step;
      let min = 1, max = -1;
      for (let i = 0; i < step && start + i < float32.length; i++) {
        const v = float32[start + i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const y1 = (1 - (min * 0.9 + 1) / 2) * height;
      const y2 = (1 - (max * 0.9 + 1) / 2) * height;
      ctx.moveTo(x + .5, y1);
      ctx.lineTo(x + .5, y2);
    }
    ctx.stroke();
  }
}
