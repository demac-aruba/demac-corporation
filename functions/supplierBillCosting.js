"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.blankBill = exports.blankLine = exports.sellable = exports.MAX_LINES = void 0;
exports.amount = amount;
exports.percentOf = percentOf;
exports.compareMarket = compareMarket;
exports.purchaseCost = purchaseCost;
exports.saleQuote = saleQuote;
exports.evaluateLine = evaluateLine;
exports.summarizeBill = summarizeBill;
exports.changeRate = changeRate;
exports.openDraft = openDraft;
exports.MAX_LINES = 100;
const sellable = (use) => use === 'product' || use === 'material';
exports.sellable = sellable;
const blankLine = () => ({
    description: '', use: 'product', quantity: '1', unitCost: '', importOverride: null,
    marketing: '', profit: '', operations: '', finalPrice: '', confirmed: false,
});
exports.blankLine = blankLine;
const blankBill = () => ({
    version: 1, supplier: '', invoiceNumber: '', origin: '', currency: 'USD',
    generalImport: '', wire: '2', lines: [(0, exports.blankLine)()],
});
exports.blankBill = blankBill;
// Decimal text goes straight to minor units. Each displayed charge rounds once,
// half up, per unit. Commas are accepted as decimal separators, never as grouping.
function decimal(raw, places, label) {
    const value = raw.trim().replace(',', '.');
    const [whole, fraction = ''] = value.split('.');
    if (!/^\d{1,9}(?:\.\d+)?$/.test(value) || fraction.length > places) {
        throw new Error('Revisa ' + label + ' (hasta ' + places + ' decimales).');
    }
    return BigInt(whole + fraction.padEnd(places, '0'));
}
function roundedRatio(value, numerator, denominator) {
    const product = value * numerator;
    const half = denominator / 2n;
    return (product + (product < 0n ? -half : half)) / denominator;
}
function percentOf(part, total) {
    return total > 0n ? roundedRatio(part, 10000n, total) : null;
}
function amount(cents) {
    const absolute = cents < 0n ? -cents : cents;
    return (cents < 0n ? '−' : '') + (absolute / 100n).toLocaleString('en-US') + '.' + (absolute % 100n).toString().padStart(2, '0');
}
function lineQuantity(line) {
    const fractional = line.use === 'material' || line.use === 'consumable';
    const quantity = decimal(line.quantity, 3, 'la cantidad');
    if (quantity === 0n || (!fractional && quantity % 1000n !== 0n))
        throw new Error('Revisa la cantidad para este tipo de artículo.');
    return quantity;
}
function productUnits(lines) {
    if (!lines.length || !lines.every(line => line.use === 'product')) return null;
    try {
        return lines.reduce((total, line) => total + lineQuantity(line) / 1000n, 0n);
    } catch {
        return null;
    }
}
function purchaseCost(bill, line) {
    const cost = decimal(line.unitCost, 2, 'el costo por unidad');
    const quantity = lineQuantity(line);
    const imported = bill.currency === 'USD';
    const converted = imported ? roundedRatio(cost, 180n, 100n) : cost;
    const wire = imported ? roundedRatio(converted, decimal(bill.wire, 2, 'el wire'), 10000n) : 0n;
    let shipping = 0n;
    if (imported) {
        const general = decimal(bill.generalImport, 2, 'el porcentaje general de importación');
        const rate = line.importOverride === null ? general : decimal(line.importOverride, 2, 'la importación del artículo');
        shipping = roundedRatio(converted + wire, rate, 10000n);
    }
    const landed = converted + wire + shipping;
    return { cost, converted, wire, shipping, landed, supplierTotal: roundedRatio(cost, quantity, 1000n), landedTotal: roundedRatio(landed, quantity, 1000n) };
}
function saleQuote(landed, line, priceMode = 'final') {
    if (!(0, exports.sellable)(line.use))
        return null;
    const tax = 700n;
    const marketing = decimal(line.marketing, 2, 'marketing');
    const profit = decimal(line.profit, 2, 'ganancia');
    const operationsTarget = decimal(line.operations, 2, 'operaciones objetivo');
    const costShare = 10000n - tax - marketing - profit - operationsTarget;
    if (costShare <= 0n)
        throw new Error('Impuesto, marketing, ganancia y operaciones deben sumar menos de 100%.');
    const recommended = roundedRatio(landed, 10000n, costShare);
    const hasFinalPrice = line.finalPrice.trim() !== '';
    if (!hasFinalPrice && priceMode !== 'projected')
        return { recommended, allocation: null };
    const price = hasFinalPrice ? decimal(line.finalPrice, 2, 'el precio final') : recommended;
    const taxes = roundedRatio(price, tax, 10000n);
    const marketingFund = roundedRatio(price, marketing, 10000n);
    const profitFund = roundedRatio(price, profit, 10000n);
    return { recommended, allocation: { price, taxes, marketing: marketingFund, profit: profitFund, restock: landed,
            operations: price - landed - taxes - marketingFund - profitFund } };
}
function evaluateLine(bill, line, priceMode = 'final') {
    let cost = null;
    try {
        cost = purchaseCost(bill, line);
        return { cost, quote: saleQuote(cost.landed, line, priceMode), error: '' };
    }
    catch (error) {
        return { cost, quote: null, error: error instanceof Error ? error.message : 'Revisa el artículo.' };
    }
}
// A caller displaying the same rows can reuse their 'projected' evaluations in bill order.
function summarizeBill(bill, projectedLines) {
    const totals = { sales: 0n, restock: 0n, taxes: 0n, marketing: 0n, profit: 0n, operations: 0n };
    const purchase = { supplier: 0n, converted: 0n, wire: 0n, shipping: 0n, landed: 0n, rounding: 0n };
    const pendingLines = [];
    const purchasePendingLines = [];
    const negativeOperationsLines = [];
    let recommendedSales = 0n;
    let weightedOperationsTarget = 0n;
    let finalCount = 0;
    let suggestedCount = 0;
    let internalCount = 0;
    for (const [index, line] of bill.lines.entries()) {
        const { cost, quote } = projectedLines?.[index] ?? evaluateLine(bill, line, 'projected');
        const quantity = cost ? decimal(line.quantity, 3, 'la cantidad') : 0n;
        if (cost) {
            purchase.supplier += cost.supplierTotal;
            purchase.converted += roundedRatio(cost.converted, quantity, 1000n);
            purchase.wire += roundedRatio(cost.wire, quantity, 1000n);
            purchase.shipping += roundedRatio(cost.shipping, quantity, 1000n);
            purchase.landed += cost.landedTotal;
        } else {
            purchasePendingLines.push(index + 1);
        }
        if (!sellable(line.use)) {
            internalCount++;
            continue;
        }
        if (!cost || !quote?.allocation) {
            pendingLines.push(index + 1);
            continue;
        }
        if (line.finalPrice.trim() === '') suggestedCount++;
        else finalCount++;
        const allocation = quote.allocation;
        const sales = roundedRatio(allocation.price, quantity, 1000n);
        const taxes = roundedRatio(allocation.taxes, quantity, 1000n);
        const marketing = roundedRatio(allocation.marketing, quantity, 1000n);
        const profit = roundedRatio(allocation.profit, quantity, 1000n);
        // Operations receives the residual after each fund is rounded to money.
        const operations = sales - cost.landedTotal - taxes - marketing - profit;
        totals.sales += sales;
        totals.restock += cost.landedTotal;
        totals.taxes += taxes;
        totals.marketing += marketing;
        totals.profit += profit;
        totals.operations += operations;
        recommendedSales += roundedRatio(quote.recommended, quantity, 1000n);
        weightedOperationsTarget += sales * decimal(line.operations, 2, 'operaciones objetivo');
        if (operations < 0n) negativeOperationsLines.push(index + 1);
    }
    // Fractional quantities can round the combined landed amount differently from its components.
    purchase.rounding = purchase.landed - purchase.converted - purchase.wire - purchase.shipping;
    const operationsTarget = roundedRatio(weightedOperationsTarget, 1n, 10000n);
    const analysis = {
        purchase, purchasePendingLines, productUnits: productUnits(bill.lines),
        grossMargin: totals.sales - totals.restock, recommendedSales,
        operationsTarget, operationsShortfall: operationsTarget > totals.operations ? operationsTarget - totals.operations : 0n,
        negativeOperationsLines,
    };
    return { totals, analysis, finalCount, suggestedCount, pendingLines, internalCount };
}
function changeRate(bill, generalImport) {
    if (generalImport === bill.generalImport)
        return bill;
    return { ...bill, generalImport, lines: bill.lines.map(line => line.importOverride === null ? { ...line, confirmed: false } : line) };
}
function record(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function shortText(value) {
    return typeof value === 'string' && value.length <= 240;
}
function marketRecord(value) {
    return record(value) && [value.price, value.source, value.date].every(shortText)
        && (value.simulated === undefined || typeof value.simulated === 'boolean');
}
function validMarketDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
    const parsed = new Date(value + 'T00:00:00Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function compareMarket(price, market) {
    if (market === undefined) return { status: 'missing' };
    if (!marketRecord(market) || price < 0n) return { status: 'invalid' };
    const referenceText = market.price.trim();
    const source = market.source.trim();
    const date = market.date.trim();
    if (!referenceText && !source && !date) return { status: 'missing' };
    let referencePrice;
    if (referenceText) {
        try {
            referencePrice = decimal(referenceText, 2, 'el precio de mercado');
        } catch {
            return { status: 'invalid' };
        }
        if (referencePrice === 0n) return { status: 'invalid' };
    }
    if (date && !validMarketDate(date)) return { status: 'invalid' };
    if (!referenceText || !source || !date) return { status: 'incomplete' };
    const difference = price - referencePrice;
    return {
        status: market.simulated ? 'simulated' : 'compared',
        referencePrice, difference, differenceBps: percentOf(difference, referencePrice),
        position: difference < 0n ? 'below' : difference > 0n ? 'above' : 'equal',
    };
}
// Allow incomplete drafts. Restore only known fields; a file is never authority
// for catalog pricing. The operator reviews sellable lines again after opening.
function openDraft(json) {
    const data = JSON.parse(json);
    if (!record(data) || data.version !== 1 || (data.currency !== 'USD' && data.currency !== 'AWG')
        || ![data.supplier, data.invoiceNumber, data.origin, data.generalImport, data.wire].every(shortText)
        || !Array.isArray(data.lines) || !data.lines.length || data.lines.length > exports.MAX_LINES) {
        throw new Error('Archivo de borrador inválido.');
    }
    const lines = data.lines.map((row) => {
        if (!record(row) || (typeof row.use !== 'string' || !['product', 'material', 'consumable', 'tool'].includes(row.use)))
            throw new Error('Tipo de artículo inválido.');
        const line = (0, exports.blankLine)();
        for (const name of ['description', 'quantity', 'unitCost', 'marketing', 'profit', 'operations', 'finalPrice']) {
            const value = row[name];
            if (!shortText(value))
                throw new Error('Artículo inválido.');
            line[name] = value;
        }
        if (row.importOverride !== null && !shortText(row.importOverride))
            throw new Error('Porcentaje inválido.');
        if (row.market !== undefined) {
            if (!marketRecord(row.market)) throw new Error('Referencia de mercado inválida.');
            const { price, source, date, simulated } = row.market;
            line.market = { price, source, date };
            if (simulated !== undefined) line.market.simulated = simulated;
        }
        return { ...line, use: row.use, importOverride: row.importOverride };
    });
    return { version: 1, supplier: String(data.supplier), invoiceNumber: String(data.invoiceNumber),
        origin: String(data.origin), currency: data.currency, generalImport: String(data.generalImport), wire: String(data.wire), lines };
}

