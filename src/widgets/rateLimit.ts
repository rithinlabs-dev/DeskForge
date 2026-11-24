/** Token bucket: `capacity` requests at once, refilled at `refillPerSec`. */
export class RateLimiter {
  private tokens: number;
  private last: number;

  constructor(
    private capacity = 60,
    private refillPerSec = 30,
    private now: () => number = () => Date.now(),
  ) {
    this.tokens = capacity;
    this.last = now();
  }

  take(): boolean {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.refillPerSec);
    this.last = t;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}
