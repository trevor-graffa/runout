export { Range, parseRange, parseCards } from "./ranges.js";
/** Async browser API. Parsing, simulation and evaluation run inside a worker. */
export class Calculator {
  constructor(ranges, { game = "holdem", board = "", dead = "" } = {}) {
    this.worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    this.pending = new Map(); this.nextId = 0; this.disposed = false;
    this.worker.onmessage = ({ data }) => {
      const request = this.pending.get(data.id); if (!request) return;
      if(data.progress){
        try{request.onProgress?.(data.progress);}catch(error){this.pending.delete(data.id);request.reject(error);}
        return;
      }
      this.pending.delete(data.id);
      if (data.error) request.reject(new Error(data.error)); else request.resolve(data.result);
    };
    this.worker.onerror = error => {
      for (const request of this.pending.values()) request.reject(new Error(error.message));
      this.pending.clear();
    };
    this.ready = this.request("configure", { ranges, game, board, dead });
  }
  request(operation, payload, onProgress) {
    if (this.disposed) return Promise.reject(new Error("Calculator is disposed"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress }); this.worker.postMessage({ id, operation, payload });
    });
  }
  async equity({onProgress,...options} = {}) {
    if(onProgress!==undefined&&typeof onProgress!=='function')throw new Error('onProgress must be a function');
    await this.ready; return this.request("equity", options, onProgress);
  }
  exact(options = {}) { return this.equity({ ...options, method: "exact" }); }
  simulate(options = {}) { return this.equity({ ...options, method: "monte_carlo" }); }
  async evaluateCards(cards) { await this.ready; return this.request("evaluateCards", { cards }); }
  async evaluateHand(hole, board) { await this.ready; return this.request("evaluateHand", { hole, board }); }
  dispose() {
    this.disposed = true; this.worker.terminate();
    for (const request of this.pending.values()) request.reject(new Error("Calculation cancelled"));
    this.pending.clear();
  }
}
