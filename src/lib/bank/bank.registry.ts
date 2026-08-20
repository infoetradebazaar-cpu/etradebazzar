export interface BankBrand {
    name: string;
    short: string;
    color: string;
    logoUrl?: string;
}

const LOGO_BASE = "/images/banks";

export const BANK_REGISTRY: Record<string, BankBrand> = {
    SBIN: { name: "State Bank of India", short: "SBI", color: "#22409A", logoUrl: `${LOGO_BASE}/sbi-logo-png_seeklogo-398127.png` },
    HDFC: { name: "HDFC Bank", short: "HDFC", color: "#004C8F", logoUrl: `${LOGO_BASE}/hdfcbank-com-logo.png` },
    ICIC: { name: "ICICI Bank", short: "ICICI", color: "#A6192E", logoUrl: `${LOGO_BASE}/icicibank-com-logo.png` },
    UTIB: { name: "Axis Bank", short: "AXIS", color: "#97144D", logoUrl: `${LOGO_BASE}/axisbank-com-logo.png` },
    KKBK: { name: "Kotak Mahindra Bank", short: "KOTAK", color: "#ED1C24", logoUrl: `${LOGO_BASE}/kotak-com-logo.png` },
    PUNB: { name: "Punjab National Bank", short: "PNB", color: "#8E1537", logoUrl: `${LOGO_BASE}/pnb-bank-in-logo.png` },
    BARB: { name: "Bank of Baroda", short: "BOB", color: "#F58220", logoUrl: `${LOGO_BASE}/bob.png` },
    CNRB: { name: "Canara Bank", short: "CANARA", color: "#00579B", logoUrl: `${LOGO_BASE}/canara-bank.jpeg` },
    UBIN: { name: "Union Bank of India", short: "UNION", color: "#E5322D", logoUrl: `${LOGO_BASE}/unionbankofindia-bank-in-logo.png` },
    IDIB: { name: "Indian Bank", short: "INDIAN", color: "#00693E", logoUrl: `${LOGO_BASE}/indianbank-in-logo.png` },
    IOBA: { name: "Indian Overseas Bank", short: "IOB", color: "#C8102E", logoUrl: `${LOGO_BASE}/iob-co-th-logo.png` },
    MAHB: { name: "Bank of Maharashtra", short: "BOM", color: "#F58220", logoUrl: `${LOGO_BASE}/bank-of-maharashtra.jpeg` },
    CBIN: { name: "Central Bank of India", short: "CBI", color: "#003366", logoUrl: `${LOGO_BASE}/cbi-logo.jpg` },
    UCBA: { name: "UCO Bank", short: "UCO", color: "#00447C", logoUrl: `${LOGO_BASE}/uco.jpeg` },
    IDFB: { name: "IDFC FIRST Bank", short: "IDFC", color: "#96122D", logoUrl: `${LOGO_BASE}/idfcfirst-bank-in-logo.png` },
    YESB: { name: "Yes Bank", short: "YES", color: "#003DA5", logoUrl: `${LOGO_BASE}/yesbank-in-logo.png` },
    INDB: { name: "IndusInd Bank", short: "INDUS", color: "#7B2C39", logoUrl: `${LOGO_BASE}/indusind-com-logo.png` },
    RATN: { name: "RBL Bank", short: "RBL", color: "#E4002B", logoUrl: `${LOGO_BASE}/rbl-bank-in-logo.png` },
    FDRL: { name: "Federal Bank", short: "FEDERAL", color: "#003057", logoUrl: `${LOGO_BASE}/federal-bank-in-logo.png` },
    DEUT: { name: "Deutsche Bank", short: "DB", color: "#0018A8", logoUrl: `${LOGO_BASE}/db-com-logo.png` },
    HSBC: { name: "HSBC Bank", short: "HSBC", color: "#DB0011", logoUrl: `${LOGO_BASE}/hsbc-bank-in-logo.png` },
    SCBL: { name: "Standard Chartered Bank", short: "SC", color: "#0473EA", logoUrl: `${LOGO_BASE}/standard-chartered.png` },
    CITI: { name: "Citibank", short: "CITI", color: "#003B70", logoUrl: `${LOGO_BASE}/citi-com-logo.png` },
    BDBL: { name: "Bandhan Bank", short: "BANDHAN", color: "#8B1E3F", logoUrl: `${LOGO_BASE}/bandhanbank-com-logo.png` },
    BKID: { name: "Bank of India", short: "BOI", color: "#F7941D", logoUrl: `${LOGO_BASE}/boi_en_US_logo.png` },
    DCBL: { name: "DCB Bank", short: "DCB", color: "#00563F", logoUrl: `${LOGO_BASE}/dcbbank-com-logo.png` },
    JSFB: { name: "Jana Small Finance Bank", short: "JANA", color: "#004B87", logoUrl: `${LOGO_BASE}/Jana_Bank_Master_logo.jpg` },
    DBSS: { name: "DBS Bank India", short: "DBS", color: "#EF3340", logoUrl: `${LOGO_BASE}/dbs.jpeg` },
    ESFB: { name: "Equitas Small Finance Bank", short: "EQUITAS", color: "#8DC63F", logoUrl: `${LOGO_BASE}/equitas.jpeg` },
    UTKS: { name: "Utkarsh Small Finance Bank", short: "UTKARSH", color: "#F58220", logoUrl: `${LOGO_BASE}/utkarsh.jpeg` },
    UJVN: { name: "Ujjivan Small Finance Bank", short: "UJJIVAN", color: "#00A651", logoUrl: `${LOGO_BASE}/ujjivan.jpeg` },
    PSIB: { name: "Punjab & Sind Bank", short: "PSB", color: "#00447C", logoUrl: `${LOGO_BASE}/panjab-and-sindh-bank.png` },
    AUBL: { name: "AU Small Finance Bank", short: "AU", color: "#ED1C24", logoUrl: `${LOGO_BASE}/au-small-finance-bank.jpeg` },

    ABHY: { name: "Abhyudaya Co-operative Bank", short: "ABHYUDAYA", color: "#004B87", logoUrl: `${LOGO_BASE}/abhyudaya.jpeg` },
    ADCB: { name: "Abu Dhabi Commercial Bank", short: "ADCB", color: "#6E1E78", logoUrl: `${LOGO_BASE}/adcb.jpeg` },
    AIRP: { name: "Airtel Payments Bank", short: "AIRTEL", color: "#ED1C24", logoUrl: `${LOGO_BASE}/airtel-payments-bank.png` },
    APGV: { name: "Andhra Pradesh Grameena Vikas Bank", short: "APGVB", color: "#00563F", logoUrl: `${LOGO_BASE}/andhra-pradesh-grameena-vikas-bank.png` },
    APBL: { name: "Andhra Pradesh State Co-operative Bank", short: "APCOB", color: "#0F766E", logoUrl: `${LOGO_BASE}/andhra-pradesh-state-cooperative.jpeg` },
    GIFT: { name: "ANZ Bank", short: "ANZ", color: "#00447C", logoUrl: `${LOGO_BASE}/anz.png` },
    ASCB: { name: "Assam State Co-operative Bank", short: "ASCB", color: "#0F766E", logoUrl: `${LOGO_BASE}/assam-state-cooperative.jpeg` },
    BOFA: { name: "Bank of America", short: "BOFA", color: "#012169", logoUrl: `${LOGO_BASE}/bank-of-america.png` },
    BCHN: { name: "Bank of China", short: "BOC", color: "#C8102E", logoUrl: `${LOGO_BASE}/bank-of-china.png` },
    NOSC: { name: "Bank of Nova Scotia", short: "SCOTIA", color: "#EC111A", logoUrl: `${LOGO_BASE}/bank-of-nova.png` },
    BBKM: { name: "Bank of Bahrain and Kuwait", short: "BBK", color: "#005EB8", logoUrl: `${LOGO_BASE}/bbk.png` },
    BHAR: { name: "Bharat Co-operative Bank", short: "BHARAT", color: "#8E1537", logoUrl: `${LOGO_BASE}/bharat-bank.jpeg` },
    BSCB: { name: "Bihar State Co-operative Bank", short: "BSCB", color: "#00447C", logoUrl: `${LOGO_BASE}/bihar-state-cooperative.jpeg` },
    CLBL: { name: "Capital Small Finance Bank", short: "CAPITAL", color: "#004C8F", logoUrl: `${LOGO_BASE}/capital-small-finance-bank.png` },
    CIUB: { name: "City Union Bank", short: "CUB", color: "#8E1537", logoUrl: `${LOGO_BASE}/city-union-bank.png` },
    COSB: { name: "Cosmos Co-operative Bank", short: "COSMOS", color: "#003366", logoUrl: `${LOGO_BASE}/Cosmosbank__logo.png` },
    CRLY: { name: "Credit Agricole", short: "CA", color: "#00A651", logoUrl: `${LOGO_BASE}/credit-agricole.jpeg` },
    CRES: { name: "Credit Suisse", short: "CS", color: "#00447C", logoUrl: `${LOGO_BASE}/credit_suisse_logo.jpeg` },
    CSBK: { name: "CSB Bank", short: "CSB", color: "#8E1537", logoUrl: `${LOGO_BASE}/CSB.jpeg` },
    DLXB: { name: "Dhanlaxmi Bank", short: "DHANLAXMI", color: "#8E1537", logoUrl: `${LOGO_BASE}/dhanlaxmi-bank.png` },
    DOHB: { name: "Doha Bank", short: "DOHA", color: "#8E1537", logoUrl: `${LOGO_BASE}/doha.png` },
    EBIL: { name: "Emirates NBD", short: "ENBD", color: "#003DA5", logoUrl: `${LOGO_BASE}/emirates-nbd.jpeg` },
    ESAF: { name: "ESAF Small Finance Bank", short: "ESAF", color: "#00A651", logoUrl: `${LOGO_BASE}/esaf-small-finance-bank.png` },
    NBAD: { name: "First Abu Dhabi Bank", short: "FAB", color: "#8B7355", logoUrl: `${LOGO_BASE}/fab.jpeg` },
    FINO: { name: "Fino Payments Bank", short: "FINO", color: "#F58220", logoUrl: `${LOGO_BASE}/fino-payment-bank.png` },
    GSCB: { name: "Gujarat State Co-operative Bank", short: "GSCB", color: "#F58220", logoUrl: `${LOGO_BASE}/gujarat-state.jpeg` },
    HSCB: { name: "Haryana State Co-operative Bank", short: "HSCB", color: "#00447C", logoUrl: `${LOGO_BASE}/haryana-state.jpeg` },
    IPOS: { name: "India Post Payments Bank", short: "IPPB", color: "#C8102E", logoUrl: `${LOGO_BASE}/india-post-payment.jpeg` },
    JAKA: { name: "Jammu & Kashmir Bank", short: "J&K", color: "#8E1537", logoUrl: `${LOGO_BASE}/jammu-and-kashmir-bank.png` },
    JSBP: { name: "Janata Sahakari Bank", short: "JANATA", color: "#00447C", logoUrl: `${LOGO_BASE}/janata.png` },
    KCCB: { name: "Kalupur Commercial Co-operative Bank", short: "KALUPUR", color: "#00563F", logoUrl: `${LOGO_BASE}/kalupur.jpeg` },
    KARB: { name: "Karnataka Bank", short: "KARNATAKA", color: "#00447C", logoUrl: `${LOGO_BASE}/karnataka-bank.png` },
    KSCB: { name: "Karnataka State Co-operative Bank", short: "KSCB", color: "#0F766E", logoUrl: `${LOGO_BASE}/karnataka-state.png` },
    KVBL: { name: "Karur Vysya Bank", short: "KVB", color: "#8E1537", logoUrl: `${LOGO_BASE}/karur-vysya-bank.png` },
    KSBK: { name: "Kerala State Co-operative Bank", short: "KSCB", color: "#00563F", logoUrl: `${LOGO_BASE}/kerela-state.jpeg` },
    MSCI: { name: "Maharashtra State Co-operative Bank", short: "MSCB", color: "#F58220", logoUrl: `${LOGO_BASE}/maharashtra-state-cooperative-bank-logo.jpeg` },
    MSHQ: { name: "Mashreq Bank", short: "MASHREQ", color: "#003DA5", logoUrl: `${LOGO_BASE}/mashreq.png` },
    MSNU: { name: "Mehsana Urban Co-operative Bank", short: "MEHSANA", color: "#00447C", logoUrl: `${LOGO_BASE}/mehsana.png` },
    MHCB: { name: "Mizuho Bank", short: "MIZUHO", color: "#003DA5", logoUrl: `${LOGO_BASE}/mizuho.jpeg` },
    MPCB: { name: "Madhya Pradesh State Co-operative Bank", short: "MPSCB", color: "#00447C", logoUrl: `${LOGO_BASE}/mp-state-cooperative.jpeg` },
    BOTK: { name: "MUFG Bank", short: "MUFG", color: "#C8102E", logoUrl: `${LOGO_BASE}/mufg-bank.png` },
    NTBL: { name: "Nainital Bank", short: "NAINITAL", color: "#00447C", logoUrl: `${LOGO_BASE}/nainital-bank.png` },
    NKGS: { name: "NKGSB Co-operative Bank", short: "NKGSB", color: "#8E1537", logoUrl: `${LOGO_BASE}/nkgsb.jpeg` },
    NESF: { name: "North East Small Finance Bank", short: "NESFB", color: "#00A651", logoUrl: `${LOGO_BASE}/north-east-small-finance-bank.png` },
    NSPB: { name: "NSDL Payments Bank", short: "NSDL", color: "#003DA5", logoUrl: `${LOGO_BASE}/nsdl-payments-bank.png` },
    NNSB: { name: "Nutan Nagrik Sahakari Bank", short: "NUTAN", color: "#00447C", logoUrl: `${LOGO_BASE}/nutan-nagrik.jpeg` },
    ORCB: { name: "Odisha State Co-operative Bank", short: "OSCB", color: "#F58220", logoUrl: `${LOGO_BASE}/odisha-state-cooperative.jpeg` },
    QNBA: { name: "Qatar National Bank", short: "QNB", color: "#8E1537", logoUrl: `${LOGO_BASE}/qatar.png` },
    RABO: { name: "Rabobank", short: "RABO", color: "#F58220", logoUrl: `${LOGO_BASE}/rabo-bank.png` },
    RNSB: { name: "Rajkot Nagarik Sahakari Bank", short: "RAJKOT", color: "#00447C", logoUrl: `${LOGO_BASE}/rajkot.jpeg` },
    RSCB: { name: "Rajasthan State Co-operative Bank", short: "RSCB", color: "#8E1537", logoUrl: `${LOGO_BASE}/rajsthan-state.jpeg` },
    SRCB: { name: "Saraswat Co-operative Bank", short: "SARASWAT", color: "#8E1537", logoUrl: `${LOGO_BASE}/saraswatbank.png` },
    SVCB: { name: "Shamrao Vithal Co-operative Bank", short: "SVC", color: "#00447C", logoUrl: `${LOGO_BASE}/shamrao.png` },
    SMCB: { name: "Shivalik Small Finance Bank", short: "SHIVALIK", color: "#00A651", logoUrl: `${LOGO_BASE}/shivalik-small-finance-bank.png` },
    SMBC: { name: "Sumitomo Mitsui Banking Corporation", short: "SMBC", color: "#00447C", logoUrl: `${LOGO_BASE}/smbc.jpeg` },
    SOGE: { name: "Societe Generale", short: "SOCGEN", color: "#C8102E", logoUrl: `${LOGO_BASE}/societe.png` },
    SIBL: { name: "South Indian Bank", short: "SIB", color: "#00447C", logoUrl: `${LOGO_BASE}/south-indian-bank.png` },
    SPCB: { name: "Surat People's Co-operative Bank", short: "SPCB", color: "#F58220", logoUrl: `${LOGO_BASE}/surat.png` },
    SURY: { name: "Suryoday Small Finance Bank", short: "SURYODAY", color: "#F58220", logoUrl: `${LOGO_BASE}/suryoday-small-finance-bank.png` },
    TMBL: { name: "Tamilnad Mercantile Bank", short: "TMB", color: "#00563F", logoUrl: `${LOGO_BASE}/tamilnad-mercantile-bank.png` },
    TNSC: { name: "Tamil Nadu State Apex Co-operative Bank", short: "TNSCB", color: "#00563F", logoUrl: `${LOGO_BASE}/tamilnadu-state.jpeg` },
    TSAB: { name: "Telangana State Co-operative Apex Bank", short: "TSAB", color: "#8E1537", logoUrl: `${LOGO_BASE}/telangana-state-cooperative-apex.png` },
    TJSB: { name: "TJSB Sahakari Bank", short: "TJSB", color: "#00447C", logoUrl: `${LOGO_BASE}/tjsb.jpeg` },
    UPCB: { name: "UP Co-operative Bank", short: "UPCB", color: "#F58220", logoUrl: `${LOGO_BASE}/uttar-pradesh-cooperative.jpeg` },
    WBSC: { name: "West Bengal State Co-operative Bank", short: "WBSCB", color: "#00447C", logoUrl: `${LOGO_BASE}/west-bengal-state-cooperative.png` },
};

const FALLBACK_COLORS = [
    "#4C51BF", "#0E7490", "#B45309", "#4D7C0F", "#9D174D",
    "#5B21B6", "#0F766E", "#B91C1C", "#1D4ED8", "#A16207",
];

function hashString(value: string): number {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
        hash = (hash << 5) - hash + value.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}

function initialsFromName(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return "??";
    if (words.length === 1) return words[0]!.slice(0, 3).toUpperCase();
    return words
        .slice(0, 3)
        .map((w) => w[0])
        .join("")
        .toUpperCase();
}

function normalizeForMatch(value: string): string {
    return value.toUpperCase().replace(/[^A-Z]/g, "");
}

const GENERIC_BANK_WORDS = new Set([
    "BANK", "BANKING", "COOPERATIVE", "CO", "OPERATIVE", "STATE", "LTD",
    "LIMITED", "DISTRICT", "URBAN", "RURAL", "SAHAKARI", "NAGRIK", "APEX",
    "COMMERCIAL", "SMALL", "FINANCE", "SCHEDULED", "NATIONAL", "OF", "AND",
    "THE", "INDIA", "REGIONAL", "GRAMIN", "GRAMEENA", "VIKAS",
]);

function namesLikelyMatch(curatedName: string, realName: string): boolean {
    const curatedWords = curatedName
        .split(/\s+/)
        .map((w) => normalizeForMatch(w))
        .filter((w) => w.length >= 4 && !GENERIC_BANK_WORDS.has(w));
    if (curatedWords.length === 0) return true;
    const normalizedReal = normalizeForMatch(realName);
    return curatedWords.some((w) => normalizedReal.includes(w));
}

export function getBankBrand(
    ifscCode?: string | null,
    bankName?: string | null,
): BankBrand {
    const prefix = ifscCode?.trim().slice(0, 4).toUpperCase();
    const curated = prefix ? BANK_REGISTRY[prefix] : undefined;
    const trimmedBankName = bankName?.trim();

    if (curated) {
        // A shared/sponsor-bank IFSC prefix (e.g. an RRB using its sponsor
        // bank's prefix) can point at the wrong curated entry. Only trust the
        // curated logo/color when the real bank name roughly agrees with it;
        // otherwise fall through to the generic fallback below.
        if (!trimmedBankName || namesLikelyMatch(curated.name, trimmedBankName)) {
            return trimmedBankName ? { ...curated, name: trimmedBankName } : curated;
        }
    }

    const name = trimmedBankName || prefix || "Bank";
    const seed = prefix || name;
    const color = FALLBACK_COLORS[hashString(seed) % FALLBACK_COLORS.length]!;
    return { name, short: initialsFromName(name), color };
}
