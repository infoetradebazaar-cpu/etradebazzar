ALTER TABLE "PrintArea" ADD CONSTRAINT "PrintArea_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
