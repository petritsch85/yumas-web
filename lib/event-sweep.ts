/**
 * Finding event enquiries in five years of mail.
 *
 * Two filters, and the order matters. Gmail's own search throws away the
 * ninety-odd per cent that cannot possibly be an event — it costs nothing and
 * runs server-side. Only what survives is read by the model, which is the
 * expensive step and the only one that can judge what a thread was actually
 * about.
 *
 * The size test has to be the model's. "Wir sind 45 Personen" is the sentence
 * that decides whether a thread belongs in this list, and no mailbox query can
 * see it.
 */

/** The threshold that makes a booking an event rather than a large table. */
export const EVENT_MIN_PARTY = 30;

/**
 * What an event enquiry looks like to Gmail.
 *
 * German first, because the business is German, with the English a Frankfurt
 * corporate would use. Deliberately broad: a thread wrongly let through costs
 * one model call, a thread wrongly excluded is a contact lost for good, and
 * the second is much the worse trade.
 */
const TERMS = [
  'Weihnachtsfeier', 'Firmenfeier', 'Betriebsfeier', 'Jahresfeier', 'Sommerfest',
  'Veranstaltung', 'Firmenevent', 'Teamevent', 'Betriebsausflug', 'Jubiläum',
  'Catering', 'Buffet', 'Menüvorschlag', 'Raumvermietung', 'Exklusivbuchung',
  'Gruppenreservierung', 'Gruppenbuchung', 'Personen reservieren',
  'Angebot Veranstaltung', 'Christmas party', 'company event', 'team event',
  'group booking', 'private dining', 'event enquiry', 'event inquiry',
];

/**
 * The Gmail query for a sweep.
 *
 * Trash and spam are out; so is everything we sent, because a thread that only
 * ever ran outward has no contact in it to collect. `newer_than` takes years.
 */
export function sweepQuery(years: number): string {
  const any = TERMS.map(t => (t.includes(' ') ? `"${t}"` : t)).join(' OR ');
  return `(${any}) -in:trash -in:spam -in:drafts newer_than:${years}y`;
}

/** What the model is asked to return for one thread. */
export interface Candidate {
  is_event: boolean;
  person: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  party_size: number | null;
  status: 'won' | 'lost' | 'no_reply' | 'enquiry' | null;
  comment: string | null;
  confidence: number;
  evidence: string | null;
}

/**
 * The instruction. Written to make the model say "no" easily, because the
 * failure that matters is a plausible invention: a supplier read as a client,
 * a name lifted out of a signature block of someone merely copied in.
 */
export const EXTRACT_PROMPT = `Du liest einen E-Mail-Thread aus dem Postfach eines Frankfurter Restaurantbetriebs (Yumas GmbH, mexikanische Restaurants in Westend, Eschborn und Taunus).

Aufgabe: Handelt es sich um eine Anfrage oder Absprache zu einer GRÖSSEREN VERANSTALTUNG (Weihnachtsfeier, Firmenfeier, Gruppenbuchung, Catering, Raumbuchung)? Wenn ja, extrahiere den Ansprechpartner auf Kundenseite.

Gib NUR JSON zurück, kein Markdown:
{
  "is_event": boolean,
  "person": "Vor- und Nachname der Kontaktperson beim Kunden, sonst null",
  "company": "Firmenname, sonst null",
  "email": "E-Mail-Adresse der Kontaktperson, sonst null",
  "phone": "Telefonnummer, sonst null",
  "role": "Funktion/Abteilung falls genannt, sonst null",
  "party_size": "Personenzahl als Zahl, sonst null",
  "status": "won | lost | no_reply | enquiry",
  "comment": "EIN Satz auf Deutsch: worum ging es und was kam dabei heraus. Z.B. 'Weihnachtsfeier 2024 für 60 Personen angefragt, kam nicht zustande' oder 'Sommerfest Juni 2025 im Eschborn ausgerichtet, 45 Personen'.",
  "confidence": 0.0 bis 1.0,
  "evidence": "Der kurze Satz aus der Mail, der die Personenzahl bzw. den Anlass belegt"
}

Regeln:
- is_event = false bei: Lieferantenrechnungen, Newsletter, Bewerbungen, Tischreservierungen unter 10 Personen, Werbung, internen Mails.
- Die Kontaktperson ist der KUNDE, nie jemand von Yumas. Mails von @yumas.de sind wir selbst.
- Nimm keinen Namen aus einer Signatur, wenn die Person nur in CC stand.
- Lieber is_event = false als geraten. Eine erfundene Zeile ist schlimmer als eine fehlende.
- status: "won" wenn die Veranstaltung stattfand, "lost" wenn abgesagt/woanders gebucht, "no_reply" wenn das Gespräch ohne Antwort endete, "enquiry" wenn offen/unklar.
- party_size: die größte genannte Personenzahl. Wenn keine genannt ist, null.`;

/** A thread is worth keeping when the model is sure and the party was big. */
export function worthKeeping(c: Candidate): boolean {
  if (!c.is_event) return false;
  if (c.confidence < 0.4) return false;
  /* An unknown size is kept: plenty of first emails say "unsere Weihnachtsfeier"
     and give the number only on the phone. A small one named outright is not. */
  if (c.party_size !== null && c.party_size < 10) return false;
  return !!(c.person || c.company || c.email);
}
