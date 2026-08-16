import { db } from "../../db";
import { generateDisplayId } from "../../lib/uid/uid.generator";

import { withTenantScope } from "../../middleware/tenant";
import { shopAccessService } from "./shop-access.service";
import { StorageFactory } from "../../lib/storage/storage.factory";
import { PincodeFactory } from "../../lib/location/pincode.factory";
import { logger } from "../../utils/logger";

async function resolvePickupCityState(
  pincode: string,
  city: string | undefined,
  state: string | undefined,
): Promise<{ city: string; state: string }> {
  if (city && state) return { city, state };

  try {
    const pincodeProvider = PincodeFactory.get();
    const pincodeDetails = await pincodeProvider.lookupByPincode(pincode);

    if (!city) city = pincodeDetails.city;
    if (!state) state = pincodeDetails.state;
  } catch (error: any) {
    logger.warn(
      { err: error.message, pincode },
      "Failed to auto-fill pickup city/state from pincode",
    );
  }

  if (!city || !state) {
    throw new Error(
      "Pickup city and state could not be determined from the provided pincode. Please provide them manually.",
    );
  }

  return { city, state };
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export async function resolveShopMediaUrls<
  T extends {
    logo?: string | null;
    logoKey?: string | null;
    banner?: string | null;
    bannerKey?: string | null;
  },
>(shop: T): Promise<T> {
  const storage = StorageFactory.get();
  const result = { ...shop };
  if (shop.logoKey) {
    result.logo = await storage.getSignedUrl({
      key: shop.logoKey,
      expiresIn: 3600,
    });
  }
  if (shop.bannerKey) {
    result.banner = await storage.getSignedUrl({
      key: shop.bannerKey,
      expiresIn: 3600,
    });
  }
  return result;
}

export const shopService = {
  async createShop(
    sellerId: string,
    actorId: string,
    data: {
      name: string;
      description?: string;
      category: string;
      logo?: string;
      logoKey?: string;
      bannerKey?: string;
      banner?: string;
      contactEmail: string;
      contactPhone: string;
      returnPolicy?: string;
      pickupStreet: string;
      pickupCity?: string;
      pickupState?: string;
      pickupPincode: string;
      latitude?: number;
      longitude?: number;
    },
  ) {
    const seller = await db.seller.findUnique({ where: { id: sellerId } });
    if (!seller) throw new Error("Seller not found");
    if (seller.status !== "APPROVED") throw new Error("Seller not approved");

    const { city: pickupCity, state: pickupState } =
      await resolvePickupCityState(
        data.pickupPincode,
        data.pickupCity,
        data.pickupState,
      );

    const baseSlug = generateSlug(data.name);
    const displayId = await generateDisplayId("shop");

    try {
      return await withTenantScope(async (tx) => {
        const slug = `${baseSlug}-${Date.now()}`;

        const newShop = await tx.shop.create({
          data: {
            sellerId,
            slug,
            displayId,
            status: "APPROVED",
            ...data,
            pickupCity,
            pickupState,
          },
        });

        await tx.auditLog.create({
          data: {
            sellerId,
            actorId,
            actorType: "seller",
            action: "SHOP_CREATED",
            entityType: "shop",
            entityId: newShop.id,
            metadata: { name: data.name },
          },
        });

        return newShop;
      });
    } catch (err: any) {
      if (err.code === "P2002") {
        throw new Error(
          "A shop with a conflicting slug already exists, please try again",
        );
      }
      throw err;
    }
  },

  async updateShop(
    sellerId: string,
    actorId: string,
    shopId: string,
    data: Partial<{
      name: string;
      description: string;
      category: string;
      logo: string;
      banner: string;
      logoKey?: string;
      bannerKey?: string;
      contactEmail: string;
      contactPhone: string;
      returnPolicy: string;
      pickupStreet: string;
      pickupCity: string;
      pickupState: string;
      pickupPincode: string;
      latitude: number;
      longitude: number;
    }>,
  ) {
    const updateData: any = { ...data };
    if (data.name) {
      updateData.slug = `${generateSlug(data.name)}-${Date.now()}`;
    }

    let oldLogoKey: string | null = null;
    let oldBannerKey: string | null = null;

    if (
      (data.pickupPincode && (!data.pickupCity || !data.pickupState)) ||
      data.logoKey ||
      data.bannerKey
    ) {
      const existing = await db.shop.findFirst({
        where: { id: shopId, sellerId },
        select: { pickupPincode: true, logoKey: true, bannerKey: true },
      });

      if (existing) {
        if (
          data.pickupPincode &&
          (!data.pickupCity || !data.pickupState) &&
          existing.pickupPincode !== data.pickupPincode
        ) {
          const { city, state } = await resolvePickupCityState(
            data.pickupPincode,
            data.pickupCity,
            data.pickupState,
          );
          updateData.pickupCity = city;
          updateData.pickupState = state;
        }

        if (data.logoKey && data.logoKey !== existing.logoKey)
          oldLogoKey = existing.logoKey;
        if (data.bannerKey && data.bannerKey !== existing.bannerKey)
          oldBannerKey = existing.bannerKey;
      }
    }

    let updated: any;
    try {
      updated = await withTenantScope(async (tx) => {
        const updateResult = await tx.shop.updateMany({
          where: { id: shopId, sellerId, status: { not: "REJECTED" } },
          data: updateData,
        });

        if (updateResult.count === 0) {
          const exists = await tx.shop.findFirst({
            where: { id: shopId, sellerId },
          });
          if (!exists) throw new Error("Shop not found");
          throw new Error("Cannot update rejected shop");
        }

        await tx.auditLog.create({
          data: {
            sellerId,
            actorId,
            actorType: "seller",
            action: "SHOP_UPDATED",
            entityType: "shop",
            entityId: shopId,
            metadata: data,
          },
        });

        return tx.shop.findUniqueOrThrow({ where: { id: shopId } });
      });
    } catch (err: any) {
      if (err.code === "P2002") {
        throw new Error(
          "A shop with a conflicting slug already exists, please try again",
        );
      }
      throw err;
    }

    if (oldLogoKey || oldBannerKey) {
      const storage = StorageFactory.get();
      await Promise.all(
        [oldLogoKey, oldBannerKey]
          .filter((key): key is string => !!key)
          .map((key) =>
            storage.delete({ key }).catch((err) => {
              logger.warn(
                { err: err?.message, key, shopId },
                "Failed to delete old shop media from storage",
              );
              return null;
            }),
          ),
      );
    }

    return updated;
  },

  async getShop(sellerId: string, userId: string, shopId: string) {
    await shopAccessService.assertShopAccess(sellerId, userId, shopId);

    const shop = await withTenantScope((tx) =>
      tx.shop.findFirst({
        where: { id: shopId, sellerId },
        include: {
          _count: { select: { products: true } },
        },
      }),
    );
    if (!shop) throw new Error("Shop not found");
    return resolveShopMediaUrls(shop);
  },

  async listShops(
    sellerId: string,
    userId: string,
    filters: {
      search?: string;
      status?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 20, 100);

    const accessibleShopIds = await shopAccessService.getAccessibleShopIds(
      sellerId,
      userId,
    );
    const where: any = { sellerId };

    if (accessibleShopIds !== null) where.id = { in: accessibleShopIds };

    if (filters.status) {
      const STATUS_REVERSE: Record<string, string> = {
        active: "APPROVED",
        pending: "PENDING",
        inactive: "REJECTED",
      };
      where.status =
        STATUS_REVERSE[filters.status] ?? filters.status.toUpperCase();
    }
    if (filters.search)
      where.name = { contains: filters.search, mode: "insensitive" };

    const { data, total } = await withTenantScope(async (tx) => {
      const data = await tx.shop.findMany({
        where,
        select: {
          id: true,
          displayId: true,
          name: true,
          slug: true,
          category: true,
          description: true,
          status: true,
          logo: true,
          logoKey: true,
          banner: true,
          bannerKey: true,
          createdAt: true,
          pickupCity: true,
          pickupState: true,
          _count: { select: { products: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      });
      const total = await tx.shop.count({ where });
      return { data, total };
    });

    const STATUS_MAP: Record<string, string> = {
      PENDING: "pending",
      APPROVED: "active",
      REJECTED: "inactive",
    };

    const withSignedUrls = await Promise.all(data.map(resolveShopMediaUrls));

    const mapped = withSignedUrls.map((s) => ({
      ...s,
      status: STATUS_MAP[s.status] ?? s.status.toLowerCase(),
    }));

    return {
      data: mapped,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  },

  async listAllShops(filters: {
    search?: string;
    status?: string;
    sellerId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 20, 100);

    const where: any = {};
    if (filters.sellerId) where.sellerId = filters.sellerId;
    if (filters.status) {
      const STATUS_REVERSE: Record<string, string> = {
        active: "APPROVED",
        pending: "PENDING",
        inactive: "REJECTED",
      };
      where.status =
        STATUS_REVERSE[filters.status] ?? filters.status.toUpperCase();
    }
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: "insensitive" } },
        { slug: { contains: filters.search, mode: "insensitive" } },
      ];
    }

    const { data, total } = await withTenantScope(async (tx) => {
      const data = await tx.shop.findMany({
        where,
        select: {
          id: true,
          displayId: true,
          name: true,
          slug: true,
          category: true,
          description: true,
          status: true,
          logo: true,
          logoKey: true,
          banner: true,
          bannerKey: true,
          createdAt: true,
          contactEmail: true,
          contactPhone: true,
          pickupCity: true,
          pickupState: true,
          seller: { select: { id: true, name: true, businessName: true } },
          _count: { select: { products: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      });
      const total = await tx.shop.count({ where });
      return { data, total };
    });

    const STATUS_MAP: Record<string, string> = {
      PENDING: "pending",
      APPROVED: "active",
      REJECTED: "inactive",
    };

    const withSignedUrls = await Promise.all(data.map(resolveShopMediaUrls));

    const mapped = withSignedUrls.map((s) => ({
      ...s,
      status: STATUS_MAP[s.status] ?? s.status.toLowerCase(),
    }));

    return {
      data: mapped,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  },

  async setAutoAssign(sellerId: string, shopId: string, enabled: boolean) {
    return withTenantScope(async (tx) => {
      const updateResult = await tx.shop.updateMany({
        where: { id: shopId, sellerId },
        data: { autoAssignEnabled: enabled },
      });
      if (updateResult.count === 0) throw new Error("Shop not found");
      return tx.shop.findUniqueOrThrow({ where: { id: shopId } });
    });
  },
};
