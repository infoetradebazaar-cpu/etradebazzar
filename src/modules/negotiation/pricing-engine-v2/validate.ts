import { PREMIUM_STRETCH_PCT } from "../legacy-linear-formula";

export interface OfferValidation {
  valid: boolean;
  errors: string[];
}

const RUPEE = 1; // rounding tolerance, matches engine.ts's roundToRupee()

export function checkOfferValidity(offer: number, floor: number, visible: number, customerPrice?: number): OfferValidation {
  const errors: string[] = [];

  if (!Number.isFinite(offer)) {
    errors.push(`offer is not a finite number: ${offer}`);
    return { valid: false, errors };
  }

  if (offer < 0) {
    errors.push(`offer is negative: ${offer}`);
  }

  if (!Number.isInteger(offer)) {
    errors.push(`offer is not a whole rupee: ${offer}`);
  }

  if (offer < floor - RUPEE) {
    errors.push(`offer ${offer} is below floor ${floor}`);
  }

  const ceiling =
    customerPrice !== undefined ? Math.max(visible, customerPrice * (1 + PREMIUM_STRETCH_PCT)) : visible;
  if (offer > ceiling + RUPEE) {
    errors.push(`offer ${offer} is above ceiling ${ceiling} (visible=${visible}${customerPrice !== undefined ? `, customerPrice=${customerPrice}` : ""})`);
  }

  return { valid: errors.length === 0, errors };
}

// throwing variant, for tests/CLI
export function assertValidOffer(offer: number, floor: number, visible: number, customerPrice?: number): void {
  const result = checkOfferValidity(offer, floor, visible, customerPrice);
  if (!result.valid) {
    throw new Error(`Invalid offer ${offer} (floor=${floor}, visible=${visible}): ${result.errors.join("; ")}`);
  }
}
