// Waveform module translated from the TypeScript implementation.
// Draws a simple audio waveform on a canvas based on PCM data.

export class Waveform {
  /**
   * Construct a waveform renderer bound to a canvas element.
   * It listens for resize events and automatically redraws.
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not available');
    this.ctx = ctx;
    this.pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /**
   * Recalculate dimensions and clear the canvas on resize.
   */
  resize() {
    this.width = Math.floor(this.canvas.clientWidth * this.pixelRatio);
    this.height = Math.floor(this.canvas.clientHeight * this.pixelRatio);
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.clear();
  }

  /**
   * Clear the canvas with a white background and set stroke colour.
   */
  clear() {
    const ctx = this.ctx;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.strokeStyle = '#4f46e5';
  }

  /**
   * Draw a waveform based off a Float32Array of PCM samples.
   * @param {Float32Array} float32
   */
  drawFromPCM(float32) {
    this.clear();
    const ctx = this.ctx;
    const width = this.width;
    const height = this.height;
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
      ctx.moveTo(x + 0.5, y1);
      ctx.lineTo(x + 0.5, y2);
    }
    ctx.stroke();
  }
}