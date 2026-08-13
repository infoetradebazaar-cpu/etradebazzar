import { db } from "../../db/index";
import { Prisma } from "../../../prisma/generated/client";

export const customizationOptionService = {
    async listForProduct(productId: string) {
        return db.customizationOptionGroup.findMany({
            where: { productId },
            include: { options: { orderBy: { sortOrder: "asc" } } },
            orderBy: { sortOrder: "asc" },
        });
    },

    async createGroup(
        sellerId: string,
        productId: string,
        data: { name: string; required?: boolean; sortOrder?: number },
    ) {
        const product = await db.product.findFirst({ where: { id: productId, sellerId } });
        if (!product) throw new Error("Product not found");

        try {
            return await db.customizationOptionGroup.create({
                data: {
                    productId,
                    name: data.name,
                    required: data.required ?? false,
                    sortOrder: data.sortOrder ?? 0,
                },
                include: { options: true },
            });
        } catch (err: any) {
            if (err?.code === "P2002") throw new Error(`Option group "${data.name}" already exists`);
            throw err;
        }
    },

    async updateGroup(
        sellerId: string,
        productId: string,
        groupId: string,
        data: { name?: string; required?: boolean; sortOrder?: number },
    ) {
        const product = await db.product.findFirst({ where: { id: productId, sellerId } });
        if (!product) throw new Error("Product not found");

        const group = await db.customizationOptionGroup.findFirst({ where: { id: groupId, productId } });
        if (!group) throw new Error("Option group not found");

        try {
            return await db.customizationOptionGroup.update({ where: { id: groupId }, data });
        } catch (err: any) {
            if (err?.code === "P2002") throw new Error(`Option group "${data.name}" already exists`);
            throw err;
        }
    },

    async deleteGroup(sellerId: string, productId: string, groupId: string) {
        const product = await db.product.findFirst({ where: { id: productId, sellerId } });
        if (!product) throw new Error("Product not found");

        const group = await db.customizationOptionGroup.findFirst({ where: { id: groupId, productId } });
        if (!group) throw new Error("Option group not found");

        await db.customizationOptionGroup.delete({ where: { id: groupId } });
        return { deleted: true };
    },

    async createOption(
        sellerId: string,
        productId: string,
        groupId: string,
        data: {
            label: string;
            type: "TEXT" | "NUMBER" | "COLOR" | "SELECT" | "IMAGE_UPLOAD";
            priceDelta?: number;
            sortOrder?: number;
            metadata?: Record<string, unknown>;
        },
    ) {
        const product = await db.product.findFirst({ where: { id: productId, sellerId } });
        if (!product) throw new Error("Product not found");

        const group = await db.customizationOptionGroup.findFirst({ where: { id: groupId, productId } });
        if (!group) throw new Error("Option group not found");

        try {
            return await db.customizationOption.create({
                data: {
                    groupId,
                    label: data.label,
                    type: data.type,
                    priceDelta: data.priceDelta ?? 0,
                    sortOrder: data.sortOrder ?? 0,
                    metadata: data.metadata as Prisma.InputJsonValue | undefined,
                },
            });
        } catch (err: any) {
            if (err?.code === "P2002") throw new Error(`Option "${data.label}" already exists in this group`);
            throw err;
        }
    },

    async updateOption(
        sellerId: string,
        productId: string,
        groupId: string,
        optionId: string,
        data: {
            label?: string;
            type?: "TEXT" | "NUMBER" | "COLOR" | "SELECT" | "IMAGE_UPLOAD";
            priceDelta?: number;
            sortOrder?: number;
            metadata?: Record<string, unknown>;
        },
    ) {
        const product = await db.product.findFirst({ where: { id: productId, sellerId } });
        if (!product) throw new Error("Product not found");

        const group = await db.customizationOptionGroup.findFirst({ where: { id: groupId, productId } });
        if (!group) throw new Error("Option group not found");

        const option = await db.customizationOption.findFirst({ where: { id: optionId, groupId } });
        if (!option) throw new Error("Option not found");

        try {
            return await db.customizationOption.update({
                where: { id: optionId },
                data: {
                    label: data.label,
                    type: data.type,
                    priceDelta: data.priceDelta,
                    sortOrder: data.sortOrder,
                    metadata: data.metadata as Prisma.InputJsonValue | undefined,
                },
            });
        } catch (err: any) {
            if (err?.code === "P2002") throw new Error(`Option "${data.label}" already exists in this group`);
            throw err;
        }
    },

    async deleteOption(sellerId: string, productId: string, groupId: string, optionId: string) {
        const product = await db.product.findFirst({ where: { id: productId, sellerId } });
        if (!product) throw new Error("Product not found");

        const group = await db.customizationOptionGroup.findFirst({ where: { id: groupId, productId } });
        if (!group) throw new Error("Option group not found");

        const option = await db.customizationOption.findFirst({ where: { id: optionId, groupId } });
        if (!option) throw new Error("Option not found");

        await db.customizationOption.delete({ where: { id: optionId } });
        return { deleted: true };
    },
};
