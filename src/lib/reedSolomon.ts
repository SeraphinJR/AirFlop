type ReedSolomonExports = WebAssembly.Exports & {
  memory: WebAssembly.Memory
  __wbindgen_malloc(size: number): number
  __wbindgen_free(pointer: number, size: number): void
  encode(pointer: number, length: number, dataShards: number, parityShards: number): number
}

export class ReedSolomonErasure {
  static readonly RESULT_OK = 0

  private readonly wasmExports: ReedSolomonExports
  private memoryCache: Uint8Array | null = null

  private constructor(wasmExports: ReedSolomonExports) {
    this.wasmExports = wasmExports
  }

  static async fromResponse(source: Promise<Response>): Promise<ReedSolomonErasure> {
    let instance: WebAssembly.Instance

    try {
      ;({ instance } = await WebAssembly.instantiateStreaming(source))
    } catch {
      const response = await source
      ;({ instance } = await WebAssembly.instantiate(await response.arrayBuffer()))
    }

    return new ReedSolomonErasure(instance.exports as ReedSolomonExports)
  }

  encode(shards: Uint8Array, dataShards: number, parityShards: number): number {
    const { __wbindgen_malloc, __wbindgen_free, encode } = this.wasmExports
    const pointer = __wbindgen_malloc(shards.length)
    this.getUint8Memory().set(shards, pointer)
    const shardSize = shards.length / (dataShards + parityShards)
    const result = encode(pointer, shards.length, dataShards, parityShards)

    if (result === ReedSolomonErasure.RESULT_OK) {
      shards.set(
        this.getUint8Memory().subarray(pointer + shardSize * dataShards, pointer + shards.length),
        shardSize * dataShards,
      )
    }

    __wbindgen_free(pointer, shards.length)
    return result
  }

  private getUint8Memory(): Uint8Array {
    if (!this.memoryCache || this.memoryCache.buffer !== this.wasmExports.memory.buffer) {
      this.memoryCache = new Uint8Array(this.wasmExports.memory.buffer)
    }
    return this.memoryCache
  }
}
