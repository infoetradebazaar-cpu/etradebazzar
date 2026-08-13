const HTML_ESCAPES: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
};

function escapeHtml(value: unknown): string {
    return String(value ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

export function interpolateTemplate(template: string, data: Record<string, unknown>): string {
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) =>
        key in data ? escapeHtml(data[key]) : "",
    );
}
