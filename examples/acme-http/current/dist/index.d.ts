export interface RequestOptions {
  headers?: Record<string, string>;
  retries?: number;
  signal?: AbortSignal;
}

export interface Response<T = unknown> {
  status: number;
  body: T;
  headers: Record<string, string>;
}

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export declare enum LogLevel {
  Trace = 0,
  Debug = 1,
  Info = 2,
  Warn = 3,
  Error = 4,
}

export declare const DEFAULT_TIMEOUT = 60000;

export declare class Client {
  constructor(baseUrl: string);
  request<T>(method: Method, path: string, opts?: RequestOptions): Promise<T>;
  get<T>(path: string, opts?: RequestOptions): Promise<T>;
  stream(path: string, opts?: RequestOptions): AsyncIterable<Uint8Array>;
  close(): void;
}

export declare function createClient(baseUrl: string, apiKey: string): Client;
