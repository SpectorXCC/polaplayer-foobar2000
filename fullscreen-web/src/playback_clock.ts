/** Interpolates host snapshots on the local monotonic clock. */
export class PlaybackClock {
  private anchorMs = 0;
  private anchorAt = 0;
  private correctionMs = 0;
  private advancing = false;
  private durationMs = 0;

  at(now: number): number {
    let time = this.anchorMs;
    if (this.advancing) {
      const elapsed = Math.max(0, now - this.anchorAt);
      // A negative correction slows playback slightly but never reverses it.
      const correction = Math.sign(this.correctionMs) * Math.min(Math.abs(this.correctionMs), elapsed * 0.2);
      time += elapsed + correction;
    }
    return this.durationMs > 0 ? Math.min(this.durationMs, time) : time;
  }

  sync(timeSec: number, durationSec: number, advancing: boolean, reset: boolean, now: number): void {
    const previous = this.at(now);
    const target = Number.isFinite(timeSec) ? Math.max(0, timeSec * 1000) : 0;
    this.anchorMs = reset || !advancing ? target : previous;
    this.anchorAt = now;
    this.correctionMs = advancing && !reset ? target - this.anchorMs : 0;
    this.advancing = advancing;
    this.durationMs = Number.isFinite(durationSec) ? Math.max(0, durationSec * 1000) : 0;
  }
}
