import fs from 'fs';
import { renderPageAsImage } from 'unpdf';
const f = 'C:/Users/49172/Downloads/146961 - JA 2024 (gebundene Version).pdf';
const buf = new Uint8Array(fs.readFileSync(f));
const out = process.argv[2];
const from = Number(process.argv[3]), to = Number(process.argv[4]);
for (let p = from; p <= to; p++) {
  try {
  const img = await renderPageAsImage(buf, p, { scale: 2, canvasImport: () => import('@napi-rs/canvas') });
  fs.writeFileSync(`${out}/p${String(p).padStart(2,'0')}.png`, Buffer.from(img as ArrayBuffer));
  process.stdout.write(`${p} `);
  } catch (e) { console.log(`
FAIL p${p}: ${e instanceof Error ? e.message.slice(0,90) : e}`); }
}
console.log('ok');
