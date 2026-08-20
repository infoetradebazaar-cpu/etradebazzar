/**
 * ETradeBazaar — Main Script
 *
 * Merged from:
 *   - seed-comprehensive.ts       (comprehensive database seeding)
 *   - backfill-platform-rbac.ts   (platform RBAC permission backfill)
 *   - backfill-seller-rbac.ts     (seller RBAC permission backfill)
 *   - reindex-search.ts           (OpenSearch product reindex)
 *
 * Usage:
 *   bun scripts/main-script.ts seed                  # Full comprehensive seed
 *   bun scripts/main-script.ts backfill-platform-rbac
 *   bun scripts/main-script.ts backfill-seller-rbac
 *   bun scripts/main-script.ts reindex-search
 *   bun scripts/main-script.ts                       # Interactive menu
 */
import { db } from "../src/db/index";
import { redis, RedisKeys } from "../src/db/redis";
import {
  assignDefaultRolePermissions,
  seedPlatformPermissions,
  DEFAULT_PLATFORM_ROLE_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
} from "../src/lib/permission/permission.service";
import { generateDisplayId } from "../src/lib/uid/uid.generator";
import { invoicingService } from "../src/modules/invoicing/invoicing.service";
import { encrypt } from "../src/utils/encryption";
import { logger } from "../src/utils/logger";
import { SearchIndexFactory } from "../src/lib/search/search-index.factory";
import { buildSearchDocument } from "../src/lib/search/product-search-document";
import bcrypt from "bcryptjs";

// ─── Helpers ────────────────────────────────────────────────────────────────
const randomDate = (start: Date, end: Date) =>
  new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
const randomInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;
const randomDecimal = (min: number, max: number) =>
  parseFloat((Math.random() * (max - min) + min).toFixed(2));
const randomItem = <T>(arr: T[]): T =>
  arr[Math.floor(Math.random() * arr.length)]!;
const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
let _c = 0;
const uid = () => `${Date.now()}${++_c}`;

// ─── Static Data ────────────────────────────────────────────────────────────
const firstNames = ["Rahul", "Priya", "Amit", "Sneha", "Vikram", "Anita", "Rajesh", "Kavita", "Deepak", "Meena", "Arjun", "Nisha", "Suresh", "Pooja", "Kiran"];
const lastNames = ["Sharma", "Patel", "Singh", "Kumar", "Verma", "Gupta", "Reddy", "Nair", "Iyer", "Das", "Joshi", "Mishra", "Tiwari", "Yadav", "Shah"];
const cities = ["Mumbai", "Delhi", "Bangalore", "Chennai", "Hyderabad", "Pune", "Ahmedabad", "Kolkata", "Jaipur", "Lucknow", "Surat", "Nagpur"];
const states = ["Maharashtra", "Delhi", "Karnataka", "Tamil Nadu", "Telangana", "Maharashtra", "Gujarat", "West Bengal", "Rajasthan", "Uttar Pradesh", "Gujarat", "Maharashtra"];
const roads = ["MG Road", "Brigade Road", "Linking Road", "Park Street", "Anna Salai", "FC Road"];
const banks = ["State Bank of India", "HDFC Bank", "ICICI Bank", "Axis Bank", "Kotak Bank"];
const devices = ["Android 13 - Chrome", "iOS 17 - Safari", "Windows 11 - Firefox", "macOS - Safari"];
const comments = ["Great product!", "Good quality for the price.", "Fast delivery, very satisfied.", "Exactly as described.", "Would buy again.", "Exceeded expectations."];
const shopNames = ["Flagship", "Express", "Premium", "Online", "Direct"];
const auditActs = ["SELLER_APPROVED", "PRODUCT_APPROVED", "KYC_VERIFIED", "ORDER_CREATED", "PAYOUT_INITIATED", "PRODUCT_REJECTED"];

const categoryTree = [
  { name: "Electronics", subs: ["Mobiles", "Laptops", "Tech Accessories"] },
  { name: "Fashion", subs: ["Men's Clothing", "Women's Clothing", "Footwear"] },
  { name: "Home & Kitchen", subs: ["Furniture", "Cookware", "Home Decor"] },
  { name: "Sports", subs: ["Fitness Equipment", "Outdoor Gear", "Team Sports"] },
  { name: "Beauty", subs: ["Skincare", "Haircare", "Makeup"] },
  { name: "Books", subs: ["Fiction", "Non-Fiction", "Academic"] },
  { name: "Automotive", subs: ["Car Parts", "Car Accessories", "Auto Tools"] },
  { name: "Health", subs: ["Supplements", "Medical Devices", "Ayurvedic"] },
];

const productNames: Record<string, string[]> = {
  Mobiles: ["iPhone 15", "Samsung Galaxy S24", "OnePlus 12", "Xiaomi 14 Pro"],
  Laptops: ["Dell XPS 15", "MacBook Pro 14", "HP Pavilion 15", "Lenovo ThinkPad E15"],
  "Tech Accessories": ["USB-C Hub", "Wireless Charger", "Phone Case", "Laptop Stand"],
  "Men's Clothing": ["Cotton T-Shirt", "Denim Jeans", "Formal Shirt", "Kurta Pajama"],
  "Women's Clothing": ["Designer Kurti", "Silk Saree", "Casual Dress", "Lehenga Choli"],
  Footwear: ["Running Shoes", "Leather Sandals", "Formal Shoes", "Canvas Sneakers"],
  Furniture: ["Study Table", "Bookshelf", "Office Chair", "Sofa Set"],
  Cookware: ["Non-Stick Pan", "Pressure Cooker", "Kadai", "Tawa"],
  "Home Decor": ["Wall Clock", "Photo Frame", "Ceramic Vase", "Curtain Set"],
  "Fitness Equipment": ["Yoga Mat", "Adjustable Dumbbells", "Resistance Bands", "Jump Rope"],
  "Outdoor Gear": ["Camping Tent", "Hiking Backpack", "Steel Water Bottle", "Compass"],
  "Team Sports": ["Cricket Bat", "Football", "Badminton Racket", "Tennis Ball"],
  Skincare: ["Face Cream SPF 30", "Vitamin C Serum", "Face Wash", "Toner Mist"],
  Haircare: ["Anti-Dandruff Shampoo", "Conditioner", "Argan Hair Oil", "Dry Shampoo"],
  Makeup: ["Matte Lipstick", "Foundation", "Mascara", "Eyeshadow Palette"],
  Fiction: ["The Alchemist", "Harry Potter Box Set", "1984", "Dune"],
  "Non-Fiction": ["Atomic Habits", "Sapiens", "Rich Dad Poor Dad", "Think and Grow Rich"],
  Academic: ["Physics Textbook", "Chemistry Guide", "Maths Workbook", "Biology Atlas"],
  "Car Parts": ["Car Battery 45Ah", "Ceramic Brake Pads", "Air Filter", "Oil Filter"],
  "Car Accessories": ["Seat Covers Set", "Steering Wheel Cover", "Dash Camera", "Car Freshener"],
  "Auto Tools": ["Hydraulic Jack", "Torque Wrench", "Tyre Inflator", "OBD2 Scanner"],
  Supplements: ["Whey Protein 1kg", "Multivitamin Tablets", "Omega-3 Capsules", "Pre-Workout"],
  "Medical Devices": ["BP Monitor Digital", "Glucometer", "Pulse Oximeter", "Infrared Thermometer"],
  Ayurvedic: ["Ashwagandha Extract", "Triphala Powder", "Giloy Tablets", "Shilajit Resin"],
};

const categoryAttributeDefs: Record<string, {
  key: string; label: string; type: "TEXT" | "NUMBER" | "ENUM" | "BOOLEAN";
  required: boolean; isVariant: boolean; options?: string[]; unit?: string; sortOrder: number;
}[]> = {
  Electronics: [
    { key: "brand", label: "Brand", type: "TEXT", required: true, isVariant: false, sortOrder: 1 },
    { key: "model_number", label: "Model Number", type: "TEXT", required: false, isVariant: false, sortOrder: 2 },
    { key: "warranty_period", label: "Warranty Period", type: "TEXT", required: false, isVariant: false, sortOrder: 3 },
    { key: "power_consumption", label: "Power Consumption", type: "NUMBER", required: false, isVariant: false, unit: "watts", sortOrder: 4 },
    { key: "color", label: "Color", type: "ENUM", required: false, isVariant: true, options: ["Black", "White", "Blue", "Silver", "Gold"], sortOrder: 5 },
  ],
  Fashion: [
    { key: "brand", label: "Brand", type: "TEXT", required: true, isVariant: false, sortOrder: 1 },
    { key: "material", label: "Material", type: "TEXT", required: true, isVariant: false, sortOrder: 2 },
    { key: "care_instructions", label: "Care Instructions", type: "TEXT", required: false, isVariant: false, sortOrder: 3 },
    { key: "gender", label: "Gender", type: "ENUM", required: false, isVariant: false, options: ["Men", "Women", "Unisex"], sortOrder: 4 },
    { key: "size", label: "Size", type: "ENUM", required: true, isVariant: true, options: ["S", "M", "L", "XL", "XXL"], sortOrder: 5 },
    { key: "color", label: "Color", type: "ENUM", required: false, isVariant: true, options: ["Black", "White", "Blue", "Red", "Green", "Navy"], sortOrder: 6 },
  ],
  "Home & Kitchen": [
    { key: "material", label: "Material", type: "TEXT", required: true, isVariant: false, sortOrder: 1 },
    { key: "capacity", label: "Capacity", type: "TEXT", required: false, isVariant: false, sortOrder: 2 },
    { key: "dishwasher_safe", label: "Dishwasher Safe", type: "BOOLEAN", required: false, isVariant: false, sortOrder: 3 },
    { key: "warranty_period", label: "Warranty Period", type: "TEXT", required: false, isVariant: false, sortOrder: 4 },
    { key: "color", label: "Color", type: "ENUM", required: false, isVariant: true, options: ["Black", "White", "Brown", "Grey"], sortOrder: 5 },
  ],
  Sports: [
    { key: "material", label: "Material", type: "TEXT", required: false, isVariant: false, sortOrder: 1 },
    { key: "skill_level", label: "Skill Level", type: "ENUM", required: false, isVariant: false, options: ["Beginner", "Intermediate", "Advanced"], sortOrder: 2 },
    { key: "age_group", label: "Age Group", type: "ENUM", required: false, isVariant: false, options: ["Kids", "Teens", "Adults"], sortOrder: 3 },
    { key: "size", label: "Size", type: "ENUM", required: false, isVariant: true, options: ["S", "M", "L", "XL"], sortOrder: 4 },
  ],
  Beauty: [
    { key: "brand", label: "Brand", type: "TEXT", required: true, isVariant: false, sortOrder: 1 },
    { key: "skin_type", label: "Skin Type", type: "ENUM", required: false, isVariant: false, options: ["All", "Oily", "Dry", "Normal", "Combination"], sortOrder: 2 },
    { key: "shelf_life", label: "Shelf Life", type: "TEXT", required: false, isVariant: false, sortOrder: 3 },
    { key: "paraben_free", label: "Paraben Free", type: "BOOLEAN", required: false, isVariant: false, sortOrder: 4 },
  ],
  Books: [
    { key: "author", label: "Author", type: "TEXT", required: true, isVariant: false, sortOrder: 1 },
    { key: "publisher", label: "Publisher", type: "TEXT", required: false, isVariant: false, sortOrder: 2 },
    { key: "pages", label: "Pages", type: "NUMBER", required: false, isVariant: false, sortOrder: 3 },
    { key: "language", label: "Language", type: "TEXT", required: false, isVariant: false, sortOrder: 4 },
  ],
  Automotive: [
    { key: "brand", label: "Brand", type: "TEXT", required: true, isVariant: false, sortOrder: 1 },
    { key: "compatible_models", label: "Compatible Models", type: "TEXT", required: false, isVariant: false, sortOrder: 2 },
    { key: "warranty_period", label: "Warranty Period", type: "TEXT", required: false, isVariant: false, sortOrder: 3 },
  ],
  Health: [
    { key: "brand", label: "Brand", type: "TEXT", required: true, isVariant: false, sortOrder: 1 },
    { key: "dosage", label: "Dosage", type: "TEXT", required: false, isVariant: false, sortOrder: 2 },
    { key: "vegetarian", label: "Vegetarian", type: "BOOLEAN", required: false, isVariant: false, sortOrder: 3 },
    { key: "shelf_life", label: "Shelf Life", type: "TEXT", required: false, isVariant: false, sortOrder: 4 },
  ],
};

// ─── Utility Functions ──────────────────────────────────────────────────────

function generateProductAttributes(parentCatName: string): Record<string, string | number | boolean | null> {
  const defs = categoryAttributeDefs[parentCatName];
  if (!defs) return {};
  const attrs: Record<string, string | number | boolean | null> = {};
  for (const def of defs) {
    if (def.isVariant) continue;
    if (def.type === "TEXT") {
      if (def.key === "brand") attrs[def.key] = randomItem(["Samsung", "Apple", "Sony", "Nike", "Adidas", "Puma", "LG", "Philips", "Havells", "Bosch", "Himalaya", "Mamaearth", "Penguin", "HarperCollins"]);
      else if (def.key === "material") attrs[def.key] = randomItem(["Cotton", "Polyester", "Stainless Steel", "Aluminum", "Plastic", "Wood", "Leather"]);
      else if (def.key === "author") attrs[def.key] = `${randomItem(firstNames)} ${randomItem(lastNames)}`;
      else if (def.key === "publisher") attrs[def.key] = randomItem(["Penguin Books", "HarperCollins", "Random House", "Oxford Press"]);
      else if (def.key === "warranty_period") attrs[def.key] = randomItem(["6 months", "1 year", "2 years", "3 years"]);
      else if (def.key === "care_instructions") attrs[def.key] = randomItem(["Machine wash cold", "Hand wash only", "Dry clean only", "Do not bleach"]);
      else if (def.key === "capacity") attrs[def.key] = randomItem(["1L", "2L", "5L", "10L"]);
      else if (def.key === "dosage") attrs[def.key] = randomItem(["1 tablet daily", "2 tablets daily", "As directed by physician"]);
      else if (def.key === "shelf_life") attrs[def.key] = randomItem(["12 months", "18 months", "24 months", "36 months"]);
      else if (def.key === "compatible_models") attrs[def.key] = "Universal fit";
      else if (def.key === "model_number") attrs[def.key] = `MODEL-${randomInt(1000, 9999)}`;
      else if (def.key === "language") attrs[def.key] = randomItem(["English", "Hindi", "Spanish", "French"]);
      else attrs[def.key] = `Sample ${def.label}`;
    } else if (def.type === "NUMBER") {
      if (def.key === "pages") attrs[def.key] = randomInt(50, 800);
      else if (def.key === "power_consumption") attrs[def.key] = randomInt(5, 500);
      else attrs[def.key] = randomInt(1, 100);
    } else if (def.type === "ENUM") {
      if (def.options && def.options.length > 0) attrs[def.key] = randomItem(def.options);
    } else if (def.type === "BOOLEAN") {
      attrs[def.key] = Math.random() > 0.5;
    }
  }
  return attrs;
}

function getVariantAxesForCategory(parentCatName: string): { name: string; values: string[] }[] {
  const defs = categoryAttributeDefs[parentCatName];
  if (!defs) return [];
  return defs.filter((d) => d.isVariant).map((d) => ({ name: d.label, values: d.options ?? [] }));
}

async function fixSellerPermissions() {
  logger.info("Fixing seller role permissions...");
  const sellers = await db.seller.findMany({ select: { id: true, roles: { select: { id: true, name: true } } } });
  let fixed = 0;
  for (const seller of sellers) {
    const roles = seller.roles.map((r) => ({ id: r.id, name: r.name }));
    if (roles.length === 0) continue;
    await db.$transaction(async (tx) => { await assignDefaultRolePermissions(tx, roles); }, { timeout: 60000, maxWait: 60000 });
    const members = await db.sellerMember.findMany({ where: { sellerId: seller.id }, select: { userId: true } });
    for (const member of members) {
      await redis.del(RedisKeys.userPermissions(member.userId, seller.id));
      await redis.del(RedisKeys.userRoles(member.userId, seller.id));
    }
    fixed++;
  }
  logger.info(`Permissions fixed for ${fixed} sellers.`);
}

async function cleanProductData() {
  logger.info("Cleaning product-related tables...");
  const tableNames = [
    "wishlist_items", "cart_items", "carts", "saved_designs", "customer_upload_assets",
    "negotiation_messages", "negotiation_chat_sessions", "negotiation_rounds", "negotiation_sessions",
    "return_shipments", "return_requests", "review_helpful", "reviews",
    "invoices", "purchase_orders", "commission_proposals", "product_models_3d",
    "customization_options", "customization_option_groups", "sku_price_tiers",
    "print_areas", "templates",
    "product_skus", "variant_option_values", "variant_options", "product_images",
    "product_commissions", "products", "category_attributes", "customer_addresses",
  ];
  for (const table of tableNames) {
    await db.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`);
    logger.info(`  Truncated ${table}`);
  }
  logger.info("Product tables cleaned.");
}

// ─── Operation 1: Seed Comprehensive ────────────────────────────────────────

async function seedComprehensive() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_MIGRATE !== "true") {
    logger.error("Refusing to run seed with NODE_ENV=production without ALLOW_PROD_MIGRATE=true");
    process.exit(1);
  }
  logger.info("Starting comprehensive seed...");
  try {
    // 0. Seed platform permissions
    logger.info("Seeding platform permissions...");
    await db.$transaction(async (tx) => { await seedPlatformPermissions(tx); }, { timeout: 60000, maxWait: 60000 });

    // 1. Platform Roles
    logger.info("Seeding platform roles...");
    const [superAdminRole, onboardingRole, reviewerRole] = await Promise.all([
      db.platformRole.upsert({ where: { name: "super_admin" }, update: {}, create: { name: "super_admin", description: "Full platform access" } }),
      db.platformRole.upsert({ where: { name: "onboarding_manager" }, update: {}, create: { name: "onboarding_manager", description: "Manages seller onboarding" } }),
      db.platformRole.upsert({ where: { name: "product_reviewer" }, update: {}, create: { name: "product_reviewer", description: "Reviews products" } }),
    ]);

    // 1b. Grant platform role permissions
    logger.info("Granting platform role permissions...");
    const platformRoles = [superAdminRole, onboardingRole, reviewerRole];
    const allPlatformKeys = [...new Set(Object.values(DEFAULT_PLATFORM_ROLE_PERMISSIONS).flat())];
    const platformPerms = await db.permission.findMany({ where: { key: { in: allPlatformKeys } }, select: { id: true, key: true } });
    const platformPermIdByKey = new Map(platformPerms.map((p) => [p.key, p.id]));
    for (const role of platformRoles) {
      const keys = DEFAULT_PLATFORM_ROLE_PERMISSIONS[role.name] ?? [];
      await db.platformRolePermission.createMany({
        data: keys.map((key) => ({ roleId: role.id, permissionId: platformPermIdByKey.get(key)! })),
        skipDuplicates: true,
      });
    }

    // 2. Admin / Platform Users
    logger.info("Seeding admin users...");
    const [adminPwd, onboardPwd, reviewPwd] = await Promise.all([
      bcrypt.hash("Admin@123456", 12), bcrypt.hash("Manager@123", 12), bcrypt.hash("Reviewer@123", 12),
    ]);
    const adminUser = await db.user.upsert({ where: { email: "admin@etradebazaar.com" }, update: {}, create: { name: "Super Admin", email: "admin@etradebazaar.com", password: adminPwd, isActive: true } });
    const onboardUser = await db.user.upsert({ where: { email: "onboarding@etradebazaar.com" }, update: {}, create: { name: "Onboarding Manager", email: "onboarding@etradebazaar.com", password: onboardPwd, isActive: true } });
    const reviewerUser = await db.user.upsert({ where: { email: "reviewer@etradebazaar.com" }, update: {}, create: { name: "Product Reviewer", email: "reviewer@etradebazaar.com", password: reviewPwd, isActive: true } });
    await Promise.all([
      db.platformMember.upsert({ where: { userId: adminUser.id }, update: {}, create: { userId: adminUser.id, roleId: superAdminRole.id } }),
      db.platformMember.upsert({ where: { userId: onboardUser.id }, update: {}, create: { userId: onboardUser.id, roleId: onboardingRole.id } }),
      db.platformMember.upsert({ where: { userId: reviewerUser.id }, update: {}, create: { userId: reviewerUser.id, roleId: reviewerRole.id } }),
    ]);

    // 3. Platform Configs
    logger.info("Seeding platform configs...");
    await Promise.all([
      ["commission_rate", "5.00"], ["min_order_amount", "1000.00"], ["max_negotiation_discount", "20.00"],
      ["payout_cycle_days", "7"], ["max_return_days", "7"], ["low_stock_threshold", "10"],
    ].map(([key, value]) => db.platformConfig.upsert({ where: { key: key! }, update: {}, create: { key: key!, value: value! } })));

    // Idempotency check
    const existingSellers = await db.seller.findFirst();
    if (existingSellers) {
      logger.info("Sellers already exist — cleaning product data and re-seeding products...");
      await cleanProductData();
      const existingSellersList = await db.seller.findMany({ where: { status: "APPROVED" } });
      const existingCategories = await db.category.findMany();
      const categoryMap = new Map<string, string>();
      for (const cat of existingCategories) categoryMap.set(cat.name, cat.id);

      // Re-create category attributes
      logger.info("Seeding category attributes...");
      for (const parentCat of categoryTree) {
        const parentId = categoryMap.get(parentCat.name);
        if (!parentId) continue;
        const defs = categoryAttributeDefs[parentCat.name];
        if (!defs) continue;
        for (const def of defs) {
          await db.categoryAttribute.create({
            data: {
              categoryId: parentId, key: def.key, label: def.label, type: def.type,
              required: def.required, isVariant: def.isVariant,
              options: def.options ? { create: def.options.map((value) => ({ value })) } : undefined,
              unit: def.unit ?? null, sortOrder: def.sortOrder,
            }
          }).catch(() => { });
        }
      }

      // Re-seed products
      logger.info("Re-seeding products...");
      const products: any[] = [];
      let skuCounter = 100000;
      const allSubCats = categoryTree.flatMap((c) => c.subs);
      for (const seller of existingSellersList) {
        for (let i = 0; i < 20; i++) {
          const subCat = randomItem(allSubCats);
          const catId = categoryMap.get(subCat) ?? categoryMap.get("Electronics")!;
          const parentCatName = categoryTree.find((c) => c.subs.includes(subCat))?.name ?? "Electronics";
          const pName = `${randomItem(productNames[subCat] ?? ["Generic Product"])} ${randomItem(["Pro", "Plus", "Elite", "Basic", "Premium"])}`;
          const price = randomDecimal(299, 49999);
          const product = await db.product.create({
            data: {
              sellerId: seller.id, categoryId: catId,
              displayId: await generateDisplayId("product"), name: pName,
              description: `Premium ${pName}. Manufacturer warranty included.`,
              price, compareAtPrice: price * 1.2, sku: `SKU-${++skuCounter}`,
              stock: randomInt(20, 500), lowStockThreshold: 10,
              weightGrams: randomInt(100, 5000), length: randomDecimal(5, 60),
              width: randomDecimal(5, 60), height: randomDecimal(2, 30),
              isDigital: false, attributes: generateProductAttributes(parentCatName),
              status: "APPROVED", reviewedBy: adminUser.id,
              reviewedAt: randomDate(new Date("2024-01-01"), new Date()),
              negotiationThresholdQty: randomItem([5, 10, 20, 50]),
              customizationEnabled: Math.random() > 0.7,
              customizationAcceptedFormats: Math.random() > 0.7 ? ["image/png", "image/jpeg", "application/pdf"] : [],
            }
          });
          await Promise.all([1, 2, 3].map((n) => db.productImage.create({
            data: {
              productId: product.id, skuId: null, url: `https://picsum.photos/seed/${product.id}${n}/400/400`,
              key: `${product.id}-${n}`, order: n - 1,
            }
          })));
          const variantAxes = getVariantAxesForCategory(parentCatName);
          for (const axis of variantAxes) {
            const opt = await db.variantOption.create({ data: { productId: product.id, name: axis.name } });
            await Promise.all(axis.values.map((v) => db.variantOptionValue.create({ data: { optionId: opt.id, value: v } })));
          }
          const colorValues = variantAxes.find((a) => a.name === "Color")?.values ?? ["Default"];
          const skuIds: string[] = [];
          for (const color of colorValues.slice(0, 3)) {
            const sku = await db.productSKU.create({
              data: {
                productId: product.id, sku: `SKU-${++skuCounter}-${color.toUpperCase()}`,
                price, stock: randomInt(5, 100), minQuantity: 1,
                options: variantAxes.reduce((acc, a) => { acc[a.name] = a.name === "Color" ? color : a.values[0]!; return acc; }, {} as Record<string, string>),
              }
            });
            skuIds.push(sku.id);
            // SkuPriceTier — 2 tiers per SKU
            for (const [ti, tier] of [{ minQty: 10, maxQty: 49, price: price * 0.95 }, { minQty: 50, maxQty: null, price: price * 0.88 }].entries()) {
              await db.skuPriceTier.create({ data: { skuId: sku.id, minQty: tier.minQty, maxQty: tier.maxQty, price: tier.price, hiddenFloorPrice: tier.price * 0.8 } }).catch(() => {});
            }
          }
          await db.productCommission.create({ data: { productId: product.id, rate: randomDecimal(3, 10), setBy: adminUser.id } });
          // CustomizationOptionGroup for customizable products
          if (product.customizationEnabled) {
            const grp = await db.customizationOptionGroup.create({ data: { productId: product.id, name: "Print Placement", required: true, sortOrder: 0 } });
            for (const opt of [{ label: "Front Center", type: "SELECT", delta: 0 }, { label: "Back Center", type: "SELECT", delta: 0 }, { label: "Full Wrap", type: "SELECT", delta: 50 }]) {
              await db.customizationOption.create({ data: { groupId: grp.id, label: opt.label, type: opt.type as any, priceDelta: opt.delta, sortOrder: 0 } });
            }
            const grp2 = await db.customizationOptionGroup.create({ data: { productId: product.id, name: "Color Choice", required: false, sortOrder: 1 } });
            for (const c of ["Black", "White", "Navy", "Red"]) {
              await db.customizationOption.create({ data: { groupId: grp2.id, label: c, type: "COLOR", priceDelta: 0, sortOrder: 0 } });
            }
          }
          // Template + PrintArea for customizable products
          if (product.customizationEnabled) {
            const firstSku = await db.productSKU.findFirst({ where: { productId: product.id } });
            await db.template.create({
              data: {
                productId: product.id, sellerId: seller.id,
                name: `${pName} Default Template`,
                industry: parentCatName, style: randomItem(["Modern", "Classic", "Minimal"]),
                thumbnailUrl: `https://picsum.photos/seed/template-${product.id}/300/300`,
                thumbnailKey: `templates/${product.id}/thumb.png`,
                canvasState: { width: 800, height: 600, elements: [] },
              }
            }).catch(() => { });
            await db.printArea.create({
              data: {
                productId: product.id, skuId: firstSku?.id ?? null,
                widthCm: randomDecimal(5, 30), heightCm: randomDecimal(5, 30),
              }
            }).catch(() => { });
          }
          products.push(product);
        }
      }
      await fixSellerPermissions();
      // Notification preferences for existing users
      logger.info("Seeding notification preferences...");
      const existingUsers = await db.user.findMany({ select: { id: true } });
      const notifCategories = ["ORDER", "SHIPMENT", "PAYOUT", "NEGOTIATION", "PROMOTION", "SECURITY", "ACCOUNT"] as const;
      for (const user of existingUsers) {
        for (const category of notifCategories) {
          await db.notificationPreference.upsert({ where: { userId_category: { userId: user.id, category } }, update: {}, create: { userId: user.id, category, enabled: category === "SECURITY" || category === "ACCOUNT" ? true : Math.random() > 0.1 } }).catch(() => { });
        }
      }
      // Re-seed negotiation sessions, saved designs, carts, wishlists, upload assets
      const existingSellers = await db.seller.findMany({ where: { status: "APPROVED" } });
      const existingCustomers = await db.user.findMany({ where: { isActive: true }, take: 25, skip: 0 });
      const customerUsers = existingCustomers.filter((u) => !existingSellers.some((s) => s.email === u.email));
      logger.info("Re-seeding negotiation sessions...");
      const negProducts = products.slice(0, 20);
      const negStatuses = ["PENDING", "ACCEPTED", "REJECTED", "EXHAUSTED", "EXPIRED"];
      const negModes = ["AUTO", "MANUAL", "AUTO", "MANUAL", "AUTO"];
      for (const customer of customerUsers) {
        const usedSkuIds = new Set<string>();
        for (let i = 0; i < 5 && negProducts.length > 0; i++) {
          let product: any = null;
          let sellerId = "";
          let skuId = "";
          for (let attempt = 0; attempt < 10; attempt++) {
            const candidate = randomItem(negProducts);
            const candidateSkus = await db.productSKU.findMany({ where: { productId: candidate.id } });
            const availableSku = candidateSkus.find((s) => !usedSkuIds.has(s.id));
            if (availableSku) {
              product = candidate;
              sellerId = candidate.sellerId;
              skuId = availableSku.id;
              usedSkuIds.add(skuId);
              break;
            }
          }
          if (!product) continue;
          const mode = negModes[i] as any;
          const status = negStatuses[i] as any;
          const session = await db.negotiationSession.create({ data: {
            customerId: customer.id, sellerId, productId: product.id, skuId,
            orgId: null, formulaVersion: Math.random() > 0.5 ? "v2_gamma" : "v1_linear",
            quantity: randomInt(5, 50), mode, status, visibleTierPrice: parseFloat(product.price.toString()),
            hiddenFloorPrice: parseFloat(product.price.toString()) * 0.8,
            round: mode === "AUTO" ? randomInt(1, 3) : 0,
            finalPrice: status === "ACCEPTED" ? parseFloat(product.price.toString()) * 0.9 : null,
            nudgeDueAt: status === "PENDING" ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null,
          }});
          if (mode === "AUTO") {
            const numRounds = session.round;
            for (let r = 1; r <= numRounds; r++) {
              await db.negotiationRound.create({ data: {
                sessionId: session.id, round: r,
                offeredPrice: parseFloat(product.price.toString()) * (1 - r * 0.05),
                customerPrice: parseFloat(product.price.toString()) * (1 - (r + 1) * 0.05),
                response: r < numRounds ? randomItem(["ACCEPT", "REJECT"]) as any : null,
                createdAt: randomDate(new Date("2024-10-01"), new Date()),
                respondedAt: r < numRounds ? randomDate(new Date("2024-10-01"), new Date()) : null,
              }});
            }
          }
          if (mode === "MANUAL") {
            const chat = await db.negotiationChatSession.create({ data: {
              sessionId: session.id, proposedTimeSlot: Math.random() > 0.5 ? randomDate(new Date(), new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)) : null,
              proposedBy: Math.random() > 0.5 ? "customer" as any : "seller" as any,
              customerConfirmed: Math.random() > 0.5, sellerConfirmed: Math.random() > 0.5,
            }});
            for (let m = 0; m < randomInt(2, 5); m++) {
              await db.negotiationMessage.create({ data: {
                chatSessionId: chat.id, senderId: m % 2 === 0 ? customer.id : sellerId,
                senderType: m % 2 === 0 ? "customer" as any : "seller" as any,
                body: randomItem(["Can you offer a better price?", "What's the best you can do?", "I can offer a 10% discount.", "Let me check and get back.", "That works for me."]),
              }});
            }
          }
        }
      }
      logger.info("Re-seeding saved designs...");
      const customizableProducts = products.filter((p) => p.customizationEnabled);
      if (customizableProducts.length > 0) {
        for (const customer of customerUsers) {
          for (let i = 0; i < 3; i++) {
            const product = randomItem(customizableProducts);
            const skus = await db.productSKU.findMany({ where: { productId: product.id }, take: 1 });
            await db.savedDesign.create({ data: {
              userId: customer.id, productId: product.id, skuId: skus[0]?.id ?? null,
              name: `${product.name} Design v${i + 1}`,
              customizationState: { printPlacement: randomItem(["Front Center", "Back Center", "Full Wrap"]), color: randomItem(["Black", "White", "Navy", "Red"]) },
            }}).catch(() => {});
          }
        }
      }
      logger.info("Re-seeding carts...");
      for (const customer of customerUsers) {
        const cart = await db.cart.create({ data: { userId: customer.id, orgId: null, sellerId: randomItem(existingSellers).id } }).catch(() => null);
        if (!cart) continue;
        for (let i = 0; i < randomInt(3, 5); i++) {
          const product = randomItem(products);
          const skus = await db.productSKU.findMany({ where: { productId: product.id }, take: 1 });
          await db.cartItem.create({ data: { cartId: cart.id, productId: product.id, skuId: skus[0]?.id ?? null, quantity: randomInt(1, 5) } }).catch(() => {});
        }
      }
      logger.info("Re-seeding wishlist items...");
      for (const customer of customerUsers) {
        for (let i = 0; i < 5; i++) {
          const product = randomItem(products);
          await db.wishlistItem.create({ data: { userId: customer.id, productId: product.id } }).catch(() => {});
        }
      }
      logger.info("Re-seeding customer upload assets...");
      const assetDefs = [
        { name: "company-logo.svg", fileType: "image/svg+xml", key: "assets/logo.svg" },
        { name: "brand-guidelines.pdf", fileType: "application/pdf", key: "assets/brand-guide.pdf" },
        { name: "product-artwork.png", fileType: "image/png", key: "assets/artwork.png" },
      ];
      for (const customer of customerUsers) {
        for (const asset of assetDefs) {
          await db.customerUploadAsset.create({ data: {
            userId: customer.id, url: `https://picsum.photos/seed/${customer.id}-${asset.name}/400/400`,
            key: `users/${customer.id}/${asset.key}`, fileType: asset.fileType,
          }}).catch(() => {});
        }
      }
      logger.info("✅ Seed completed (product re-seed)!");
      logger.info(`  Products: ${products.length}`);
      return;
    }

    // 4. Sellers
    logger.info("Seeding sellers...");
    const sellerPwd = await bcrypt.hash("Seller@123", 12);
    const sellerUser1 = await db.user.upsert({ where: { email: "akash.seller@example.com" }, update: {}, create: { name: "Akash Sharma", email: "akash.seller@example.com", password: sellerPwd, isActive: true } });
    const seller1 = await db.seller.create({
      data: {
        name: "Akash Sharma", email: "akash.seller@example.com", phone: "9876543210",
        businessName: "TechPro Solutions", businessType: "COMPANY",
        street: "101 MG Road", city: "Mumbai", state: "Maharashtra", pincode: "400001",
        status: "APPROVED", businessDescription: "Leading technology solutions provider",
        industryCategory: "Electronics", yearOfEstablishment: 2018,
        pickupAddress: { street: "101 MG Road", city: "Mumbai", state: "Maharashtra", pincode: "400001" },
        billingAddress: { street: "101 MG Road", city: "Mumbai", state: "Maharashtra", pincode: "400001" },
        socialLinks: { website: "https://techpro.in", instagram: "@techpro_india" },
      }
    });
    const sellerUser2 = await db.user.upsert({ where: { email: "priya.seller@example.com" }, update: {}, create: { name: "Priya Patel", email: "priya.seller@example.com", password: sellerPwd, isActive: true } });
    const seller2 = await db.seller.create({
      data: {
        name: "Priya Patel", email: "priya.seller@example.com", phone: "9876543211",
        businessName: "FashionHive", businessType: "INDIVIDUAL",
        street: "22 FC Road", city: "Pune", state: "Maharashtra", pincode: "411001",
        status: "APPROVED", businessDescription: "Trendy fashion for all ages",
        industryCategory: "Fashion", yearOfEstablishment: 2020,
        pickupAddress: { street: "22 FC Road", city: "Pune", state: "Maharashtra", pincode: "411001" },
        billingAddress: { street: "22 FC Road", city: "Pune", state: "Maharashtra", pincode: "411001" },
      }
    });
    const sellerUser3 = await db.user.upsert({ where: { email: "amit.seller@example.com" }, update: {}, create: { name: "Amit Singh", email: "amit.seller@example.com", password: sellerPwd, isActive: true } });
    const seller3 = await db.seller.create({
      data: {
        name: "Amit Singh", email: "amit.seller@example.com", phone: "9876543212",
        businessName: "HomeEssentials", businessType: "PARTNERSHIP",
        street: "45 Brigade Road", city: "Bangalore", state: "Karnataka", pincode: "560001", status: "PENDING",
      }
    });
    const allSellers = [seller1, seller2, seller3];
    const allSellerUsers = [sellerUser1, sellerUser2, sellerUser3];

    // Seller roles + members
    const sellerRoles: { owner: any; manager: any; staff: any }[] = [];
    for (let i = 0; i < allSellers.length; i++) {
      const [ownerRole, managerRole, staffRole] = await Promise.all([
        db.sellerRole.create({ data: { sellerId: allSellers[i]!.id, name: "owner", description: "Business owner" } }),
        db.sellerRole.create({ data: { sellerId: allSellers[i]!.id, name: "manager", description: "Store manager" } }),
        db.sellerRole.create({ data: { sellerId: allSellers[i]!.id, name: "staff", description: "Staff member" } }),
      ]);
      sellerRoles.push({ owner: ownerRole, manager: managerRole, staff: staffRole });
      await db.$transaction(async (tx) => { await assignDefaultRolePermissions(tx, [ownerRole, managerRole, staffRole]); }, { timeout: 60000, maxWait: 60000 });
      await db.sellerMember.create({ data: { userId: allSellerUsers[i]!.id, sellerId: allSellers[i]!.id, roleId: ownerRole.id } });
    }

    // KYC + Bank details + team members for approved sellers
    for (let i = 0; i < 2; i++) {
      const seller = allSellers[i]!;
      await db.sellerKyc.create({
        data: {
          sellerId: seller.id, aadharNumber: String(randomInt(200000000000, 999999999999)),
          panNumber: `ABCDE${randomInt(1000, 9999)}F`, gstNumber: `27ABCDE${randomInt(1000, 9999)}F1Z5`,
          businessRegNumber: `U${randomInt(10000, 99999)}MH2024PTC${randomInt(100000, 999999)}`,
          status: "VERIFIED", verifiedAt: randomDate(new Date("2024-01-01"), new Date()), verifiedBy: adminUser.id,
          aadhaarStatus: "VERIFIED", govtIdType: "PAN", govtIdNumber: `ABCDE${randomInt(1000, 9999)}F`, govtIdStatus: "VERIFIED",
        }
      });
      await db.sellerBankDetail.create({
        data: {
          sellerId: seller.id, accountHolderName: seller.name,
          accountNumber: encrypt(String(randomInt(100000000000, 999999999999))),
          ifscCode: `SBIN${randomInt(1000000, 9999999)}`, bankName: randomItem(banks),
        }
      });
      for (let j = 0; j < 3; j++) {
        const teamUser = await db.user.create({ data: { name: `${randomItem(firstNames)} ${randomItem(lastNames)}`, email: `team_s${i}_${j}_${uid()}@example.com`, password: await bcrypt.hash("Team@123", 12), isActive: true } });
        await db.sellerMember.create({ data: { userId: teamUser.id, sellerId: seller.id, roleId: j === 0 ? sellerRoles[i]!.manager.id : sellerRoles[i]!.staff.id } });
      }
    }

    // 5. Seller Invites
    logger.info("Seeding seller invites...");
    for (let i = 0; i < 6; i++) {
      await db.sellerInvite.create({ data: { email: `invite_${uid()}@example.com`, sellerId: seller1.id, status: randomItem(["PENDING", "ACCEPTED", "EXPIRED", "REVOKED"]) as any, expiresAt: randomDate(new Date(), new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)) } });
    }

    // 6. Categories
    logger.info("Seeding categories...");
    const categoryMap = new Map<string, string>();
    for (const parentCat of categoryTree) {
      const parent = await db.category.upsert({ where: { name: parentCat.name }, update: {}, create: { name: parentCat.name, slug: slugify(parentCat.name), description: `${parentCat.name} products` } });
      categoryMap.set(parentCat.name, parent.id);
      for (const sub of parentCat.subs) {
        const child = await db.category.upsert({ where: { name: sub }, update: {}, create: { name: sub, slug: slugify(sub), description: `${sub} products`, parentId: parent.id } });
        categoryMap.set(sub, child.id);
      }
    }
    // Uncategorized placeholder category for products uploaded without a category
    const uncategorized = await db.category.upsert({ where: { name: "Uncategorized" }, update: {}, create: { name: "Uncategorized", slug: "uncategorized", description: "Products without a category — assign one later" } });
    categoryMap.set("Uncategorized", uncategorized.id);

    // 6b. Category Attributes
    logger.info("Seeding category attributes...");
    for (const parentCat of categoryTree) {
      const parentId = categoryMap.get(parentCat.name);
      if (!parentId) continue;
      const defs = categoryAttributeDefs[parentCat.name];
      if (!defs) continue;
      for (const def of defs) {
        await db.categoryAttribute.create({
          data: {
            categoryId: parentId, key: def.key, label: def.label, type: def.type,
            required: def.required, isVariant: def.isVariant,
            options: def.options ? { create: def.options.map((value) => ({ value })) } : undefined,
            unit: def.unit ?? null, sortOrder: def.sortOrder,
          }
        }).catch(() => { });
      }
    }

    // 7. Shops
    logger.info("Seeding shops...");
    const shops: any[] = [];
    for (const seller of [seller1, seller2]) {
      for (let i = 0; i < 3; i++) {
        const shopName = `${seller.businessName} ${shopNames[i]} Store`;
        const shop = await db.shop.create({
          data: {
            sellerId: seller.id, displayId: await generateDisplayId("shop"),
            name: shopName, slug: `${slugify(seller.businessName)}-${shopNames[i]!.toLowerCase()}-${uid()}`,
            description: `${shopName} quality guaranteed`, category: randomItem(categoryTree.map((c) => c.name)),
            contactEmail: seller.email, contactPhone: seller.phone,
            returnPolicy: "7-day hassle-free return",
            pickupStreet: seller.street, pickupCity: seller.city, pickupState: seller.state, pickupPincode: seller.pincode,
            latitude: randomDecimal(18.0, 28.0), longitude: randomDecimal(72.0, 88.0),
            status: "APPROVED", reviewedBy: adminUser.id, reviewedAt: randomDate(new Date("2024-01-01"), new Date()),
          }
        });
        shops.push(shop);
      }
    }
    await db.shop.create({
      data: {
        sellerId: seller3.id, displayId: await generateDisplayId("shop"),
        name: "HomeEssentials Online", slug: `homeessentials-online-${uid()}`,
        description: "Your home essentials destination", category: "Home & Kitchen",
        contactEmail: seller3.email, contactPhone: seller3.phone, returnPolicy: "15-day return",
        pickupStreet: seller3.street, pickupCity: seller3.city, pickupState: seller3.state, pickupPincode: seller3.pincode,
        status: "PENDING",
      }
    });

    // 7b. Shop Access (link seller members to shops)
    logger.info("Seeding shop access...");
    for (const shop of shops) {
      const members = await db.sellerMember.findMany({ where: { sellerId: shop.sellerId } });
      for (const member of members) {
        await db.shopAccess.create({ data: { memberId: member.id, shopId: shop.id } }).catch(() => { });
      }
    }

    // 8. Category-level Commissions
    logger.info("Seeding category commissions...");
    for (const cat of categoryTree) {
      await db.productCommission.create({ data: { category: cat.name, rate: randomDecimal(3, 12), setBy: adminUser.id } });
    }

    // 9. Products (with new fields: negotiationThresholdQty, customizationEnabled)
    logger.info("Seeding products...");
    const products: any[] = [];
    let skuCounter = 100000;
    const allSubCats = categoryTree.flatMap((c) => c.subs);
    for (const seller of [seller1, seller2]) {
      for (let i = 0; i < 20; i++) {
        const subCat = randomItem(allSubCats);
        const catId = categoryMap.get(subCat) ?? categoryMap.get("Electronics")!;
        const parentCatName = categoryTree.find((c) => c.subs.includes(subCat))?.name ?? "Electronics";
        const pName = `${randomItem(productNames[subCat] ?? ["Generic Product"])} ${randomItem(["Pro", "Plus", "Elite", "Basic", "Premium"])}`;
        const price = randomDecimal(299, 49999);
        const isCustomizable = Math.random() > 0.7;
        const product = await db.product.create({
          data: {
            sellerId: seller.id, categoryId: catId,
            displayId: await generateDisplayId("product"), name: pName,
            description: `Premium ${pName}. Manufacturer warranty included.`,
            price, compareAtPrice: price * 1.2, sku: `SKU-${++skuCounter}`,
            stock: randomInt(20, 500), lowStockThreshold: 10,
            weightGrams: randomInt(100, 5000), length: randomDecimal(5, 60),
            width: randomDecimal(5, 60), height: randomDecimal(2, 30),
            isDigital: false, attributes: generateProductAttributes(parentCatName),
            status: "APPROVED", reviewedBy: adminUser.id,
            reviewedAt: randomDate(new Date("2024-01-01"), new Date()),
            negotiationThresholdQty: randomItem([5, 10, 20, 50]),
            customizationEnabled: isCustomizable,
            customizationAcceptedFormats: isCustomizable ? ["image/png", "image/jpeg", "application/pdf"] : [],
          }
        });
        await Promise.all([1, 2, 3].map((n) => db.productImage.create({
          data: {
            productId: product.id, url: `https://picsum.photos/seed/${product.id}${n}/400/400`,
            key: `${product.id}-${n}`, order: n - 1,
          }
        })));
        const variantAxes = getVariantAxesForCategory(parentCatName);
        for (const axis of variantAxes) {
          const opt = await db.variantOption.create({ data: { productId: product.id, name: axis.name } });
          await Promise.all(axis.values.map((v) => db.variantOptionValue.create({ data: { optionId: opt.id, value: v } })));
        }
        const colorValues = variantAxes.find((a) => a.name === "Color")?.values ?? ["Default"];
        const skuIds: string[] = [];
        for (const color of colorValues.slice(0, 3)) {
          const sku = await db.productSKU.create({
            data: {
              productId: product.id, sku: `SKU-${++skuCounter}-${color.toUpperCase()}`,
              price, stock: randomInt(5, 100), minQuantity: 1,
              options: variantAxes.reduce((acc, a) => { acc[a.name] = a.name === "Color" ? color : a.values[0]!; return acc; }, {} as Record<string, string>),
            }
          });
          skuIds.push(sku.id);
          // SkuPriceTier — 2 tiers per SKU
          for (const tier of [{ minQty: 10, price: price * 0.95 }, { minQty: 50, price: price * 0.88 }]) {
            await db.skuPriceTier.create({ data: { skuId: sku.id, minQty: tier.minQty, price: tier.price, hiddenFloorPrice: tier.price * 0.8 } });
          }
        }
        await db.productCommission.create({ data: { productId: product.id, rate: randomDecimal(3, 10), setBy: adminUser.id } });
        // CustomizationOptionGroup + CustomizationOption
        if (isCustomizable) {
          const grp = await db.customizationOptionGroup.create({ data: { productId: product.id, name: "Print Placement", required: true, sortOrder: 0 } });
          for (const opt of [{ label: "Front Center", type: "SELECT", delta: 0 }, { label: "Back Center", type: "SELECT", delta: 0 }, { label: "Full Wrap", type: "SELECT", delta: 50 }]) {
            await db.customizationOption.create({ data: { groupId: grp.id, label: opt.label, type: opt.type as any, priceDelta: opt.delta, sortOrder: 0 } });
          }
          const grp2 = await db.customizationOptionGroup.create({ data: { productId: product.id, name: "Color Choice", required: false, sortOrder: 1 } });
          for (const c of ["Black", "White", "Navy", "Red"]) {
            await db.customizationOption.create({ data: { groupId: grp2.id, label: c, type: "COLOR", priceDelta: 0, sortOrder: 0 } });
          }
        }
        // ProductModel3D — for some products
        if (Math.random() > 0.8) {
          await db.productModel3D.create({ data: { productId: product.id, key: `models/${product.id}/model.glb`, format: "GLB", sizeBytes: randomInt(500000, 5000000) } });
        }
        // CommissionProposal — for some products
        if (Math.random() > 0.8) {
          await db.commissionProposal.create({
            data: {
              productId: product.id, proposedRate: randomDecimal(2, 5),
              status: randomItem(["PENDING", "ACCEPTED", "REJECTED"]) as any,
              proposedBy: seller.id, proposedByType: "seller",
            }
          });
        }
        // Template + PrintArea for customizable products
        if (isCustomizable) {
          const firstSku = await db.productSKU.findFirst({ where: { productId: product.id } });
          await db.template.create({
            data: {
              productId: product.id, sellerId: seller.id,
              name: `${pName} Default Template`,
              industry: parentCatName, style: randomItem(["Modern", "Classic", "Minimal"]),
              thumbnailUrl: `https://picsum.photos/seed/template-${product.id}/300/300`,
              thumbnailKey: `templates/${product.id}/thumb.png`,
              canvasState: { width: 800, height: 600, elements: [] },
            }
          }).catch(() => { });
          await db.printArea.create({
            data: {
              productId: product.id, skuId: firstSku?.id ?? null,
              widthCm: randomDecimal(5, 30), heightCm: randomDecimal(5, 30),
            }
          }).catch(() => { });
        }
        products.push(product);
      }
    }

    // 11. Customers (4 named customers with rich data)
    logger.info("Seeding customers...");
    const customers: any[] = [];
    const custPwd = await bcrypt.hash("Customer@123", 12);
    const customerDefs = [
      { name: "Rahul Sharma", email: "rahul.customer@example.com" },
      { name: "Priya Patel", email: "priya.customer@example.com" },
      { name: "Amit Singh", email: "amit.customer@example.com" },
      { name: "Sneha Gupta", email: "sneha.customer@example.com" },
    ];
    for (const def of customerDefs) {
      const customer = await db.user.create({ data: { name: def.name, email: def.email, password: custPwd, isActive: true } });
      customers.push(customer);
    }

    // 11b. Customer Addresses (2 addresses per customer)
    logger.info("Seeding customer addresses...");
    for (const customer of customers) {
      await db.customerAddress.create({
        data: {
          userId: customer.id, label: "Home",
          receiverName: customer.name ?? "Customer", phone: `98${randomInt(10000000, 99999999)}`,
          street: `${randomInt(1, 999)} ${randomItem(roads)}`, city: randomItem(cities),
          state: randomItem(states), pincode: String(randomInt(110001, 599999)),
          latitude: randomDecimal(18.0, 28.0), longitude: randomDecimal(72.0, 88.0), isDefault: true,
        }
      });
      await db.customerAddress.create({
        data: {
          userId: customer.id, label: "Work",
          receiverName: customer.name ?? "Customer", phone: `98${randomInt(10000000, 99999999)}`,
          street: `${randomInt(1, 999)} ${randomItem(roads)}`, city: randomItem(cities),
          state: randomItem(states), pincode: String(randomInt(110001, 599999)),
          isDefault: false,
        }
      });
    }

    // 12. Wallets
    logger.info("Seeding wallets...");
    const walletMap = new Map<string, string>();
    for (const user of [...allSellerUsers, ...customers]) {
      const balance = randomDecimal(0, 15000);
      const wallet = await db.wallet.create({ data: { userId: user.id, balance } });
      walletMap.set(user.id, wallet.id);
      if (balance > 0) {
        await db.walletTopup.create({ data: { userId: user.id, walletId: wallet.id, amount: balance, method: randomItem(["NEFT", "RTGS", "IMPS", "UPI"]) as any, utrReference: `UTR${randomInt(100000000000, 999999999999)}` } });
        await db.walletTransaction.create({ data: { walletId: wallet.id, type: "CREDIT", amount: balance, reason: "Initial topup", referenceId: wallet.id, balanceAfter: balance } });
      }
    }

    // 13. Sessions
    logger.info("Seeding sessions...");
    for (const user of [...allSellerUsers, ...customers]) {
      await db.session.create({ data: { userId: user.id, deviceInfo: randomItem(devices), ipAddress: `192.168.${randomInt(1, 254)}.${randomInt(1, 254)}`, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", lastActiveAt: randomDate(new Date("2024-10-01"), new Date()), revoked: Math.random() > 0.85 } });
    }

    // 14. Coupons
    logger.info("Seeding coupons...");
    const coupons: any[] = [];
    for (const c of [{ code: "WELCOME10", type: "PERCENTAGE", value: 10, minOrder: 500, maxUses: 100 }, { code: "FLAT200", type: "FIXED", value: 200, minOrder: 1000, maxUses: 50 }, { code: "SALE20", type: "PERCENTAGE", value: 20, minOrder: 2000, maxUses: 200 }, { code: "BULK500", type: "FIXED", value: 500, minOrder: 5000, maxUses: 30 }, { code: "FIRST50", type: "PERCENTAGE", value: 50, minOrder: 500, maxUses: 1 }]) {
      coupons.push(await db.coupon.create({ data: { code: c.code, type: c.type as any, value: c.value, minOrder: c.minOrder, maxUses: c.maxUses, perUserLimit: 1, expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), isActive: true, scopeType: "ALL", scopeIds: [], createdBy: adminUser.id } }));
    }

    // 15. Orders (distribute evenly across 4 customers with varied statuses)
    logger.info("Seeding orders...");
    const orders: { order: any; address: any }[] = [];
    const usedPayoutOrders = new Set<string>();
    const usedCouponOrders = new Set<string>();
    const usedReviewCombos = new Set<string>();
    // Ensure each customer gets a spread of statuses
    const orderStatuses = ["PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"];
    const ordersPerCustomer = 12; // 4 customers × 12 = 48 orders
    for (let ci = 0; ci < customers.length; ci++) {
      const customer = customers[ci]!;
      for (let oi = 0; oi < ordersPerCustomer; oi++) {
        const seller = randomItem([seller1, seller2]);
        const shopPool = shops.filter((s) => s.sellerId === seller.id);
        const shop = randomItem(shopPool);
        const prodPool = products.filter((p) => p.sellerId === seller.id);
        const product = prodPool.length > 0 ? randomItem(prodPool) : randomItem(products);
        const qty = randomInt(1, 10);
        const total = parseFloat(product.price.toString()) * qty;
        const commR = 5.0;
        const commA = (total * commR) / 100;
        const oType = randomItem(["STANDARD", "HIGH_TICKET", "SAMPLE", "BULK"]) as any;
        // Ensure a good spread: first few DELIVERED, then SHIPPED, then others
        const statusIndex = oi % orderStatuses.length;
        const oStatus = orderStatuses[statusIndex] as any;
        const payS = oStatus === "DELIVERED" || oStatus === "SHIPPED" ? "PAID" : randomItem(["UNPAID", "PAID", "PARTIALLY_PAID"]) as any;
        const order = await db.order.create({
          data: {
            sellerId: seller.id, customerId: customer.id, orgId: null, displayId: await generateDisplayId("order"),
            type: oType, status: oStatus, totalAmount: total, finalAmount: total - commA,
            commissionRate: commR, commissionAmount: commA, paymentStatus: payS,
            assignedShopId: shop.id, discountAmount: Math.random() > 0.7 ? randomDecimal(50, 500) : null,
          }
        });
        const orderSkus = await db.productSKU.findMany({ where: { productId: product.id }, take: 1 });
        await db.orderItem.create({ data: { orderId: order.id, productId: product.id, skuId: orderSkus[0]?.id ?? null, quantity: qty, unitPrice: product.price, finalUnitPrice: product.price, selectedOptions: { Color: randomItem(["Black", "White", "Blue"]) } } });
        const address = await db.orderAddress.create({
          data: {
            orderId: order.id, receiverName: customer.name ?? "Customer", phone: `98${randomInt(10000000, 99999999)}`,
            street: `${randomInt(1, 999)} ${randomItem(roads)}`, city: randomItem(cities), state: randomItem(states),
            pincode: String(randomInt(110001, 599999)), latitude: randomDecimal(18.0, 28.0), longitude: randomDecimal(72.0, 88.0),
            assignedShopId: shop.id, assignedBy: adminUser.id, fulfillmentStatus: randomItem(["PENDING", "ASSIGNED", "PROCESSING", "SHIPPED", "DELIVERED"]) as any,
          }
        });
        if (oStatus === "SHIPPED" || oStatus === "DELIVERED") {
          await db.shipment.create({
            data: {
              orderId: order.id, orderAddressId: address.id, shopId: shop.id, displayId: await generateDisplayId("shipment"),
              provider: "SHIPROCKET", trackingId: `TRK${randomInt(100000000, 999999999)}`,
              trackingUrl: `https://shiprocket.co/tracking/${randomInt(100000000, 999999999)}`,
              status: oStatus === "DELIVERED" ? "DELIVERED" : randomItem(["BOOKED", "IN_TRANSIT", "OUT_FOR_DELIVERY"]) as any,
              estimatedDelivery: randomDate(new Date(), new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
            }
          });
        }
        await db.payment.create({
          data: {
            orderId: order.id, razorpayOrderId: `order_${randomInt(100000000, 999999999)}${ci}${oi}`,
            razorpayPaymentId: payS === "PAID" ? `pay_${randomInt(100000000, 999999999)}` : null,
            amount: total, currency: "INR", type: randomItem(["ADVANCE", "FINAL"]) as any, status: payS, attempts: payS === "PAID" ? 1 : 0,
          }
        });
        if (oType === "BULK") {
          await db.bulkUpload.create({ data: { orderId: order.id, uploadedBy: seller.id, fileName: `bulk_order_${order.id}.csv`, status: randomItem(["PROCESSING", "COMPLETED", "FAILED"]) as any, totalAddresses: randomInt(10, 100), assignedCount: randomInt(5, 50) } });
        }
        orders.push({ order, address });
      }
    }


    // 16b. Negotiation Sessions (5 per customer across all 4 customers)
    logger.info("Seeding negotiation sessions...");
    const negProducts = products.slice(0, 20);
    const negStatuses = ["PENDING", "ACCEPTED", "REJECTED", "EXHAUSTED", "EXPIRED"];
    const negModes = ["AUTO", "MANUAL", "AUTO", "MANUAL", "AUTO"];
    for (const customer of customers) {
      const usedSkuIds = new Set<string>();
      for (let i = 0; i < 5; i++) {
        // Pick a product with an SKU not yet used for this customer (avoids unique constraint on PENDING/EXHAUSTED)
        let product: any = null;
        let sellerId = "";
        let skuId = "";
        for (let attempt = 0; attempt < 10; attempt++) {
          const candidate = randomItem(negProducts);
          const candidateSkus = await db.productSKU.findMany({ where: { productId: candidate.id } });
          const availableSku = candidateSkus.find((s) => !usedSkuIds.has(s.id));
          if (availableSku) {
            product = candidate;
            sellerId = candidate.sellerId;
            skuId = availableSku.id;
            usedSkuIds.add(skuId);
            break;
          }
        }
        if (!product) continue;
        const mode = negModes[i] as any;
        const status = negStatuses[i] as any;
        const session = await db.negotiationSession.create({
          data: {
            customerId: customer.id, sellerId, productId: product.id, skuId,
            orgId: null, formulaVersion: Math.random() > 0.5 ? "v2_gamma" : "v1_linear",
            quantity: randomInt(5, 50), mode, status, visibleTierPrice: parseFloat(product.price.toString()),
            hiddenFloorPrice: parseFloat(product.price.toString()) * 0.8,
            round: mode === "AUTO" ? randomInt(1, 3) : 0,
            finalPrice: status === "ACCEPTED" ? parseFloat(product.price.toString()) * 0.9 : null,
            nudgeDueAt: status === "PENDING" ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null,
          }
        });
        // Auto negotiation rounds
        if (mode === "AUTO") {
          const numRounds = session.round;
          for (let r = 1; r <= numRounds; r++) {
            await db.negotiationRound.create({
              data: {
                sessionId: session.id, round: r,
                offeredPrice: parseFloat(product.price.toString()) * (1 - r * 0.05),
                customerPrice: parseFloat(product.price.toString()) * (1 - (r + 1) * 0.05),
                response: r < numRounds ? randomItem(["ACCEPT", "REJECT"]) as any : null,
                createdAt: randomDate(new Date("2024-10-01"), new Date()),
                respondedAt: r < numRounds ? randomDate(new Date("2024-10-01"), new Date()) : null,
              }
            });
          }
        }
        // Manual negotiation chat
        if (mode === "MANUAL") {
          const chat = await db.negotiationChatSession.create({
            data: {
              sessionId: session.id, proposedTimeSlot: Math.random() > 0.5 ? randomDate(new Date(), new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)) : null,
              proposedBy: Math.random() > 0.5 ? "customer" as any : "seller" as any,
              customerConfirmed: Math.random() > 0.5, sellerConfirmed: Math.random() > 0.5,
            }
          });
          for (let m = 0; m < randomInt(2, 5); m++) {
            await db.negotiationMessage.create({
              data: {
                chatSessionId: chat.id, senderId: m % 2 === 0 ? customer.id : sellerId,
                senderType: m % 2 === 0 ? "customer" as any : "seller" as any,
                body: randomItem(["Can you offer a better price?", "What's the best you can do?", "I can offer a 10% discount.", "Let me check and get back.", "That works for me."]),
              }
            });
          }
        }
      }
    }

    // 17. Coupon Usages
    logger.info("Seeding coupon usages...");
    for (let i = 0; i < 8; i++) {
      const { order } = orders[i]!;
      if (usedCouponOrders.has(order.id)) continue;
      await db.couponUsage.create({ data: { couponId: coupons[i % coupons.length].id, userId: order.customerId, orderId: order.id, discount: randomDecimal(50, 500) } });
      usedCouponOrders.add(order.id);
    }

    // 18. Reviews + Helpful Votes
    logger.info("Seeding reviews...");
    const deliveredOrders = orders.filter((o) => o.order.status === "DELIVERED");
    for (const { order } of deliveredOrders.slice(0, 15)) {
      const items = await db.orderItem.findMany({ where: { orderId: order.id } });
      for (const item of items) {
        const combo = `${order.id}:${item.productId}:${order.customerId}`;
        if (usedReviewCombos.has(combo)) continue;
        usedReviewCombos.add(combo);
        const review = await db.review.create({ data: { orderId: order.id, productId: item.productId, customerId: order.customerId, sellerId: order.sellerId, rating: randomInt(3, 5), comment: randomItem(comments), mediaUrls: [], isVerifiedPurchase: true, status: randomItem(["APPROVED", "APPROVED", "APPROVED", "PENDING"]) as any, reviewedBy: Math.random() > 0.4 ? adminUser.id : null } });
        const voters = customers.slice(0, randomInt(1, 6));
        const seenVoters = new Set<string>();
        for (const voter of voters) { if (seenVoters.has(voter.id)) continue; seenVoters.add(voter.id); await db.reviewHelpful.create({ data: { reviewId: review.id, userId: voter.id } }); }
      }
    }

    // 19. Return Requests (2 per customer, varied statuses)
    logger.info("Seeding return requests...");
    const returnStatuses = ["PENDING", "APPROVED", "REJECTED", "COMPLETED"];
    for (const customer of customers) {
      const custDelivered = deliveredOrders.filter((o) => o.order.customerId === customer.id);
      for (let i = 0; i < 2 && i < custDelivered.length; i++) {
        const { order } = custDelivered[i]!;
        const returnReq = await db.returnRequest.create({ data: { orderId: order.id, customerId: order.customerId, reason: randomItem(["Product damaged", "Wrong item received", "Not as described", "Changed mind"]), status: returnStatuses[i % returnStatuses.length] as any, approvedBy: i % 2 === 0 ? adminUser.id : null, note: "Customer raised return request via portal" } });
        if (returnReq.status === "APPROVED" || returnReq.status === "COMPLETED") {
          await db.returnShipment.create({ data: { returnRequestId: returnReq.id, provider: "SHIPROCKET", trackingId: `RTN${randomInt(100000000, 999999999)}`, trackingUrl: `https://shiprocket.co/return-tracking/${randomInt(100000000, 999999999)}`, status: returnReq.status === "COMPLETED" ? "DELIVERED" : "IN_TRANSIT" as any } });
        }
        // ReturnImage via CustomerUploadAsset
        await db.customerUploadAsset.create({ data: { userId: order.customerId, returnRequestId: returnReq.id, url: `https://picsum.photos/seed/return-${returnReq.id}/400/400`, key: `returns/${returnReq.id}/image1.jpg`, fileType: "image/jpeg" } });
      }
    }

    // 20. Seller Payouts + Payout Orders
    logger.info("Seeding payouts...");
    for (const seller of [seller1, seller2]) {
      const sellerOrders = orders.filter((o) => o.order.sellerId === seller.id);
      for (let i = 0; i < 3; i++) {
        const gross = randomDecimal(15000, 100000);
        const comm = gross * 0.05;
        const net = gross - comm;
        const status = randomItem(["PENDING", "PROCESSING", "PAID", "FAILED"]) as any;
        const payout = await db.sellerPayout.create({ data: { sellerId: seller.id, grossAmount: gross, commissionAmount: comm, netAmount: net, method: randomItem(["UPI", "IMPS", "RTGS", "NEFT"]) as any, razorpayPayoutId: status === "PAID" ? `pout_${randomInt(100000000, 999999999)}` : null, utrReference: status === "PAID" ? `UTR${randomInt(100000000000, 999999999999)}` : null, status, initiatedBy: adminUser.id, paidAt: status === "PAID" ? randomDate(new Date("2024-06-01"), new Date()) : null, periodStart: randomDate(new Date("2024-01-01"), new Date("2024-06-01")), periodEnd: randomDate(new Date("2024-06-01"), new Date()), note: "Regular weekly payout" } });
        for (const { order } of sellerOrders.slice(i * 3, i * 3 + 3)) {
          const key = `${payout.id}:${order.id}`;
          if (usedPayoutOrders.has(key)) continue;
          usedPayoutOrders.add(key);
          await db.payoutOrder.create({ data: { payoutId: payout.id, orderId: order.id, orderAmount: order.totalAmount, commissionAmount: order.commissionAmount ?? 0, netAmount: order.finalAmount ?? order.totalAmount } });
        }
      }
    }

    // 20b. Invoices & Purchase Orders (for delivered/confident orders)
    // Use the real invoicing service so snapshots have the full shape
    // (seller/buyer/items/etc.) the PDF renderer requires, instead of a
    // hand-rolled stub that generatePdf() would crash on.
    logger.info("Seeding invoices & purchase orders...");
    for (const { order } of orders.filter((o) => o.order.status === "DELIVERED" || o.order.status === "SHIPPED").slice(0, 15)) {
      try {
        await invoicingService.generateInvoice(order.id, {
          userId: adminUser.id,
          sellerId: order.sellerId,
          actorType: "seller",
        });
      } catch (err: any) {
        logger.warn({ err: err.message, orderId: order.id }, "Skipped seeding invoice for order");
      }
      // Purchase orders for some orders
      if (Math.random() > 0.5) {
        try {
          await invoicingService.generatePurchaseOrder(order.id, {
            userId: adminUser.id,
            sellerId: order.sellerId,
            actorType: "seller",
          });
        } catch (err: any) {
          logger.warn({ err: err.message, orderId: order.id }, "Skipped seeding purchase order for order");
        }
      }
    }

    // 21. Audit Logs
    logger.info("Seeding audit logs...");
    for (let i = 0; i < 30; i++) {
      const seller = randomItem([seller1, seller2]);
      await db.auditLog.create({ data: { sellerId: seller.id, actorId: randomItem([adminUser.id, onboardUser.id, reviewerUser.id]), actorType: "platform", action: randomItem(auditActs), entityType: randomItem(["seller", "product", "seller_kyc", "order"]), entityId: seller.id, metadata: { reason: "Manual review", ts: new Date().toISOString() }, ipAddress: `10.0.${randomInt(1, 254)}.${randomInt(1, 254)}`, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } });
    }

    // 21b. Notification Templates
    logger.info("Seeding notification templates...");
    const notifTemplateDefs: { type: string; subject: string; bodyHtml: string }[] = [
      { type: "SELLER_APPROVED", subject: "Your seller account is approved", bodyHtml: "<p>Congratulations! Your seller account has been approved.</p>" },
      { type: "SELLER_REJECTED", subject: "Seller account update", bodyHtml: "<p>Your seller account application was rejected.</p>" },
      { type: "PRODUCT_APPROVED", subject: "Product approved", bodyHtml: "<p>Your product listing is now live.</p>" },
      { type: "PRODUCT_REJECTED", subject: "Product needs changes", bodyHtml: "<p>Your product submission was rejected. Please review and resubmit.</p>" },
      { type: "ORDER_PLACED", subject: "New order received", bodyHtml: "<p>You have received a new order.</p>" },
      { type: "ORDER_CONFIRMED", subject: "Order confirmed", bodyHtml: "<p>Your order has been confirmed.</p>" },
      { type: "ORDER_CANCELLED", subject: "Order cancelled", bodyHtml: "<p>Your order has been cancelled.</p>" },
      { type: "SHIPMENT_UPDATED", subject: "Shipment update", bodyHtml: "<p>Your shipment status has been updated.</p>" },
      { type: "PAYMENT_RECEIVED", subject: "Payment received", bodyHtml: "<p>Payment has been received for your order.</p>" },
      { type: "KYC_VERIFIED", subject: "KYC verified", bodyHtml: "<p>Your KYC verification is complete.</p>" },
      { type: "KYC_REJECTED", subject: "KYC rejected", bodyHtml: "<p>Your KYC submission was rejected. Please resubmit.</p>" },
      { type: "RETURN_REQUESTED", subject: "Return request", bodyHtml: "<p>A return request has been raised.</p>" },
      { type: "RETURN_APPROVED", subject: "Return approved", bodyHtml: "<p>The return request has been approved.</p>" },
      { type: "RETURN_REJECTED", subject: "Return rejected", bodyHtml: "<p>The return request has been rejected.</p>" },
      { type: "PAYOUT_INITIATED", subject: "Payout initiated", bodyHtml: "<p>Your payout has been initiated.</p>" },
      { type: "PAYOUT_PAID", subject: "Payout sent", bodyHtml: "<p>Your payout has been processed.</p>" },
      { type: "PAYOUT_FAILED", subject: "Payout failed", bodyHtml: "<p>Your payout could not be processed.</p>" },
      { type: "PRODUCT_LOW_STOCK", subject: "Low stock alert", bodyHtml: "<p>Your product is running low on stock.</p>" },
      { type: "REVIEW_RECEIVED", subject: "New review", bodyHtml: "<p>You received a new product review.</p>" },
      { type: "REVIEW_REPLY", subject: "Review reply", bodyHtml: "<p>Your review has received a reply.</p>" },
      { type: "COUPON_APPLIED", subject: "Coupon applied", bodyHtml: "<p>A coupon was applied to your order.</p>" },
      { type: "TEAM_INVITE", subject: "Team invitation", bodyHtml: "<p>You have been invited to join a seller team.</p>" },
      { type: "NEGOTIATION_NUDGE", subject: "Negotiation reminder", bodyHtml: "<p>You have a pending negotiation offer.</p>" },
      { type: "MANUAL_NEGOTIATION_STARTED", subject: "New negotiation", bodyHtml: "<p>A customer started a manual negotiation.</p>" },
    ];
    for (const tpl of notifTemplateDefs) {
      await db.notificationTemplate.upsert({ where: { type: tpl.type as any }, update: { subject: tpl.subject, bodyHtml: tpl.bodyHtml, updatedBy: adminUser.id }, create: { type: tpl.type as any, subject: tpl.subject, bodyHtml: tpl.bodyHtml, updatedBy: adminUser.id } });
    }

    // 22. Notifications (with new types)
    logger.info("Seeding notifications...");
    const notifDefs = [
      { type: "ORDER_PLACED", title: "New Order", msg: "You have received a new order" },
      { type: "PAYMENT_RECEIVED", title: "Payment", msg: "Payment received for your order" },
      { type: "SELLER_APPROVED", title: "Account Approved", msg: "Your seller account is approved" },
      { type: "PRODUCT_APPROVED", title: "Product Live", msg: "Your product listing is live" },
      { type: "KYC_VERIFIED", title: "KYC Verified", msg: "KYC verification complete" },
      { type: "PAYOUT_PAID", title: "Payout Sent", msg: "Your payout has been processed" },
      { type: "SHIPMENT_UPDATED", title: "Shipment Update", msg: "Shipment status updated" },
      { type: "RETURN_REQUESTED", title: "Return Request", msg: "Customer raised a return request" },
      { type: "NEGOTIATION_NUDGE", title: "Negotiation Reminder", msg: "You have a pending negotiation offer" },
      { type: "MANUAL_NEGOTIATION_STARTED", title: "New Negotiation", msg: "A customer started a manual negotiation" },
      { type: "PRODUCT_LOW_STOCK", title: "Low Stock Alert", msg: "Your product is running low on stock" },
      { type: "PAYOUT_FAILED", title: "Payout Failed", msg: "Your payout could not be processed" },
      { type: "RETURN_APPROVED", title: "Return Approved", msg: "Return request has been approved" },
      { type: "RETURN_REJECTED", title: "Return Rejected", msg: "Return request has been rejected" },
    ];
    for (const user of [...allSellerUsers, ...customers]) {
      for (let i = 0; i < randomInt(3, 6); i++) {
        const n = randomItem(notifDefs);
        const notification = await db.notification.create({ data: { userId: user.id, type: n.type as any, title: n.title, message: n.msg, isRead: Math.random() > 0.4 } });
        // NotificationDelivery for some notifications
        if (Math.random() > 0.5) {
          await db.notificationDelivery.create({ data: {
            notificationId: notification.id,
            channel: randomItem(["EMAIL", "SMS", "SSE"]) as any,
            status: randomItem(["SENT", "SENT", "PENDING", "FAILED"]) as any,
            attempts: randomInt(1, 3),
            payload: { to: user.email, subject: n.title },
          }}).catch(() => {});
        }
      }
    }

    // 22b. Notification Preferences (with ACCOUNT category)
    logger.info("Seeding notification preferences...");
    const notifCategories = ["ORDER", "SHIPMENT", "PAYOUT", "NEGOTIATION", "PROMOTION", "SECURITY", "ACCOUNT"] as const;
    for (const user of [...allSellerUsers, ...customers]) {
      for (const category of notifCategories) {
        const enabled = category === "SECURITY" || category === "ACCOUNT" ? true : Math.random() > 0.1;
        await db.notificationPreference.create({ data: { userId: user.id, category, enabled } }).catch(() => {});
      }
    }

    // 22c. Saved Designs (3 per customer on customizable products)
    logger.info("Seeding saved designs...");
    const customizableProducts = products.filter((p) => p.customizationEnabled);
    if (customizableProducts.length > 0) {
      for (const customer of customers) {
        for (let i = 0; i < 3; i++) {
          const product = randomItem(customizableProducts);
          const skus = await db.productSKU.findMany({ where: { productId: product.id }, take: 1 });
          await db.savedDesign.create({ data: {
            userId: customer.id, productId: product.id, skuId: skus[0]?.id ?? null,
            name: `${product.name} Design v${i + 1}`,
            customizationState: { printPlacement: randomItem(["Front Center", "Back Center", "Full Wrap"]), color: randomItem(["Black", "White", "Navy", "Red"]) },
          }});
        }
      }
    }

    // 22d. Carts & Cart Items (1 cart per customer with 3-5 items)
    logger.info("Seeding carts...");
    for (const customer of customers) {
      const cart = await db.cart.create({ data: { userId: customer.id, orgId: null, sellerId: randomItem([seller1.id, seller2.id]) } });
      const usedProductIds = new Set<string>();
      const itemCount = randomInt(3, 5);
      for (let i = 0; i < itemCount; i++) {
        const available = products.filter((p) => !usedProductIds.has(p.id));
        if (available.length === 0) break;
        const product = randomItem(available);
        usedProductIds.add(product.id);
        const skus = await db.productSKU.findMany({ where: { productId: product.id }, take: 1 });
        await db.cartItem.create({ data: { cartId: cart.id, productId: product.id, skuId: skus[0]?.id ?? null, quantity: randomInt(1, 5) } }).catch(() => {});
      }
    }

    // 22e. Wishlist Items (5 per customer)
    logger.info("Seeding wishlist items...");
    for (const customer of customers) {
      for (let i = 0; i < 5; i++) {
        const product = randomItem(products);
        await db.wishlistItem.create({ data: { userId: customer.id, productId: product.id } }).catch(() => {});
      }
    }

    // 22f. Customer Upload Assets (files for My Files page — 3 per customer)
    logger.info("Seeding customer upload assets...");
    const assetDefs = [
      { name: "company-logo.svg", fileType: "image/svg+xml", key: "assets/logo.svg" },
      { name: "brand-guidelines.pdf", fileType: "application/pdf", key: "assets/brand-guide.pdf" },
      { name: "product-artwork.png", fileType: "image/png", key: "assets/artwork.png" },
    ];
    for (const customer of customers) {
      for (const asset of assetDefs) {
        await db.customerUploadAsset.create({ data: {
          userId: customer.id, url: `https://picsum.photos/seed/${customer.id}-${asset.name}/400/400`,
          key: `users/${customer.id}/${asset.key}`, fileType: asset.fileType,
        }}).catch(() => {});
      }
    }

    // 23. Fix Permissions
    await fixSellerPermissions();

    // 24. Customer Organization Permissions Catalog
    logger.info("Seeding customer org permissions catalog...");
    const orgPermDefs = [
      { key: "view_org_cart", description: "View organization shared cart" },
      { key: "edit_org_cart", description: "Add or modify items in org cart" },
      { key: "place_order", description: "Place orders on behalf of organization" },
      { key: "view_order_history", description: "View organization order history" },
      { key: "manage_negotiations", description: "Manage negotiations for organization" },
      { key: "invite_members", description: "Invite new members to organization" },
      { key: "manage_roles", description: "Create and manage custom roles" },
      { key: "remove_members", description: "Remove members from organization" },
    ];
    for (const perm of orgPermDefs) {
      await db.customerOrgPermission.upsert({
        where: { key: perm.key },
        update: { description: perm.description },
        create: perm,
      });
    }

    // 25. Customer Organizations (1 org for first 2 customers)
    logger.info("Seeding customer organizations...");
    const orgPermIds = await db.customerOrgPermission.findMany();
    const orgPermIdByKey = new Map(orgPermIds.map((p) => [p.key, p.id]));
    const allPermIds = orgPermIds.map((p) => p.id);

    for (let oi = 0; oi < 2 && oi < customers.length; oi++) {
      const customer = customers[oi]!;
      const org = await db.customerOrg.create({
        data: {
          name: `${customer.name?.split(" ")[0] ?? "Customer"} Industries Pvt Ltd`,
          createdBy: customer.id,
        },
      });
      // Admin role with all permissions
      const adminRole = await db.customerOrgRole.create({
        data: { orgId: org.id, name: "admin" },
      });
      await db.customerOrgRolePermission.createMany({
        data: allPermIds.map((pid) => ({ roleId: adminRole.id, permissionId: pid })),
        skipDuplicates: true,
      });
      // Buyer role with limited permissions
      const buyerRole = await db.customerOrgRole.create({
        data: { orgId: org.id, name: "buyer" },
      });
      const buyerPerms = ["view_org_cart", "edit_org_cart", "place_order", "view_order_history", "manage_negotiations"];
      await db.customerOrgRolePermission.createMany({
        data: buyerPerms.map((k) => ({ roleId: buyerRole.id, permissionId: orgPermIdByKey.get(k)! })).filter((x) => x.permissionId),
        skipDuplicates: true,
      });
      // Add customer as admin member
      await db.customerOrgMember.create({
        data: { userId: customer.id, orgId: org.id, roleId: adminRole.id, isActive: true },
      });
      // Pending invite
      await db.customerOrgInvite.create({
        data: {
          orgId: org.id, email: `invitee.${oi + 1}@example.com`, roleId: buyerRole.id,
          invitedBy: customer.id, status: "PENDING",
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      }).catch(() => {});
    }

    // 26. Pricing Engine Config + Constants
    logger.info("Seeding pricing engine config and constants...");
    await db.pricingEngineConfig.upsert({
      where: { id: "singleton" },
      update: {},
      create: {
        id: "singleton",
        stage: 0,
        enableDemandDecay: false,
        enableVolatility: false,
        enableAdverseSelection: false,
        enableDynamicHorizon: false,
        enableRegimeAdj: false,
        enableOFI: false,
        enableRepeatMult: false,
        enableCrossSkuDemand: false,
        updatedBy: adminUser.id,
      },
    }).catch(() => {});

    await db.pricingEngineConstants.upsert({
      where: { id: "singleton" },
      update: {},
      create: {
        id: "singleton",
        updatedBy: adminUser.id,
      },
    }).catch(() => {});

    // 27. Seller Negotiation Configs (1 per seller)
    logger.info("Seeding seller negotiation configs...");
    for (const seller of [seller1, seller2]) {
      await db.sellerNegotiationConfig.create({
        data: {
          sellerId: seller.id,
          category: null,
          gammaBase: 0.5,
          gammaMin: 0.2,
          gammaMax: 0.8,
          alpha: 0.3,
          beta: 0.3,
          delta: 0,
          zeta: 0,
          eta: 0,
          tolerancePct: 0.03,
          earlyExitMinRound: 2,
          minImprovementPct: 0.005,
          setBy: adminUser.id,
        },
      }).catch(() => {});
    }

    logger.info("✅ Seed completed!");
    logger.info(`  Sellers: ${allSellers.length}  |  Shops: ${shops.length}  |  Products: ${products.length}`);
    logger.info(`  Customers: ${customers.length}  |  Orders: ${orders.length}  |  Coupons: ${coupons.length}`);
    logger.info(`  DeliveredOrders: ${deliveredOrders.length}  |  Categories: ${categoryMap.size}`);
    logger.info(`  Negotiations: ${customers.length * 5}  |  Returns: ${customers.length * 2}  |  SavedDesigns: ${customers.length * 3}`);
  } catch (error: any) {
    logger.error({ err: error.message, stack: error.stack }, "Seed failed");
    throw error;
  }
}

// ─── Operation 2: Backfill Platform RBAC ────────────────────────────────────

async function backfillPlatformRbac() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_RBAC_BACKFILL !== "true") {
    logger.error("Refusing to run backfill-platform-rbac against production without ALLOW_PROD_RBAC_BACKFILL=true");
    process.exit(1);
  }
  console.log("Platform RBAC backfill about to grant:\n");
  for (const [roleName, keys] of Object.entries(DEFAULT_PLATFORM_ROLE_PERMISSIONS)) {
    console.log(`  ${roleName} (${keys.length} permissions):`);
    for (const key of [...keys].sort()) console.log(`    - ${key}`);
    console.log("");
  }
  const roles = await db.platformRole.findMany({ where: { name: { in: Object.keys(DEFAULT_PLATFORM_ROLE_PERMISSIONS) } }, select: { id: true, name: true } });
  const missing = Object.keys(DEFAULT_PLATFORM_ROLE_PERMISSIONS).filter((name) => !roles.some((r) => r.name === name));
  if (missing.length) { logger.error({ missing }, "Expected PlatformRole rows not found — run seed first"); process.exit(1); }
  let totalGranted = 0;
  await db.$transaction(async (tx) => {
    await seedPlatformPermissions(tx);
    const allKeys = [...new Set(Object.values(DEFAULT_PLATFORM_ROLE_PERMISSIONS).flat())];
    const permissions = await tx.permission.findMany({ where: { key: { in: allKeys } }, select: { id: true, key: true } });
    if (permissions.length !== allKeys.length) throw new Error("Platform permission catalog not fully seeded — aborting backfill");
    const permissionIdByKey = new Map(permissions.map((p) => [p.key, p.id]));
    for (const role of roles) {
      const keys = DEFAULT_PLATFORM_ROLE_PERMISSIONS[role.name] ?? [];
      const result = await tx.platformRolePermission.createMany({ data: keys.map((key) => ({ roleId: role.id, permissionId: permissionIdByKey.get(key)! })), skipDuplicates: true });
      totalGranted += result.count;
    }
  });
  console.log(`Backfill complete — ${totalGranted} new grant(s) written (existing grants left as-is).`);
  process.exit(0);
}

// ─── Operation 3: Backfill Seller RBAC ──────────────────────────────────────

async function backfillSellerRbac() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_RBAC_BACKFILL !== "true") {
    logger.error("Refusing to run backfill-seller-rbac against production without ALLOW_PROD_RBAC_BACKFILL=true");
    process.exit(1);
  }
  console.log("Seller RBAC backfill about to grant (per matching role name):\n");
  for (const [roleName, keys] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    console.log(`  ${roleName} (${keys.length} permissions):`);
    for (const key of [...keys].sort()) console.log(`    - ${key}`);
    console.log("");
  }
  const roles = await db.sellerRole.findMany({ where: { name: { in: Object.keys(DEFAULT_ROLE_PERMISSIONS) } }, select: { id: true, name: true, sellerId: true } });
  console.log(`Found ${roles.length} matching roles across all sellers.`);
  let totalGranted = 0;
  await db.$transaction(async (tx) => {
    await seedPlatformPermissions(tx);
    const allKeys = [...new Set(Object.values(DEFAULT_ROLE_PERMISSIONS).flat())];
    const permissions = await tx.permission.findMany({ where: { key: { in: allKeys } }, select: { id: true, key: true } });
    if (permissions.length !== allKeys.length) throw new Error("Permission catalog not fully seeded — aborting backfill");
    const permissionIdByKey = new Map(permissions.map((p) => [p.key, p.id]));
    for (const role of roles) {
      const keys = DEFAULT_ROLE_PERMISSIONS[role.name] ?? [];
      const result = await tx.rolePermission.createMany({ data: keys.map((key) => ({ roleId: role.id, permissionId: permissionIdByKey.get(key)! })), skipDuplicates: true });
      totalGranted += result.count;
    }
  });
  console.log(`Backfill complete — ${totalGranted} new grant(s) written across ${roles.length} roles (existing grants left as-is).`);
  process.exit(0);
}

// ─── Operation 5: Reindex Search ────────────────────────────────────────────

async function reindexSearch() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_SEARCH_REINDEX !== "true") {
    logger.error("Refusing to run reindex-search against production without ALLOW_PROD_SEARCH_REINDEX=true");
    process.exit(1);
  }
  const provider = SearchIndexFactory.get();
  await provider.recreateIndex();
  const approvedCount = await db.product.count({ where: { status: "APPROVED" } });
  console.log(`Reindexing search: ${approvedCount} APPROVED product(s) found in Postgres.\n`);
  let indexed = 0, failed = 0;
  let cursor: string | undefined;
  const approvedIds = new Set<string>();
  const BATCH_SIZE = 200;
  while (true) {
    const batch = await db.product.findMany({ where: { status: "APPROVED" }, select: { id: true }, orderBy: { id: "asc" }, take: BATCH_SIZE, ...(cursor && { cursor: { id: cursor }, skip: 1 }) });
    if (!batch.length) break;
    for (const { id } of batch) {
      approvedIds.add(id);
      try {
        const doc = await buildSearchDocument(id);
        if (doc) { await provider.indexProduct(doc); indexed++; }
      } catch (err: any) { failed++; logger.warn({ err: err.message, productId: id }, "Failed to reindex product"); }
    }
    cursor = batch[batch.length - 1]!.id;
    console.log(`  ...${indexed + failed}/${approvedCount} processed`);
  }
  console.log("\nChecking for orphaned index entries...");
  const indexedIds = await provider.listAllProductIds();
  const orphanIds = indexedIds.filter((id) => !approvedIds.has(id));
  let pruned = 0;
  for (const id of orphanIds) {
    try { await provider.deleteProduct(id); pruned++; } catch (err: any) { logger.warn({ err: err.message, productId: id }, "Failed to prune orphaned index entry"); }
  }
  console.log(`\nReindex complete — ${indexed} indexed, ${failed} failed, ${pruned} orphan(s) pruned.`);
  if (failed > 0) console.log("Failures were logged above — re-run this script to retry (it's idempotent).");
  process.exit(failed > 0 ? 1 : 0);
}

// ─── CLI Menu ───────────────────────────────────────────────────────────────

const OPERATIONS: Record<string, { description: string; fn: () => Promise<void> }> = {
  seed: { description: "Full comprehensive database seed", fn: seedComprehensive },
  "backfill-platform-rbac": { description: "Backfill platform RBAC permissions", fn: backfillPlatformRbac },
  "backfill-seller-rbac": { description: "Backfill seller RBAC permissions", fn: backfillSellerRbac },
  "reindex-search": { description: "Reindex OpenSearch product index", fn: reindexSearch },
};

async function showMenu() {
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║     ETradeBazaar — Main Script               ║");
  console.log("╠══════════════════════════════════════════════╣");
  const keys = Object.keys(OPERATIONS);
  keys.forEach((key, i) => {
    console.log(`║  ${i + 1}. ${key.padEnd(20)} ${OPERATIONS[key]!.description.padEnd(24)} ║`);
  });
  console.log("╚══════════════════════════════════════════════╝");
  console.log("\nOr run directly: bun scripts/main-script.ts <command>\n");
  const readline = await import("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question("Select operation (1-5): ", (answer) => {
    const idx = parseInt(answer.trim(), 10) - 1;
    rl.close();
    if (idx < 0 || idx >= keys.length) {
      console.error("Invalid selection");
      process.exit(1);
    }
    const key = keys[idx]!;
    console.log(`\nRunning: ${key} — ${OPERATIONS[key]!.description}\n`);
    OPERATIONS[key]!.fn().catch((err) => {
      logger.error({ err: err.message }, `${key} failed`);
      process.exit(1);
    });
  });
}

// ─── Entry Point ────────────────────────────────────────────────────────────

const command = process.argv[2];

if (command && OPERATIONS[command]) {
  console.log(`Running: ${command} — ${OPERATIONS[command]!.description}\n`);
  OPERATIONS[command]!.fn()
    .then(() => { logger.info(`${command} completed — exiting`); process.exit(0); })
    .catch((err) => { logger.error({ err: err.message }, `${command} failed`); process.exit(1); });
} else if (command) {
  console.error(`Unknown command: ${command}`);
  console.error(`Available: ${Object.keys(OPERATIONS).join(", ")}`);
  process.exit(1);
} else {
  showMenu();
}
