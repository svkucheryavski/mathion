// The few Node built-ins the OLX reader tests use; the project has no @types/node.
interface NodeBufferModule {
  Blob: typeof Blob;
  File: typeof File;
}

interface NodeStreamWebModule {
  ReadableStream: typeof ReadableStream;
  CompressionStream: typeof CompressionStream;
  DecompressionStream: typeof DecompressionStream;
}

interface NodeFsModule {
  readFileSync(path: string): Uint8Array<ArrayBuffer>;
  readFileSync(path: string, encoding: 'utf8'): string;
}

interface NodeProcessLite {
  getBuiltinModule(id: 'node:buffer'): NodeBufferModule;
  getBuiltinModule(id: 'node:stream/web'): NodeStreamWebModule;
  getBuiltinModule(id: 'node:fs'): NodeFsModule;
}

declare var process: NodeProcessLite;
