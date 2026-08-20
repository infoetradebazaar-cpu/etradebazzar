import { db } from "../../db/index";
import { invalidateAuthContext } from "../../middleware/auth";
import { getLocationFromIp } from "../../utils/geo";
import type { OrderStatus } from "../../../prisma/generated/client";
import { resolveKycDocumentUrls } from "./seller.service";
import { maskIdNumber } from "../../utils/mask";

function fmt(n: any): number {
    return n ? parseFloat(Number(n).toFixed(2)) : 0.00;
}

export const sellerProfileService = {
    async getProfile(sellerId: string) {
        const seller = await db.seller.findUnique({
            where: { id: sellerId },
            select: {
                id: true, name: true, email: true, phone: true, alternatePhone: true,
                profileImage: true, createdAt: true, updatedAt: true, status: true,
            },
        });
        if (!seller) throw new Error("Seller not found");
        return seller;
    },

    async updateProfile(
        sellerId: string,
        actorId: string,
        data: Partial<{ name: string; alternatePhone: string; profileImage: string }>,
        requestMeta: { ipAddress?: string; userAgent?: string }
    ) {
        const location = getLocationFromIp(requestMeta.ipAddress);

        const result = await db.$transaction(async (tx) => {
            const seller = await tx.seller.update({ where: { id: sellerId }, data });

            let ownerId: string | undefined;
            if (data.name) {
                const owner = await tx.sellerMember.findFirst({
                    where: { sellerId, role: { name: "owner" }, isActive: true },
                    select: { userId: true },
                });
                if (owner) {
                    ownerId = owner.userId;
                    await tx.user.update({ where: { id: ownerId }, data: { name: data.name } });
                }

                await tx.auditLog.create({
                    data: {
                        sellerId,
                        actorId,
                        actorType: "seller",
                        action: "SELLER_PROFILE_NAME_UPDATED",
                        entityType: "seller",
                        entityId: sellerId,
                        metadata: { newName: data.name, location } as any,
                        ipAddress: requestMeta.ipAddress,
                        userAgent: requestMeta.userAgent,
                    },
                });
            }

            return { seller, ownerId };
        });

        if (result.ownerId) {
            await invalidateAuthContext(result.ownerId);
        }
        return result.seller;
    },

    async getBusiness(sellerId: string) {
        const seller = await db.seller.findUnique({
            where: { id: sellerId },
            select: {
                businessName: true, businessType: true, businessLogo: true,
                businessDescription: true, industryCategory: true, yearOfEstablishment: true,
                street: true, city: true, state: true, pincode: true,
                pickupAddress: true, billingAddress: true, socialLinks: true,
                kyc: {
                    select: {
                        id: true, status: true,
                        panNumber: true, gstNumber: true, aadharNumber: true,
                        businessRegNumber: true, documents: true,
                        rejectedReason: true, verifiedAt: true, createdAt: true,
                        aadhaarStatus: true, aadhaarRejectedReason: true, aadhaarVerifiedAt: true,
                        govtIdType: true, govtIdNumber: true, govtIdStatus: true,
                        govtIdRejectedReason: true, govtIdVerifiedAt: true,
                        gstVerificationStatus: true, gstVerifiedAt: true,
                        panVerificationStatus: true, panVerifiedAt: true,
                    },
                },
            },
        });
        if (!seller) throw new Error("Seller not found");

        if (!seller.kyc) return seller;

        const kycWithUrls = await resolveKycDocumentUrls(seller.kyc);
        return {
            ...seller,
            kyc: {
                ...kycWithUrls,
                aadharNumber: maskIdNumber(seller.kyc.aadharNumber),
                govtIdNumber: seller.kyc.govtIdNumber
                    ? maskIdNumber(seller.kyc.govtIdNumber)
                    : seller.kyc.govtIdNumber,
            },
        };
    },

    async updateBusiness(
        sellerId: string,
        data: Partial<{
            businessName: string;
            businessLogo: string;
            businessDescription: string;
            industryCategory: string;
            yearOfEstablishment: number;
            pickupAddress: object;
            billingAddress: object;
            socialLinks: object;
        }>
    ) {

        return db.seller.update({
            where: { id: sellerId },
            data: data as any,
            select: {
                id: true, businessName: true, businessType: true, businessLogo: true,
                businessDescription: true, industryCategory: true, yearOfEstablishment: true,
                street: true, city: true, state: true, pincode: true,
                pickupAddress: true, billingAddress: true, socialLinks: true,
            },
        });
    },

    async getVerificationBadges(sellerId: string) {
        const seller = await db.seller.findUnique({
            where: { id: sellerId },
            select: {
                status: true,
                kyc: {
                    select: {
                        status: true, aadhaarStatus: true, govtIdStatus: true,
                    },
                },
            },
        });
        if (!seller) throw new Error("Seller not found");
        return {
            approvalStatus: seller.status,
            kycStatus: seller.kyc?.status ?? "PENDING",
            aadhaarStatus: seller.kyc?.aadhaarStatus ?? "PENDING",
            governmentIdStatus: seller.kyc?.govtIdStatus ?? "PENDING",
        };
    },

    //Shop statistics 
    async getShopStats(sellerId: string, shopId: string) {
        const shop = await db.shop.findFirst({ where: { id: shopId, sellerId } });
        if (!shop) throw new Error("Shop not found");

        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        const CONFIRMED_STATUSES: OrderStatus[] = [
            "CONFIRMED", "PACKED", "PROCESSING", "SHIPPED",
            "OUT_FOR_DELIVERY", "DELIVERED", "RETURNED",
        ];

        const [totalAgg, monthAgg, reviewAgg, assignedOrderCount, confirmedOrderCount] = await Promise.all([
            db.order.aggregate({
                where: { assignedShopId: shopId, status: "DELIVERED" },
                _sum: { finalAmount: true, totalAmount: true },
                _count: { id: true },
            }),
            db.order.aggregate({
                where: { assignedShopId: shopId, status: "DELIVERED", createdAt: { gte: monthStart } },
                _sum: { finalAmount: true, totalAmount: true },
                _count: { id: true },
            }),
            db.review.aggregate({
                where: { product: { shopId }, status: "APPROVED" },
                _avg: { rating: true },
            }),
            db.order.count({ where: { assignedShopId: shopId } }),
            db.order.count({ where: { assignedShopId: shopId, status: { in: CONFIRMED_STATUSES } } }),
        ]);

        return {
            totalRevenue: fmt(totalAgg._sum.finalAmount ?? totalAgg._sum.totalAmount),
            totalOrders: assignedOrderCount,
            averageRating: fmt(reviewAgg._avg.rating),
            responseRate: assignedOrderCount > 0
                ? fmt((confirmedOrderCount / assignedOrderCount) * 100)
                : 0.00,
            monthlyRevenue: fmt(monthAgg._sum.finalAmount ?? monthAgg._sum.totalAmount),
            monthlyOrders: monthAgg._count.id ?? 0,
        };
    },
};