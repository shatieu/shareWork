#!/usr/bin/env node
// Zero-dependency: renders an ask-human spec into a self-contained HTML page and
// serves it locally, accepting a single /submit POST that writes answers.json.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "..", "template", "page.html.tmpl");
const CHOICE_TYPES = new Set(["single-select", "multi-select", "compare"]);
const KNOWN_TYPES = new Set([
  "single-select", "multi-select", "text", "yesno", "rating", "ranking", "compare",
]);
const BASE_PORT = 8765;
const MAX_PORT_TRIES = 25;

function fail(message) {
  console.error("ask-human: " + message);
  process.exit(1);
}

function validateSpec(spec) {
  if (!Array.isArray(spec) || spec.length === 0) {
    throw new Error("spec.json must be a non-empty array of questions");
  }
  const seenIds = new Set();
  spec.forEach((q, i) => {
    const where = `question[${i}]`;
    if (!q || typeof q !== "object") throw new Error(`${where} must be an object`);
    if (!q.id || typeof q.id !== "string") throw new Error(`${where} is missing a string "id"`);
    if (seenIds.has(q.id)) throw new Error(`duplicate question id "${q.id}"`);
    seenIds.add(q.id);
    if (!q.prompt || typeof q.prompt !== "string") {
      throw new Error(`question "${q.id}" is missing a string "prompt"`);
    }
    if (!KNOWN_TYPES.has(q.type)) {
      throw new Error(`question "${q.id}" has unknown type "${q.type}" (expected one of ${[...KNOWN_TYPES].join(", ")})`);
    }
    if (CHOICE_TYPES.has(q.type)) {
      if (!Array.isArray(q.choices) || q.choices.length === 0) {
        throw new Error(`question "${q.id}" (${q.type}) needs a non-empty "choices" array`);
      }
      q.choices.forEach((c, ci) => {
        if (!c || typeof c.value !== "string" || typeof c.label !== "string") {
          throw new Error(`question "${q.id}" choices[${ci}] needs string "value" and "label"`);
        }
      });
    }
    if (q.type === "ranking" && (!Array.isArray(q.choices) || q.choices.length === 0)) {
      throw new Error(`question "${q.id}" (ranking) needs a non-empty "choices" array`);
    }
  });
}

function sanitizeFilename(name) {
  const base = path.basename(String(name || "file")).replace(/[^a-zA-Z0-9._-]/g, "_");
  return base || "file";
}

function renderHtml(spec) {
  const template = fs.readFileSync(TEMPLATE_PATH, "utf8");
  const json = JSON.stringify(spec).replace(/</g, "\\u003c");
  return template.replace("__ASK_HUMAN_SPEC_JSON__", json);
}

function openBrowser(url) {
  const platform = process.platform;
  let cmd;
  if (platform === "win32") cmd = `start "" "${url}"`;
  else if (platform === "darwin") cmd = `open "${url}"`;
  else cmd = `xdg-open "${url}"`;
  exec(cmd, () => {});
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function handleSubmit(req, res, sessionDir) {
  readBody(req)
    .then((buf) => {
      let payload;
      try {
        payload = JSON.parse(buf.toString("utf8"));
      } catch {
        throw new Error("invalid JSON body");
      }
      const answers = Array.isArray(payload.answers) ? payload.answers : [];
      const attachmentsDir = path.join(sessionDir, "attachments");
      const finalAnswers = answers.map((a) => {
        const attachmentPaths = [];
        (a.attachments || []).forEach((att, idx) => {
          const m = /^data:([^;]+);base64,(.+)$/s.exec(att.dataUrl || "");
          if (!m) return;
          fs.mkdirSync(attachmentsDir, { recursive: true });
          const safeName = `${a.id}__${idx}__${sanitizeFilename(att.filename)}`;
          fs.writeFileSync(path.join(attachmentsDir, safeName), Buffer.from(m[2], "base64"));
          attachmentPaths.push(path.join("attachments", safeName).replace(/\\/g, "/"));
        });
        return { id: a.id, type: a.type, value: a.value, attachments: attachmentPaths };
      });
      fs.writeFileSync(
        path.join(sessionDir, "answers.json"),
        JSON.stringify(finalAnswers, null, 2)
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    })
    .catch((err) => {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    });
}

function startServer(sessionDir, htmlPath, port, triesLeft) {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(htmlPath));
      return;
    }
    if (req.method === "POST" && req.url === "/submit") {
      handleSubmit(req, res, sessionDir);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && triesLeft > 0) {
      startServer(sessionDir, htmlPath, port + 1, triesLeft - 1);
    } else {
      fail(`could not start server: ${err.message}`);
    }
  });

  server.listen(port, () => {
    const url = `http://localhost:${port}/`;
    fs.writeFileSync(path.join(sessionDir, "server.pid"), String(process.pid));
    fs.writeFileSync(path.join(sessionDir, "url.txt"), url);
    openBrowser(url);
    console.log(`ASK_HUMAN_URL: ${url}`);
    console.log(`ask-human: serving session "${path.basename(sessionDir)}" — waiting for submission.`);
  });
}

function main() {
  const sessionDirArg = process.argv[2];
  if (!sessionDirArg) fail("usage: node server.mjs <sessionDir>");
  const sessionDir = path.resolve(sessionDirArg);
  const specPath = path.join(sessionDir, "spec.json");
  if (!fs.existsSync(specPath)) fail(`spec.json not found at ${specPath}`);

  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
    validateSpec(spec);
  } catch (err) {
    fail(`invalid spec.json — ${err.message}`);
    return;
  }

  const htmlPath = path.join(sessionDir, "index.html");
  fs.writeFileSync(htmlPath, renderHtml(spec));

  startServer(sessionDir, htmlPath, BASE_PORT, MAX_PORT_TRIES);
}

main();
