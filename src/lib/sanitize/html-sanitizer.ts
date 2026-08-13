import sanitizeHtml from "sanitize-html";

// Server-side allowlist sanitization for seller-authored rich text
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "strong", "em", "u", "s",
    "h1", "h2", "h3", "h4",
    "ul", "ol", "li",
    "a", "blockquote", "code", "pre", "span",
  ],
  allowedAttributes: {
    a: ["href", "title", "rel", "target"],
    span: [],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer nofollow", target: "_blank" }),
  },
};

export function sanitizeSpecificationHtml(rawHtml: string): string {
  return sanitizeHtml(rawHtml, SANITIZE_OPTIONS);
}
