// SPPB envelope: magic (4 bytes), format version, file kind, reserved (2).
// Version 1 payload is compact UTF-8 JSON compressed with gzip. The extension
// version inside the payload remains independent of this envelope version.
const SNIPPET_FILE_MAGIC = [0x53, 0x50, 0x50, 0x42];
const SNIPPET_FILE_KINDS = Object.freeze({ settings: 1, group: 2 });

async function encodeSnippetExport(data, kind, format) {
  if (!SNIPPET_FILE_KINDS[kind]) throw new Error('Unknown export kind');
  if (format === 'json') {
    return new Blob([JSON.stringify(data, null, 2)], { type: 'application/octet-stream' });
  }
  if (format !== 'binary') throw new Error('Unknown export format');
  const payload = new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream('gzip'));
  const compressed = await new Response(payload).arrayBuffer();
  const header = new Uint8Array([...SNIPPET_FILE_MAGIC, 1, SNIPPET_FILE_KINDS[kind], 0, 0]);
  return new Blob([header, compressed], { type: 'application/octet-stream' });
}

async function decodeSnippetExport(buffer, kind) {
  const bytes = new Uint8Array(buffer);
  const binary = SNIPPET_FILE_MAGIC.every((byte, index) => bytes[index] === byte);
  let text;
  if (binary) {
    if (bytes.length <= 8 || bytes[4] !== 1 || bytes[5] !== SNIPPET_FILE_KINDS[kind] || bytes[6] !== 0 || bytes[7] !== 0) {
      throw new Error('Invalid or unsupported snippet file');
    }
    const payload = new Blob([bytes.subarray(8)]).stream().pipeThrough(new DecompressionStream('gzip'));
    const decompressed = await new Response(payload).arrayBuffer();
    text = new TextDecoder('utf-8', { fatal: true }).decode(decompressed);
  } else {
    // Legacy plain JSON and newly exported JSON follow the same import flow.
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  return JSON.parse(text);
}
