import { NextRequest, NextResponse, after } from 'next/server';
import PostalMime from 'postal-mime';
import { createHash } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { extractFromAttachment, type Attachment } from '@/lib/bill-extract';
import { fileBill, findDuplicate, isBillDocument } from '@/lib/inbound-bills';

const SECRET = process.env.INBOUND_BILLS_WEBHOOK_SECRET ?? '';

/* A batch arrives as one email with each original forwarded "as attachment"
   (Gmail: select several → ⋮ → Forward as attachment). The work runs after
   the reply to the sender, so a batch of bills is not cut off by its timeout. */
export const maxDuration = 300;

/** Where the inbound-relay function parks an email too large to post here. */
const INBOUND_BUCKET = 'inbound-emails';

/** How many bills are read at once — enough to clear a batch, few enough not to hit the API's rate limit. */
const CONCURRENCY = 3;

/* A PDF is recognised by its content as well as its label. Some invoicing
   systems send "application/octet-stream" and a name with no extension; every
   PDF still begins "%PDF", which is "JVBERi" in base64. Going by the label
   alone, such an invoice was answered "no bill attachments", the Gmail script
   took the 200 as success and labelled it Imported, and the bill appeared
   nowhere at all. */
const looksLikePdf = (content: string | undefined) => (content ?? '').trimStart().startsWith('JVBERi');
const isPdf   = (ct: string, name: string, content?: string) =>
  ct === 'application/pdf' || name.endsWith('.pdf') || looksLikePdf(content);
const isImage = (ct: string, name: string) =>
  ct === 'image/jpeg' || ct === 'image/jpg' || ct === 'image/png' ||
  name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png');
const isEmail = (ct: string, name: string) => ct === 'message/rfc822' || name.endsWith('.eml');

/* The logo in an email signature ("image001.png") is not a bill. It is
   embedded in the body, not attached, and small. */
const isSignatureImage = (name: string, inline: boolean, bytes: number) =>
  inline || /^image\d{3}\.(png|jpe?g)$/i.test(name) || bytes < 15_000;

/** The bills in one email, looking inside any email forwarded as an attachment. */
async function collectBills(attachments: Attachment[], depth = 0): Promise<Attachment[]> {
  const found: Attachment[] = [];
  for (const a of attachments) {
    const ct = (a.ContentType ?? '').toLowerCase().split(';')[0].trim();
    const name = (a.Name ?? '').toLowerCase();
    const bytes = Math.floor((a.Content?.length ?? 0) * 3 / 4);

    if (isEmail(ct, name) && depth < 3) {
      try {
        const inner = await PostalMime.parse(Buffer.from(a.Content, 'base64'), { attachmentEncoding: 'base64' });
        found.push(...await collectBills(inner.attachments.map(x => ({
          Name:        x.filename ?? 'attachment',
          Content:     x.content as string,
          ContentType: x.mimeType,
          ContentID:   x.disposition === 'inline' || x.related ? (x.contentId ?? 'inline') : undefined,
        })), depth + 1));
      } catch (e) {
        console.error(`[inbound-bills] could not read forwarded email ${a.Name}:`, e);
      }
    } else if (isPdf(ct, name, a.Content)) {
      found.push(a);
    } else if (isImage(ct, name) && !isSignatureImage(name, !!a.ContentID, bytes)) {
      found.push(a);
    }
  }
  return found;
}

/* The same file arriving twice at once — one email in two batches, or a
   manual retry overlapping an automatic one — would pass the duplicate check
   below in both copies, since neither is saved until it has been read. So a
   file is claimed by its content first: creating the claim fails if it
   exists, and only one copy gets past. A claim is released if reading fails,
   and lapses after half an hour — the race is over by then, and a bill that
   was deleted on purpose can be sent again. */
const CLAIM_MINUTES = 30;

const claimPath = (a: Attachment) =>
  `claims/${createHash('sha256').update(a.Content).digest('hex')}.json`;

async function claimFile(a: Attachment): Promise<boolean> {
  const bucket = getSupabaseAdmin().storage.from(INBOUND_BUCKET);
  const path = claimPath(a);
  const claim = JSON.stringify({ name: a.Name, at: new Date().toISOString() });

  const { error } = await bucket.upload(path, claim, { contentType: 'application/json', upsert: false });
  if (!error) return true;

  if (/exists|duplicate|409/i.test(error.message)) {
    const { data } = await bucket.download(path);
    const at = data ? Date.parse(JSON.parse(await data.text()).at ?? '') : NaN;
    if (Number.isFinite(at) && Date.now() - at < CLAIM_MINUTES * 60_000) return false;
    // A lapsed claim: take it over
    await bucket.upload(path, claim, { contentType: 'application/json', upsert: true });
    return true;
  }
  // Storage trouble is no reason to drop a bill; the check after reading still stands
  console.error(`[inbound-bills] ${a.Name}: could not claim (${error.message}) — processing anyway`);
  return true;
}

const releaseFile = (a: Attachment) =>
  getSupabaseAdmin().storage.from(INBOUND_BUCKET).remove([claimPath(a)]);


/** Stores the file, then files the bill. The new bill's id, or null when the document was filed without one. */
async function saveBillToDB(attachment: Attachment, extracted: Record<string, unknown>): Promise<string | null> {
  const path = await storeFile(attachment, 'bills');
  return fileBill(path, extracted, { isNew: true });
}

/** Puts the file in the bills bucket under `folder`, returning its path. */
async function storeFile(attachment: Attachment, folder: 'bills' | 'skipped'): Promise<string> {
  const bytes = Buffer.from(attachment.Content, 'base64');
  const fileName = attachment.Name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${folder}/${Date.now()}_${fileName}`;
  const { error } = await getSupabaseAdmin().storage
    .from('bills')
    .upload(path, bytes, { contentType: attachment.ContentType || 'application/pdf' });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return path;
}

type EmailMeta = { from: string | null; subject: string | null };

/* A document that is not a bill is kept, not dropped: it is listed under
   "Not imported" on the Bills page, where it can still be imported by hand if
   the reading was wrong. Should that list not exist yet, the document is
   filed as a bill after all — a stray Lieferschein is better than a lost
   invoice. */
async function setAside(attachment: Attachment, extracted: Record<string, unknown>, email: EmailMeta): Promise<void> {
  const path = await storeFile(attachment, 'skipped');
  const { error } = await getSupabaseAdmin().from('inbound_skipped').insert({
    file_name:     attachment.Name,
    file_path:     path,
    document_type: String(extracted.document_type ?? 'other'),
    supplier_name: (extracted.supplier_name as string | null) ?? null,
    gross_amount:  typeof extracted.gross_amount === 'number' ? extracted.gross_amount : null,
    email_from:    email.from,
    email_subject: email.subject,
    extracted,
  });
  if (error) {
    console.error(`[inbound-bills] ${attachment.Name}: could not set aside (${error.message}) — filing as a bill instead`);
    await fileBill(path, extracted, { isNew: true });
  }
}

export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret') ?? req.headers.get('x-webhook-secret') ?? '';
  if (SECRET && secret !== SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  /* An email too large for Vercel's 4.5 MB request limit comes by way of the
     inbound-relay function, which stores it and sends only its path. */
  const key = req.nextUrl.searchParams.get('key');
  if (key && !/^\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.json$/.test(key)) {
    return NextResponse.json({ error: 'Invalid key' }, { status: 400 });
  }
  const discard = async () => {
    if (key) await getSupabaseAdmin().storage.from(INBOUND_BUCKET).remove([key]);
  };

  let payload: Record<string, unknown>;
  try {
    if (key) {
      const { data, error } = await getSupabaseAdmin().storage.from(INBOUND_BUCKET).download(key);
      if (error || !data) return NextResponse.json({ error: `Stored email not found: ${error?.message ?? key}` }, { status: 404 });
      payload = JSON.parse(await data.text());
    } else {
      payload = await req.json();
    }
  } catch {
    await discard();
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const attachments = (payload.Attachments as Attachment[] | undefined) ?? [];
  const billAttachments = await collectBills(attachments);

  if (billAttachments.length === 0) {
    /**
     * Never ignore an email without a trace.
     *
     * The Gmail script reads any 200 as "imported" and labels the thread so,
     * which made an email whose attachment nothing recognised look done while
     * it appeared nowhere — not in the bills, not in Not imported. Each
     * attachment is now filed under Not imported as "unrecognised", where it
     * can be looked at and imported by hand. Signature logos are still left
     * out; they are never anything.
     */
    const meta: EmailMeta = {
      from:    typeof payload.From === 'string' ? payload.From : null,
      subject: typeof payload.Subject === 'string' ? payload.Subject : null,
    };
    let kept = 0;
    for (const a of attachments) {
      const bytes = Math.floor((a.Content?.length ?? 0) * 3 / 4);
      if (isSignatureImage((a.Name ?? '').toLowerCase(), !!a.ContentID, bytes)) continue;
      try {
        await setAside(a, { document_type: 'unrecognised', supplier_name: null }, meta);
        kept++;
      } catch (e) {
        console.error(`[inbound-bills] ${a.Name}: could not keep unrecognised attachment:`, e);
      }
    }
    await discard();
    return NextResponse.json({
      message: kept
        ? `No attachment recognised as a bill — ${kept} kept under Not imported`
        : 'No bill attachments found — email ignored',
    });
  }

  // Postmark's field names, which the Gmail import script (scripts/gmail-bill-import.gs) uses too
  const email: EmailMeta = {
    from:    typeof payload.From === 'string' ? payload.From : null,
    subject: typeof payload.Subject === 'string' ? payload.Subject : null,
  };

  after(async () => {
    try {
      await processBills(billAttachments, email);
    } finally {
      await discard();
    }
  });

  return NextResponse.json({ queued: billAttachments.map(a => a.Name) });
}

/**
 * Wolt's settlement documents are not bills.
 *
 * Wolt sends every period as a set: its fee invoice to us, the self-billing
 * invoice for our own sales, a netting or payout report, a sales report. The
 * sales they evidence reach the P&L through the Wolt import, already net of
 * Wolt's fees and advertising — so filing the fee invoice as a bill counted
 * those fees a second time in SG&A, and the self-billing invoice is our
 * revenue, not something we owe.
 *
 * Recognised three ways, because no single one is reliable: Wolt's own file
 * names, Wolt's commercial register number on its invoices (HRB 217122 B),
 * and our self-billing series (…/HRB96797/…), whose "supplier" reads as us.
 * The documents are kept under Not imported, and the Steuerberater's copies
 * go in through the Monatsabschluss Wolt position as before.
 */
function isWoltSettlement(fileName: string, extracted: Record<string, unknown>): boolean {
  if (/WOLT_TO_MERCHANT|MERCHANT_TO_WOLT|NETTING_REPORT|PAYOUT_REPORT|HEXA_MONTHLY/i.test(fileName)) return true;
  const number = String(extracted.invoice_number ?? '').replace(/\s+/g, '');
  if (/HRB217122B/i.test(number) || /\/HRB96797\//i.test(number)) return true;
  return /\bwolt\b/i.test(String(extracted.supplier_name ?? ''));
}

/** Reads each document and files the bills among them, a few at a time. */
async function processBills(billAttachments: Attachment[], email: EmailMeta) {
  const queue = [...billAttachments];
  const worker = async () => {
    for (let a = queue.shift(); a; a = queue.shift()) {
      if (!await claimFile(a)) {
        console.log(`[inbound-bills] ${a.Name}: this exact file was already received — skipped`);
        continue;
      }
      try {
        const extracted = await extractFromAttachment(a);
        if (isWoltSettlement(a.Name, extracted)) {
          await setAside(a, { ...extracted, document_type: 'platform_statement' }, email);
          console.log(`[inbound-bills] ${a.Name}: Wolt settlement document — set aside, not a bill`);
          continue;
        }
        if (!isBillDocument(extracted)) {
          await setAside(a, extracted, email);
          console.log(`[inbound-bills] ${a.Name}: ${extracted.document_type}, not a bill — set aside`);
          continue;
        }
        const duplicate = await findDuplicate(extracted);
        if (duplicate) {
          console.log(`[inbound-bills] ${a.Name}: already on file as ${duplicate} — skipped`);
          continue;
        }
        const billId = await saveBillToDB(a, extracted);
        console.log(billId
          ? `[inbound-bills] ${a.Name}: saved as ${billId}`
          : `[inbound-bills] ${a.Name}: stored, but not as a payable`);
      } catch (err) {
        console.error(`[inbound-bills] ${a.Name}: processing failed:`, err);
        await releaseFile(a);
        /**
         * A failure here used to leave nothing behind. The email had already
         * been answered "queued" — the Gmail script took that as Imported —
         * so a bill whose reading failed was gone from everywhere but a
         * server log: KVE's invoice 22622326 went this way. It is now kept
         * under Not imported as "failed", with the reason, where it can be
         * imported by hand.
         */
        try {
          await setAside(a, {
            document_type: 'failed',
            supplier_name: null,
            error: String((err as Error)?.message ?? err).slice(0, 300),
          }, email);
        } catch (e) {
          console.error(`[inbound-bills] ${a.Name}: could not even keep the failed file:`, e);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, billAttachments.length) }, worker));
}
