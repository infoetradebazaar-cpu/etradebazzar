export interface UploadInput {
    key: string; // S3 object key 
    buffer: Buffer;
    mimeType: string;
    size: number;
    contentDisposition?: string;
}

export interface UploadResult {
    key: string;
    url: string;
}

export interface SignedUrlInput {
    key: string;
    expiresIn?: number;
    responseContentDisposition?: "inline" | "attachment";
    responseContentType?: string;
}

export interface DeleteInput {
    key: string;
}

export interface StorageProvider {
    upload(input: UploadInput): Promise<UploadResult>;
    delete(input: DeleteInput): Promise<void>;
    getSignedUrl(input: SignedUrlInput): Promise<string>;
    download(key: string): Promise<Buffer | null>;
    getPublicUrl(key: string): string;
}