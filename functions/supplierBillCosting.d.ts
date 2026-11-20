type Currency = 'USD' | 'AWG';
type PriceMode = 'final' | 'projected';
export type ItemUse = 'product' | 'material' | 'consumable' | 'tool';
export type MarketReference = {
    price: string;
    source: string;
    date: string;
    simulated?: boolean;
};
export type BillLine = {
    description: string;
    use: ItemUse;
    quantity: string;
    unitCost: string;
    importOverride: string | null;
    marketing: string;
    profit: string;
    operations: string;
    finalPrice: string;
    confirmed: boolean;
    market?: MarketReference;
};
export type BillDraft = {
    version: 1;
    supplier: string;
    invoiceNumber: string;
    origin: string;
    currency: Currency;
    generalImport: string;
    wire: string;
    lines: BillLine[];
};
export declare const MAX_LINES = 100;
export declare const sellable: (use: ItemUse) => use is "product" | "material";
export declare const blankLine: () => BillLine;
export declare const blankBill: () => BillDraft;
export declare function amount(cents: bigint): string;
export declare function percentOf(part: bigint, total: bigint): bigint | null;
export declare function compareMarket(price: bigint, market?: MarketReference): {
    status: 'missing' | 'incomplete' | 'invalid';
} | {
    status: 'compared' | 'simulated';
    referencePrice: bigint;
    difference: bigint;
    differenceBps: bigint;
    position: 'below' | 'equal' | 'above';
};
export declare function purchaseCost(bill: BillDraft, line: BillLine): {
    cost: bigint;
    converted: bigint;
    wire: bigint;
    shipping: bigint;
    landed: bigint;
    supplierTotal: bigint;
    landedTotal: bigint;
};
export declare function saleQuote(landed: bigint, line: BillLine, priceMode?: PriceMode): {
    recommended: bigint;
    allocation: null;
} | {
    recommended: bigint;
    allocation: {
        price: bigint;
        taxes: bigint;
        marketing: bigint;
        profit: bigint;
        restock: bigint;
        operations: bigint;
    };
} | null;
export declare function evaluateLine(bill: BillDraft, line: BillLine, priceMode?: PriceMode): {
    cost: {
        cost: bigint;
        converted: bigint;
        wire: bigint;
        shipping: bigint;
        landed: bigint;
        supplierTotal: bigint;
        landedTotal: bigint;
    };
    quote: {
        recommended: bigint;
        allocation: null;
    } | {
        recommended: bigint;
        allocation: {
            price: bigint;
            taxes: bigint;
            marketing: bigint;
            profit: bigint;
            restock: bigint;
            operations: bigint;
        };
    } | null;
    error: string;
} | {
    cost: {
        cost: bigint;
        converted: bigint;
        wire: bigint;
        shipping: bigint;
        landed: bigint;
        supplierTotal: bigint;
        landedTotal: bigint;
    } | null;
    quote: null;
    error: string;
};
export declare function changeRate(bill: BillDraft, generalImport: string): BillDraft;
/** Optional evaluations must come from this bill's lines in order, using the 'projected' price mode. */
export declare function summarizeBill(bill: BillDraft, projectedLines?: ReadonlyArray<ReturnType<typeof evaluateLine>>): {
    analysis: {
        purchase: {
            supplier: bigint;
            converted: bigint;
            wire: bigint;
            shipping: bigint;
            landed: bigint;
            rounding: bigint;
        };
        productUnits: bigint | null;
        purchasePendingLines: number[];
        grossMargin: bigint;
        recommendedSales: bigint;
        operationsTarget: bigint;
        operationsShortfall: bigint;
        negativeOperationsLines: number[];
    };
    totals: {
        sales: bigint;
        restock: bigint;
        taxes: bigint;
        marketing: bigint;
        profit: bigint;
        operations: bigint;
    };
    finalCount: number;
    suggestedCount: number;
    pendingLines: number[];
    internalCount: number;
};
export declare function openDraft(json: string): BillDraft;
export {};

