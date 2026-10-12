// ISO region codes keep country spelling consistent across imports, spend and reports.
const codes = 'DE SG US GB CA AU MY TH VN ID PH IN JP KR FR IT ES NL BE CH AT SE NO DK FI PL PT IE NZ AE SA BR MX ZA TR HK TW CN BD PK LK KH LA MM NP NG KE EG IL AR CL CO PE RU UA CZ RO HU GR BG HR SK SI LT LV EE LU MT CY IS MA TN DZ GH TZ UG UZ KZ GE AZ AM BH QA KW OM JO LB IQ IR AF AL AD AO AG BS BB BY BZ BJ BT BO BA BW BN BF BI CV CM CF TD KM CG CD CR CI CU DJ DM DO EC SV GQ ER SZ ET FJ GA GM GD GT GN GW GY HT HN JM KI KG LS LR LY LI MG MW MV ML MH MR MU FM MD MC MN ME MZ NA NR NI NE MK PW PA PG PY RW KN LC VC WS SM ST SN RS SC SL SB SO SS SD SR SY TJ TL TG TO TT TM TV VE VU YE ZM ZW'.split(' ');
const names = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
export const COUNTRIES = codes.map(code => ({ code, name: names.of(code) || code }));
export const countryName = (code: string) => code ? COUNTRIES.find(item => item.code === code)?.name ?? code : '未标注国家';
export const isCountry = (value: unknown): value is string => typeof value === 'string' && codes.includes(value);
export const CURRENCIES = ['USD', 'EUR', 'SGD', 'CNY', 'GBP', 'MYR', 'HKD', 'AUD', 'CAD', 'THB'] as const;
export function parseSpendCents(value: unknown): number | null {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return cents <= 2_000_000_000 ? cents : null;
}
export type SpendTotal = { currency: string; amountCents: number };
