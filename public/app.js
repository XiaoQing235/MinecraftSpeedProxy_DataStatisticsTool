const calculateBtn = document.getElementById("calculateBtn");
const downloadBtn = document.getElementById("downloadBtn");
const statusWrap = document.querySelector(".status");
const statusText = document.getElementById("statusText");
const resultBody = document.getElementById("resultBody");
const proxyTotalTraffic = document.getElementById("proxyTotalTraffic");
const proxyTotalOnlineTime = document.getElementById("proxyTotalOnlineTime");
const proxyAverageSpeed = document.getElementById("proxyAverageSpeed");

let latestFileName = null;

function setStatus(message, type = "normal") {
  statusText.textContent = message;
  statusWrap.classList.remove("ok", "error");
  if (type === "ok") {
    statusWrap.classList.add("ok");
  } else if (type === "error") {
    statusWrap.classList.add("error");
  }
}

function renderResults(playerTotals, totalTraffic, totalOnlineTime, averageSpeed) {
  resultBody.innerHTML = "";

  for (const row of playerTotals) {
    const tr = document.createElement("tr");
    const tdPlayer = document.createElement("td");
    const tdTraffic = document.createElement("td");
    const tdOnlineTime = document.createElement("td");
    const tdAverageSpeed = document.createElement("td");

    tdPlayer.textContent = row.player_name;
    tdTraffic.textContent = row.total_traffic;
    tdOnlineTime.textContent = row.total_online_time;
    tdAverageSpeed.textContent = row.average_speed;

    tr.append(tdPlayer, tdTraffic, tdOnlineTime, tdAverageSpeed);
    resultBody.append(tr);
  }

  proxyTotalTraffic.textContent = `proxy_total_traffic: ${totalTraffic}`;
  proxyTotalOnlineTime.textContent = `proxy_total_online_time: ${totalOnlineTime}`;
  proxyAverageSpeed.textContent = `proxy_average_speed: ${averageSpeed}`;
}

calculateBtn.addEventListener("click", async () => {
  calculateBtn.disabled = true;
  downloadBtn.disabled = true;
  setStatus("计算中，请稍候...");

  try {
    const response = await fetch("/api/calculate", {
      method: "POST"
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.message || "计算失败");
    }

    renderResults(
      data.player_totals,
      data.proxy_total_traffic,
      data.proxy_total_online_time,
      data.proxy_average_speed
    );
    latestFileName = data.file_name;
    downloadBtn.disabled = false;
    setStatus(`计算完成，生成文件：${data.file_name}`, "ok");
  } catch (error) {
    setStatus(`计算失败：${error.message}`, "error");
  } finally {
    calculateBtn.disabled = false;
  }
});

downloadBtn.addEventListener("click", () => {
  if (!latestFileName) {
    window.location.href = "/api/download/latest";
    return;
  }

  window.location.href = `/api/download?file=${encodeURIComponent(latestFileName)}`;
});

async function init() {
  try {
    const response = await fetch("/api/status");
    const data = await response.json();
    if (response.ok && data.latest_file) {
      latestFileName = data.latest_file;
      downloadBtn.disabled = false;
      setStatus(`检测到已有结果文件：${data.latest_file}`);
    }
  } catch (error) {
    // Ignore status initialization failures.
  }
}

init();
