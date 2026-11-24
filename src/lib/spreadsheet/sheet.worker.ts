import * as XLSX from "xlsx";

declare const self: Worker;

self.onmessage = (event: MessageEvent<{ data: Uint8Array; maxRows: number }>) => {
    try {
        const { data, maxRows } = event.data;
        const workbook = XLSX.read(data, { type: "array", sheetRows: maxRows + 2, dense: true });
        const sheetName = workbook.SheetNames[0];
        const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
        const rows = sheet ? XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet) : [];
        self.postMessage({ ok: true, rows });
    } catch (err) {
        self.postMessage({ ok: false, error: err instanceof Error ? err.message : "Could not read spreadsheet" });
    }
};