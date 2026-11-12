// Writes real PowerPoint, Word and Excel files for the tests (tests/fixtures).
import fs from 'node:fs';
import path from 'node:path';
import PptxGenJS from 'pptxgenjs';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, PageBreak, Table, TableRow, TableCell, WidthType } from 'docx';
import ExcelJS from 'exceljs';
const out = (f) => path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures', f);

const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_WIDE';
for (const [title, body, colour] of [['Welcome to Church', 'Sunday Service · 9:00 am', '0B1F3A'], ['Sermon: Grace', 'Ephesians 2:8-9', '12301F'], ['Announcements', 'Youth meeting on Friday', '3A0D12']]) {
  const s = pptx.addSlide();
  s.background = { color: colour };
  s.addText(title, { x: 0.5, y: 2.2, w: 12.3, h: 1.4, fontSize: 54, bold: true, color: 'FFFFFF', align: 'center' });
  s.addText(body, { x: 0.5, y: 3.8, w: 12.3, h: 0.8, fontSize: 28, color: 'E2B232', align: 'center' });
}
fs.writeFileSync(out('worship.pptx'), Buffer.from(await pptx.write({ outputType: 'nodebuffer' })));

const doc = new Document({ sections: [{ children: [
  new Paragraph({ text: 'Order of Service', heading: HeadingLevel.HEADING_1 }),
  new Paragraph({ children: [new TextRun({ text: 'Opening prayer', bold: true }), new TextRun(' led by the elders.')] }),
  new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [['Time', 'Item'], ['9:00', 'Praise'], ['9:30', 'Word']].map((r) => new TableRow({ children: r.map((c) => new TableCell({ children: [new Paragraph(c)] })) })) }),
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({ text: 'Page two: Closing hymn', heading: HeadingLevel.HEADING_2 }),
] }] });
fs.writeFileSync(out('notes.docx'), await Packer.toBuffer(doc));

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Offerings');
ws.columns = [{ header: 'Date', width: 14 }, { header: 'Service', width: 18 }, { header: 'Amount (GH₵)', width: 16 }];
for (let i = 1; i <= 30; i++) ws.addRow([`2026-10-${String(i).padStart(2, '0')}`, i % 2 ? 'Sunday' : 'Midweek', 100 * i]);
ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1F3A' } };
wb.addWorksheet('Hidden').state = 'hidden';
const ws2 = wb.addWorksheet('Members');
ws2.addRow(['Name', 'Group']); ws2.addRow(['Ama', 'Choir']); ws2.addRow(['Kofi', 'Ushers']);
await wb.xlsx.writeFile(out('accounts.xlsx'));
fs.writeFileSync(out('rota.csv'), 'Name,Duty,Week\nAma,Projection,1\nKofi,"Sound, mixer",1\n');
fs.writeFileSync(out('old.ppt'), 'not really a ppt');
console.log('office fixtures written');
