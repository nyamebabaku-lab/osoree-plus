// PowerPoint, Word, Excel, CSV and text files become pictures, one per slide or page, so they show on every
// screen (projector, Wi-Fi screens, live stream) exactly like a PDF, with no internet.
// Each file is laid out in a hidden area of this page and photographed page by page.

export const OFFICE_EXT = /\.(pptx|docx|xlsx|csv|txt)$/i;
export const OLD_OFFICE_EXT = /\.(ppt|pps|pot|doc|dot|xls|odp|odt|ods|rtf)$/i;
export const MAX_PAGES = 300;

export const officeFormat = (name) => (name.match(OFFICE_EXT)?.[1] || '').toLowerCase();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stage(width) {
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  // On the page but out of sight: layout and fonts work as normal.
  el.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;background:#fff;color:#000;z-index:-1;`;
  document.body.appendChild(el);
  return el;
}

async function settle(el) {
  await document.fonts?.ready;
  const imgs = [...el.querySelectorAll('img')];
  await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 4000); }))));
  await sleep(60);
}

async function snap(el, scale = 1) {
  const html2canvas = (await import('html2canvas')).default;
  // The app's base style makes pictures "block"; html2canvas measures text with a picture in this page,
  // so for the moment of the snapshot pictures go back to inline (otherwise text is drawn too low).
  const fix = document.createElement('style');
  fix.textContent = 'img{display:inline-block !important}';
  document.head.appendChild(fix);
  let canvas;
  try {
    canvas = await html2canvas(el, { backgroundColor: '#ffffff', scale, logging: false, useCORS: true });
  } finally { fix.remove(); }
  return new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
}

// ---- PowerPoint ------------------------------------------------------------------------------------
// Some programs list parts in a .pptx that the file does not contain; PowerPoint ignores them, the reader stops.
async function tidyPptx(buf) {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buf);
  const ct = await zip.file('[Content_Types].xml')?.async('text');
  if (!ct) return buf;
  const fixed = ct.replace(/<Override\s+PartName="\/([^"]+)"[^>]*\/>/g, (tag, part) => (zip.file(part) ? tag : ''));
  if (fixed === ct) return buf;
  zip.file('[Content_Types].xml', fixed);
  return zip.generateAsync({ type: 'arraybuffer' });
}

async function pptx(buf, onPage) {
  const { init } = await import('pptx-preview');
  buf = await tidyPptx(buf);
  const host = stage(1920);
  try {
    // "list" mode draws every slide one under the other; each is then photographed on its own.
    const viewer = init(host, { width: 1920, height: 1080, mode: 'list' });
    await viewer.preview(buf);
    await settle(host);
    const slides = [...host.querySelectorAll('.pptx-preview-slide-wrapper')];
    if (!slides.length) throw new Error('This presentation could not be read here. In PowerPoint use “Save as” PDF and add the PDF instead.');
    const total = Math.min(slides.length, MAX_PAGES);
    const pages = [];
    for (let i = 0; i < total; i++) {
      onPage(i + 1, total);
      slides[i].style.margin = '0';
      slides[i].style.boxShadow = 'none';
      pages.push(await snap(slides[i], 1));
    }
    viewer.destroy?.();
    return { pages, total: slides.length };
  } finally { host.remove(); }
}

// ---- Word ------------------------------------------------------------------------------------------
async function docx(buf, onPage) {
  const { renderAsync } = await import('docx-preview');
  const host = stage(1000);
  try {
    await renderAsync(buf, host, host, { inWrapper: false, breakPages: true, ignoreLastRenderedPageBreak: false, renderHeaders: true, renderFooters: true, experimental: true, useBase64URL: true });
    await settle(host);
    const sections = [...host.querySelectorAll('section')];
    const list = sections.length ? sections : [host];
    const total = Math.min(list.length, MAX_PAGES);
    const pages = [];
    for (let i = 0; i < total; i++) {
      onPage(i + 1, total);
      list[i].style.margin = '0';
      list[i].style.boxShadow = 'none';
      pages.push(await snap(list[i], 1.6));
    }
    return { pages, total: list.length };
  } finally { host.remove(); }
}

// ---- Excel / CSV -----------------------------------------------------------------------------------
const ROWS_PER_PAGE = 18;

function table(title, rows, widths) {
  const esc = (t) => String(t ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const head = `<div style="font:700 30px system-ui,sans-serif;margin:0 0 18px;color:#0b1f3a">${esc(title)}</div>`;
  const body = rows.map((r, ri) => `<tr>${Array.from({ length: cols }, (_, ci) => {
    const c = r[ci] || {};
    const st = [`padding:8px 14px`, `border:1px solid #c9ced6`, `white-space:nowrap`,
      c.bold || ri === 0 && c.header ? 'font-weight:700' : '', c.fill ? `background:${c.fill}` : (ri % 2 ? 'background:#f6f7f9' : ''),
      c.color ? `color:${c.color}` : '', `text-align:${c.align || (typeof c.v === 'number' ? 'right' : 'left')}`].filter(Boolean).join(';');
    return `<td style="${st}">${esc(c.t ?? c.v ?? '')}</td>`;
  }).join('')}</tr>`).join('');
  const colgroup = widths?.length ? `<colgroup>${widths.slice(0, cols).map((w) => `<col style="width:${Math.max(60, Math.round(w * 9))}px">`).join('')}</colgroup>` : '';
  return `<div style="padding:36px 40px;font:24px system-ui,'Noto Sans',sans-serif">${head}<table style="border-collapse:collapse">${colgroup}${body}</table></div>`;
}

async function tablesToPages(sheets, onPage) {
  // One page holds a header row plus ROWS_PER_PAGE rows; wide sheets are scaled down to the page.
  const jobs = [];
  for (const s of sheets) {
    const [header, ...rest] = s.rows;
    if (!rest.length) { jobs.push({ title: s.name, rows: s.rows, widths: s.widths }); continue; }
    for (let i = 0; i < rest.length; i += ROWS_PER_PAGE) {
      const part = rest.slice(i, i + ROWS_PER_PAGE);
      const n = Math.floor(i / ROWS_PER_PAGE) + 1, of = Math.ceil(rest.length / ROWS_PER_PAGE);
      jobs.push({ title: of > 1 ? `${s.name} (${n}/${of})` : s.name, rows: [header.map((c) => ({ ...c, header: true, bold: true })), ...part], widths: s.widths });
    }
  }
  const total = Math.min(jobs.length, MAX_PAGES);
  const host = stage(1920);
  const pages = [];
  try {
    for (let i = 0; i < total; i++) {
      onPage(i + 1, total);
      // Each page is a 1920×1080 picture; the table is scaled to fill it (up to 2.2× for small tables, down for wide ones).
      host.style.height = '1080px';
      host.style.overflow = 'hidden';
      host.innerHTML = table(jobs[i].title, jobs[i].rows, jobs[i].widths);
      const inner = host.firstElementChild;
      inner.style.display = 'inline-block';
      const w = inner.scrollWidth, h = inner.scrollHeight;
      const k = Math.min(1880 / w, 1040 / h, 2.2);
      inner.style.transformOrigin = '0 0';
      inner.style.transform = `translate(${Math.max(0, (1920 - w * k) / 2)}px, 20px) scale(${k})`;
      await settle(host);
      pages.push(await snap(host, 1));
    }
  } finally { host.remove(); }
  return { pages, total: jobs.length };
}

const argb = (c) => (c?.argb && c.argb.length === 8 && c.argb.slice(0, 2) !== '00' ? `#${c.argb.slice(2)}` : '');

async function xlsx(buf, onPage) {
  const ExcelJS = (await import('exceljs/dist/exceljs.min.js')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sheets = [];
  wb.eachSheet((ws) => {
    if (ws.state && ws.state !== 'visible') return;
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const out = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        const v = cell.value;
        out[col - 1] = {
          v: typeof v === 'number' ? v : undefined,
          t: cell.text,
          bold: !!cell.font?.bold,
          color: argb(cell.font?.color),
          fill: cell.fill?.type === 'pattern' ? argb(cell.fill.fgColor) : '',
          align: cell.alignment?.horizontal,
        };
      });
      rows.push(Array.from(out, (c) => c || {}));
    });
    if (rows.length) sheets.push({ name: ws.name, rows, widths: ws.columns?.map((c) => c.width || 12) });
  });
  if (!sheets.length) throw new Error('This spreadsheet has no cells to show.');
  return tablesToPages(sheets, onPage);
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

async function csv(buf, onPage, name) {
  const rows = parseCsv(new TextDecoder().decode(buf)).map((r) => r.map((t) => ({ t, v: /^-?\d+(\.\d+)?$/.test(t.trim()) ? Number(t) : undefined })));
  if (!rows.length) throw new Error('This file has no rows to show.');
  return tablesToPages([{ name: name.replace(/\.[^.]+$/, ''), rows }], onPage);
}

// ---- Plain text ------------------------------------------------------------------------------------
async function txt(buf, onPage) {
  const lines = new TextDecoder().decode(buf).replace(/\r/g, '').split('\n');
  const per = 16;
  const chunks = [];
  for (let i = 0; i < lines.length; i += per) chunks.push(lines.slice(i, i + per));
  const total = Math.min(chunks.length || 1, MAX_PAGES);
  const host = stage(1920);
  const pages = [];
  try {
    for (let i = 0; i < total; i++) {
      onPage(i + 1, total);
      host.style.height = '1080px';
      host.innerHTML = '';
      const pre = document.createElement('div');
      pre.style.cssText = "padding:60px 80px;font:600 40px/1.45 'Noto Sans',system-ui,sans-serif;white-space:pre-wrap;color:#111";
      pre.textContent = (chunks[i] || []).join('\n');
      host.appendChild(pre);
      await settle(host);
      pages.push(await snap(host, 1));
    }
  } finally { host.remove(); }
  return { pages, total: chunks.length };
}

/** Converts one file. onPage(n, total) reports progress. Returns { pages: [Blob], total, format }. */
export async function convertOffice(name, buf, onPage = () => {}) {
  const format = officeFormat(name);
  if (!format) {
    if (OLD_OFFICE_EXT.test(name)) throw new Error(`${name}: this older file type cannot be opened on a phone. In PowerPoint, Word or Excel use “Save as” .pptx, .docx or .xlsx (or PDF), then add it again.`);
    throw new Error(`${name}: this file type is not supported.`);
  }
  const run = { pptx, docx, xlsx, csv, txt }[format];
  const out = await run(buf, onPage, name);
  if (!out.pages.length) throw new Error(`${name}: nothing to show in this file.`);
  return { ...out, format };
}
