export type CfDirection = 'in' | 'out';

export interface CfClassification {
  category: string;
  salesType: string;
}

export function classifyTransaction(
  counterparty: string,
  description: string,
  direction: CfDirection,
): CfClassification {
  const cp   = (counterparty  ?? '').toLowerCase();
  const desc = (description   ?? '').toLowerCase();

  if (direction === 'out') {
    if (
      desc.includes('abschlag') ||
      desc.includes('gehalt') ||
      desc.includes('lohn-/') ||
      desc.includes('lohnzahlung') ||
      cp.includes('techniker krankenkasse') ||
      cp.includes('aok') ||
      cp.includes('knappschaft') ||
      cp.includes('ikk suedwest') ||
      cp.includes('meine krankenkasse') ||
      cp.includes('barmer') ||
      cp.includes('hek - hanseatische') ||
      cp.includes('berufsgenossenschaft') ||
      cp.includes('vertical cloud solution') ||
      cp.includes('indeed deutschland')
    ) return { category: 'C - Personnel', salesType: 'Other' };

    if (
      cp.includes('metro deutschland') ||
      cp.includes('ffd-frisch') ||
      cp.includes('nacho kings') ||
      cp.includes('bierzentrale') ||
      cp.includes('weinquelle') ||
      cp.includes('weinhaus hauck') ||
      cp.includes('werz wurst') ||
      cp.includes('ferrand deutschland') ||
      cp.includes('perola') ||
      cp.includes('bad homburger brauhaus') ||
      cp.includes('barstuff') ||
      cp.includes('nsw nordspirituosen') ||
      cp.includes('raum und wein') ||
      cp.includes('adam schneble') ||
      cp.includes('storm schadlingsbekampfung') ||
      cp.includes('kahler berlin')
    ) return { category: 'C - Suppliers', salesType: 'Other' };

    if (
      cp.includes('wohnraum entwicklungs') ||
      cp.includes('strabag real estate') ||
      desc.includes('bruttomiete') ||
      desc.includes('miete yumas')
    ) return { category: 'C - Rent', salesType: 'Other' };

    if (cp.includes('opentable'))  return { category: 'C - OpenTable',   salesType: 'Other' };
    if (cp.includes('orderbird'))  return { category: 'C - Orderbird',   salesType: 'Other' };

    if (
      cp.includes('nientiedt') ||
      cp.includes('fa ffm') ||
      (desc.includes('steuernr') && desc.includes('lohnst'))
    ) return { category: 'C - Tax Advisor', salesType: 'Other' };

    if (
      cp.includes('inotec sicherheitstechnik') ||
      cp.includes('ford bank')
    ) return { category: 'C - Insurance', salesType: 'Other' };

    if (
      cp.includes('suewag') ||
      cp.includes('schwarzwald energy') ||
      cp.includes('fleetcor') ||
      cp.includes('energor')
    ) return { category: 'C - Energy', salesType: 'Other' };

    if (
      cp.includes('fiylo') ||
      cp.includes('stroeer deutsche') ||
      cp.includes('neue medien muennich')
    ) return { category: 'C - Marketing', salesType: 'Other' };

    if (cp.includes('amazon')) return { category: 'C - Amazon', salesType: 'Other' };

    if (
      (cp.includes('sparkasse') && (desc.includes('darl') || desc.includes('tilgung'))) ||
      desc.includes('zinsrueckzahlung') ||
      desc.includes('rechnung darl')
    ) return { category: 'C - Financing', salesType: 'Other' };

    return { category: 'C - Other', salesType: 'Other' };
  } else {
    if (
      cp.includes('takeawaycom') || cp.includes('derdengelden') ||
      cp.includes('wolt') ||
      (cp.includes('stripe') && desc.includes('sides')) ||
      cp.includes('too good to go')
    ) return { category: 'S - Delivery', salesType: 'Delivery' };

    if (
      cp.includes('bambora') ||
      cp.includes('american express payments') ||
      cp.includes('stichting mollie') ||
      cp.includes('pluxee')
    ) return { category: 'S - In House', salesType: 'In-House' };

    return { category: 'S - Other', salesType: 'Other' };
  }
}
