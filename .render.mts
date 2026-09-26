import fs from 'fs';
import { getDocumentProxy } from 'unpdf';
import { createCanvas } from '@napi-rs/canvas';
const f = 'C:/Users/49172/Downloads/146961 - JA 2024 (gebundene Version).pdf';
const outDir = process.argv[2];
const from = Number(process.argv[3] ?? 1), to = Number(process.argv[4] ?? 36);
const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(f)));
for (let p = from; p <= Math.min(to, pdf.numPages); p++) {
  const page = await pdf.getPage(p);
  const vp = page.getViewport({ scale: 2.0 });
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx as never, viewport: vp, canvas: canvas as never }).promise;
  fs.writeFileSync(`${outDir}/p${String(p).padStart(2,'0')}.png`, canvas.toBuffer('image/png'));
  process.stdout.write(`${p} `);
}
console.log('\ndone');
