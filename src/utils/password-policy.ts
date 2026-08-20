import { z } from "zod";

const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "12345678", "123456789", "qwerty123",
  "letmein1", "welcome1", "admin123", "iloveyou", "monkey123", "football1",
  "changeme", "passw0rd", "abc12345",
]);

export const strongPasswordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(128, "Password is too long")
  .refine((v) => /[A-Z]/.test(v), "Password must contain an uppercase letter")
  .refine((v) => /[a-z]/.test(v), "Password must contain a lowercase letter")
  .refine((v) => /[0-9]/.test(v), "Password must contain a number")
  .refine((v) => /[^A-Za-z0-9]/.test(v), "Password must contain a special character")
  .refine((v) => !COMMON_PASSWORDS.has(v.toLowerCase()), "Password is too common, choose a stronger one");
