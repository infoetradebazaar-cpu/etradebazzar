import { isSpreadsheetContent } from "../storage/file-signature";

const DEFAULT_TIMEOUT_MS = 15_000;


export async function parseFirstSheet(
    buffer: Buffer,
    maxRows: number,
    timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Record<string, unknown>[]> {
    if (!isSpreadsheetContent(buffer)) {
        throw new Error("File is not a valid spreadsheet (.xlsx, .xls or .csv)");
    }

    const worker = new Worker(new URL("./sheet.worker.ts", import.meta.url).href);
    try {
        return await new Promise((resolve, reject) => {
            const timer = setTimeout(
                () =>
                    reject(
                        new Error(
                            "Spreadsheet took too long to read; split it into smaller files",
                        ),
                    ),
                timeoutMs,
            );
            worker.onmessage = (event: MessageEvent<{ ok: boolean; rows?: Record<string, unknown>[]; error?: string }>) => {
                clearTimeout(timer);
                if (event.data.ok) resolve(event.data.rows ?? []);
                else reject(new Error(`Could not read spreadsheet: ${event.data.error}`));
            };
            worker.onerror = (event) => {
                clearTimeout(timer);
                reject(new Error(`Could not read spreadsheet: ${event.message}`));
            };
            worker.postMessage({ data: new Uint8Array(buffer), maxRows });
        });
    } finally {
        worker.terminate();
    }
}