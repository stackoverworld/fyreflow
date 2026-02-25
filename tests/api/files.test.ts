import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerFileManagerRoutes } from "../../server/http/routes/pipelines/registerFileManagerRoutes.js";
import { createRouteHarness, invokeRoute } from "../helpers/routeHarness.js";
import { createTempStore } from "../helpers/tempStore.js";

function safeStorageSegment(value: string): string {
  const trimmed = value.trim();
  const fallback = trimmed.length > 0 ? trimmed : "default";
  return fallback.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

describe("File Manager Routes", () => {
  it("lists and deletes scoped storage paths for the selected pipeline", async () => {
    const { app, route } = createRouteHarness();
    const { store, cleanup } = await createTempStore();
    const storageRoot = await mkdtemp(path.join(tmpdir(), "fyreflow-files-"));

    try {
      registerFileManagerRoutes(app as never, { store } as never);

      const pipeline = store.listPipelines()[0];
      const safePipelineId = safeStorageSegment(pipeline.id);
      const sharedRoot = path.join(storageRoot, "shared", safePipelineId);
      await mkdir(path.join(sharedRoot, "docs"), { recursive: true });
      await writeFile(path.join(sharedRoot, "readme.txt"), "hello", "utf8");
      await writeFile(path.join(sharedRoot, "docs", "guide.md"), "# guide", "utf8");
      await writeFile(path.join(sharedRoot, "docs", "logo.png"), Buffer.from([137, 80, 78, 71]), "binary");

      store.updateStorageConfig({
        enabled: true,
        rootPath: storageRoot,
        sharedFolder: "shared",
        isolatedFolder: "isolated",
        runsFolder: "runs"
      });

      const listHandler = route("GET", "/api/files");
      const listResponse = await invokeRoute(listHandler, {
        method: "GET",
        path: "/api/files",
        query: {
          pipelineId: pipeline.id,
          scope: "shared",
          path: ""
        }
      });

      const listPayload = listResponse.body as {
        entries: Array<{ name: string; type: string }>;
      };
      expect(listResponse.statusCode).toBe(200);
      expect(listPayload.entries.map((entry) => `${entry.type}:${entry.name}`)).toEqual([
        "directory:docs",
        "file:readme.txt"
      ]);

      const contentHandler = route("GET", "/api/files/content");
      const contentResponse = await invokeRoute(contentHandler, {
        method: "GET",
        path: "/api/files/content",
        query: {
          pipelineId: pipeline.id,
          scope: "shared",
          path: "readme.txt"
        }
      });
      const contentPayload = contentResponse.body as {
        path: string;
        name: string;
        previewKind: string;
        content: string;
      };
      expect(contentResponse.statusCode).toBe(200);
      expect(contentPayload.path).toBe("readme.txt");
      expect(contentPayload.name).toBe("readme.txt");
      expect(contentPayload.previewKind).toBe("text");
      expect(contentPayload.content).toBe("hello");

      const rawHandler = route("GET", "/api/files/raw/:scope/:pipelineId/:runId/*");
      const rawResponse = await invokeRoute(rawHandler, {
        method: "GET",
        path: `/api/files/raw/shared/${pipeline.id}/-/docs/logo.png`,
        params: {
          scope: "shared",
          pipelineId: pipeline.id,
          runId: "-",
          "0": "docs/logo.png"
        }
      });
      expect(rawResponse.statusCode).toBe(200);
      expect(rawResponse.getHeader("content-type")).toBe("image/png");
      expect(rawResponse.body).toBeInstanceOf(Buffer);

      const deleteHandler = route("DELETE", "/api/files");
      const deleteResponse = await invokeRoute(deleteHandler, {
        method: "DELETE",
        path: "/api/files",
        body: {
          pipelineId: pipeline.id,
          scope: "shared",
          path: "docs",
          recursive: true
        }
      });
      expect(deleteResponse.statusCode).toBe(200);

      const listAfterDeleteResponse = await invokeRoute(listHandler, {
        method: "GET",
        path: "/api/files",
        query: {
          pipelineId: pipeline.id,
          scope: "shared",
          path: ""
        }
      });
      const listAfterDeletePayload = listAfterDeleteResponse.body as {
        entries: Array<{ name: string; type: string }>;
      };
      expect(listAfterDeleteResponse.statusCode).toBe(200);
      expect(listAfterDeletePayload.entries.map((entry) => `${entry.type}:${entry.name}`)).toEqual(["file:readme.txt"]);
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
      await cleanup();
    }
  });

  it("rejects path traversal and root delete attempts", async () => {
    const { app, route } = createRouteHarness();
    const { store, cleanup } = await createTempStore();
    const storageRoot = await mkdtemp(path.join(tmpdir(), "fyreflow-files-"));

    try {
      registerFileManagerRoutes(app as never, { store } as never);
      const pipeline = store.listPipelines()[0];

      store.updateStorageConfig({
        enabled: true,
        rootPath: storageRoot,
        sharedFolder: "shared",
        isolatedFolder: "isolated",
        runsFolder: "runs"
      });

      const listHandler = route("GET", "/api/files");
      const traversalResponse = await invokeRoute(listHandler, {
        method: "GET",
        path: "/api/files",
        query: {
          pipelineId: pipeline.id,
          scope: "shared",
          path: "../outside"
        }
      });
      expect(traversalResponse.statusCode).toBe(400);

      const contentHandler = route("GET", "/api/files/content");
      const contentTraversalResponse = await invokeRoute(contentHandler, {
        method: "GET",
        path: "/api/files/content",
        query: {
          pipelineId: pipeline.id,
          scope: "shared",
          path: "../outside.txt"
        }
      });
      expect(contentTraversalResponse.statusCode).toBe(400);

      const rawHandler = route("GET", "/api/files/raw/:scope/:pipelineId/:runId/*");
      const rawTraversalResponse = await invokeRoute(rawHandler, {
        method: "GET",
        path: `/api/files/raw/shared/${pipeline.id}/-/../outside.txt`,
        params: {
          scope: "shared",
          pipelineId: pipeline.id,
          runId: "-",
          "0": "../outside.txt"
        }
      });
      expect(rawTraversalResponse.statusCode).toBe(400);

      const deleteHandler = route("DELETE", "/api/files");
      const deleteTraversalResponse = await invokeRoute(deleteHandler, {
        method: "DELETE",
        path: "/api/files",
        body: {
          pipelineId: pipeline.id,
          scope: "shared",
          path: "../outside",
          recursive: true
        }
      });
      expect(deleteTraversalResponse.statusCode).toBe(400);

      const deleteRootResponse = await invokeRoute(deleteHandler, {
        method: "DELETE",
        path: "/api/files",
        body: {
          pipelineId: pipeline.id,
          scope: "shared",
          path: ".",
          recursive: true
        }
      });
      expect(deleteRootResponse.statusCode).toBe(400);
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
      await cleanup();
    }
  });

  it("blocks run-scope access to runs from other pipelines", async () => {
    const { app, route } = createRouteHarness();
    const { store, cleanup } = await createTempStore();
    const storageRoot = await mkdtemp(path.join(tmpdir(), "fyreflow-files-"));

    try {
      registerFileManagerRoutes(app as never, { store } as never);

      const pipeline = store.listPipelines()[0];
      const otherPipeline = store.createPipeline({
        name: "Other Flow",
        description: "",
        steps: [
          {
            name: "Planner",
            role: "planner",
            prompt: "plan"
          }
        ],
        links: [],
        qualityGates: []
      });

      store.updateStorageConfig({
        enabled: true,
        rootPath: storageRoot,
        sharedFolder: "shared",
        isolatedFolder: "isolated",
        runsFolder: "runs"
      });

      const ownRun = store.createRun(pipeline, "Own run");
      const foreignRun = store.createRun(otherPipeline, "Foreign run");
      const ownRunRoot = path.join(storageRoot, "runs", safeStorageSegment(ownRun.id));
      await mkdir(ownRunRoot, { recursive: true });
      await writeFile(path.join(ownRunRoot, "report.md"), "ok", "utf8");

      const listHandler = route("GET", "/api/files");
      const ownRunResponse = await invokeRoute(listHandler, {
        method: "GET",
        path: "/api/files",
        query: {
          pipelineId: pipeline.id,
          scope: "runs",
          runId: ownRun.id
        }
      });
      expect(ownRunResponse.statusCode).toBe(200);

      const foreignRunResponse = await invokeRoute(listHandler, {
        method: "GET",
        path: "/api/files",
        query: {
          pipelineId: pipeline.id,
          scope: "runs",
          runId: foreignRun.id
        }
      });
      expect(foreignRunResponse.statusCode).toBe(404);

      const contentHandler = route("GET", "/api/files/content");
      const foreignRunContentResponse = await invokeRoute(contentHandler, {
        method: "GET",
        path: "/api/files/content",
        query: {
          pipelineId: pipeline.id,
          scope: "runs",
          runId: foreignRun.id,
          path: "report.md"
        }
      });
      expect(foreignRunContentResponse.statusCode).toBe(404);

      const rawHandler = route("GET", "/api/files/raw/:scope/:pipelineId/:runId/*");
      const foreignRunRawResponse = await invokeRoute(rawHandler, {
        method: "GET",
        path: `/api/files/raw/runs/${pipeline.id}/${foreignRun.id}/report.md`,
        params: {
          scope: "runs",
          pipelineId: pipeline.id,
          runId: foreignRun.id,
          "0": "report.md"
        }
      });
      expect(foreignRunRawResponse.statusCode).toBe(404);
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
      await cleanup();
    }
  });

  it("previews html files and rejects non-file content targets", async () => {
    const { app, route } = createRouteHarness();
    const { store, cleanup } = await createTempStore();
    const storageRoot = await mkdtemp(path.join(tmpdir(), "fyreflow-files-"));

    try {
      registerFileManagerRoutes(app as never, { store } as never);
      const pipeline = store.listPipelines()[0];
      const safePipelineId = safeStorageSegment(pipeline.id);
      const sharedRoot = path.join(storageRoot, "shared", safePipelineId);

      await mkdir(path.join(sharedRoot, "assets"), { recursive: true });
      await writeFile(path.join(sharedRoot, "index.html"), "<!doctype html><html><body>ok</body></html>", "utf8");
      await writeFile(path.join(sharedRoot, "archive.bin"), Buffer.from([0, 159, 146, 150]));

      store.updateStorageConfig({
        enabled: true,
        rootPath: storageRoot,
        sharedFolder: "shared",
        isolatedFolder: "isolated",
        runsFolder: "runs"
      });

      const contentHandler = route("GET", "/api/files/content");
      const htmlResponse = await invokeRoute(contentHandler, {
        method: "GET",
        path: "/api/files/content",
        query: {
          pipelineId: pipeline.id,
          scope: "shared",
          path: "index.html"
        }
      });
      const htmlPayload = htmlResponse.body as {
        previewKind: string;
        mimeType: string;
        content: string;
      };
      expect(htmlResponse.statusCode).toBe(200);
      expect(htmlPayload.previewKind).toBe("html");
      expect(htmlPayload.mimeType).toBe("text/html");
      expect(htmlPayload.content).toContain("<body>ok</body>");

      const directoryResponse = await invokeRoute(contentHandler, {
        method: "GET",
        path: "/api/files/content",
        query: {
          pipelineId: pipeline.id,
          scope: "shared",
          path: "assets"
        }
      });
      expect(directoryResponse.statusCode).toBe(400);

      const binaryResponse = await invokeRoute(contentHandler, {
        method: "GET",
        path: "/api/files/content",
        query: {
          pipelineId: pipeline.id,
          scope: "shared",
          path: "archive.bin"
        }
      });
      expect(binaryResponse.statusCode).toBe(415);
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
      await cleanup();
    }
  });

  it("uploads chunked files and returns attachment headers on raw download", async () => {
    const { app, route } = createRouteHarness();
    const { store, cleanup } = await createTempStore();
    const storageRoot = await mkdtemp(path.join(tmpdir(), "fyreflow-files-"));

    try {
      registerFileManagerRoutes(app as never, { store } as never);
      const pipeline = store.listPipelines()[0];
      const safePipelineId = safeStorageSegment(pipeline.id);
      const sharedRoot = path.join(storageRoot, "shared", safePipelineId);

      await mkdir(sharedRoot, { recursive: true });
      store.updateStorageConfig({
        enabled: true,
        rootPath: storageRoot,
        sharedFolder: "shared",
        isolatedFolder: "isolated",
        runsFolder: "runs"
      });

      const uploadHandler = route("POST", "/api/files/upload");
      const firstChunk = Buffer.from("hello ");
      const secondChunk = Buffer.from("world");
      const totalSize = firstChunk.length + secondChunk.length;

      const uploadPartOne = await invokeRoute(uploadHandler, {
        method: "POST",
        path: "/api/files/upload",
        body: {
          pipelineId: pipeline.id,
          scope: "shared",
          destinationPath: "docs/note.txt",
          uploadId: "upload-1",
          chunkIndex: 0,
          totalChunks: 2,
          totalSizeBytes: totalSize,
          chunkBase64: firstChunk.toString("base64")
        }
      });
      expect(uploadPartOne.statusCode).toBe(202);

      const uploadPartTwo = await invokeRoute(uploadHandler, {
        method: "POST",
        path: "/api/files/upload",
        body: {
          pipelineId: pipeline.id,
          scope: "shared",
          destinationPath: "docs/note.txt",
          uploadId: "upload-1",
          chunkIndex: 1,
          totalChunks: 2,
          totalSizeBytes: totalSize,
          chunkBase64: secondChunk.toString("base64")
        }
      });
      expect(uploadPartTwo.statusCode).toBe(201);

      const uploadedContent = await readFile(path.join(sharedRoot, "docs", "note.txt"), "utf8");
      expect(uploadedContent).toBe("hello world");

      const rawHandler = route("GET", "/api/files/raw/:scope/:pipelineId/:runId/*");
      const rawResponse = await invokeRoute(rawHandler, {
        method: "GET",
        path: `/api/files/raw/shared/${pipeline.id}/-/docs/note.txt`,
        params: {
          scope: "shared",
          pipelineId: pipeline.id,
          runId: "-",
          "0": "docs/note.txt"
        },
        query: {
          download: "1"
        }
      });
      expect(rawResponse.statusCode).toBe(200);
      expect(String(rawResponse.getHeader("content-disposition"))).toContain("attachment;");
      expect(String(rawResponse.getHeader("content-disposition"))).toContain("note.txt");
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
      await cleanup();
    }
  });

  it("imports files from URL and blocks localhost sources", async () => {
    const { app, route } = createRouteHarness();
    const { store, cleanup } = await createTempStore();
    const storageRoot = await mkdtemp(path.join(tmpdir(), "fyreflow-files-"));
    const originalFetch = global.fetch;
    const previousDnsValidationFlag = process.env.FYREFLOW_DISABLE_URL_IMPORT_DNS_VALIDATION;

    try {
      process.env.FYREFLOW_DISABLE_URL_IMPORT_DNS_VALIDATION = "1";
      registerFileManagerRoutes(app as never, { store } as never);
      const pipeline = store.listPipelines()[0];
      const safePipelineId = safeStorageSegment(pipeline.id);
      const sharedRoot = path.join(storageRoot, "shared", safePipelineId);
      await mkdir(sharedRoot, { recursive: true });

      store.updateStorageConfig({
        enabled: true,
        rootPath: storageRoot,
        sharedFolder: "shared",
        isolatedFolder: "isolated",
        runsFolder: "runs"
      });

      global.fetch = async () =>
        new Response("remote body", {
          status: 200,
          headers: {
            "content-type": "text/plain"
          }
        });

      const importHandler = route("POST", "/api/files/import-url");
      const importResponse = await invokeRoute(importHandler, {
        method: "POST",
        path: "/api/files/import-url",
        body: {
          pipelineId: pipeline.id,
          scope: "shared",
          sourceUrl: "https://example.com/assets/readme.txt"
        }
      });

      expect(importResponse.statusCode).toBe(201);
      const importedContent = await readFile(path.join(sharedRoot, "readme.txt"), "utf8");
      expect(importedContent).toBe("remote body");

      const blockedResponse = await invokeRoute(importHandler, {
        method: "POST",
        path: "/api/files/import-url",
        body: {
          pipelineId: pipeline.id,
          scope: "shared",
          sourceUrl: "http://localhost:8080/internal.txt",
          destinationPath: "internal.txt"
        }
      });
      expect(blockedResponse.statusCode).toBe(400);

      const blockedMappedIpv6Response = await invokeRoute(importHandler, {
        method: "POST",
        path: "/api/files/import-url",
        body: {
          pipelineId: pipeline.id,
          scope: "shared",
          sourceUrl: "http://[::ffff:127.0.0.1]/internal.txt",
          destinationPath: "internal-ipv6.txt"
        }
      });
      expect(blockedMappedIpv6Response.statusCode).toBe(400);

      const blockedLocalhostDotResponse = await invokeRoute(importHandler, {
        method: "POST",
        path: "/api/files/import-url",
        body: {
          pipelineId: pipeline.id,
          scope: "shared",
          sourceUrl: "http://localhost./internal.txt",
          destinationPath: "internal-localhost-dot.txt"
        }
      });
      expect(blockedLocalhostDotResponse.statusCode).toBe(400);
    } finally {
      if (typeof previousDnsValidationFlag === "string") {
        process.env.FYREFLOW_DISABLE_URL_IMPORT_DNS_VALIDATION = previousDnsValidationFlag;
      } else {
        delete process.env.FYREFLOW_DISABLE_URL_IMPORT_DNS_VALIDATION;
      }
      global.fetch = originalFetch;
      await rm(storageRoot, { recursive: true, force: true });
      await cleanup();
    }
  });

  it("blocks URL imports that redirect to private hosts", async () => {
    const { app, route } = createRouteHarness();
    const { store, cleanup } = await createTempStore();
    const storageRoot = await mkdtemp(path.join(tmpdir(), "fyreflow-files-"));
    const originalFetch = global.fetch;
    const previousDnsValidationFlag = process.env.FYREFLOW_DISABLE_URL_IMPORT_DNS_VALIDATION;

    try {
      process.env.FYREFLOW_DISABLE_URL_IMPORT_DNS_VALIDATION = "1";
      registerFileManagerRoutes(app as never, { store } as never);
      const pipeline = store.listPipelines()[0];
      const safePipelineId = safeStorageSegment(pipeline.id);
      const sharedRoot = path.join(storageRoot, "shared", safePipelineId);
      await mkdir(sharedRoot, { recursive: true });

      store.updateStorageConfig({
        enabled: true,
        rootPath: storageRoot,
        sharedFolder: "shared",
        isolatedFolder: "isolated",
        runsFolder: "runs"
      });

      global.fetch = async () =>
        new Response(null, {
          status: 302,
          headers: {
            location: "http://localhost:8080/private.txt"
          }
        });

      const importHandler = route("POST", "/api/files/import-url");
      const response = await invokeRoute(importHandler, {
        method: "POST",
        path: "/api/files/import-url",
        body: {
          pipelineId: pipeline.id,
          scope: "shared",
          sourceUrl: "https://example.com/public.txt"
        }
      });

      expect(response.statusCode).toBe(400);
      expect(response.body).toMatchObject({
        error: "Localhost URLs are not allowed."
      });
    } finally {
      if (typeof previousDnsValidationFlag === "string") {
        process.env.FYREFLOW_DISABLE_URL_IMPORT_DNS_VALIDATION = previousDnsValidationFlag;
      } else {
        delete process.env.FYREFLOW_DISABLE_URL_IMPORT_DNS_VALIDATION;
      }
      global.fetch = originalFetch;
      await rm(storageRoot, { recursive: true, force: true });
      await cleanup();
    }
  });
});
