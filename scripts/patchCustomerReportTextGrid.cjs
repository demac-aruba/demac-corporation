const fs = require('fs');

const pdfFile = 'src/services/technicalReportPdf.ts';
let pdfSource = fs.readFileSync(pdfFile, 'utf8');

if (!pdfSource.includes('const TEXT_GRID_COLUMNS = 3;')) {
  const oldBlock = `      if (!field.photoUrl) {
        const value = field.value || 'Sin información';
        const valueLines = wrapText(value, CONTENT_WIDTH - 18, 9);
        const height = 31 + valueLines.length * 12;
        ensureSpace(height + 8);
        fillRect(page, MARGIN, cursor, CONTENT_WIDTH, height, WHITE, BORDER);
        drawText(page, field.label.toUpperCase(), MARGIN + 9, cursor + 8, 6.8, { bold: true, fill: MUTED });
        valueLines.forEach((entry, index) => drawText(page, entry, MARGIN + 9, cursor + 22 + index * 12, 9, { fill: TEXT }));
        cursor += height + 8;
        fieldIndex += 1;
        continue;
      }`;

  const newBlock = `      if (!field.photoUrl) {
        const TEXT_GRID_COLUMNS = 3;
        const TEXT_COLUMN_GAP = 8;
        const TEXT_ROW_GAP = 8;
        const TEXT_UNIT_WIDTH = (CONTENT_WIDTH - TEXT_COLUMN_GAP * (TEXT_GRID_COLUMNS - 1)) / TEXT_GRID_COLUMNS;
        let textRunEnd = fieldIndex;
        while (textRunEnd < section.fields.length && !section.fields[textRunEnd].photoUrl) textRunEnd += 1;
        const textRun = section.fields.slice(fieldIndex, textRunEnd);
        let textRunIndex = 0;

        while (textRunIndex < textRun.length) {
          const row: Array<{ field: PrintableReportField; span: number; startUnit: number }> = [];
          let usedUnits = 0;

          while (textRunIndex < textRun.length) {
            const textField = textRun[textRunIndex];
            const rawValue = String(textField.value || 'Sin información').trim();
            const isLong = rawValue.includes('\\n') || rawValue.length > 160;
            const isMedium = !isLong && (rawValue.length > 70 || textField.label.length > 55);
            const span = isLong ? 3 : isMedium ? 2 : 1;

            if (row.length && usedUnits + span > TEXT_GRID_COLUMNS) break;
            if (span === 3 && row.length) break;

            row.push({ field: textField, span, startUnit: usedUnits });
            usedUnits += span;
            textRunIndex += 1;
            if (usedUnits >= TEXT_GRID_COLUMNS) break;
          }

          const allSingle = row.every((item) => item.span === 1);
          const prepared = row.map((item, index) => {
            let width: number;
            let x: number;
            if (allSingle && row.length === 2) {
              width = (CONTENT_WIDTH - TEXT_COLUMN_GAP) / 2;
              x = MARGIN + index * (width + TEXT_COLUMN_GAP);
            } else if (allSingle && row.length === 1) {
              width = (CONTENT_WIDTH - TEXT_COLUMN_GAP) / 2;
              x = MARGIN;
            } else {
              width = TEXT_UNIT_WIDTH * item.span + TEXT_COLUMN_GAP * (item.span - 1);
              x = MARGIN + item.startUnit * (TEXT_UNIT_WIDTH + TEXT_COLUMN_GAP);
            }

            const value = String(item.field.value || 'Sin información');
            const labelLines = wrapText(item.field.label.toUpperCase(), width - 18, 6.8).slice(0, 3);
            const valueLines = wrapText(value, width - 18, 9);
            const labelHeight = Math.max(1, labelLines.length) * 9;
            const valueHeight = Math.max(1, valueLines.length) * 11.5;
            return {
              ...item,
              x,
              width,
              labelLines,
              valueLines,
              labelHeight,
              valueHeight,
              cardHeight: 16 + labelHeight + 5 + valueHeight + 12,
            };
          });

          const rowHeight = Math.max(...prepared.map((item) => item.cardHeight));
          if (cursor + rowHeight > FOOTER_TOP - 18) {
            addPage();
            drawText(page, section.title + ' - continuación', MARGIN, cursor, 12, { bold: true, fill: DARK_BLUE });
            cursor += 22;
          }

          prepared.forEach((item) => {
            fillRect(page, item.x, cursor, item.width, rowHeight, WHITE, BORDER);
            let itemTop = cursor + 8;
            item.labelLines.forEach((entry, lineIndex) => drawText(page, entry, item.x + 9, itemTop + lineIndex * 9, 6.8, { bold: true, fill: MUTED }));
            itemTop += item.labelHeight + 5;
            item.valueLines.forEach((entry, lineIndex) => drawText(page, entry, item.x + 9, itemTop + lineIndex * 11.5, 9, { fill: TEXT }));
          });

          cursor += rowHeight + TEXT_ROW_GAP;
        }

        fieldIndex = textRunEnd;
        continue;
      }`;

  if (!pdfSource.includes(oldBlock)) {
    throw new Error('The full-width PDF text field block was not found.');
  }
  pdfSource = pdfSource.replace(oldBlock, newBlock);
  fs.writeFileSync(pdfFile, pdfSource);
}

console.log('Customer report text grid patch applied.');
