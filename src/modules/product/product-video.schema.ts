import { z } from "zod";

export const productVideoParamSchema = z.object({
  params: z.object({ productId: z.string() }),
});
