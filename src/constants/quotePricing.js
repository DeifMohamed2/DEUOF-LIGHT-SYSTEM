/**
 * Standard wording for priced quotes (`from_stock`) — VAT inclusive.
 * Used in PDF, Excel, and web UI.
 */
const PRICED_QUOTE_VAT_NOTE = 'الأسعار تشمل ضريبة القيمة المضافة.';

/** Prefix for footnote-style display (PDF / UI). */
const PRICED_QUOTE_VAT_NOTE_PREFIX = '* ';

module.exports = {
  PRICED_QUOTE_VAT_NOTE,
  PRICED_QUOTE_VAT_NOTE_PREFIX,
  pricedQuoteNotesLines: () => [PRICED_QUOTE_VAT_NOTE],
};
