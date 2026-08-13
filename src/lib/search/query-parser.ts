import { db } from "../../db/index";
import { redis, RedisKeys } from "../../db/redis";
import { logger } from "../../utils/logger";

const LEXICON_TTL_SECS = 300;

const LEXICON_ATTRIBUTE_NAMES = ["Size", "Color"];

// attribute name -> lowercase value -> canonical (as-stored) value
type Lexicon = Record<string, Record<string, string>>;

async function buildLexicon(): Promise<Lexicon> {
  const options = await db.variantOption.findMany({
    where: { name: { in: LEXICON_ATTRIBUTE_NAMES, mode: "insensitive" } },
    select: { name: true, values: { select: { value: true } } },
  });

  const lexicon: Lexicon = {};
  for (const option of options) {
    const canonicalName =
      LEXICON_ATTRIBUTE_NAMES.find((n) => n.toLowerCase() === option.name.toLowerCase()) ??
      option.name;
    lexicon[canonicalName] ??= {};
    for (const { value } of option.values) {
      lexicon[canonicalName][value.toLowerCase()] = value;
    }
  }
  return lexicon;
}

async function getLexicon(): Promise<Lexicon> {
  try {
    const cached = await redis.get(RedisKeys.searchAttributeLexicon());
    if (cached) return JSON.parse(cached) as Lexicon;
  } catch (err: any) {
    logger.warn({ err: err.message }, "Search lexicon cache read failed, rebuilding from DB");
  }

  const lexicon = await buildLexicon();
  redis
    .set(RedisKeys.searchAttributeLexicon(), JSON.stringify(lexicon), "EX", LEXICON_TTL_SECS)
    .catch((err: any) => logger.warn({ err: err.message }, "Search lexicon cache write failed"));

  return lexicon;
}

export interface ParsedQuery {
  q?: string;
  minPrice?: number;
  maxPrice?: number;
  attributes?: Record<string, string[]>;
}

function parseAmount(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

const AMOUNT = String.raw`[₹$]?\s*(\d+(?:,\d{3})*(?:\.\d+)?)`;
const BETWEEN_RE = new RegExp(`\\bbetween\\s*${AMOUNT}\\s*(?:and|to|-)\\s*${AMOUNT}\\b`, "i");
const UNDER_RE = new RegExp(`\\b(?:under|below|less than|up ?to)\\s*${AMOUNT}`, "i");
const OVER_RE = new RegExp(`\\b(?:over|above|more than)\\s*${AMOUNT}`, "i");

export async function parseSearchQuery(rawQuery: string): Promise<ParsedQuery> {
  let text = rawQuery;
  const result: ParsedQuery = {};

  const between = BETWEEN_RE.exec(text);
  if (between) {
    const a = parseAmount(between[1]!);
    const b = parseAmount(between[2]!);
    result.minPrice = Math.min(a, b);
    result.maxPrice = Math.max(a, b);
    text = text.replace(between[0], " ");
  } else {
    const under = UNDER_RE.exec(text);
    if (under) {
      result.maxPrice = parseAmount(under[1]!);
      text = text.replace(under[0], " ");
    }
    const over = OVER_RE.exec(text);
    if (over) {
      result.minPrice = parseAmount(over[1]!);
      text = text.replace(over[0], " ");
    }
  }

  const lexicon = await getLexicon();
  const attributes: Record<string, string[]> = {};
  const remainingTokens: string[] = [];

  for (const token of text.split(/\s+/).filter(Boolean)) {
    const cleaned = token.toLowerCase().replace(/[^\w]/g, "");
    let matched = false;

    for (const [attributeName, values] of Object.entries(lexicon)) {
      const canonicalValue = values[cleaned];
      if (canonicalValue) {
        const bucket = (attributes[attributeName] ??= []);
        if (!bucket.includes(canonicalValue)) bucket.push(canonicalValue);
        matched = true;
        break;
      }
    }

    if (!matched) remainingTokens.push(token);
  }

  if (Object.keys(attributes).length > 0) result.attributes = attributes;

  const remainingText = remainingTokens.join(" ").trim();
  if (remainingText) result.q = remainingText;

  return result;
}
