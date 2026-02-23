const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_CONFIG = {
  logsUrl: "https://domain:port/",
  serverHost: "0.0.0.0",
  serverPort: 3000,
  requestTimeoutMs: 15000,
  allowInsecureTls: false,
  maxConcurrentDownloads: 4
};

function normalizeLogsUrl(logsUrl) {
  let url;
  try {
    url = new URL(logsUrl);
  } catch (error) {
    throw new Error(`logsUrl 不是合法 URL: ${logsUrl}`);
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`logsUrl 必须使用 http 或 https 协议: ${logsUrl}`);
  }

  if (!url.pathname.endsWith("/")) {
    url.pathname += "/";
  }
  return url.toString();
}

async function loadConfig(configPath = path.join(process.cwd(), "config.json")) {
  const raw = await fs.readFile(configPath, "utf8");
  const userConfig = JSON.parse(raw);

  if (!userConfig.logsUrl) {
    throw new Error("config.json 缺少 logsUrl 配置");
  }

  const merged = {
    ...DEFAULT_CONFIG,
    ...userConfig
  };

  merged.logsUrl = normalizeLogsUrl(merged.logsUrl);

  if (!Number.isInteger(merged.serverPort) || merged.serverPort <= 0 || merged.serverPort > 65535) {
    throw new Error("serverPort 必须是 1-65535 的整数");
  }

  if (!Number.isInteger(merged.requestTimeoutMs) || merged.requestTimeoutMs <= 0) {
    throw new Error("requestTimeoutMs 必须是正整数");
  }

  if (!Number.isInteger(merged.maxConcurrentDownloads) || merged.maxConcurrentDownloads <= 0) {
    throw new Error("maxConcurrentDownloads 必须是正整数");
  }

  return merged;
}

module.exports = {
  loadConfig
};
