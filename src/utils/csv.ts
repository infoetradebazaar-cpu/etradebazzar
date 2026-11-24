import type { Response } from "express";

const FORMULA_TRIGGER_CHARS = ["=", "+", "-", "@", "\t", "\r"];

function escapeCsvField(value: string): string {
    let str = value;

    if (FORMULA_TRIGGER_CHARS.some((char) => str.startsWith(char))) {
        str = `'${str}`;
    }

    const escaped = str.replace(/"/g, '""');
    return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

export async function streamCsv(
    res: Response,
    filename: string,
    columns: string[],
    batches: AsyncIterable<Record<string, any>[]>,
): Promise<void> {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
    res.write(columns.join(","));
    for await (const rows of batches) {
        const chunk = rows
            .map((row) => "\n" + columns.map((col) => escapeCsvField(String(row[col] ?? ""))).join(","))
            .join("");
        if (!res.write(chunk)) await new Promise((resolve) => res.once("drain", resolve));
    }
    res.end();
}

export function toCsv(rows: Record<string, any>[], columns: string[]): string {
    const header = columns.join(",");
    const lines = rows.map((row) =>
        columns
            .map((col) => {
                const val = row[col] ?? "";
                return escapeCsvField(String(val));
            })
            .join(",")
    );
    return [header, ...lines].join("\n");
}