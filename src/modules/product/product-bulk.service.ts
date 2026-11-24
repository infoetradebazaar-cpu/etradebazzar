import { db } from "../../db/index";
import { logger } from "../../utils/logger";
import { parseFirstSheet } from "../../lib/spreadsheet/parse-sheet";

interface BulkProductRow {
    name: string;
    categorySlug: string;
    price?: number;
    stock?: number;
    description?: string;
    sku?: string;
    weightGrams?: number;
    compareAtPrice?: number;
    isDigital?: boolean;
    length?: number;
    width?: number;
    height?: number;
}

interface RowResult {
    row: number;
    status: "success" | "error";
    name?: string;
    productId?: string;
    error?: string;
}


const REQUIRED_COLS = ["name"];
const MAX_ROWS = 500;

export const productBulkService = {
    async uploadProducts(
        sellerId: string,
        actorId: string,
        file: Express.Multer.File
    ): Promise<{ results: RowResult[]; created: number; failed: number }> {
        const rows: any[] = await parseFirstSheet(file.buffer, MAX_ROWS);
        if (!rows.length) throw new Error("XLS file is empty");
        if (rows.length > MAX_ROWS) {
            throw new Error(`Bulk upload exceeds maximum of ${MAX_ROWS} products`);
        }

        const firstRow = rows[0];
        const missing = REQUIRED_COLS.filter((col) => !(col in firstRow));
        if (missing.length) throw new Error(`Missing columns: ${missing.join(", ")}`);

        const kyc = await db.sellerKyc.findUnique({ where: { sellerId } });
        if (!kyc) throw new Error("KYC not submitted");
        if (kyc.status !== "VERIFIED") throw new Error("KYC not verified");

        const slugs = [...new Set(rows.map((r: any) => String(r.categorySlug)))];
        const categories = await db.category.findMany({
            where: { slug: { in: slugs } },
            select: { id: true, slug: true },
        });
        const categoryMap = new Map(categories.map((c) => [c.slug, c.id]));

        const results: RowResult[] = [];
        let created = 0;
        let failed = 0;

        const fileSkus = rows.map((r: any) => (r.sku ? String(r.sku).trim() : "")).filter(Boolean);
        const takenSkus = new Set(
            fileSkus.length
                ? (await db.product.findMany({ where: { sku: { in: fileSkus } }, select: { sku: true } })).map((p) => p.sku!)
                : [],
        );

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i] as any;
            const rowNum = i + 2;

            try {
                const parsed = parseRow(row);

                const categoryId = categoryMap.get(parsed.categorySlug);
                if (!categoryId) {
                    throw new Error(`Category "${parsed.categorySlug}" not found`);
                }

                if (parsed.sku) {
                    if (takenSkus.has(parsed.sku)) throw new Error(`SKU "${parsed.sku}" already exists`);
                    takenSkus.add(parsed.sku);
                }

                const product = await db.product.create({
                    data: {
                        sellerId,
                        categoryId,
                        name: parsed.name,
                        description: parsed.description,
                        price: parsed.price,
                        compareAtPrice: parsed.compareAtPrice,
                        sku: parsed.sku,
                        stock: parsed.stock,
                        weightGrams: parsed.weightGrams,
                        isDigital: parsed.isDigital ?? false,
                        length: parsed.length,
                        width: parsed.width,
                        height: parsed.height,
                    },
                });

                results.push({ row: rowNum, status: "success", name: parsed.name, productId: product.id });
                created++;
            } catch (err: any) {
                logger.warn({ row: rowNum, err: err.message }, "Bulk upload row failed");
                const message = err?.code === "P2002" ? "SKU already exists" : err.message;
                results.push({ row: rowNum, status: "error", name: row.name, error: message });
                failed++;
            }
        }

        await db.auditLog.create({
            data: {
                sellerId,
                actorId,
                actorType: "seller",
                action: "BULK_PRODUCT_UPLOAD",
                entityType: "product",
                entityId: sellerId,
                metadata: { fileName: file.originalname, total: rows.length, created, failed },
            },
        });

        return { results, created, failed };
    },

    async getTemplate(): Promise<Buffer> {
        const XLSX = await import("xlsx");

        const headers = [
            "name",
            "categorySlug",
            "price",
            "stock",
            "description",
            "sku",
            "weightGrams",
            "compareAtPrice",
            "isDigital",
            "length",
            "width",
            "height",
        ];

        const example = [
            "Business Cards",
            "business-cards",
            "299",
            "100",
            "Premium matte business cards",
            "BC-001",
            "50",
            "399",
            "false",
            "9",
            "5.5",
            "0.3",
        ];

        const ws = XLSX.utils.aoa_to_sheet([headers, example]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Products");

        return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    },
};

function parseRow(row: any): BulkProductRow {
    const name = String(row.name ?? "").trim();
    if (!name) throw new Error("name is required");

    const categorySlug = String(row.categorySlug ?? "").trim() || "uncategorized";

    const price = row.price !== undefined && row.price !== "" ? Number(row.price) : undefined;
    if (price !== undefined && (isNaN(price) || price < 0)) throw new Error("price must be a positive number");

    const stock = row.stock !== undefined && row.stock !== "" ? Number(row.stock) : undefined;
    if (stock !== undefined && (isNaN(stock) || stock < 0)) throw new Error("stock must be a non-negative number");

    return {
        name,
        categorySlug,
        price,
        stock,
        description: row.description ? String(row.description).trim() : undefined,
        sku: row.sku ? String(row.sku).trim() : undefined,
        weightGrams: row.weightGrams ? Number(row.weightGrams) : undefined,
        compareAtPrice: row.compareAtPrice ? Number(row.compareAtPrice) : undefined,
        isDigital: row.isDigital ? String(row.isDigital).toLowerCase() === "true" : false,
        length: row.length ? Number(row.length) : undefined,
        width: row.width ? Number(row.width) : undefined,
        height: row.height ? Number(row.height) : undefined,
    };
}