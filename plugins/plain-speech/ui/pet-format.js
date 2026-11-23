(() => {
  const actions = ['text', 'diagram', 'ask'];
  const maxBytes = 512 * 1024;
  const codexDimensions = { text: [1086, 362], diagram: [448, 490], ask: [448, 448] };
  const gridColumns = { 'grid-2x2-v1': 2, 'grid-4x4-v1': 4 };

  function webpSize(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = (offset) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
    if (bytes.length < 30 || tag(0) !== 'RIFF' || view.getUint32(4, true) + 8 !== bytes.length || tag(8) !== 'WEBP') return;
    let canvas;
    let picture;
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const kind = tag(offset);
      const size = view.getUint32(offset + 4, true);
      const start = offset + 8;
      offset = start + size + (size % 2);
      if (offset > bytes.length || kind === 'ANIM' || kind === 'ANMF') return;
      if (kind === 'VP8X') {
        if (canvas || size !== 10 || (bytes[start] & 2)) return;
        const side = (index) => 1 + bytes[index] + (bytes[index + 1] << 8) + (bytes[index + 2] << 16);
        canvas = [side(start + 4), side(start + 7)];
      } else if (kind === 'VP8L') {
        if (picture || size < 5 || bytes[start] !== 0x2f) return;
        const dimensions = view.getUint32(start + 1, true);
        picture = [(dimensions & 0x3fff) + 1, ((dimensions >>> 14) & 0x3fff) + 1];
      } else if (kind === 'VP8 ') {
        if (picture || size < 10 || bytes[start + 3] !== 0x9d || bytes[start + 4] !== 1 || bytes[start + 5] !== 0x2a) return;
        picture = [view.getUint16(start + 6, true) & 0x3fff, view.getUint16(start + 8, true) & 0x3fff];
      }
    }
    if (offset !== bytes.length || !picture || canvas?.some((value, index) => value !== picture[index])) return;
    return picture;
  }

  function decodePetPack(input) {
    const layout = input?.layout;
    const columns = typeof layout === 'string' && Object.hasOwn(gridColumns, layout) ? gridColumns[layout] : undefined;
    if (input?.format !== 'grandma-mode-pet' || input.version !== 1
        || (!columns && layout !== 'codex-v1')
        || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 60
        || typeof (input.credit ?? '') !== 'string' || (input.credit?.length ?? 0) > 240) return;
    const sprites = {};
    const bytes = {};
    let total = 0;
    for (const action of actions) {
      const data = input.sprites?.[action];
      if (typeof data !== 'string' || data.length > Math.ceil(maxBytes / 3) * 4
          || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return;
      const raw = atob(data);
      total += raw.length;
      if (total > maxBytes || btoa(raw) !== data) return;
      bytes[action] = Uint8Array.from(raw, (character) => character.charCodeAt(0));
      const [width, height] = webpSize(bytes[action]) ?? [];
      const valid = input.layout === 'codex-v1'
        ? width === codexDimensions[action][0] && height === codexDimensions[action][1]
        : width === height && width >= columns * 128 && width <= 1536 && width % columns === 0;
      if (!valid) return;
      sprites[action] = data;
    }
    return { pack: {
      format: input.format, version: 1, layout: input.layout,
      name: input.name.trim(), credit: input.credit?.trim() ?? '', sprites,
    }, bytes };
  }

  if (typeof module === 'object' && module.exports) module.exports = decodePetPack;
  else window.decodeGrandmaPetPack = decodePetPack;
})();
