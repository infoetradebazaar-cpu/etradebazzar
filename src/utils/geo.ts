import geoip from "geoip-lite";

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