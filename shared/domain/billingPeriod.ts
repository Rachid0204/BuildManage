const FRENCH_MONTHS_TO_NUM: Record<string, string> = {
  janvier: '01',
  jan: '01',
  fevrier: '02',
  février: '02',
  fev: '02',
  fév: '02',
  mars: '03',
  mar: '03',
  avril: '04',
  avr: '04',
  mai: '05',
  juin: '06',
  juillet: '07',
  juil: '07',
  aout: '08',
  août: '08',
  septembre: '09',
  sep: '09',
  sept: '09',
  octobre: '10',
  oct: '10',
  novembre: '11',
  nov: '11',
  decembre: '12',
  décembre: '12',
  dec: '12',
  déc: '12',
};

export function normalizeBillingPeriodKey(periodStr: string): string {
  const cleaned = (periodStr || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!cleaned) return '';

  // Match ISO YYYY-MM or YYYY/MM
  const isoMatch = cleaned.match(/^(\d{4})[-/](\d{1,2})$/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}`;
  }

  // Match MM/YYYY or MM-YYYY
  const revIsoMatch = cleaned.match(/^(\d{1,2})[-/](\d{4})$/);
  if (revIsoMatch) {
    return `${revIsoMatch[2]}-${revIsoMatch[1].padStart(2, '0')}`;
  }

  // Match French month + year (e.g. "octobre 2026" or "2026 octobre")
  const tokens = cleaned.split(/[\s\-_/]+/);
  let foundYear: string | undefined;
  let foundMonth: string | undefined;
  for (const tok of tokens) {
    if (/^\d{4}$/.test(tok)) {
      foundYear = tok;
    } else if (FRENCH_MONTHS_TO_NUM[tok]) {
      foundMonth = FRENCH_MONTHS_TO_NUM[tok];
    }
  }
  if (foundYear && foundMonth) {
    return `${foundYear}-${foundMonth}`;
  }

  return cleaned;
}

