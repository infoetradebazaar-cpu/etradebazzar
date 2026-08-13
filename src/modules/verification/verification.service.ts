import { db } from "../../db/index";
import { AadhaarFactory } from "../../lib/aadhar/aadhar.factory";
import { PanFactory } from "../../lib/pan/pan.factory";
import { encrypt } from "../../utils/encryption";

export const verificationService = {
  async initializeAadhaarDigilocker(sellerId: string, redirectUrl?: string) {
    const kyc = await db.sellerKyc.findUnique({ where: { sellerId } });
    if (!kyc) throw new Error("KYC record not found - complete KYC first");

    if (kyc.aadhaarStatus === "VERIFIED") {
      throw new Error("Aadhaar already verified, contact support to change it");
    }

    const seller = await db.seller.findUnique({
      where: { id: sellerId },
      select: { name: true, email: true, phone: true },
    });
    if (!seller) throw new Error("Seller not found");

    const provider = AadhaarFactory.get();
    const session = await provider.initializeDigilocker({
      redirectUrl,
      prefill: { fullName: seller.name, email: seller.email, phone: seller.phone },
    });

    await db.sellerKyc.update({
      where: { sellerId },
      data: {
        aadhaarStatus: "PENDING",
        aadhaarRejectedReason: null,
        aadhaarDigilockerClientId: session.clientId,
      },
    });

    return { url: session.url, expirySeconds: session.expirySeconds };
  },

  async confirmAadhaarDigilocker(sellerId: string) {
    const kyc = await db.sellerKyc.findUnique({ where: { sellerId } });
    if (!kyc) throw new Error("KYC record not found - complete KYC first");
    if (!kyc.aadhaarDigilockerClientId) {
      throw new Error("No pending Aadhaar DigiLocker session - start verification first");
    }

    const provider = AadhaarFactory.get();
    const details = await provider.fetchAadhaarDetails(kyc.aadhaarDigilockerClientId);

    return db.$transaction(async (tx) => {
      const updated = await tx.sellerKyc.update({
        where: { sellerId },
        data: {
          aadhaarStatus: "VERIFIED",
          aadhaarVerifiedAt: new Date(),
          aadhaarDigilockerClientId: null,
          aadhaarVerifiedName: details.fullName || null,
          aadhaarVerificationMeta: details.raw as any,
        },
      });

      await tx.auditLog.create({
        data: {
          sellerId, actorId: sellerId, actorType: "system",
          action: "AADHAAR_VERIFIED", entityType: "seller_kyc", entityId: sellerId,
          metadata: { via: "surepass_digilocker", verifiedName: details.fullName },
        },
      });

      return updated;
    });
  },

  async submitGovernmentId(
    sellerId: string,
    data: { govtIdType: string; govtIdNumber: string },
  ) {
    const kyc = await db.sellerKyc.findUnique({ where: { sellerId } });
    if (!kyc) throw new Error("KYC record not found  complete KYC first");

    if (kyc.govtIdStatus === "VERIFIED") {
      throw new Error("Government ID already verified, contact support to change it");
    }

    if (data.govtIdType === "PAN") {
      return this.submitPan(sellerId, data.govtIdNumber);
    }

    return db.sellerKyc.update({
      where: { sellerId },
      data: {
        govtIdType: data.govtIdType,
        govtIdNumber: encrypt(data.govtIdNumber, sellerId),
        govtIdStatus: "PENDING",
        govtIdRejectedReason: null,
        govtIdVerifiedName: null,
        govtIdVerificationMeta: undefined,
      },
    });
  },

  async submitPan(sellerId: string, panNumber: string) {
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panNumber)) {
      throw new Error("PAN number format is invalid");
    }

    const provider = PanFactory.get();
    const details = await provider.verifyPan(panNumber);

    const isValid = details.status === "VALID";

    return db.$transaction(async (tx) => {
      const updated = await tx.sellerKyc.update({
        where: { sellerId },
        data: {
          govtIdType: "PAN",
          govtIdNumber: encrypt(panNumber, sellerId),
          govtIdStatus: isValid ? "VERIFIED" : "REJECTED",
          govtIdRejectedReason: isValid ? null : "PAN could not be verified against government records",
          govtIdVerifiedAt: isValid ? new Date() : null,
          govtIdVerifiedName: details.fullName || null,
          govtIdVerificationMeta: details.raw as any,
        },
      });

      await tx.auditLog.create({
        data: {
          sellerId, actorId: sellerId, actorType: "system",
          action: isValid ? "GOVT_ID_VERIFIED" : "GOVT_ID_REJECTED",
          entityType: "seller_kyc", entityId: sellerId,
          metadata: { via: "surepass_pan", status: details.status, verifiedName: details.fullName },
        },
      });

      return updated;
    });
  },

  async getVerificationStatus(sellerId: string) {
    const kyc = await db.sellerKyc.findUnique({
      where: { sellerId },
      select: {
        status: true,
        aadhaarStatus: true,
        aadhaarRejectedReason: true,
        aadhaarVerifiedAt: true,
        govtIdType: true,
        govtIdStatus: true,
        govtIdRejectedReason: true,
        govtIdVerifiedAt: true,
      },
    });
    if (!kyc) throw new Error("KYC record not found");
    return kyc;
  },

  // Platform admin
  async verifyAadhaar(sellerId: string, actorId: string) {
    const kyc = await db.sellerKyc.findUnique({ where: { sellerId } });
    if (!kyc) throw new Error("KYC record not found");
    if (kyc.aadhaarStatus !== "PENDING") {
      throw new Error(`Cannot verify current status is ${kyc.aadhaarStatus}`);
    }

    return db.$transaction(async (tx) => {
      const updated = await tx.sellerKyc.update({
        where: { sellerId },
        data: { aadhaarStatus: "VERIFIED", aadhaarVerifiedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          sellerId, actorId, actorType: "platform",
          action: "AADHAAR_VERIFIED", entityType: "seller_kyc", entityId: sellerId,
        },
      });

      return updated;
    });
  },

  async rejectAadhaar(sellerId: string, actorId: string, reason: string) {
    const kyc = await db.sellerKyc.findUnique({ where: { sellerId } });
    if (!kyc) throw new Error("KYC record not found");
    if (kyc.aadhaarStatus === "PENDING" || kyc.aadhaarStatus === "VERIFIED") {
    } else {
      throw new Error(`Cannot reject current status is ${kyc.aadhaarStatus}`);
    }

    return db.$transaction(async (tx) => {
      const updated = await tx.sellerKyc.update({
        where: { sellerId },
        data: { aadhaarStatus: "REJECTED", aadhaarRejectedReason: reason },
      });

      await tx.auditLog.create({
        data: {
          sellerId, actorId, actorType: "platform",
          action: "AADHAAR_REJECTED", entityType: "seller_kyc", entityId: sellerId,
          metadata: { reason },
        },
      });

      return updated;
    });
  },

  async verifyGovernmentId(sellerId: string, actorId: string) {
    const kyc = await db.sellerKyc.findUnique({ where: { sellerId } });
    if (!kyc) throw new Error("KYC record not found");
    if (kyc.govtIdStatus !== "PENDING") {
      throw new Error(`Cannot verify current status is ${kyc.govtIdStatus}`);
    }

    return db.$transaction(async (tx) => {
      const updated = await tx.sellerKyc.update({
        where: { sellerId },
        data: { govtIdStatus: "VERIFIED", govtIdVerifiedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          sellerId, actorId, actorType: "platform",
          action: "GOVT_ID_VERIFIED", entityType: "seller_kyc", entityId: sellerId,
        },
      });

      return updated;
    });
  },

  async rejectGovernmentId(sellerId: string, actorId: string, reason: string) {
    const kyc = await db.sellerKyc.findUnique({ where: { sellerId } });
    if (!kyc) throw new Error("KYC record not found");
    if (kyc.govtIdStatus === "PENDING" || kyc.govtIdStatus === "VERIFIED") {
    } else {
      throw new Error(`Cannot reject current status is ${kyc.govtIdStatus}`);
    }

    return db.$transaction(async (tx) => {
      const updated = await tx.sellerKyc.update({
        where: { sellerId },
        data: { govtIdStatus: "REJECTED", govtIdRejectedReason: reason },
      });

      await tx.auditLog.create({
        data: {
          sellerId, actorId, actorType: "platform",
          action: "GOVT_ID_REJECTED", entityType: "seller_kyc", entityId: sellerId,
          metadata: { reason },
        },
      });

      return updated;
    });
  },
};
