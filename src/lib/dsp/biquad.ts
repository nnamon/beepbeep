// Second-order low-pass and high-pass filters (RBJ cookbook), Butterworth by default.

export class LowPass {
  private b0 = 0; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;

  constructor(private readonly fs: number, cutoff: number, private readonly q = Math.SQRT1_2) {
    this.setCutoff(cutoff);
  }

  setCutoff(fc: number) {
    const w0 = (2 * Math.PI * Math.min(fc, this.fs * 0.45)) / this.fs;
    const alpha = Math.sin(w0) / (2 * this.q);
    const cosw = Math.cos(w0);
    const a0 = 1 + alpha;
    this.b0 = (1 - cosw) / 2 / a0;
    this.b1 = (1 - cosw) / a0;
    this.b2 = (1 - cosw) / 2 / a0;
    this.a1 = (-2 * cosw) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  step(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }

  reset() {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
}

export class HighPass {
  private b0 = 0; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;

  constructor(private readonly fs: number, cutoff: number, private readonly q = Math.SQRT1_2) {
    const w0 = (2 * Math.PI * Math.min(cutoff, this.fs * 0.45)) / this.fs;
    const alpha = Math.sin(w0) / (2 * this.q);
    const cosw = Math.cos(w0);
    const a0 = 1 + alpha;
    this.b0 = (1 + cosw) / 2 / a0;
    this.b1 = -(1 + cosw) / a0;
    this.b2 = (1 + cosw) / 2 / a0;
    this.a1 = (-2 * cosw) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  step(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }
}
