export class SimpleRateLimiter {
  private last: number = 0
  constructor(private minIntervalMs: number) {}
  async wait(){
    const now = Date.now()
    const delta = now - this.last
    if(delta < this.minIntervalMs){
      await new Promise(r => setTimeout(r, this.minIntervalMs - delta))
    }
    this.last = Date.now()
  }
}
