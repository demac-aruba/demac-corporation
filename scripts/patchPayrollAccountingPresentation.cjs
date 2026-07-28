const fs = require('fs');

function replaceOrConfirm(path, oldText, newText, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(oldText)) throw new Error(`Required payroll accounting presentation block not found in ${path}: ${marker}`);
  text = text.replace(oldText, newText);
  fs.writeFileSync(path, text);
}

const pdf = 'src/services/payrollAccountingPdf.ts';

replaceOrConfirm(
  pdf,
  "const DARK_GREEN: Rgb = [0.08, 0.39, 0.07];\nconst LIGHT_GREEN: Rgb = [0.92, 0.97, 0.91];",
  "const DARK_GREEN: Rgb = [0.08, 0.39, 0.07];\nconst BONUS_BLUE: Rgb = [0.08, 0.32, 0.78];\nconst DEDUCTION_RED: Rgb = [0.76, 0.08, 0.12];\nconst LIGHT_GREEN: Rgb = [0.92, 0.97, 0.91];",
  'const BONUS_BLUE: Rgb',
);

replaceOrConfirm(
  pdf,
  `function formatHours(value: number) {
  return \`${'${Number(value || 0).toLocaleString(\'en-US\', {\n    minimumFractionDigits: 2,\n    maximumFractionDigits: 2,\n  })}'} h\`;
}`,
  `function formatHours(value: number) {
  return \`${'${Number(value || 0).toLocaleString(\'en-US\', {\n    minimumFractionDigits: 2,\n    maximumFractionDigits: 2,\n  })}'} h\`;
}

function formatHoursMinutes(value: number) {
  const totalMinutes = Math.max(0, Math.round(Number(value || 0) * 60));
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!wholeHours && !minutes) return '0 h';
  if (!wholeHours) return \`${'${minutes}'} min\`;
  if (!minutes) return \`${'${wholeHours}'} h\`;
  return \`${'${wholeHours}'} h ${'${minutes}'} min\`;
}`,
  'function formatHoursMinutes(value: number)',
);

replaceOrConfirm(
  pdf,
  `          drawText(formatAfl(value), x + 5, top + 11, 7.7, {
            bold: value > 0,
            fill: column.key === 'bonuses' && value > 0 ? DARK_GREEN : TEXT,
            align: column.align,
            width: column.width - 10,
          });`,
  `          drawText(formatAfl(value), x + 5, top + 11, 7.7, {
            bold: value > 0,
            fill: column.key === 'bonuses'
              ? (value > 0 ? BONUS_BLUE : TEXT)
              : (value > 0 ? DEDUCTION_RED : TEXT),
            align: column.align,
            width: column.width - 10,
          });`,
  '? (value > 0 ? BONUS_BLUE : TEXT)',
);

replaceOrConfirm(
  pdf,
  `          drawText(formatHours(values[column.key]), x + 5, top + 11, 8.1, {
            bold: column.key === 'weeklyBase',
            align: column.align,
            width: column.width - 10,
          });`,
  `          const displayValue = column.key === 'weeklyBase'
            ? formatHours(values[column.key])
            : formatHoursMinutes(values[column.key]);
          drawText(displayValue, x + 5, top + 11, 8.1, {
            bold: column.key === 'weeklyBase',
            align: column.align,
            width: column.width - 10,
          });`,
  "const displayValue = column.key === 'weeklyBase'",
);

replaceOrConfirm(
  pdf,
  "    drawText('Horas: base semanal, overtime, AO, vacation y no work / no pay. Bonos y deducciones: florines (Afl.).', MARGIN, PAGE_HEIGHT - 24, 7.2, { fill: MUTED });",
  "    drawText('Base semanal en horas decimales configuradas; overtime, AO, vacation y no work / no pay en horas y minutos. Bonos y deducciones en Afl.', MARGIN, PAGE_HEIGHT - 24, 7.0, { fill: MUTED });",
  'overtime, AO, vacation y no work / no pay en horas y minutos',
);

console.log('Payroll accounting time and amount presentation applied.');
