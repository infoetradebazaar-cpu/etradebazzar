import { StorageProvider } from "./storage.interface";
import { S3Provider } from "./s3.provider";
import { DigitalOceanSpacesProvider } from "./digitalocean.provider";
import { RailwayBucketProvider } from "./railway.provider";
import { MinioProvider } from "./minio.provider";

type StorageProviderType = "aws" | "do" | "railway" | "minio";

class StorageFactory {
  private static instance: StorageProvider | null = null;

  static get(provider?: StorageProviderType): StorageProvider {
    if (!this.instance) {
      const key = (provider ??
        process.env["STORAGE_PROVIDER"] ??
        "aws") as StorageProviderType;
      this.instance = this.create(key);
    }
    return this.instance;
  }

  private static create(provider: StorageProviderType): StorageProvider {
    switch (provider) {
      case "aws":
        return new S3Provider();
      case "do":
        return new DigitalOceanSpacesProvider();
      case "railway":
        return new RailwayBucketProvider();
      case "minio":
        return new MinioProvider();
      default:
        throw new Error(`Unsupported storage provider: ${provider}`);
    }
  }
}

export { StorageFactory };
