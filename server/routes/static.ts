import express from "express";
import path from "path";
import { applyHtmlShellHeaders } from "../securityHeaders";

export type StaticRoutesDeps = Record<string, never>;

export async function registerStaticRoutes(
  app: express.Express,
  _deps: StaticRoutesDeps = {},
) {
  if (!process.env.NODE_ENV || process.env.NODE_ENV === "development") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath =
      process.env.NODE_ENV !== "production" && process.env.SYNDIK_TEST_DIST_DIR
        ? path.resolve(process.env.SYNDIK_TEST_DIST_DIR)
        : path.join(process.cwd(), "dist");
    const assetsPath = path.join(distPath, "assets") + path.sep;
    const guidesPath = path.join(distPath, "guides", "screenshots") + path.sep;
    const iconsPath = path.join(distPath, "icons") + path.sep;
    // The HTML shell must be revalidated so a new release is picked up at once, and
    // it should not be framed by other origins. Vite content-hashes everything under
    // /assets, so those files never change in place and can be cached indefinitely.
    const shellHeaders = (res: express.Response) => {
      applyHtmlShellHeaders(res);
    };
    app.use(
      express.static(distPath, {
        setHeaders(res, filePath) {
          res.setHeader("X-Content-Type-Options", "nosniff");
          if (filePath.startsWith(assetsPath))
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          else if (filePath.startsWith(guidesPath))
            res.setHeader("Cache-Control", "public, max-age=86400");
          else if (filePath.startsWith(iconsPath))
            res.setHeader("Cache-Control", "public, max-age=3600, must-revalidate");
          else if (filePath.endsWith(".webmanifest")) {
            res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
            res.setHeader("Cache-Control", "no-cache");
          } else if (path.basename(filePath) === "sw.js") {
            res.setHeader("Cache-Control", "no-cache");
          } else if (filePath.endsWith(".html")) shellHeaders(res);
        },
      }),
    );
    app.get("*all", async (req, res) => {
      if (req.path.startsWith("/api/")) {
        return res
          .status(404)
          .json({ ok: false, error: "API route not found" });
      }
      // A hashed file that no longer exists (an open tab from the previous release
      // lazy-loading a chunk) must fail as a 404. Answering with index.html and a
      // 200 turns it into an opaque "Unexpected token <" script error.
      if (
        req.path.startsWith("/assets/") ||
        req.path.startsWith("/guides/screenshots/") ||
        req.path.startsWith("/icons/")
      )
        return res.status(404).type("text/plain").send("Not found");
      shellHeaders(res);
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
}
