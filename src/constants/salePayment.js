const SALE_PAYMENT_METHODS = [
  { value: 'instapay', label: 'Instapay' },
  { value: 'bank_transfer', label: 'تحويل بنكي' },
  { value: 'cash', label: 'نقدي' },
];

const SALE_PAYMENT_VALUES = SALE_PAYMENT_METHODS.map((m) => m.value);

function salePaymentLabel(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  const m = SALE_PAYMENT_METHODS.find((x) => x.value === v);
  if (m) return m.label;
  return v;
}

module.exports = {
  SALE_PAYMENT_METHODS,
  SALE_PAYMENT_VALUES,
  salePaymentLabel,
};
