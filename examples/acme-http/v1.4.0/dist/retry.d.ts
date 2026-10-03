export declare function withRetry<T>(fn: () => Promise<T>, attempts: number): Promise<T>;
export declare function backoff(attempt: number): number;
