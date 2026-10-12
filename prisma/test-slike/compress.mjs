import sharp from 'sharp';
import { readdirSync, statSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const dir = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir).filter(f => f.endsWith('.png'));
const manifest = [];
for (const f of files) {
  const out = join(dir, f.replace('.png', '.jpg'));
  await sharp(join(dir, f)).resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 74 }).toFile(out);
  const kb = Math.round(statSync(out).size / 1024);
  manifest.push({ file: f.replace('.png', '.jpg'), kb });
  console.log(`${f.replace('.png', '.jpg')}  ${kb} kB`);
}
writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log('Skupaj:', Math.round(manifest.reduce((s, m) => s + m.kb, 0)), 'kB v', files.length, 'slikah');
