import geoip from "geoip-lite";
import { db } from "../db/index";

export interface IpLocation {
  city: string | null;
  region: string | null;
  country: string | null;
}

export function getLocationFromIp(ip: string | undefined): IpLocation | null {
  if (!ip) return null;
  const normalized = ip.replace(/^::ffff:/, "");
  const geo = geoip.lookup(normalized);
  if (!geo) return null;
  return {
    city: geo.city || null,
    region: geo.region || null,
    country: geo.country || null,
  };
}

const EARTH_RADIUS_KM = 6371;
const MAX_CANDIDATE_SHOPS = 200;

export function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.asin(Math.sqrt(a));
}
export interface NearestShopResult {
  shopId: string;
  distanceBased: boolean;
}

export async function findNearestShop(
  sellerId: string,
  productIds: string[],
  lat?: number,
  lon?: number
): Promise<NearestShopResult | null> {
  const shops = await db.shop.findMany({
    where: {
      sellerId,
      status: "APPROVED",
      products: {
        some: {
          id: { in: productIds },
          status: "LIVE",
          stock: { gt: 0 },
        },
      },
    },
    select: { id: true, latitude: true, longitude: true },
    take: MAX_CANDIDATE_SHOPS,
  });

  if (!shops.length) return null;
  if (!lat || !lon) {
    return { shopId: shops[0]!.id, distanceBased: false };
  }

  let nearestId = shops[0]!.id;
  let minDistance = Infinity;
  let foundWithCoords = false;

  for (const shop of shops) {
    if (!shop.latitude || !shop.longitude) continue;
    foundWithCoords = true;
    const distance = haversineDistance(
      lat, lon,
      Number(shop.latitude),
      Number(shop.longitude)
    );
    if (distance < minDistance) {
      minDistance = distance;
      nearestId = shop.id;
    }
  }

  return { shopId: nearestId, distanceBased: foundWithCoords };
}