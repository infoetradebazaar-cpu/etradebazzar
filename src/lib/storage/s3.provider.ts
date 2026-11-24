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

export class S3Provider implements StorageProvider {
    private client: S3Client;
    private bucket: string;
    private cdnUrl: string | undefined;

    constructor() {
        this.client = new S3Client({
            region: config.awsRegion,
            credentials: {
                accessKeyId: config.awsAccessKeyId,
                secretAccessKey: config.awsSecretAccessKey,
            },
        });
        this.bucket = config.awsS3Bucket;
        this.cdnUrl = config.awsCdnUrl;
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

    async download(key: string): Promise<Buffer | null> {
        try {
            const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
            return res.Body ? Buffer.from(await res.Body.transformToByteArray()) : null;
        } catch (err: any) {
            if (err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) return null;
            throw err;
        }
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
        if (this.cdnUrl) {
            return `${this.cdnUrl}/${key}`;
        }
        return `https://${this.bucket}.s3.${config.awsRegion}.amazonaws.com/${key}`;
    }
}