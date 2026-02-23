const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { loadConfig } = require("./config");
const { calculateAndSave } = require("./logCalculator");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function findLatestCalcFileName(calcDir) {
  try {
    const entries = await fsPromises.readdir(calcDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();

    if (files.length === 0) {
      return null;
    }

    return files[files.length - 1];
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function sanitizeDownloadFileName(fileName) {
  if (!fileName) {
    return null;
  }

  if (fileName.includes("/") || fileName.includes("\\")) {
    return null;
  }

  if (!fileName.endsWith(".json")) {
    return null;
  }

  return fileName;
}

async function serveStaticFile(publicDir, pathname, res) {
  let requestPath = pathname;
  if (requestPath === "/") {
    requestPath = "/index.html";
  }

  const normalizedPublicDir = path.resolve(publicDir);
  const normalizedPath = path.resolve(path.join(publicDir, requestPath.replace(/^\/+/, "")));
  const relative = path.relative(normalizedPublicDir, normalizedPath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  try {
    const stat = await fsPromises.stat(normalizedPath);
    if (!stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }

    const ext = path.extname(normalizedPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size
    });

    fs.createReadStream(normalizedPath).pipe(res);
  } catch (error) {
    if (error.code === "ENOENT") {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }

    throw error;
  }
}

async function startServer() {
  const config = await loadConfig();
  const publicDir = path.join(process.cwd(), "public");
  const calcDir = path.join(process.cwd(), "calcData");
  let latestFileName = await findLatestCalcFileName(calcDir);

  const server = http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const { pathname } = requestUrl;

      if (req.method === "POST" && pathname === "/api/calculate") {
        const result = await calculateAndSave(config);
        latestFileName = result.fileName;

        sendJson(res, 200, {
          success: true,
          proxy_total_traffic: result.proxyTotalTraffic,
          proxy_total_online_time: result.proxyTotalOnlineTime,
          proxy_average_speed: result.proxyAverageSpeed,
          player_totals: result.playerTotals,
          calculation_date: result.calculationDate,
          file_name: result.fileName
        });
        return;
      }

      if (req.method === "GET" && pathname === "/api/download/latest") {
        const targetFileName = latestFileName || await findLatestCalcFileName(calcDir);
        if (!targetFileName) {
          sendJson(res, 404, { success: false, message: "暂无可下载的计算结果文件" });
          return;
        }

        const filePath = path.join(calcDir, targetFileName);
        let stat;
        try {
          stat = await fsPromises.stat(filePath);
        } catch (error) {
          sendJson(res, 404, { success: false, message: "文件不存在" });
          return;
        }

        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${targetFileName}"`,
          "Content-Length": stat.size
        });
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      if (req.method === "GET" && pathname === "/api/download") {
        const requested = sanitizeDownloadFileName(requestUrl.searchParams.get("file"));
        if (!requested) {
          sendJson(res, 400, { success: false, message: "file 参数无效" });
          return;
        }

        const filePath = path.join(calcDir, requested);
        let stat;
        try {
          stat = await fsPromises.stat(filePath);
        } catch (error) {
          sendJson(res, 404, { success: false, message: "文件不存在" });
          return;
        }

        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${requested}"`,
          "Content-Length": stat.size
        });
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      if (req.method === "GET" && pathname === "/api/status") {
        sendJson(res, 200, {
          success: true,
          latest_file: latestFileName
        });
        return;
      }

      if (req.method === "GET") {
        await serveStaticFile(publicDir, pathname, res);
        return;
      }

      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Method Not Allowed");
    } catch (error) {
      sendJson(res, 500, {
        success: false,
        message: error.message
      });
    }
  });

  server.listen(config.serverPort, config.serverHost, () => {
    process.stdout.write(`Server started at http://${config.serverHost}:${config.serverPort}\n`);
  });
}

startServer().catch((error) => {
  process.stderr.write(`Server failed to start: ${error.message}\n`);
  process.exit(1);
});
