import { readFile, writeFile } from 'node:fs/promises';
import { normalizePetPack } from '../../../server/pet-pack.mjs';

async function main() {
  const [output, name, credit, slide, draw, knit] = process.argv.slice(2);
  if (!output?.endsWith('.grandma-pet.json') || !name || !slide || !draw || !knit) {
    throw new Error('Usage: node pack-pet.mjs <out.grandma-pet.json> <name> <credit> <slide.webp> <draw.webp> <knit.webp>');
  }
  const [text, diagram, ask] = await Promise.all([slide, draw, knit].map((path) => readFile(path, 'base64')));
  const pack = normalizePetPack({
    format: 'grandma-mode-pet', version: 1, layout: 'grid-2x2-v1', name, credit,
    sprites: { text, diagram, ask },
  });
  if (!pack) throw new Error('Expected three square still WebP sheets (even sides between 256 and 1536 px, at most 512 KiB total).');
  await writeFile(output, JSON.stringify(pack) + '\n', { flag: 'wx' });
  console.log(output);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
