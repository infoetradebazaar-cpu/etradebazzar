import { AsyncLocalStorage } from "async_hooks";

export interface TenantContext {
    sellerId?: string;
    isPlatformAdmin?: boolean;
    customerOrgId?: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

export function runWithTenantContext<T>(ctx: TenantContext, fn: () => T): T {
    return storage.run(ctx, fn);
}

export function getTenantContext(): TenantContext {
    return storage.getStore() ?? {};
}