import type { Express } from "express";
import { readStoredFile, verifyStorageSignature } from "../storage";

export function registerStorageProxy(app: Express) {
  app.get("/files/*", async (req, res) => {
    const key = (req.params as Record<string, string>)[0];
    try {
      const expires = Number(req.query.expires);
      const signature = typeof req.query.signature === "string" ? req.query.signature : "";
      if (!await verifyStorageSignature(key, expires, signature)) {
        res.status(403).send("File link expired or invalid");
        return;
      }
      res.set("Cache-Control", "no-store");
      res.set("Content-Type", "application/pdf");
      res.set("X-Content-Type-Options", "nosniff");
      try {
        res.send(await readStoredFile(key));
      } catch {
        res.status(404).end();
      }
    } catch {
      res.status(400).send("Invalid file request");
    }
  });
}
