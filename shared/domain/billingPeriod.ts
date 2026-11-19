const MONTHS_TO_NUM: Record<string, string> = {
  // French
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
  // Arabic (Moroccan & Standard)
  يناير: '01',
  فبراير: '02',
  مارس: '03',
  أبريل: '04',
  ابريل: '04',
  ماي: '05',
  مايو: '05',
  يونيو: '06',
  يوليوز: '07',
  يوليو: '07',
  غشت: '08',
  أغسطس: '08',
  اغسطس: '08',
  شتنبر: '09',
  سبتمبر: '09',
  أكتوبر: '10',
  اكتوبر: '10',
  نونبر: '11',
  نوفمبر: '11',
  دجنبر: '12',
  ديسمبر: '12',
  // English
  january: '01',
  february: '02',
  feb: '02',
  march: '03',
  april: '04',
  apr: '04',
  may: '05',
  june: '06',
  jun: '06',
  july: '07',
  jul: '07',
  august: '08',
  aug: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
};

export function normalizeBillingPeriodKey(periodStr: string): string {
  const cleaned = (periodStr || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!cleaned) return '';

  // Match ISO YYYY-MM or YYYY/MM
  const isoMatch = cleaned.match(/^(\d{4})[-/](\d{1,2})$/);
  if (isoMatch) {
    const monthNum = Number(isoMatch[2]);
    if (monthNum >= 1 && monthNum <= 12) {
      return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}`;
    }
  }

  // Match MM/YYYY or MM-YYYY
  const revIsoMatch = cleaned.match(/^(\d{1,2})[-/](\d{4})$/);
  if (revIsoMatch) {
    const monthNum = Number(revIsoMatch[1]);
    if (monthNum >= 1 && monthNum <= 12) {
      return `${revIsoMatch[2]}-${revIsoMatch[1].padStart(2, '0')}`;
    }
  }

  // Match month name (FR/AR/EN) + year (e.g. "octobre 2026" or "2026 أكتوبر")
  const tokens = cleaned.split(/[\s\-_/]+/);
  let foundYear: string | undefined;
  let foundMonth: string | undefined;
  for (const tok of tokens) {
    if (/^\d{4}$/.test(tok)) {
      foundYear = tok;
    } else if (MONTHS_TO_NUM[tok]) {
      foundMonth = MONTHS_TO_NUM[tok];
    }
  }
  if (foundYear && foundMonth) {
    return `${foundYear}-${foundMonth}`;
  }

  return cleaned;
}

export function parseIsoBillingPeriod(
  periodStr: string,
): { year: number; month: number; key: string } | null {
  const key = normalizeBillingPeriodKey(periodStr);
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12 || year < 1900 || year > 2200) return null;
  return { year, month, key };
}


