export interface RequestOptions {
  headers?: Record<string, string>;
  timeout?: number;
  retries?: number;
}

export interface Response<T = unknown> {
  status: number;
  body: T;
  headers: Record<string, string>;
}

export type Method = "GET" | "POST" | "PUT" | "DELETE";

export declare enum LogLevel {
  Debug = 0,
  Info = 1,
  Warn = 2,
  Error = 3,
}

export declare const DEFAULT_TIMEOUT = 30000;

export declare class Client {
  constructor(baseUrl: string);
  request<T>(method: Method, path: string, opts?: RequestOptions): Promise<Response<T>>;
  get<T>(path: string, opts?: RequestOptions): Promise<Response<T>>;
  close(): void;
}

export declare function createClient(baseUrl: string): Client;
export declare function parseLinkHeader(header: string): Record<string, string>;
