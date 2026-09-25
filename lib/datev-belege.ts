/**
 * The Belegtransfer archive — invoice images with their metadata, for DATEV
 * Unternehmen online.
 *
 * DATEV takes a zip holding one `document.xml` and the PDFs it names. The XML
 * says who the client is and, per document, what the invoice is: supplier,
 * number, date, amount. Unternehmen online then shows the image beside the
 * booking, which is the half of Vorkontierung a posting batch cannot carry.
 *
 * The pairing to the Buchungsstapel is the invoice number: the batch writes it
 * into Belegfeld 1 and the document carries it here, so a posting and its
 * image find each other however they arrive.
 *
 * The filenames are written to be readable on their own — date, supplier,
 * invoice number — because a zip of `4f2a…pdf` is useless the moment anything
 * needs checking by hand.
 */

import { zipSync, strToU8 } from 'fflate';

export interface BelegDocument {
  /** The bill's id, used as the document's own reference. */
  id: string;
  supplierName: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  /** Gross, positive for an invoice and negative for a credit note. */
  grossAmount: number;
  netAmount: number;
  vatAmount: number;
  currency?: string;
  /** The PDF itself. A document without one is left out of the archive. */
  pdf?: Uint8Array | null;
  /** What the file was called when it arrived. */
  sourceName?: string | null;
}

export interface BelegArchiveOptions {
  consultantNumber: string;
  clientNumber: string;
  clientName: string;
  from: string;
  to: string;
  documents: BelegDocument[];
}

const esc = (s: string) =>
  (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A filename a person can read, and a file system will accept. */
export function belegFilename(d: BelegDocument, index: number): string {
  const date = (d.invoiceDate ?? '0000-00-00').replace(/-/g, '');
  /* The umlauts go first: stripping accents would turn "Müller" into "Muller"
     rather than "Mueller", and the supplier would be hard to find by name. */
  const safe = (s: string) => (s ?? '')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const supplier = safe(d.supplierName).slice(0, 40) || 'Lieferant';
  const number   = safe(d.invoiceNumber ?? '').slice(0, 24);
  return `${date}_${supplier}${number ? `_${number}` : `_${index + 1}`}.pdf`;
}

/** A GUID from the bill's own id, which is already one. */
const guidOf = (id: string) => id;

/**
 * Builds `document.xml`.
 *
 * Only the properties that are certain are written. A field DATEV does not
 * recognise fails the whole import, and an invoice's essentials — who, when,
 * which number, how much — are enough for Unternehmen online to file it.
 */
export function buildDocumentXml(opts: BelegArchiveOptions): string {
  const { documents } = opts;
  const today = new Date().toISOString().slice(0, 10);

  const docs = documents.map((d, i) => {
    const file = belegFilename(d, i);
    const props: [string, string][] = [
      ['InvoiceType', d.grossAmount < 0 ? 'CreditNote' : 'Incoming'],
      ['SupplierName', d.supplierName],
    ];
    if (d.invoiceNumber) props.push(['InvoiceNumber', d.invoiceNumber]);
    if (d.invoiceDate)   props.push(['InvoiceDate', d.invoiceDate]);
    props.push(['TotalGrossAmount', Math.abs(d.grossAmount).toFixed(2)]);
    props.push(['TotalNetAmount',   Math.abs(d.netAmount).toFixed(2)]);
    props.push(['TotalTaxAmount',   Math.abs(d.vatAmount).toFixed(2)]);
    props.push(['Currency', d.currency || 'EUR']);

    return `    <document guid="${esc(guidOf(d.id))}">
      <extension xsi:type="File" name="${esc(file)}">
        <property key="FileName" value="${esc(file)}"/>
      </extension>
      <extension xsi:type="Invoice">
${props.map(([k, v]) => `        <property key="${esc(k)}" value="${esc(v)}"/>`).join('\n')}
      </extension>
    </document>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<archive xmlns="http://xml.datev.de/bedi/tps/document/v05.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         version="5.0"
         generatingSystem="Yumas">
  <header>
    <date>${today}</date>
    <description>${esc(`Eingangsrechnungen ${opts.from} - ${opts.to}`)}</description>
    <consultantNumber>${esc(opts.consultantNumber)}</consultantNumber>
    <clientNumber>${esc(opts.clientNumber)}</clientNumber>
    <clientName>${esc(opts.clientName)}</clientName>
  </header>
  <content>
${docs}
  </content>
</archive>
`;
}

export interface BelegArchive {
  bytes: Uint8Array;
  filename: string;
  /** Documents that went in, and those left out for want of a PDF. */
  included: number;
  missing: { supplier: string; invoiceNumber: string | null }[];
}

/** The zip: `document.xml` at the root, beside the PDFs it names. */
export function buildBelegArchive(opts: BelegArchiveOptions): BelegArchive {
  const withPdf = opts.documents.filter(d => d.pdf && d.pdf.length > 0);
  const missing = opts.documents.filter(d => !d.pdf || d.pdf.length === 0)
    .map(d => ({ supplier: d.supplierName, invoiceNumber: d.invoiceNumber }));

  const xml = buildDocumentXml({ ...opts, documents: withPdf });
  const files: Record<string, Uint8Array> = { 'document.xml': strToU8(xml) };
  withPdf.forEach((d, i) => {
    let name = belegFilename(d, i);
    // Two invoices can share a date, a supplier and no number.
    let n = 2;
    while (files[name]) name = belegFilename(d, i).replace(/\.pdf$/, `-${n++}.pdf`);
    files[name] = d.pdf!;
  });

  return {
    bytes: zipSync(files, { level: 6 }),
    filename: `DATEV_Belege_${opts.from.replace(/-/g, '')}_${opts.to.replace(/-/g, '')}.zip`,
    included: withPdf.length,
    missing,
  };
}
