const fs = require("node:fs/promises");
const path = require("node:path");
const { downloadText } = require("./httpClient");

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatDate(date) {
  return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function formatFileDate(date) {
  return `${date.getFullYear()}_${pad2(date.getMonth() + 1)}_${pad2(date.getDate())}_${pad2(date.getHours())}_${pad2(date.getMinutes())}_${pad2(date.getSeconds())}`;
}

function parseLogTimestamp(datePart, hour, minute, second) {
  const [year, month, day] = datePart.split("-").map((v) => Number(v));
  return new Date(year, month - 1, day, Number(hour), Number(minute), Number(second));
}

function parseDurationToSeconds(durationText) {
  if (!durationText) {
    return null;
  }

  const match = durationText.trim().match(/^([\d.]+)\s*(seconds?|minutes?|hours?)$/i);
  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (Number.isNaN(value)) {
    return null;
  }

  if (unit.startsWith("hour")) {
    return Math.round(value * 3600);
  }

  if (unit.startsWith("minute")) {
    return Math.round(value * 60);
  }

  return Math.round(value);
}

function parseTrafficToKB(valueText, unitText) {
  const value = Number(valueText);
  if (Number.isNaN(value)) {
    return 0;
  }

  const unit = String(unitText || "").toUpperCase();
  if (unit === "GB") {
    return value * 1024 * 1024;
  }

  if (unit === "MB") {
    return value * 1024;
  }

  return value;
}

function formatKB(valueKB) {
  return `${valueKB.toFixed(3)} KB`;
}

function formatMB(valueMB) {
  return `${valueMB.toFixed(3)} MB`;
}

function formatMinutes(valueMinutes) {
  return `${valueMinutes.toFixed(3)} min`;
}

function formatHours(valueHours) {
  return `${valueHours.toFixed(3)} h`;
}

function formatMBPerMinute(value) {
  return `${value.toFixed(3)} MB/min`;
}

function formatMBPerHour(value) {
  return `${value.toFixed(3)} MB/hour`;
}

function extractLogUrls(indexHtml, baseUrl) {
  const urls = new Set();

  const hrefPattern = /href\s*=\s*["']([^"'<>]+\.log(?:\?[^"'<>]*)?)["']/gi;
  let match = hrefPattern.exec(indexHtml);
  while (match) {
    const candidate = match[1].replace(/&amp;/g, "&");
    try {
      const url = new URL(candidate, baseUrl).toString();
      urls.add(url);
    } catch (error) {
      // Ignore invalid URLs.
    }
    match = hrefPattern.exec(indexHtml);
  }

  const absolutePattern = /https?:\/\/[^\s"'<>]+\.log(?:\?[^\s"'<>]*)?/gi;
  let absoluteMatch = absolutePattern.exec(indexHtml);
  while (absoluteMatch) {
    const candidate = absoluteMatch[0].replace(/&amp;/g, "&");
    try {
      const url = new URL(candidate).toString();
      urls.add(url);
    } catch (error) {
      // Ignore invalid URLs.
    }
    absoluteMatch = absolutePattern.exec(indexHtml);
  }

  return Array.from(urls).sort((a, b) => {
    const nameA = path.basename(new URL(a).pathname);
    const nameB = path.basename(new URL(b).pathname);
    return nameA.localeCompare(nameB);
  });
}

function parsePlayerEvents(logText, fileName) {
  const events = [];
  const lines = logText.split(/\r?\n/);

  const basePattern = /^\[(\d{4}-\d{2}-\d{2}) (\d{2})-(\d{2})-(\d{2})\]\s+\[Player\]\s+Player\s+(.*?)\s+uuid:(.*?)\s+logged\s+(in|out)\s+from\b/i;
  const detailPattern = /online duration ([^,]+),\s*traffic used ([\d.]+)\s*(KB|MB|GB)/i;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const baseMatch = line.match(basePattern);
    if (!baseMatch) {
      continue;
    }

    const [, datePart, hour, minute, second, nameRaw, uuidRaw, actionRaw] = baseMatch;
    const timestamp = parseLogTimestamp(datePart, hour, minute, second);
    const action = actionRaw.toLowerCase();

    let durationSecondsFromLine = null;
    let trafficKBFromLine = null;

    if (action === "out") {
      const detailMatch = line.match(detailPattern);
      if (detailMatch) {
        durationSecondsFromLine = parseDurationToSeconds(detailMatch[1]);
        trafficKBFromLine = parseTrafficToKB(detailMatch[2], detailMatch[3]);
      } else {
        trafficKBFromLine = 0;
      }
    }

    events.push({
      timestamp,
      timestampMs: timestamp.getTime(),
      fileName,
      lineNumber: i + 1,
      nameRaw: (nameRaw || "").trim(),
      uuidRaw: (uuidRaw || "").trim(),
      action,
      durationSecondsFromLine,
      trafficKBFromLine
    });
  }

  return events;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let index = 0;

  const workers = new Array(Math.min(concurrency, items.length)).fill(null).map(async () => {
    while (true) {
      const currentIndex = index;
      index += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

function resolveIdentity(events) {
  const nameToUuid = new Map();
  const uuidToName = new Map();

  for (const event of events) {
    if (event.nameRaw && event.uuidRaw) {
      if (!nameToUuid.has(event.nameRaw)) {
        nameToUuid.set(event.nameRaw, event.uuidRaw);
      }
      if (!uuidToName.has(event.uuidRaw)) {
        uuidToName.set(event.uuidRaw, event.nameRaw);
      }
    }
  }

  const resolved = [];

  for (const event of events) {
    let name = event.nameRaw;
    let uuid = event.uuidRaw;

    if (!name && uuid) {
      name = uuidToName.get(uuid) || "";
    }

    if (!uuid && name) {
      uuid = nameToUuid.get(name) || "";
    }

    if (!name && uuid) {
      name = `unknown_${uuid.slice(0, 8)}`;
    }

    if (!name) {
      continue;
    }

    resolved.push({
      ...event,
      playerName: name,
      playerUuid: uuid
    });
  }

  return resolved;
}

function buildProxyData(events, calculationDate) {
  const players = new Map();

  for (const event of events) {
    if (!players.has(event.playerName)) {
      players.set(event.playerName, {
        uuid: event.playerUuid || "",
        pendingLogins: [],
        sessions: [],
        totalTrafficKB: 0,
        totalDurationSeconds: 0
      });
    }

    const player = players.get(event.playerName);

    if (!player.uuid && event.playerUuid) {
      player.uuid = event.playerUuid;
    }

    if (event.action === "in") {
      player.pendingLogins.push(event.timestamp);
      continue;
    }

    if (event.action !== "out") {
      continue;
    }

    const logoutTime = event.timestamp;
    const durationFromLine = event.durationSecondsFromLine;
    const trafficKB = event.trafficKBFromLine == null ? 0 : event.trafficKBFromLine;

    let loginTime = null;
    if (player.pendingLogins.length > 0) {
      loginTime = player.pendingLogins.pop();
      if (loginTime.getTime() > logoutTime.getTime()) {
        loginTime = null;
      }
    }

    if (!loginTime && durationFromLine != null) {
      loginTime = new Date(logoutTime.getTime() - (durationFromLine * 1000));
    }

    if (!loginTime) {
      loginTime = new Date(logoutTime.getTime());
    }

    let durationSeconds = Math.max(0, Math.round((logoutTime.getTime() - loginTime.getTime()) / 1000));
    if (durationFromLine != null) {
      durationSeconds = durationFromLine;
    }

    player.sessions.push({
      login_time: formatDate(loginTime),
      logout_time: formatDate(logoutTime),
      duration: `${durationSeconds} sec`,
      traffic: formatKB(trafficKB),
      trafficKB
    });

    player.totalTrafficKB += trafficKB;
    player.totalDurationSeconds += durationSeconds;
  }

  const playerData = {};
  let proxyTotalTrafficKB = 0;
  let proxyTotalDurationSeconds = 0;

  const sortedPlayerNames = Array.from(players.keys()).sort((a, b) => a.localeCompare(b));

  for (const playerName of sortedPlayerNames) {
    const player = players.get(playerName);
    proxyTotalTrafficKB += player.totalTrafficKB;
    proxyTotalDurationSeconds += player.totalDurationSeconds;

    const onlineData = {};
    for (let i = 0; i < player.sessions.length; i += 1) {
      const session = player.sessions[i];
      onlineData[String(i + 1)] = {
        login_time: session.login_time,
        logout_time: session.logout_time,
        duration: session.duration,
        traffic: session.traffic
      };
    }

    const totalTrafficMB = player.totalTrafficKB / 1024;
    const totalOnlineMinutes = player.totalDurationSeconds / 60;
    const averageSpeed = totalOnlineMinutes > 0 ? (totalTrafficMB / totalOnlineMinutes) : 0;

    playerData[playerName] = {
      uuid: player.uuid || "",
      online_data: onlineData,
      total_traffic: formatMB(totalTrafficMB),
      total_online_time: formatMinutes(totalOnlineMinutes),
      average_speed: formatMBPerMinute(averageSpeed)
    };
  }

  const proxyTotalTrafficMB = proxyTotalTrafficKB / 1024;
  const proxyTotalOnlineHours = proxyTotalDurationSeconds / 3600;
  const proxyAverageSpeed = proxyTotalOnlineHours > 0 ? (proxyTotalTrafficMB / proxyTotalOnlineHours) : 0;

  return {
    proxy_data: {
      player_data: playerData,
      proxy_total_traffic: formatMB(proxyTotalTrafficMB),
      proxy_total_online_time: formatHours(proxyTotalOnlineHours),
      proxy_average_speed: formatMBPerHour(proxyAverageSpeed),
      calculation_date: formatDate(calculationDate)
    }
  };
}

async function calculateAndSave(config) {
  const indexHtml = await downloadText(config.logsUrl, {
    timeoutMs: config.requestTimeoutMs,
    allowInsecureTls: config.allowInsecureTls
  });

  const logUrls = extractLogUrls(indexHtml, config.logsUrl);
  if (logUrls.length === 0) {
    throw new Error("未在日志目录页找到任何 .log 文件");
  }

  const eventGroups = await mapWithConcurrency(logUrls, config.maxConcurrentDownloads, async (logUrl) => {
    const text = await downloadText(logUrl, {
      timeoutMs: config.requestTimeoutMs,
      allowInsecureTls: config.allowInsecureTls
    });

    const fileName = path.basename(new URL(logUrl).pathname);
    return parsePlayerEvents(text, fileName);
  });

  const allEvents = eventGroups
    .flat()
    .sort((a, b) => (a.timestampMs - b.timestampMs) || a.fileName.localeCompare(b.fileName) || (a.lineNumber - b.lineNumber));

  const resolvedEvents = resolveIdentity(allEvents);
  const now = new Date();
  const output = buildProxyData(resolvedEvents, now);

  const calcDir = path.join(process.cwd(), "calcData");
  await fs.mkdir(calcDir, { recursive: true });

  const fileName = `${formatFileDate(now)}.json`;
  const filePath = path.join(calcDir, fileName);
  await fs.writeFile(filePath, JSON.stringify(output, null, 2), "utf8");

  const playerTotals = Object.entries(output.proxy_data.player_data).map(([playerName, value]) => ({
    player_name: playerName,
    total_traffic: value.total_traffic,
    total_online_time: value.total_online_time,
    average_speed: value.average_speed
  }));

  return {
    output,
    fileName,
    filePath,
    playerTotals,
    proxyTotalTraffic: output.proxy_data.proxy_total_traffic,
    proxyTotalOnlineTime: output.proxy_data.proxy_total_online_time,
    proxyAverageSpeed: output.proxy_data.proxy_average_speed,
    calculationDate: output.proxy_data.calculation_date
  };
}

module.exports = {
  calculateAndSave
};
