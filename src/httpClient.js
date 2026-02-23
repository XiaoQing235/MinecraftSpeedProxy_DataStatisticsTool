const http = require("node:http");
const https = require("node:https");

function downloadText(urlString, options = {}, redirectCount = 0) {
  const {
    timeoutMs = 15000,
    allowInsecureTls = false
  } = options;

  if (redirectCount > 5) {
    return Promise.reject(new Error(`请求重定向次数过多: ${urlString}`));
  }

  const url = new URL(urlString);
  const isHttps = url.protocol === "https:";
  const client = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      timeout: timeoutMs,
      rejectUnauthorized: !allowInsecureTls,
      headers: {
        Accept: "text/html, text/plain, */*",
        "User-Agent": "MinecraftSpeedProxyDataStatisticsTool/1.0"
      }
    }, (res) => {
      const statusCode = res.statusCode || 0;
      const location = res.headers.location;

      if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
        res.resume();
        const redirectUrl = new URL(location, urlString).toString();
        resolve(downloadText(redirectUrl, options, redirectCount + 1));
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        res.resume();
        reject(new Error(`请求失败 ${statusCode}: ${urlString}`));
        return;
      }

      const chunks = [];
      res.setEncoding("utf8");
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve(chunks.join(""));
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error(`请求超时: ${urlString}`));
    });

    req.on("error", (err) => {
      reject(err);
    });

    req.end();
  });
}

module.exports = {
  downloadText
};
