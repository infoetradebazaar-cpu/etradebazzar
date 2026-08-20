import {
    S3Client,
    PutObjectCommand,
    DeleteObjectCommand,
    GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../../../config/config";
import {
    StorageProvider,
    UploadInput,
    UploadResult,
    DeleteInput,
    SignedUrlInput,
} from "./storage.interface";

export class MinioProvider implements StorageProvider {
    private client: S3Client;
    private bucket: string;
    private publicUrl: string;

    constructor() {
        this.client = new S3Client({
            region: config.minioRegion,
            endpoint: config.minioEndpoint,
            forcePathStyle: true,
            credentials: {
                accessKeyId: config.minioAccessKey,
                secretAccessKey: config.minioSecretKey,
            },
        });
        this.bucket = config.minioBucket;
        this.publicUrl = config.minioPublicUrl || config.minioEndpoint;
    }

    async upload(input: UploadInput): Promise<UploadResult> {
        await this.client.send(
            new PutObjectCommand({
                Bucket: this.bucket,
                Key: input.key,
                Body: input.buffer,
                ContentType: input.mimeType,
                ContentLength: input.size,
                ContentDisposition: input.contentDisposition,
            })
        );

        return {
            key: input.key,
            url: this.getPublicUrl(input.key),
        };
    }

    async delete(input: DeleteInput): Promise<void> {
        await this.client.send(
            new DeleteObjectCommand({
                Bucket: this.bucket,
                Key: input.key,
            })
        );
    }

    async getSignedUrl(input: SignedUrlInput): Promise<string> {
        const command = new GetObjectCommand({
            Bucket: this.bucket,
            Key: input.key,
            ...(input.responseContentDisposition && {
                ResponseContentDisposition: input.responseContentDisposition,
            }),
            ...(input.responseContentType && {
                ResponseContentType: input.responseContentType,
            }),
        });

        return getSignedUrl(this.client, command, {
            expiresIn: input.expiresIn ?? 3600,
        });
    }

    getPublicUrl(key: string): string {
        return `${this.publicUrl}/${this.bucket}/${key}`;
    }
}
