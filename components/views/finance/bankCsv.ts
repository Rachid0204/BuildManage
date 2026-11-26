export interface ParsedBankCsvRow {
  date: string;
  label: string;
  amount: number;
  reference?: string;
}

export function splitCsvRecord(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

export function parseBankCsvAmount(raw: string): number {
  const compact = raw.replace(/[\s\u00A0\u202F]/g, '').replace(/(?:MAD|DH|DHS)$/i, '');
  if (!/^[+-]?\d+(?:[.,]\d+)*$/.test(compact)) return Number.NaN;
  const lastComma = compact.lastIndexOf(',');
  const lastDot = compact.lastIndexOf('.');
  let normalized = compact;
  if (lastComma !== -1 && lastDot !== -1) {
    normalized =
      lastComma > lastDot
        ? compact.replace(/\./g, '').replace(',', '.')
        : compact.replace(/,/g, '');
  } else if (lastComma !== -1) {
    normalized = compact.replace(',', '.');
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : Number.NaN;
}

export function parseBankCsvRows(text: string): ParsedBankCsvRow[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  // Prefer semicolon when unquoted semicolons appear, so quoted decimals with commas don't confuse delimiter selection
  const firstLine = lines[0];
  let unquotedSemi = 0;
  let unquotedComma = 0;
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === ';') unquotedSemi++;
    else if (!inQuotes && ch === ',') unquotedComma++;
  }
  const delimiter = unquotedSemi >= unquotedComma && unquotedSemi > 0 ? ';' : ',';

  const firstCols = splitCsvRecord(firstLine, delimiter).map((c) =>
    c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
  );
  const hasHeader = firstCols.some((c) =>
    ['date', 'montant', 'amount', 'credit', 'debit', 'libelle', 'label', 'reference', 'ref'].some((k) =>
      c.includes(k),
    ),
  );

  const findCol = (keywords: string[]) =>
    hasHeader ? firstCols.findIndex((c) => keywords.some((k) => c.includes(k))) : -1;
  const dateIdx = findCol(['date']);
  const labelIdx = findCol(['libelle', 'label', 'description', 'motif']);
  const refIdx = findCol(['reference', 'ref']);
  const amountIdx = findCol(['montant', 'amount']);
  const creditIdx = findCol(['credit']);
  const debitIdx = findCol(['debit']);

  const dataLines = hasHeader ? lines.slice(1) : lines;
  const rows: ParsedBankCsvRow[] = [];

  for (const line of dataLines) {
    const cols = splitCsvRecord(line, delimiter);
    let amount = Number.NaN;
    if (amountIdx >= 0 && cols[amountIdx]) {
      amount = parseBankCsvAmount(cols[amountIdx]);
    } else if (creditIdx >= 0 || debitIdx >= 0) {
      const creditVal = creditIdx >= 0 && cols[creditIdx] ? parseBankCsvAmount(cols[creditIdx]) : 0;
      const debitVal = debitIdx >= 0 && cols[debitIdx] ? parseBankCsvAmount(cols[debitIdx]) : 0;
      if (Number.isFinite(creditVal) && creditVal > 0) amount = creditVal;
      else if (Number.isFinite(debitVal) && debitVal !== 0) amount = -Math.abs(debitVal);
    } else {
      for (const col of cols) {
        const parsed = parseBankCsvAmount(col);
        if (Number.isFinite(parsed)) {
          amount = parsed;
          break;
        }
      }
    }
    if (!Number.isFinite(amount) || amount === 0) continue;
    const date = (dateIdx >= 0 ? cols[dateIdx] : cols[0]) || '';
    const label = (labelIdx >= 0 ? cols[labelIdx] : cols[1]) || line;
    const reference = (refIdx >= 0 ? cols[refIdx] : hasHeader ? undefined : cols[2])?.trim() || undefined;
    rows.push({ date, label, amount, reference });
  }
  return rows;
}
