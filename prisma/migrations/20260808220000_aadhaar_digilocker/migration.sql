-- Aadhaar OTP verification is no longer legal in India; the seller-facing
-- Aadhaar flow moved to Surepass DigiLocker. Rename the pending-session
-- column so it no longer says "Otp".
ALTER TABLE "seller_kyc" RENAME COLUMN "aadhaarOtpClientId" TO "aadhaarDigilockerClientId";
