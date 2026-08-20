import { db } from "../../db/index";
import { redis, RedisKeys } from "../../db/redis";
import { encrypt, decrypt } from "../../utils/encryption";
import { notificationService } from "../notification/notification.service";
import {
  validateAccountNumber,
  lookupIfsc,
} from "../../lib/bank/bank.validator";
import { getBankBrand, type BankBrand } from "../../lib/bank/bank.registry";
import { assignDefaultRolePermissions } from "../../lib/permission/permission.service";
import { isPlatformPermissionKey } from "../../lib/permission/permission.constants";
import { verifyGstAtRegistration, verifyPanAtRegistration } from "./registration-verification";
import { PincodeFactory } from "../../lib/location/pincode.factory";
import { logger } from "../../utils/logger";
import bcrypt from "bcryptjs";
import { StorageFactory } from "../../lib/storage/storage.factory";
import { BankVerificationFactory } from "../../lib/bank-verification/bank-verification.factory";
import { computeNameMatchScore, NAME_MATCH_THRESHOLD } from "../../lib/bank-verification/name-match";
import { maskAccountNumber } from "../../utils/mask";
import { config } from "../../../config/config";
import { EmailFactory } from "../../lib/notifications/email/email.factory";

const DEFAULT_SELLER_ROLES = ["owner", "manager", "staff", "shop"];

async function getSellerOwner(sellerId: string) {
  return db.sellerMember.findFirst({
    where: { sellerId, role: { name: "owner" } },
    select: { userId: true, user: { select: { email: true } } },
  });
}

function extractStorageKey(value: string): string {
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const url = new URL(value);
    return decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    return value;
  }
}

async function runBankVerification(
  seller: { name: string; email: string; phone: string },
  data: { accountHolderName: string; accountNumber: string; ifscCode: string },
): Promise<{
  verificationStatus: "VERIFIED" | "NAME_MISMATCH";
  verifiedAccountHolderName: string | null;
  verifiedAt: Date;
  verificationProvider: string;
  nameMatchScore: number | null;
  fundAccountId: string | null;
}> {
  const providerKey = process.env["BANK_VERIFICATION_PROVIDER"] ?? "sandbox";
  const provider = await BankVerificationFactory.get();

  const result = await provider.verifyBankAccount({
    accountHolderName: data.accountHolderName,
    accountNumber: data.accountNumber,
    ifscCode: data.ifscCode,
    contactName: seller.name,
    contactEmail: seller.email,
    contactPhone: seller.phone,
  });

  if (result.outcome === "FAILED") {
    throw new Error(
      `Bank account verification failed: ${result.failureReason ?? "account could not be verified"}`
    );
  }

  return {
    verificationStatus: result.outcome,
    verifiedAccountHolderName: result.verifiedAccountHolderName,
    verifiedAt: new Date(),
    verificationProvider: providerKey,
    nameMatchScore: result.nameMatchScore,
    fundAccountId: result.fundAccountId,
  };
}

function toClientBankDetail<
  T extends {
    accountNumber: string;
    verificationStatus: string;
    fundAccountId?: string | null;
    ifscCode: string;
    bankName: string;
  },
>(detail: T): Omit<T, "fundAccountId"> & { isVerified: boolean; bankBrand: BankBrand } {
  const { fundAccountId: _fundAccountId, ...rest } = detail;
  return {
    ...rest,
    accountNumber: decrypt(detail.accountNumber),
    isVerified: detail.verificationStatus === "VERIFIED",
    bankBrand: getBankBrand(detail.ifscCode, detail.bankName),
  };
}

export async function resolveKycDocumentUrls(kyc: { documents: string[] } | null) {
  if (!kyc || !kyc.documents?.length) return kyc;
  const storage = StorageFactory.get();
  const signedDocuments = await Promise.all(
    kyc.documents.map((doc) =>
      storage.getSignedUrl({
        key: extractStorageKey(doc),
        expiresIn: 3600,
        responseContentDisposition: "inline",
      }),
    ),
  );
  return { ...kyc, documents: signedDocuments };
}

async function resolveAddressCityState(address: {
  street: string; city?: string; state?: string; pincode: string;
}): Promise<{ street: string; city: string; state: string; pincode: string }> {
  let city = address.city;
  let state = address.state;

  if ((!city || !state) && address.pincode) {
    try {
      const pincodeProvider = PincodeFactory.get();
      const pincodeDetails = await pincodeProvider.lookupByPincode(address.pincode);

      if (!city) city = pincodeDetails.city;
      if (!state) state = pincodeDetails.state;
    } catch (error: any) {
      logger.warn({ err: error.message, pincode: address.pincode }, "Failed to auto-fill city/state from pincode");
    }
  }

  if (!city || !state) {
    throw new Error("City and state could not be determined from the provided pincode. Please provide them manually.");
  }

  return { street: address.street, city, state, pincode: address.pincode };
}

export const sellerService = {
  async register(data: {
    name: string;
    email: string;
    password: string;
    phone: string;
    businessName: string;
    businessType: "INDIVIDUAL" | "COMPANY" | "PARTNERSHIP";
    address: { street: string; city?: string; state?: string; pincode: string };
    gstin?: string;
    pan?: string;
  }) {
    const existing = await db.user.findUnique({ where: { email: data.email } });
    if (existing) throw new Error("Email already registered");

    const address = await resolveAddressCityState(data.address);
    const hashedPassword = await bcrypt.hash(data.password, 12);

    const registered = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name: data.name, email: data.email, password: hashedPassword },
        select: {
          id: true,
          name: true,
          email: true,
          isActive: true,
          createdAt: true,
        },
      });

      const seller = await tx.seller.create({
        data: {
          name: data.name,
          email: data.email,
          phone: data.phone,
          businessName: data.businessName,
          businessType: data.businessType,
          street: address.street,
          city: address.city,
          state: address.state,
          pincode: address.pincode,
          status: "PENDING",
        },
      });

      const roles = await Promise.all(
        DEFAULT_SELLER_ROLES.map((name) =>
          tx.sellerRole.create({ data: { sellerId: seller.id, name } }),
        ),
      );

      await assignDefaultRolePermissions(tx, roles);

      const ownerRole = roles.find((r) => r.name === "owner")!;

      await tx.sellerMember.create({
        data: { userId: user.id, sellerId: seller.id, roleId: ownerRole.id },
      });

      await tx.auditLog.create({
        data: {
          sellerId: seller.id,
          actorId: user.id,
          actorType: "seller",
          action: "SELLER_REGISTERED",
          entityType: "seller",
          entityId: seller.id,
        },
      });

      return { user, seller };
    });
    const kycUpdate: Record<string, any> = {};

    if (data.gstin) {
      const gstResult = await verifyGstAtRegistration(data.gstin);
      kycUpdate.gstin = data.gstin;
      kycUpdate.gstVerificationStatus = gstResult.status;
      kycUpdate.gstVerifiedAt = gstResult.status === "VERIFIED" ? new Date() : null;
      kycUpdate.gstVerificationMeta = gstResult.raw ?? { failureReason: gstResult.failureReason };
    }

    if (data.pan) {
      const panResult = await verifyPanAtRegistration(data.pan);
      kycUpdate.pan = data.pan;
      kycUpdate.panVerificationStatus = panResult.status;
      kycUpdate.panVerifiedAt = panResult.status === "VERIFIED" ? new Date() : null;
      kycUpdate.panVerificationMeta = panResult.raw ?? { failureReason: panResult.failureReason };
    }

    if (Object.keys(kycUpdate).length === 0) {
      return registered;
    }

    const updatedSeller = await db.seller.update({ where: { id: registered.seller.id }, data: kycUpdate });
    return { user: registered.user, seller: updatedSeller };
  },

  async completeKyc(
    sellerId: string,
    data: {
      aadharNumber: string;
      panNumber: string;
      gstNumber?: string;
      businessRegNumber?: string;
      documents?: string[];
      govtIdType?: string;
      govtIdNumber?: string;
    },
  ) {
    const existing = await db.sellerKyc.findUnique({ where: { sellerId } });
    if (existing) throw new Error("KYC already submitted");

    return db.sellerKyc.create({
      data: {
        sellerId,
        aadharNumber: encrypt(data.aadharNumber),
        panNumber: encrypt(data.panNumber),
        gstNumber: data.gstNumber,
        businessRegNumber: data.businessRegNumber,
        documents: data.documents ?? [],
        govtIdType: data.govtIdType,
        govtIdNumber: data.govtIdNumber
          ? encrypt(data.govtIdNumber)
          : undefined,
      },
    });
  },

  async verifyIfsc(ifscCode: string) {
    return lookupIfsc(ifscCode);
  },

  async addBankDetail(
    sellerId: string,
    data: {
      accountHolderName: string;
      accountNumber: string;
      ifscCode: string;
      bankName: string;
    },
  ) {
    const existing = await db.sellerBankDetail.findUnique({
      where: { sellerId },
    });
    if (existing) throw new Error("Bank detail already added");

    const accountCheck = validateAccountNumber(data.accountNumber);
    if (!accountCheck.valid) throw new Error(accountCheck.error);

    const ifscResult = await lookupIfsc(data.ifscCode);
    if (!ifscResult.verified) throw new Error(ifscResult.message);

    const seller = await db.seller.findUnique({
      where: { id: sellerId },
      select: { name: true, email: true, phone: true },
    });
    if (!seller) throw new Error("Seller not found");

    const verification = await runBankVerification(seller, data);

    const created = await db.sellerBankDetail.create({
      data: {
        sellerId,
        accountHolderName: data.accountHolderName,
        accountNumber: encrypt(data.accountNumber),
        ifscCode: data.ifscCode,
        bankName: data.bankName || ifscResult.bankName || "",
        ...verification,
      },
    });

    return toClientBankDetail(created);
  },

  async updateBankDetail(
    sellerId: string,
    data: Partial<{
      accountHolderName: string;
      accountNumber: string;
      ifscCode: string;
      bankName: string;
    }>,
  ) {
    const existing = await db.sellerBankDetail.findUnique({ where: { sellerId } });
    if (!existing) throw new Error("Bank detail not found");

    const existingAccountNumber = decrypt(existing.accountNumber);
    const nextAccountNumber = data.accountNumber ?? existingAccountNumber;
    const nextIfscCode = data.ifscCode ?? existing.ifscCode;
    const nextAccountHolderName = data.accountHolderName ?? existing.accountHolderName;

    const accountNumberChanging = nextAccountNumber !== existingAccountNumber;
    const ifscChanging = nextIfscCode !== existing.ifscCode;

    const updateData: any = {};
    if (data.accountHolderName !== undefined) updateData.accountHolderName = data.accountHolderName;
    if (data.bankName !== undefined) updateData.bankName = data.bankName;

    if (accountNumberChanging || ifscChanging) {
      const accountCheck = validateAccountNumber(nextAccountNumber);
      if (!accountCheck.valid) throw new Error(accountCheck.error);

      const ifscResult = await lookupIfsc(nextIfscCode);
      if (!ifscResult.verified) throw new Error(ifscResult.message);

      const seller = await db.seller.findUnique({
        where: { id: sellerId },
        select: { name: true, email: true, phone: true },
      });
      if (!seller) throw new Error("Seller not found");

      if (existing.fundAccountId) {
        try {
          const provider = await BankVerificationFactory.get();
          await provider.deactivateFundAccount(existing.fundAccountId);
        } catch (error: any) {
          logger.warn(
            { err: error.message, sellerId, fundAccountId: existing.fundAccountId },
            "Failed to deactivate previous bank verification fund account",
          );
        }
      }

      const verification = await runBankVerification(seller, {
        accountHolderName: nextAccountHolderName,
        accountNumber: nextAccountNumber,
        ifscCode: nextIfscCode,
      });

      updateData.accountNumber = encrypt(nextAccountNumber);
      updateData.ifscCode = nextIfscCode;
      if (data.bankName === undefined) updateData.bankName = ifscResult.bankName || existing.bankName;
      Object.assign(updateData, verification);
    } else if (data.accountHolderName !== undefined && data.accountHolderName !== existing.accountHolderName) {
      // Only the submitted name changed, not the account/IFSC - re-check the
      // match locally against the already-verified bank name instead of
      // paying for another ₹1 penny-drop.
      if (existing.verifiedAccountHolderName) {
        const score = computeNameMatchScore(data.accountHolderName, existing.verifiedAccountHolderName);
        updateData.nameMatchScore = score;
        updateData.verificationStatus = score >= NAME_MATCH_THRESHOLD ? "VERIFIED" : "NAME_MISMATCH";
      }
    }

    const updated = await db.sellerBankDetail.update({ where: { sellerId }, data: updateData });
    return toClientBankDetail(updated);
  },

  async getBankDetail(sellerId: string) {
    const detail = await db.sellerBankDetail.findUnique({
      where: { sellerId },
    });
    if (!detail) return null;
    return toClientBankDetail(detail);
  },

  async inviteSeller(actorId: string, email: string) {
    const existing = await db.seller.findUnique({ where: { email } });
    if (existing) throw new Error("Seller with this email already exists");
    const existingInvite = await db.sellerInvite.findFirst({
      where: { email, status: "PENDING" },
    });
    if (existingInvite) throw new Error("Invite already pending for this email");

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const invite = await db.sellerInvite.create({ data: { email, expiresAt } });

    await db.auditLog.create({
      data: {
        actorId,
        actorType: "platform",
        action: "SELLER_INVITED",
        entityType: "seller_invite",
        entityId: invite.id,
        metadata: { email },
      },
    });

    return invite;
  },

  async acceptInvite(
    token: string,
    data: {
      name: string;
      password: string;
      phone: string;
      businessName: string;
      businessType: "INDIVIDUAL" | "COMPANY" | "PARTNERSHIP";
      address: { street: string; city?: string; state?: string; pincode: string };
    },
  ) {
    const invite = await db.sellerInvite.findUnique({ where: { token } });
    if (!invite) throw new Error("Invalid invite token");
    if (invite.status !== "PENDING") throw new Error("Invite already used");
    if (invite.expiresAt < new Date()) {
      await db.sellerInvite.update({
        where: { token },
        data: { status: "EXPIRED" },
      });
      throw new Error("Invite expired");
    }

    const address = await resolveAddressCityState(data.address);
    const hashedPassword = await bcrypt.hash(data.password, 12);

    return db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: data.name,
          email: invite.email,
          password: hashedPassword,
        },
        select: {
          id: true,
          name: true,
          email: true,
          isActive: true,
          createdAt: true,
        },
      });

      const seller = await tx.seller.create({
        data: {
          name: data.name,
          email: invite.email,
          phone: data.phone,
          businessName: data.businessName,
          businessType: data.businessType,
          street: address.street,
          city: address.city,
          state: address.state,
          pincode: address.pincode,
          invitedBy: invite.id,
        },
      });

      const roles = await Promise.all(
        DEFAULT_SELLER_ROLES.map((name) =>
          tx.sellerRole.create({ data: { sellerId: seller.id, name } }),
        ),
      );

      await assignDefaultRolePermissions(tx, roles);

      const ownerRole = roles.find((r) => r.name === "owner")!;
      await tx.sellerMember.create({
        data: { userId: user.id, sellerId: seller.id, roleId: ownerRole.id },
      });

      await tx.sellerInvite.update({
        where: { token },
        data: { status: "ACCEPTED", sellerId: seller.id },
      });

      await tx.auditLog.create({
        data: {
          sellerId: seller.id,
          actorId: user.id,
          actorType: "seller",
          action: "INVITE_ACCEPTED",
          entityType: "seller",
          entityId: seller.id,
        },
      });

      return { user, seller };
    });
  },

  async approveSeller(sellerId: string, actorId: string) {
    const seller = await db.seller.findUnique({ where: { id: sellerId } });
    if (!seller) throw new Error("Seller not found");
    if (seller.status !== "PENDING") throw new Error("Seller is not pending");

    const [updated, owner] = await Promise.all([
      db.seller.update({
        where: { id: sellerId },
        data: { status: "APPROVED" },
      }),
      getSellerOwner(sellerId),
    ]);

    await db.auditLog.create({
      data: {
        sellerId,
        actorId,
        actorType: "platform",
        action: "SELLER_APPROVED",
        entityType: "seller",
        entityId: sellerId,
      },
    });

    await redis.del(RedisKeys.sellerStatus(sellerId));

    // Fire-and-forget  don't let notification failure break the response
    if (owner) {
      notificationService
        .sellerApproved({
          userId: owner.userId,
          email: seller.email,
          sellerName: seller.name,
          businessName: seller.businessName,
        })
        .catch(() => null);
    }

    return updated;
  },

  async rejectSeller(sellerId: string, actorId: string, reason: string) {
    const seller = await db.seller.findUnique({ where: { id: sellerId } });
    if (!seller) throw new Error("Seller not found");
    if (seller.status !== "PENDING") throw new Error("Seller is not pending");

    const [updated, owner] = await Promise.all([
      db.seller.update({
        where: { id: sellerId },
        data: { status: "REJECTED" },
      }),
      getSellerOwner(sellerId),
    ]);

    await db.auditLog.create({
      data: {
        sellerId,
        actorId,
        actorType: "platform",
        action: "SELLER_REJECTED",
        entityType: "seller",
        entityId: sellerId,
        metadata: { reason },
      },
    });

    await redis.del(RedisKeys.sellerStatus(sellerId));

    if (owner) {
      notificationService
        .sellerRejected({
          userId: owner.userId,
          email: seller.email,
          sellerName: seller.name,
          businessName: seller.businessName,
          reason,
        })
        .catch(() => null);
    }

    return updated;
  },

  async suspendSeller(sellerId: string, actorId: string, reason: string) {
    const seller = await db.seller.findUnique({ where: { id: sellerId } });
    if (!seller) throw new Error("Seller not found");
    if (seller.status === "SUSPENDED")
      throw new Error("Seller already suspended");

    const updated = await db.seller.update({
      where: { id: sellerId },
      data: {
        status: "SUSPENDED",
        suspendedAt: new Date(),
        suspendedBy: actorId,
      },
    });

    await db.auditLog.create({
      data: {
        sellerId,
        actorId,
        actorType: "platform",
        action: "SELLER_SUSPENDED",
        entityType: "seller",
        entityId: sellerId,
        metadata: { reason },
      },
    });

    await redis.del(RedisKeys.sellerStatus(sellerId));

    return updated;
  },

  async reactivateSeller(sellerId: string, actorId: string) {
    const seller = await db.seller.findUnique({ where: { id: sellerId } });
    if (!seller) throw new Error("Seller not found");
    if (seller.status !== "SUSPENDED")
      throw new Error("Seller is not suspended");

    const updated = await db.seller.update({
      where: { id: sellerId },
      data: {
        status: "APPROVED",
        suspendedAt: null,
        suspendedBy: null,
      },
    });

    await db.auditLog.create({
      data: {
        sellerId,
        actorId,
        actorType: "platform",
        action: "SELLER_REACTIVATED",
        entityType: "seller",
        entityId: sellerId,
      },
    });

    await redis.del(RedisKeys.sellerStatus(sellerId));

    return updated;
  },

  async listMembers(
    sellerId: string,
    filters: { search?: string; role?: string; page?: number; limit?: number },
  ) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;

    const where: any = { sellerId };
    if (filters.role) where.role = { name: filters.role };
    if (filters.search) {
      where.user = {
        OR: [
          { name: { contains: filters.search, mode: "insensitive" } },
          { email: { contains: filters.search, mode: "insensitive" } },
        ],
      };
    }

    const [data, total] = await Promise.all([
      db.sellerMember.findMany({
        where,
        select: {
          id: true,
          isActive: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true } },
          role: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.sellerMember.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  },

  async addMember(
    sellerId: string,
    actorId: string,
    data: { email: string; roleId: string },
  ) {
    const user = await db.user.findUnique({ where: { email: data.email } });
    if (!user) throw new Error("User not found");

    const role = await db.sellerRole.findFirst({
      where: { id: data.roleId, sellerId },
    });
    if (!role) throw new Error("Role not found");

    const existing = await db.sellerMember.findUnique({
      where: { userId_sellerId: { userId: user.id, sellerId } },
    });
    if (existing) throw new Error("User already a member");

    const member = await db.sellerMember.create({
      data: { userId: user.id, sellerId, roleId: data.roleId },
    });

    await db.auditLog.create({
      data: {
        sellerId,
        actorId,
        actorType: "seller",
        action: "MEMBER_ADDED",
        entityType: "seller_member",
        entityId: member.id,
        metadata: { email: data.email, roleId: data.roleId },
      },
    });

    return member;
  },

  async updateMemberRole(
    sellerId: string,
    actorId: string,
    memberId: string,
    roleId: string,
  ) {
    const member = await db.sellerMember.findFirst({
      where: { id: memberId, sellerId },
    });
    if (!member) throw new Error("Member not found");

    const role = await db.sellerRole.findFirst({
      where: { id: roleId, sellerId },
    });
    if (!role) throw new Error("Role not found");

    const updated = await db.sellerMember.update({
      where: { id: memberId },
      data: { roleId },
    });

    await redis.del(RedisKeys.userRoles(member.userId, sellerId));
    await redis.del(RedisKeys.userPermissions(member.userId, sellerId));

    await db.auditLog.create({
      data: {
        sellerId,
        actorId,
        actorType: "seller",
        action: "MEMBER_ROLE_UPDATED",
        entityType: "seller_member",
        entityId: memberId,
        metadata: { roleId },
      },
    });

    return updated;
  },

  async listPendingSellers() {
    return db.seller.findMany({
      where: { status: "PENDING" },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        businessName: true,
        businessType: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
  },

  async listAllSellers(status?: string) {
    const where = status
      ? {
        status: status.toUpperCase() as
          | "PENDING"
          | "APPROVED"
          | "REJECTED"
          | "SUSPENDED",
      }
      : {};
    return db.seller.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        businessName: true,
        businessType: true,
        status: true,
        createdAt: true,
        kyc: { select: { status: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  async getSellerById(sellerId: string) {
    const seller = await db.seller.findUnique({
      where: { id: sellerId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        businessName: true,
        businessType: true,
        street: true,
        city: true,
        state: true,
        pincode: true,
        status: true,
        createdAt: true,
        gstin: true,
        pan: true,
        gstVerificationStatus: true,
        gstVerifiedAt: true,
        gstVerificationMeta: true,
        panVerificationStatus: true,
        panVerifiedAt: true,
        panVerificationMeta: true,
        kyc: {
          select: {
            id: true,
            status: true,
            gstNumber: true,
            businessRegNumber: true,
            documents: true,
            govtIdType: true,
            aadhaarStatus: true,
            govtIdStatus: true,
            rejectedReason: true,
            verifiedAt: true,
            createdAt: true,
          },
        },
        bankDetail: {
          select: {
            accountHolderName: true,
            accountNumber: true,
            ifscCode: true,
            bankName: true,
            verificationStatus: true,
            verifiedAccountHolderName: true,
            verifiedAt: true,
            verificationProvider: true,
            nameMatchScore: true,
          },
        },
      },
    });

    if (!seller) return null;

    return {
      ...seller,
      kyc: await resolveKycDocumentUrls(seller.kyc),
      bankDetail: seller.bankDetail
        ? { ...seller.bankDetail, accountNumber: maskAccountNumber(decrypt(seller.bankDetail.accountNumber)) }
        : null,
    };
  },

  async reverifyBankDetail(sellerId: string, actorId: string) {
    const existing = await db.sellerBankDetail.findUnique({ where: { sellerId } });
    if (!existing) throw new Error("Bank detail not found");

    const seller = await db.seller.findUnique({
      where: { id: sellerId },
      select: { name: true, email: true, phone: true },
    });
    if (!seller) throw new Error("Seller not found");

    if (existing.fundAccountId) {
      try {
        const provider = await BankVerificationFactory.get();
        await provider.deactivateFundAccount(existing.fundAccountId);
      } catch (error: any) {
        logger.warn(
          { err: error.message, sellerId, fundAccountId: existing.fundAccountId },
          "Failed to deactivate previous bank verification fund account",
        );
      }
    }

    const verification = await runBankVerification(seller, {
      accountHolderName: existing.accountHolderName,
      accountNumber: decrypt(existing.accountNumber),
      ifscCode: existing.ifscCode,
    });

    const updated = await db.sellerBankDetail.update({
      where: { sellerId },
      data: verification,
    });

    await db.auditLog.create({
      data: {
        sellerId,
        actorId,
        actorType: "platform",
        action: "BANK_DETAIL_REVERIFIED",
        entityType: "seller_bank_detail",
        entityId: existing.id,
        metadata: { verificationStatus: verification.verificationStatus },
      },
    });

    return updated;
  },

  async overrideBankVerification(
    sellerId: string,
    actorId: string,
    data: { verificationStatus: "VERIFIED" | "NAME_MISMATCH" | "FAILED"; reason: string },
  ) {
    const existing = await db.sellerBankDetail.findUnique({ where: { sellerId } });
    if (!existing) throw new Error("Bank detail not found");

    const updated = await db.sellerBankDetail.update({
      where: { sellerId },
      data: {
        verificationStatus: data.verificationStatus,
        verificationProvider: "manual_override",
        verifiedAt: new Date(),
      },
    });

    await db.auditLog.create({
      data: {
        sellerId,
        actorId,
        actorType: "platform",
        action: "BANK_VERIFICATION_OVERRIDDEN",
        entityType: "seller_bank_detail",
        entityId: existing.id,
        metadata: { verificationStatus: data.verificationStatus, reason: data.reason },
      },
    });

    return updated;
  },

  async reverifyGstPan(sellerId: string, actorId: string) {
    const seller = await db.seller.findUnique({ where: { id: sellerId } });
    if (!seller) throw new Error("Seller not found");
    if (!seller.gstin && !seller.pan) {
      throw new Error("No GSTIN or PAN on file to reverify");
    }

    const update: Record<string, any> = {};

    if (seller.gstin) {
      const gstResult = await verifyGstAtRegistration(seller.gstin);
      update.gstVerificationStatus = gstResult.status;
      update.gstVerifiedAt = gstResult.status === "VERIFIED" ? new Date() : null;
      update.gstVerificationMeta = gstResult.raw ?? { failureReason: gstResult.failureReason };
    }

    if (seller.pan) {
      const panResult = await verifyPanAtRegistration(seller.pan);
      update.panVerificationStatus = panResult.status;
      update.panVerifiedAt = panResult.status === "VERIFIED" ? new Date() : null;
      update.panVerificationMeta = panResult.raw ?? { failureReason: panResult.failureReason };
    }

    const updated = await db.seller.update({ where: { id: sellerId }, data: update });

    await db.auditLog.create({
      data: {
        sellerId,
        actorId,
        actorType: "platform",
        action: "SELLER_GST_PAN_REVERIFIED",
        entityType: "seller",
        entityId: sellerId,
        metadata: {
          gstVerificationStatus: update.gstVerificationStatus,
          panVerificationStatus: update.panVerificationStatus,
        },
      },
    });

    return updated;
  },

  async overrideGstPanVerification(
    sellerId: string,
    actorId: string,
    data: { field: "gst" | "pan"; status: "VERIFIED" | "FAILED"; reason: string },
  ) {
    const seller = await db.seller.findUnique({ where: { id: sellerId } });
    if (!seller) throw new Error("Seller not found");
    if (data.field === "gst" && !seller.gstin) throw new Error("No GSTIN on file to override");
    if (data.field === "pan" && !seller.pan) throw new Error("No PAN on file to override");

    const update: Record<string, any> =
      data.field === "gst"
        ? {
            gstVerificationStatus: data.status,
            gstVerifiedAt: data.status === "VERIFIED" ? new Date() : null,
            gstVerificationMeta: { manualOverride: true, reason: data.reason },
          }
        : {
            panVerificationStatus: data.status,
            panVerifiedAt: data.status === "VERIFIED" ? new Date() : null,
            panVerificationMeta: { manualOverride: true, reason: data.reason },
          };

    const updated = await db.seller.update({ where: { id: sellerId }, data: update });

    await db.auditLog.create({
      data: {
        sellerId,
        actorId,
        actorType: "platform",
        action: "SELLER_GST_PAN_VERIFICATION_OVERRIDDEN",
        entityType: "seller",
        entityId: sellerId,
        metadata: { field: data.field, status: data.status, reason: data.reason },
      },
    });

    return updated;
  },

  async verifyKyc(sellerId: string, actorId: string) {
    const kyc = await db.sellerKyc.findUnique({ where: { sellerId } });
    if (!kyc) throw new Error("KYC not found");
    if (kyc.status === "VERIFIED") throw new Error("KYC already verified");

    if (kyc.aadhaarStatus !== "VERIFIED") {
      throw new Error("Aadhaar must be verified before overall KYC can be verified");
    }
    if (kyc.govtIdType && kyc.govtIdStatus !== "VERIFIED") {
      throw new Error("Government ID must be verified before overall KYC can be verified");
    }

    const [updated, owner, seller] = await Promise.all([
      db.$transaction(async (tx) => {
        const result = await tx.sellerKyc.update({
          where: { sellerId },
          data: {
            status: "VERIFIED",
            verifiedAt: new Date(),
            verifiedBy: actorId,
          },
        });
        await tx.auditLog.create({
          data: {
            sellerId,
            actorId,
            actorType: "platform",
            action: "KYC_VERIFIED",
            entityType: "seller_kyc",
            entityId: kyc.id,
          },
        });
        return result;
      }),
      getSellerOwner(sellerId),
      db.seller.findUnique({
        where: { id: sellerId },
        select: { email: true, name: true },
      }),
    ]);

    if (owner && seller) {
      notificationService
        .notify({
          userId: owner.userId,
          email: seller.email,
          type: "KYC_VERIFIED",
          title: "KYC verified",
          message: "Your KYC has been verified successfully.",
          channels: ["email", "sse"],
          emailTemplate: "kyc-verified",
          emailData: {
            sellerName: seller.name,
            dashboardUrl: `${config.appUrl}/dashboard`,
          },
        })
        .catch(() => null);
    }

    return updated;
  },

  async rejectKyc(sellerId: string, actorId: string, reason: string) {
    const kyc = await db.sellerKyc.findUnique({ where: { sellerId } });
    if (!kyc) throw new Error("KYC not found");
    if (kyc.status === "VERIFIED")
      throw new Error("Cannot reject verified KYC");

    const [updated, owner, seller] = await Promise.all([
      db.$transaction(async (tx) => {
        const result = await tx.sellerKyc.update({
          where: { sellerId },
          data: { status: "REJECTED", rejectedReason: reason },
        });
        await tx.auditLog.create({
          data: {
            sellerId,
            actorId,
            actorType: "platform",
            action: "KYC_REJECTED",
            entityType: "seller_kyc",
            entityId: kyc.id,
            metadata: { reason },
          },
        });
        return result;
      }),
      getSellerOwner(sellerId),
      db.seller.findUnique({
        where: { id: sellerId },
        select: { email: true, name: true },
      }),
    ]);

    if (owner && seller) {
      notificationService
        .notify({
          userId: owner.userId,
          email: seller.email,
          type: "KYC_REJECTED",
          title: "KYC rejected",
          message: `Your KYC was rejected. Reason: ${reason}`,
          channels: ["email", "sse"],
          emailTemplate: "kyc-rejected",
          emailData: {
            sellerName: seller.name,
            reason,
            dashboardUrl: `${config.appUrl}/dashboard`,
          },
        })
        .catch(() => null);
    }

    return updated;
  },

  async listPendingKyc() {
    return db.sellerKyc.findMany({
      select: {
        id: true,
        status: true,
        gstNumber: true,
        businessRegNumber: true,
        govtIdType: true,
        aadhaarStatus: true,
        govtIdStatus: true,
        rejectedReason: true,
        createdAt: true,
        seller: {
          select: {
            id: true,
            name: true,
            email: true,
            businessName: true,
            businessType: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  async inviteMember(
    sellerId: string,
    actorId: string,
    data: { email: string; roleId: string; name?: string },
  ) {
    const role = await db.sellerRole.findFirst({
      where: { id: data.roleId, sellerId },
    });
    if (!role) throw new Error("Role not found");

    const existingUser = await db.user.findUnique({
      where: { email: data.email },
    });
    if (existingUser) {
      const existingMember = await db.sellerMember.findUnique({
        where: { userId_sellerId: { userId: existingUser.id, sellerId } },
      });
      if (existingMember) throw new Error("User already a member");
    }

    const existingInvite = await db.teamInvite.findFirst({
      where: { sellerId, email: data.email, status: "PENDING" },
    });
    if (existingInvite)
      throw new Error("Invite already pending for this email");

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const invite = await db.teamInvite.create({
      data: {
        sellerId,
        email: data.email,
        roleId: data.roleId,
        invitedBy: actorId,
        expiresAt,
      },
    });

    const seller = await db.seller.findUnique({
      where: { id: sellerId },
      select: { businessName: true },
    });

    const inviteUrl = `${config.appUrl}/team/accept-invite?token=${invite.token}`;
    const teamInviteEmailData = {
      businessName: seller?.businessName ?? "a seller",
      roleName: role.name,
      inviteUrl,
    };
    if (existingUser) {
      notificationService
        .notify({
          userId: existingUser.id,
          email: data.email,
          type: "TEAM_INVITE" as any,
          title: "You've been invited to join a team",
          message: `You've been invited to join ${seller?.businessName ?? "a seller"} on ETradeBazaar as ${role.name}.`,
          channels: ["email", "sse"],
          emailTemplate: "team-invite",
          emailData: teamInviteEmailData,
          data: { token: invite.token },
        })
        .catch(() => null);
    } else {
      EmailFactory.get()
        .send({
          to: data.email,
          subject: "You've been invited to join a team",
          template: "team-invite",
          data: teamInviteEmailData,
        })
        .catch((err: any) => logger.error({ err: err.message }, "Team invite email failed"));
    }

    await db.auditLog.create({
      data: {
        sellerId,
        actorId,
        actorType: "seller",
        action: "MEMBER_INVITED",
        entityType: "team_invite",
        entityId: invite.id,
        metadata: { email: data.email, roleId: data.roleId },
      },
    });

    return invite;
  },

  async removeMember(sellerId: string, actorId: string, memberId: string) {
    const member = await db.sellerMember.findFirst({
      where: { id: memberId, sellerId },
      include: { role: true },
    });
    if (!member) throw new Error("Member not found");
    if (member.role.name === "owner")
      throw new Error("Cannot remove the owner");

    await db.sellerMember.delete({ where: { id: memberId } });

    await redis.del(RedisKeys.userRoles(member.userId, sellerId));
    await redis.del(RedisKeys.userPermissions(member.userId, sellerId));

    await db.auditLog.create({
      data: {
        sellerId,
        actorId,
        actorType: "seller",
        action: "MEMBER_REMOVED",
        entityType: "seller_member",
        entityId: memberId,
      },
    });

    return { removed: true };
  },

  async listRoles(sellerId: string) {
    const roles = await db.sellerRole.findMany({
      where: { sellerId },
      select: {
        id: true,
        name: true,
        description: true,
        createdAt: true,
        _count: { select: { members: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const DEFAULT_ROLE_NAMES = new Set(["owner", "manager", "staff", "shop"]);

    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      createdAt: r.createdAt,
      memberCount: r._count.members,
      isDefault: DEFAULT_ROLE_NAMES.has(r.name),
    }));
  },

  async createRole(
    sellerId: string,
    actorId: string,
    data: { name: string; description?: string },
  ) {
    const existing = await db.sellerRole.findUnique({
      where: { sellerId_name: { sellerId, name: data.name } },
    });
    if (existing) throw new Error("Role with this name already exists");

    const role = await db.sellerRole.create({
      data: { sellerId, name: data.name, description: data.description },
    });

    await db.auditLog.create({
      data: {
        sellerId,
        actorId,
        actorType: "seller",
        action: "ROLE_CREATED",
        entityType: "seller_role",
        entityId: role.id,
      },
    });

    return role;
  },

  async updateRole(
    sellerId: string,
    actorId: string,
    roleId: string,
    data: { name?: string; description?: string },
  ) {
    const role = await db.sellerRole.findFirst({
      where: { id: roleId, sellerId },
    });
    if (!role) throw new Error("Role not found");
    if (["owner", "manager", "staff"].includes(role.name))
      throw new Error("Cannot modify default roles");

    let updated;
    try {
      updated = await db.sellerRole.update({ where: { id: roleId }, data });
    } catch (err: any) {
      if (err?.code === "P2002") throw new Error("Role with this name already exists");
      throw err;
    }

    await db.auditLog.create({
      data: {
        sellerId,
        actorId,
        actorType: "seller",
        action: "ROLE_UPDATED",
        entityType: "seller_role",
        entityId: roleId,
      },
    });

    return updated;
  },

  async deleteRole(sellerId: string, actorId: string, roleId: string) {
    const role = await db.sellerRole.findFirst({
      where: { id: roleId, sellerId },
      include: { _count: { select: { members: true } } },
    });
    if (!role) throw new Error("Role not found");
    if (["owner", "manager", "staff"].includes(role.name))
      throw new Error("Cannot delete default roles");
    if (role._count.members > 0)
      throw new Error("Cannot delete role with active members");

    await db.sellerRole.delete({ where: { id: roleId } });

    await db.auditLog.create({
      data: {
        sellerId,
        actorId,
        actorType: "seller",
        action: "ROLE_DELETED",
        entityType: "seller_role",
        entityId: roleId,
      },
    });

    return { deleted: true };
  },

  async listInvites(sellerId: string) {
    return db.teamInvite.findMany({
      where: { sellerId, status: "PENDING" },
      select: {
        id: true,
        email: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        role: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  async revokeInvite(sellerId: string, inviteId: string) {
    const invite = await db.teamInvite.findFirst({
      where: { id: inviteId, sellerId },
    });
    if (!invite) throw new Error("Invite not found");
    if (invite.status !== "PENDING")
      throw new Error("Invite already used or expired");

    return db.teamInvite.update({
      where: { id: inviteId },
      data: { status: "REVOKED" },
    });
  },

  async resendInvite(sellerId: string, inviteId: string) {
    const invite = await db.teamInvite.findFirst({
      where: { id: inviteId, sellerId },
      select: {
        id: true,
        email: true,
        status: true,
        token: true,
        role: { select: { id: true, name: true } },
      },
    });
    if (!invite) throw new Error("Invite not found");
    if (invite.status !== "PENDING")
      throw new Error("Invite already used or expired");

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const updated = await db.teamInvite.update({
      where: { id: inviteId },
      data: { expiresAt },
    });

    const [seller, existingUser] = await Promise.all([
      db.seller.findUnique({ where: { id: sellerId }, select: { businessName: true } }),
      db.user.findUnique({ where: { email: invite.email } }),
    ]);
    const reminderInviteUrl = `${config.appUrl}/team/accept-invite?token=${invite.token}`;
    const reminderEmailData = {
      businessName: seller?.businessName ?? "a seller",
      roleName: (invite as any).role?.name ?? "a member",
      inviteUrl: reminderInviteUrl,
      isReminder: true,
    };
    if (existingUser) {
      notificationService
        .notify({
          userId: existingUser.id,
          email: invite.email,
          type: "TEAM_INVITE" as any,
          title: "Reminder: You've been invited to join a team",
          message: `Reminder — you've been invited to join ${seller?.businessName ?? "a seller"} as ${(invite as any).role?.name ?? "a member"}.`,
          channels: ["email", "sse"],
          emailTemplate: "team-invite",
          emailData: reminderEmailData,
          data: { token: invite.token },
        })
        .catch(() => null);
    } else {
      EmailFactory.get()
        .send({
          to: invite.email,
          subject: "Reminder: You've been invited to join a team",
          template: "team-invite",
          data: reminderEmailData,
        })
        .catch((err: any) => logger.error({ err: err.message }, "Team invite reminder email failed"));
    }

    return updated;
  },

  async acceptTeamInvite(
    token: string,
    data: { name: string; password: string },
  ) {
    const invite = await db.teamInvite.findUnique({ where: { token } });
    if (!invite) throw new Error("Invalid invite token");
    if (invite.status !== "PENDING")
      throw new Error("Invite already used or revoked");
    if (invite.expiresAt < new Date()) throw new Error("Invite expired");

    let user = await db.user.findUnique({ where: { email: invite.email } });

    return db.$transaction(async (tx) => {
      if (!user) {
        const hashedPassword = await bcrypt.hash(data.password, 12);
        user = await tx.user.create({
          data: {
            name: data.name,
            email: invite.email,
            password: hashedPassword,
          },
        });
      }

      const member = await tx.sellerMember.create({
        data: {
          userId: user.id,
          sellerId: invite.sellerId,
          roleId: invite.roleId,
        },
      });

      await tx.teamInvite.update({
        where: { token },
        data: { status: "ACCEPTED" },
      });

      return { user, member };
    });
  },

  async listRolePermissions(sellerId: string, roleId: string) {
    const role = await db.sellerRole.findFirst({
      where: { id: roleId, sellerId },
      select: {
        id: true,
        name: true,
        permissions: {
          select: { permission: { select: { id: true, key: true } } },
        },
      },
    });
    if (!role) throw new Error("Role not found");
    return role;
  },

  async updateRolePermissions(
    sellerId: string,
    actorId: string,
    roleId: string,
    permissionKeys: string[],
  ) {
    const role = await db.sellerRole.findFirst({
      where: { id: roleId, sellerId },
    });
    if (!role) throw new Error("Role not found");
    if (role.name === "owner")
      throw new Error("Cannot modify owner role permissions");

    const outOfScope = permissionKeys.filter((k) => isPlatformPermissionKey(k));
    if (outOfScope.length > 0) {
      throw new Error(`Not seller-scoped permissions: ${outOfScope.join(", ")}`);
    }

    const permissions = await db.permission.findMany({
      where: { key: { in: permissionKeys } },
      select: { id: true, key: true },
    });

    const foundKeys = new Set(permissions.map((p) => p.key));
    const missing = permissionKeys.filter((k) => !foundKeys.has(k));
    if (missing.length > 0)
      throw new Error(`Unknown permissions: ${missing.join(", ")}`);

    await db.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({
        where: { roleId },
      });

      if (permissions.length > 0) {
        await tx.rolePermission.createMany({
          data: permissions.map((p) => ({ roleId, permissionId: p.id })),
        });
      }

      await tx.auditLog.create({
        data: {
          sellerId,
          actorId,
          actorType: "seller",
          action: "ROLE_PERMISSIONS_UPDATED",
          entityType: "seller_role",
          entityId: roleId,
          metadata: { permissions: permissionKeys },
        },
      });
    });

    const members = await db.sellerMember.findMany({
      where: { roleId, isActive: true },
      select: { userId: true },
    });

    for (const member of members) {
      await redis.del(RedisKeys.userPermissions(member.userId, sellerId));
    }

    return { roleId, permissions: permissionKeys };
  },

  async listAllPermissions() {
    return db.permission.findMany({
      select: { id: true, key: true, description: true },
      orderBy: { key: "asc" },
    });
  },
};
