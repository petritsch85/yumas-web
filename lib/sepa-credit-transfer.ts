/**
 * A SEPA-Sammelüberweisung, as pain.001.001.03 XML.
 *
 * This is the file online banking calls "SEPA-Sammler einlesen": one payment
 * order carrying many transfers, which the bank shows for approval before
 * anything leaves the account. Nothing here talks to the bank — the file is
 * downloaded, looked at, and uploaded by a person.
 *
 * The format is strict in ways that matter:
 *
 *  - only a restricted Latin character set is allowed, so "Müller Großhandel"
 *    has to go as "Mueller Grosshandel". Sending an umlaut gets the whole file
 *    rejected, usually without saying which line;
 *  - a name is 70 characters, a remittance 140, an end-to-end reference 35;
 *  - the amount is a plain decimal with a point, never a comma.
 *
 * An IBAN is checked before it goes in. A wrong one does not bounce: it pays
 * somebody else.
 */

export interface SepaTransfer {
  /** Ends up in the recipient's statement, so it names the invoice. */
  reference:  string;
  creditorName: string;
  creditorIban: string;
  creditorBic?: string | null;
  /** Euro, positive. */
  amount: number;
  /** What the recipient sees — the invoice number and our name. */
  remittance: string;
}

export interface SepaOrder {
  debtorName: string;
  debtorIban: string;
  debtorBic?: string | null;
  /** The day the bank should execute, ISO. */
  executionDate: string;
  transfers: SepaTransfer[];
  /** Book the batch as one line on our statement, or each transfer singly. */
  batchBooking?: boolean;
}

/* ── The allowed character set ── */

const TRANSLIT: Record<string, string> = {
  'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ß': 'ss',
  'á': 'a', 'à': 'a', 'â': 'a', 'å': 'a', 'ã': 'a',
  'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
  'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
  'ó': 'o', 'ò': 'o', 'ô': 'o', 'õ': 'o', 'ø': 'o',
  'ú': 'u', 'ù': 'u', 'û': 'u',
  'ñ': 'n', 'ç': 'c', 'æ': 'ae', 'œ': 'oe',
  'Á': 'A', 'À': 'A', 'Â': 'A', 'É': 'E', 'È': 'E', 'Ê': 'E',
  'Í': 'I', 'Ó': 'O', 'Ô': 'O', 'Ú': 'U', 'Ñ': 'N', 'Ç': 'C',
  '&': '+', '"': "'", '«': "'", '»': "'", '„': "'", '“': "'", '”': "'", '–': '-', '—': '-',
};

/** Anything outside the SEPA set becomes a space, so a name never arrives mangled. */
export function sepaText(raw: string, max: number): string {
  const mapped = [...(raw ?? '')].map(c => TRANSLIT[c] ?? c).join('');
  const cleaned = mapped.replace(/[^A-Za-z0-9/\-?:().,'+ ]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, max);
}

/** IBAN as the bank wants it: no spaces, upper case. */
export const normaliseIban = (raw: string) => (raw ?? '').replace(/\s+/g, '').toUpperCase();

/**
 * The ISO 13616 check: move the first four characters to the end, turn letters
 * into numbers, and the whole thing mod 97 must be 1.
 */
export function isValidIban(raw: string): boolean {
  const iban = normaliseIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = [...rearranged].map(c => (/\d/.test(c) ? c : String(c.charCodeAt(0) - 55))).join('');
  let remainder = 0;
  for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  return remainder === 1;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const amount = (n: number) => n.toFixed(2);

/** Everything wrong with an order, in the words a person would use. */
export function validateOrder(order: SepaOrder): string[] {
  const problems: string[] = [];
  if (!isValidIban(order.debtorIban)) problems.push('The account to pay from does not carry a valid IBAN.');
  if (!order.debtorName?.trim()) problems.push('The account holder is missing.');
  if (order.transfers.length === 0) problems.push('There is nothing to pay.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(order.executionDate)) problems.push('The execution date is not a date.');
  for (const t of order.transfers) {
    if (!isValidIban(t.creditorIban)) problems.push(`${t.creditorName || t.reference}: the IBAN is not valid.`);
    if (!(t.amount > 0)) problems.push(`${t.creditorName || t.reference}: the amount must be positive.`);
    if (t.amount > 999999999.99) problems.push(`${t.creditorName || t.reference}: the amount is too large for one transfer.`);
  }
  return problems;
}

/**
 * Builds the file. Call validateOrder first — this assumes the order is sound
 * and will happily write a file the bank rejects otherwise.
 */
export function buildPain001(order: SepaOrder): string {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, '').slice(0, 15);
  const msgId = `YUMAS-${stamp}`;
  const total = order.transfers.reduce((t, x) => t + x.amount, 0);
  const ctrlSum = amount(Math.round(total * 100) / 100);

  const tx = order.transfers.map((t, i) => {
    const bic = t.creditorBic?.trim();
    return `      <CdtTrfTxInf>
        <PmtId>
          <EndToEndId>${esc(sepaText(t.reference || `${msgId}-${i + 1}`, 35))}</EndToEndId>
        </PmtId>
        <Amt>
          <InstdAmt Ccy="EUR">${amount(t.amount)}</InstdAmt>
        </Amt>${bic ? `
        <CdtrAgt>
          <FinInstnId>
            <BIC>${esc(bic.toUpperCase())}</BIC>
          </FinInstnId>
        </CdtrAgt>` : ''}
        <Cdtr>
          <Nm>${esc(sepaText(t.creditorName, 70))}</Nm>
        </Cdtr>
        <CdtrAcct>
          <Id>
            <IBAN>${esc(normaliseIban(t.creditorIban))}</IBAN>
          </Id>
        </CdtrAcct>
        <RmtInf>
          <Ustrd>${esc(sepaText(t.remittance, 140))}</Ustrd>
        </RmtInf>
      </CdtTrfTxInf>`;
  }).join('\n');

  const dbtrBic = order.debtorBic?.trim();

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${msgId}</MsgId>
      <CreDtTm>${now.toISOString().slice(0, 19)}</CreDtTm>
      <NbOfTxs>${order.transfers.length}</NbOfTxs>
      <CtrlSum>${ctrlSum}</CtrlSum>
      <InitgPty>
        <Nm>${esc(sepaText(order.debtorName, 70))}</Nm>
      </InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${msgId}-1</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <BtchBookg>${order.batchBooking === false ? 'false' : 'true'}</BtchBookg>
      <NbOfTxs>${order.transfers.length}</NbOfTxs>
      <CtrlSum>${ctrlSum}</CtrlSum>
      <PmtTpInf>
        <SvcLvl>
          <Cd>SEPA</Cd>
        </SvcLvl>
      </PmtTpInf>
      <ReqdExctnDt>${order.executionDate}</ReqdExctnDt>
      <Dbtr>
        <Nm>${esc(sepaText(order.debtorName, 70))}</Nm>
      </Dbtr>
      <DbtrAcct>
        <Id>
          <IBAN>${esc(normaliseIban(order.debtorIban))}</IBAN>
        </Id>
      </DbtrAcct>
      <DbtrAgt>
        <FinInstnId>
${dbtrBic ? `          <BIC>${esc(dbtrBic.toUpperCase())}</BIC>` : `          <Othr>
            <Id>NOTPROVIDED</Id>
          </Othr>`}
        </FinInstnId>
      </DbtrAgt>
      <ChrgBr>SLEV</ChrgBr>
${tx}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>
`;
}

/** A filename that says what it is and when it was made. */
export const painFilename = (executionDate: string) =>
  `yumas-sammelueberweisung-${executionDate}.xml`;
