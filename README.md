# MinecraftSpeedProxy_DataStatisticsTool

Minecraft-Speed-Proxy工具，从基于HTTP的File Server拉取log文件并统计数据，提供WebUI控制。

## 运行环境

- Node.js 18+

## 配置

`./config.json`：

```json
{
  "logsUrl": "http://domain:port/",
  "serverHost": "0.0.0.0",
  "serverPort": 8889,
  "requestTimeoutMs": 15000,
  "allowInsecureTls": false,
  "maxConcurrentDownloads": 4
}
```

- `logsUrl`: 你的日志目录 URL（必须能直接访问目录页）、

## 使用

```bash
git clone https://github.com/XiaoQing235/MinecraftSpeedProxy_DataStatisticsTool.git
cd MinecraftSpeedProxy_DataStatisticsTool
```

修改`./config.json`

```bash
npm install
npm start
```

## Web功能

- `Calculate`: 调用服务端计算逻辑
- `Download JSON`: 下载最新生成的结果 JSON

## 计算结果输出路径

`./calcData/YYYY_MM_DD_hh_mm_ss.json`

## TODO List

1. 更好看的WebUI
2. 密码保护

## Credits

- [AllesUgo/Minecraft-Speed-Proxy](https://github.com/AllesUgo/Minecraft-Speed-Proxy)