import { db } from "../../db/index";
import { StorageFactory } from "../../lib/storage/storage.factory";
import { notificationService } from "../notification/notification.service";
const ALLOWED_MEDIA_MIME_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
]);
const MAX_MEDIA_SIZE_BYTES = 5 * 1024 * 1024;

function validateReviewMediaFile(file: Express.Multer.File) {
    if (!ALLOWED_MEDIA_MIME_TYPES.has(file.mimetype)) {
        throw new Error(`Invalid file type: ${file.mimetype}. Only JPEG, PNG, WEBP, and GIF images are allowed`);
    }
    if (file.size > MAX_MEDIA_SIZE_BYTES) {
        throw new Error("File too large - maximum 5MB per file");
    }
}

export const reviewService = {
    async createReview(
        customerId: string,
        data: {
            orderId: string;
            productId: string;
            rating: number;
            comment?: string;
            mediaFiles?: Express.Multer.File[];
        }
    ) {
        const order = await db.order.findUnique({
            where: { id: data.orderId },
            include: { items: { select: { productId: true } } },
        });
        if (!order) throw new Error("Order not found");
        if (order.customerId !== customerId) throw new Error("Order not found");
        if (order.status !== "DELIVERED") throw new Error("Can only review delivered orders");

        const inOrder = order.items.some((i) => i.productId === data.productId);
        if (!inOrder) throw new Error("Product was not in this order");

        const existing = await db.review.findUnique({
            where: {
                orderId_productId_customerId: {
                    orderId: data.orderId,
                    productId: data.productId,
                    customerId,
                },
            },
        });
        if (existing) throw new Error("You have already reviewed this product for this order");

        if (data.rating < 1 || data.rating > 5) throw new Error("Rating must be between 1 and 5");

        let mediaUrls: string[] = [];
        if (data.mediaFiles?.length) {
            for (const file of data.mediaFiles) {
                validateReviewMediaFile(file);
            }
            const storage = StorageFactory.get();
            const uploads = await Promise.all(
                data.mediaFiles.map((file, i) =>
                    storage.upload({
                        key: `reviews/${data.orderId}/${data.productId}/${i}-${Date.now()}`,
                        buffer: file.buffer,
                        mimeType: file.mimetype,
                        size: file.size,
                    })
                )
            );
            mediaUrls = uploads.map((u) => u.url);
        }

        const product = await db.product.findUnique({
            where: { id: data.productId },
            select: { sellerId: true },
        });

        const review = await db.review.create({
            data: {
                orderId: data.orderId,
                productId: data.productId,
                customerId,
                sellerId: product?.sellerId ?? "",
                rating: data.rating,
                comment: data.comment,
                mediaUrls,
                isVerifiedPurchase: true,
                status: "PENDING",
            },
        });

        const owner = await db.sellerMember.findFirst({
            where: { sellerId: product?.sellerId, role: { name: "owner" }, isActive: true },
            select: { userId: true, user: { select: { email: true } } },
        });

        if (owner && product) {
            notificationService.notify({
                userId: owner.userId,
                email: owner.user.email,
                type: "REVIEW_RECEIVED",
                title: "New review received",
                message: `A customer left a ${data.rating}-star review on your product.`,
                channels: ["sse"],
                data: { reviewId: review.id, rating: data.rating, productId: data.productId },
            }).catch(() => null);
        }

        await db.auditLog.create({
            data: {
                sellerId: product?.sellerId,
                actorId: customerId,
                actorType: "customer",
                action: "REVIEW_CREATED",
                entityType: "review",
                entityId: review.id,
                metadata: { rating: data.rating, productId: data.productId },
            },
        });

        return review;
    },

    async replyToReview(sellerId: string, reviewId: string, reply: string) {
        const review = await db.review.findUnique({ where: { id: reviewId } });
        if (!review) throw new Error("Review not found");
        if (review.sellerId !== sellerId) throw new Error("Review not found");
        if (review.status !== "APPROVED") throw new Error("Can only reply to approved reviews");
        if (review.reply) throw new Error("Already replied to this review");

        return db.review.update({
            where: { id: reviewId },
            data: { reply, repliedAt: new Date() },
        });
    },

    async moderateReview(
        reviewId: string,
        actorId: string,
        action: "APPROVED" | "REJECTED"
    ) {
        const review = await db.review.findUnique({ where: { id: reviewId } });
        if (!review) throw new Error("Review not found");
        if (review.status !== "PENDING") throw new Error("Review already moderated");

        return db.review.update({
            where: { id: reviewId },
            data: { status: action, moderatedBy: actorId, moderatedAt: new Date() },
        });
    },

    async markHelpful(reviewId: string, userId: string) {
        const review = await db.review.findUnique({ where: { id: reviewId } });
        if (!review) throw new Error("Review not found");
        if (review.status !== "APPROVED") throw new Error("Review not available");
        if (review.customerId === userId) throw new Error("Cannot mark your own review as helpful");

        const existing = await db.reviewHelpful.findUnique({
            where: { reviewId_userId: { reviewId, userId } },
        });

        if (existing) {
            await db.reviewHelpful.delete({ where: { reviewId_userId: { reviewId, userId } } });
            return db.review.update({
                where: { id: reviewId },
                data: { helpfulCount: { decrement: 1 } },
            });
        }

        try {
            await db.reviewHelpful.create({ data: { reviewId, userId } });
        } catch (err: any) {
            if (err.code === "P2002") {
                return db.review.findUniqueOrThrow({ where: { id: reviewId } });
            }
            throw err;
        }
        return db.review.update({
            where: { id: reviewId },
            data: { helpfulCount: { increment: 1 } },
        });
    },

    async getProductReviews(
        productId: string,
        page = 1,
        limit = 20,
        rating?: number
    ) {
        const where = {
            productId,
            status: "APPROVED" as const,
            ...(rating && { rating }),
        };

        const [reviews, total, avgRating] = await Promise.all([
            db.review.findMany({
                where,
                select: {
                    id: true, rating: true, comment: true, mediaUrls: true,
                    helpfulCount: true, isVerifiedPurchase: true, reply: true,
                    repliedAt: true, createdAt: true,
                },
                orderBy: [{ helpfulCount: "desc" }, { createdAt: "desc" }],
                skip: (page - 1) * limit,
                take: limit,
            }),
            db.review.count({ where }),
            db.review.aggregate({
                where: { productId, status: "APPROVED" },
                _avg: { rating: true },
                _count: { rating: true },
            }),
        ]);

        const breakdown = await db.review.groupBy({
            by: ["rating"],
            where: { productId, status: "APPROVED" },
            _count: { rating: true },
        });

        return {
            reviews,
            total,
            page,
            limit,
            avgRating: avgRating._avg.rating ?? 0,
            totalRatings: avgRating._count.rating,
            breakdown: breakdown.reduce((acc, b) => {
                acc[b.rating] = b._count.rating;
                return acc;
            }, {} as Record<number, number>),
        };
    },

    async listPendingReviews(page = 1, limit = 20) {
        const cappedLimit = Math.min(limit, 100);
        const [data, total] = await Promise.all([
            db.review.findMany({
                where: { status: "PENDING" },
                select: {
                    id: true, rating: true, comment: true, mediaUrls: true,
                    isVerifiedPurchase: true, createdAt: true,
                    product: { select: { id: true, name: true } },
                },
                orderBy: { createdAt: "asc" },
                skip: (page - 1) * cappedLimit,
                take: cappedLimit,
            }),
            db.review.count({ where: { status: "PENDING" } }),
        ]);
        return { data, meta: { total, page, limit: cappedLimit, totalPages: Math.ceil(total / cappedLimit) || 1 } };
    },

    async getSellerReviews(sellerId: string, status?: string, page = 1, limit = 20) {
        const cappedLimit = Math.min(limit, 100);
        const where = {
            sellerId,
            ...(status && { status: status as any })
        };
        const [data, total] = await Promise.all([
            db.review.findMany({
                where,
                select: {
                    id: true, rating: true, comment: true, reply: true,
                    repliedAt: true, helpfulCount: true, status: true, createdAt: true,
                    product: { select: { id: true, name: true } },
                },
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * cappedLimit,
                take: cappedLimit,
            }),
            db.review.count({ where }),
        ]);
        return { data, meta: { total, page, limit: cappedLimit, totalPages: Math.ceil(total / cappedLimit) || 1 } };
    },
};