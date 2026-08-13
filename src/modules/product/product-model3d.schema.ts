import { z } from "zod";

export const productModel3DParamSchema = z.object({
  params: z.object({ productId: z.string() }),
});
