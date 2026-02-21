type RouteHandler = (request: any, response: any) => unknown | Promise<unknown>;

interface MockResponse {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  status(code: number): MockResponse;
  json(payload: unknown): MockResponse;
  send(payload?: unknown): MockResponse;
  setHeader(name: string, value: string): void;
  getHeader(name: string): string | undefined;
}

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

export function createRouteHarness(): {
  app: {
    get(path: string, handler: RouteHandler): void;
    post(path: string, handler: RouteHandler): void;
    put(path: string, handler: RouteHandler): void;
    delete(path: string, handler: RouteHandler): void;
  };
  route(method: "GET" | "POST" | "PUT" | "DELETE", path: string): RouteHandler;
} {
  const routes = new Map<string, RouteHandler>();

  const register = (method: "GET" | "POST" | "PUT" | "DELETE") => (path: string, handler: RouteHandler): void => {
    routes.set(routeKey(method, path), handler);
  };

  return {
    app: {
      get: register("GET"),
      post: register("POST"),
      put: register("PUT"),
      delete: register("DELETE")
    },
    route(method, path) {
      const handler = routes.get(routeKey(method, path));
      if (!handler) {
        throw new Error(`Route not registered: ${method} ${path}`);
      }
      return handler;
    }
  };
}

export function createMockResponse(): MockResponse {
  const response: MockResponse = {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    send(payload?: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    },
    getHeader(name: string) {
      return this.headers[name.toLowerCase()];
    }
  };

  return response;
}

export async function invokeRoute(
  handler: RouteHandler,
  request: Partial<{
    body: unknown;
    params: Record<string, string>;
    query: Record<string, string>;
    path: string;
    method: string;
    headers: Record<string, string>;
  }> = {}
): Promise<MockResponse> {
  const response = createMockResponse();
  const normalizedRequest = {
    body: request.body ?? {},
    params: request.params ?? {},
    query: request.query ?? {},
    path: request.path ?? "/",
    method: request.method ?? "GET",
    headers: request.headers ?? {}
  };

  await handler(normalizedRequest, response);
  return response;
}
