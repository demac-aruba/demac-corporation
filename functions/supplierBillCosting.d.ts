type Currency = 'USD' | 'AWG';
export type ItemUse = 'product' | 'material' | 'consumable' | 'tool';
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
export declare function purchaseCost(bill: BillDraft, line: BillLine): {
    cost: bigint;
    converted: bigint;
    wire: bigint;
    shipping: bigint;
    landed: bigint;
    supplierTotal: bigint;
    landedTotal: bigint;
};
export declare function saleQuote(landed: bigint, line: BillLine): {
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
export declare function evaluateLine(bill: BillDraft, line: BillLine): {
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
export declare function openDraft(json: string): BillDraft;
export {};
