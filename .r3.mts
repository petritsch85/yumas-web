import fs from 'fs';
import { renderPageAsImage } from 'unpdf';
const f = 'C:/Users/49172/Downloads/146961 - JA 2024 (gebundene Version).pdf';
const out = process.argv[2];
const p = Number(process.argv[3]);
// A fresh document per page: pdfjs's worker gets into a state it cannot
// recover from after a page it fails to transfer.
const buf = new Uint8Array(fs.readFileSync(f));
try {
  const img = await renderPageAsImage(buf, p, { scale: 2, canvasImport: () => import('@napi-rs/canvas') });
  fs.writeFileSync(`${out}/p${String(p).padStart(2,'0')}.png`, Buffer.from(img as ArrayBuffer));
  console.log('ok', p);
} catch (e) { console.log('FAIL', p, e instanceof Error ? e.message.slice(0,60) : e); }
