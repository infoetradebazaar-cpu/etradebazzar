import { db } from "../../db/index";
import { syncProductSearchIndexInBackground } from "../../lib/search/product-search-document";

type CategoryVariantAttribute = {
  id: string;
  label: string;
  type: "TEXT" | "NUMBER" | "ENUM" | "BOOLEAN";
};

async function findCategoryVariantAttribute(
  categoryId: string,
  optionName: string,
): Promise<CategoryVariantAttribute | null> {
  const definitions = await db.categoryAttribute.findMany({
    where: { categoryId, isVariant: true },
  });
  if (!definitions.length) return null;

  const match = definitions.find(
    (def) => def.label.toLowerCase() === optionName.toLowerCase(),
  );
  if (!match) {
    throw new Error(
      `Variant attribute "${optionName}" is not defined for this category`,
    );
  }
  return match;
}

async function resolveVariantValues(
  attribute: CategoryVariantAttribute,
  sellerId: string,
  values: string[],
): Promise<string[]> {
  if (attribute.type !== "ENUM") return values;

  const existing = await db.categoryAttributeOption.findMany({
    where: { categoryAttributeId: attribute.id },
  });
  const byValue = new Map(existing.map((o) => [o.value.toLowerCase(), o]));
  const byId = new Map(existing.map((o) => [o.id, o]));

  const resolved: string[] = [];
  const toCreate: string[] = [];

  for (const rawValue of values) {
    const match = byValue.get(rawValue.toLowerCase());
    if (!match) {
      toCreate.push(rawValue);
      resolved.push(rawValue);
      continue;
    }
    if (match.status === "REJECTED") {
      throw new Error(
        `Variant value "${rawValue}" for attribute "${attribute.label}" was rejected and can't be used`,
      );
    }
    if (match.status === "MERGED" && match.mergedIntoId) {
      const canonical = byId.get(match.mergedIntoId);
      resolved.push(canonical?.value ?? match.value);
      continue;
    }
    resolved.push(match.value);
  }

  if (toCreate.length) {
    await db.categoryAttributeOption.createMany({
      data: toCreate.map((value) => ({
        categoryAttributeId: attribute.id,
        value,
        status: "PENDING" as const,
        createdBySellerId: sellerId,
      })),
      skipDuplicates: true,
    });
  }

  return resolved;
}

function dedupeCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

export const productVariantService = {
  async createVariant(
    sellerId: string,
    productId: string,
    data: { name: string; values: string[] },
  ) {
    const product = await db.product.findFirst({
      where: { id: productId, sellerId },
    });
    if (!product) throw new Error("Product not found");
    if (product.status === "APPROVED" || product.status === "LIVE")
      throw new Error("Cannot modify approved product variants");

    const existing = await db.variantOption.findUnique({
      where: { productId_name: { productId, name: data.name } },
    });
    if (existing)
      throw new Error(`Variant option "${data.name}" already exists`);

    const categoryAttribute = await findCategoryVariantAttribute(
      product.categoryId,
      data.name,
    );
    const values = dedupeCaseInsensitive(
      categoryAttribute
        ? await resolveVariantValues(categoryAttribute, sellerId, data.values)
        : data.values,
    );

    return db.variantOption.create({
      data: {
        productId,
        name: data.name,
        values: {
          create: values.map((value) => ({ value })),
        },
      },
      include: { values: true },
    });
  },

  async addVariantValues(
    sellerId: string,
    productId: string,
    optionId: string,
    values: string[],
  ) {
    const product = await db.product.findFirst({
      where: { id: productId, sellerId },
    });
    if (!product) throw new Error("Product not found");

    const option = await db.variantOption.findFirst({
      where: { id: optionId, productId },
    });
    if (!option) throw new Error("Variant option not found");

    const categoryAttribute = await findCategoryVariantAttribute(
      product.categoryId,
      option.name,
    );
    const resolvedValues = dedupeCaseInsensitive(
      categoryAttribute
        ? await resolveVariantValues(categoryAttribute, sellerId, values)
        : values,
    );

    const existing = await db.variantOptionValue.findMany({
      where: { optionId },
    });
    const existingValues = new Set(existing.map((v) => v.value.toLowerCase()));
    const newValues = resolvedValues.filter((v) => !existingValues.has(v.toLowerCase()));

    if (!newValues.length) throw new Error("All values already exist");

    await db.variantOptionValue.createMany({
      data: newValues.map((value) => ({ optionId, value })),
    });

    return db.variantOption.findUnique({
      where: { id: optionId },
      include: { values: true },
    });
  },

  async deleteVariant(sellerId: string, productId: string, optionId: string) {
    const product = await db.product.findFirst({
      where: { id: productId, sellerId },
    });
    if (!product) throw new Error("Product not found");

    const option = await db.variantOption.findFirst({
      where: { id: optionId, productId },
    });
    if (!option) throw new Error("Variant option not found");

    const skuCount = await db.productSKU.count({ where: { productId } });
    if (skuCount > 0)
      throw new Error("Delete all SKUs before removing variant options");

    await db.variantOption.delete({ where: { id: optionId } });
    syncProductSearchIndexInBackground(productId);
  },

  async deleteVariantValue(
    sellerId: string,
    productId: string,
    optionId: string,
    valueId: string,
  ) {
    const product = await db.product.findFirst({
      where: { id: productId, sellerId },
    });
    if (!product) throw new Error("Product not found");

    const value = await db.variantOptionValue.findFirst({
      where: { id: valueId, optionId },
    });
    if (!value) throw new Error("Variant value not found");

    const skus = await db.productSKU.findMany({ where: { productId } });
    const inUse = skus.some((sku) => {
      const opts = sku.options as Record<string, string>;
      return Object.values(opts).includes(value.value);
    });
    if (inUse)
      throw new Error(
        "Variant value is used by existing SKUs  delete SKUs first",
      );

    await db.variantOptionValue.delete({ where: { id: valueId } });
    syncProductSearchIndexInBackground(productId);
  },

  async listVariants(productId: string) {
    return db.variantOption.findMany({
      where: { productId },
      include: { values: { orderBy: { value: "asc" } } },
      orderBy: { name: "asc" },
    });
  },

  async createSKU(
    sellerId: string,
    productId: string,
    data: {
      sku: string;
      price: number;
      stock: number;
      minQuantity?: number;
      options: Record<string, string>;
    },
  ) {
    const product = await db.product.findFirst({
      where: { id: productId, sellerId },
      include: { variants: { include: { values: true } } },
    });
    if (!product) throw new Error("Product not found");

    await validateSkuOptions(product.variants, data.options);

    const existing = await db.productSKU.findUnique({
      where: { sku: data.sku },
    });
    if (existing) throw new Error("SKU code already exists");

    const allSkus = await db.productSKU.findMany({ where: { productId } });
    const isDuplicate = allSkus.some((s) => {
      const opts = s.options as Record<string, string>;
      return (
        JSON.stringify(sortObject(opts)) ===
        JSON.stringify(sortObject(data.options))
      );
    });
    if (isDuplicate)
      throw new Error("A SKU with this option combination already exists");

    const created = await db.productSKU.create({
      data: {
        productId,
        sku: data.sku,
        price: data.price,
        stock: data.stock,
        minQuantity: data.minQuantity ?? 1,
        options: data.options,
      },
    });
    syncProductSearchIndexInBackground(productId);
    return created;
  },

  async updateSKU(
    sellerId: string,
    productId: string,
    skuId: string,
    data: Partial<{ price: number; stock: number; minQuantity: number }>,
  ) {
    const product = await db.product.findFirst({
      where: { id: productId, sellerId },
    });
    if (!product) throw new Error("Product not found");

    const sku = await db.productSKU.findFirst({
      where: { id: skuId, productId },
    });
    if (!sku) throw new Error("SKU not found");

    const updated = await db.productSKU.update({ where: { id: skuId }, data });
    syncProductSearchIndexInBackground(productId);
    return updated;
  },

  async deleteSKU(sellerId: string, productId: string, skuId: string) {
    const product = await db.product.findFirst({
      where: { id: productId, sellerId },
    });
    if (!product) throw new Error("Product not found");

    const sku = await db.productSKU.findFirst({
      where: { id: skuId, productId },
    });
    if (!sku) throw new Error("SKU not found");

    const inUse = await db.orderItem.findFirst({ where: { skuId } });
    if (inUse)
      throw new Error("SKU is referenced by existing orders  cannot delete");

    await db.productSKU.delete({ where: { id: skuId } });
    syncProductSearchIndexInBackground(productId);
  },

  async listSKUs(productId: string) {
    return db.productSKU.findMany({
      where: { productId },
      orderBy: { createdAt: "asc" },
    });
  },

  async getSKU(productId: string, skuId: string) {
    const sku = await db.productSKU.findFirst({
      where: { id: skuId, productId },
    });
    if (!sku) throw new Error("SKU not found");
    return sku;
  },

  async listPriceTiers(productId: string, skuId: string) {
    const sku = await db.productSKU.findFirst({ where: { id: skuId, productId } });
    if (!sku) throw new Error("SKU not found");
    return db.skuPriceTier.findMany({
      where: { skuId },
      orderBy: { minQty: "asc" },
      select: { id: true, skuId: true, minQty: true, price: true, createdAt: true, updatedAt: true },
    });
  },

  async listPriceTiersForSeller(sellerId: string, productId: string, skuId: string) {
    const product = await db.product.findFirst({ where: { id: productId, sellerId } });
    if (!product) throw new Error("Product not found");
    const sku = await db.productSKU.findFirst({ where: { id: skuId, productId } });
    if (!sku) throw new Error("SKU not found");
    return db.skuPriceTier.findMany({ where: { skuId }, orderBy: { minQty: "asc" } });
  },

  async createPriceTier(
    sellerId: string,
    productId: string,
    skuId: string,
    data: { minQty: number; price: number; hiddenFloorPrice?: number },
  ) {
    const product = await db.product.findFirst({ where: { id: productId, sellerId } });
    if (!product) throw new Error("Product not found");
    const sku = await db.productSKU.findFirst({ where: { id: skuId, productId } });
    if (!sku) throw new Error("SKU not found");

    try {
      return await db.skuPriceTier.create({
        data: {
          skuId,
          minQty: data.minQty,
          price: data.price,
          hiddenFloorPrice: data.hiddenFloorPrice,
        },
      });
    } catch (err: any) {
      if (err?.code === "P2002") throw new Error(`A tier at minQty=${data.minQty} already exists for this SKU`);
      throw translateTierTriggerError(err);
    }
  },

  async updatePriceTier(
    sellerId: string,
    productId: string,
    skuId: string,
    tierId: string,
    data: { minQty?: number; price?: number; hiddenFloorPrice?: number | null },
  ) {
    const product = await db.product.findFirst({ where: { id: productId, sellerId } });
    if (!product) throw new Error("Product not found");
    const sku = await db.productSKU.findFirst({ where: { id: skuId, productId } });
    if (!sku) throw new Error("SKU not found");
    const tier = await db.skuPriceTier.findFirst({ where: { id: tierId, skuId } });
    if (!tier) throw new Error("Price tier not found");

    try {
      return await db.skuPriceTier.update({ where: { id: tierId }, data });
    } catch (err: any) {
      if (err?.code === "P2002") throw new Error(`A tier at minQty=${data.minQty} already exists for this SKU`);
      throw translateTierTriggerError(err);
    }
  },

  async deletePriceTier(sellerId: string, productId: string, skuId: string, tierId: string) {
    const product = await db.product.findFirst({ where: { id: productId, sellerId } });
    if (!product) throw new Error("Product not found");
    const sku = await db.productSKU.findFirst({ where: { id: skuId, productId } });
    if (!sku) throw new Error("SKU not found");
    const tier = await db.skuPriceTier.findFirst({ where: { id: tierId, skuId } });
    if (!tier) throw new Error("Price tier not found");

    await db.skuPriceTier.delete({ where: { id: tierId } });
  },
};

const TIER_TRIGGER_ERROR_PREFIXES = [
  "SkuPriceTier.minQty must be >= 2",
  "Tier price (",
  "Tier hidden floor price (",
  "Tier hidden floor (",
  "Cannot set SKU price (",
];

function translateTierTriggerError(err: any): Error {
  const message = String(err?.message ?? "");
  const matched = TIER_TRIGGER_ERROR_PREFIXES.find((prefix) => message.includes(prefix));
  return matched ? new Error(message.slice(message.indexOf(matched))) : err;
}

type VariantWithValues = {
  name: string;
  values: { value: string }[];
};

async function validateSkuOptions(
  variants: VariantWithValues[],
  options: Record<string, string>,
): Promise<void> {
  if (!variants.length)
    throw new Error("Product has no variant options defined");

  const variantMap = new Map(
    variants.map((v) => [v.name, new Set(v.values.map((val) => val.value))]),
  );

  for (const [key, value] of Object.entries(options)) {
    const validValues = variantMap.get(key);
    if (!validValues) throw new Error(`Invalid variant option: "${key}"`);
    if (!validValues.has(value)) {
      throw new Error(`Invalid value "${value}" for option "${key}"`);
    }
  }

  for (const variantName of variantMap.keys()) {
    if (!(variantName in options)) {
      throw new Error(`Missing option "${variantName}" in SKU`);
    }
  }
}

function sortObject(obj: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)),
  );
}
