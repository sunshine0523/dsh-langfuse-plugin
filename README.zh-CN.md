# dsh-langfuse-plugin

适用于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的 Langfuse 可观测性插件。每个完成的 agent turn 会通过 OTLP/HTTP 导出为一条 Langfuse trace。

包名是 `dsh-langfuse-plugin`。这是 DSH bundle 插件，应使用 `dsh plugin` 安装，而不是直接执行普通的 `npm install`。

## 兼容性

当前版本已使用 **DeepSeek Harness `0.2.0-rc.2`** 和 Node.js **22.12 或更高版本**测试。依赖 DSH `0.2.0-rc.2` 的 session、home-path API，以及 Cordis `4.0.4` 和 Schemastery `3.18.4`。DSH 仍处于开发预览阶段，不同 DSH 版本之间可能存在兼容性变化。

## 功能

- 每个完成的 agent turn 对应一条 trace
- 记录工具调用、结果和工具错误
- 在可用时记录 assistant generation、模型和 token 用量
- 可选是否记录用户 prompt
- fail-open：缺少凭证或导出失败不会中断 DSH 会话
- 不依赖 Langfuse SDK，直接发送 OTLP/HTTP

## 安装

安装已发布的 npm 包：

```bash
dsh plugin --profile <profile> add dsh-langfuse-plugin
```

从源码目录安装：

```bash
dsh plugin --profile <profile> add /abs/path/to/dsh-langfuse-plugin
```

从打包文件安装：

```bash
npm pack
dsh plugin --profile <profile> add ./dsh-langfuse-plugin-0.1.2.tgz
```

包内包含 `lib/index.js` 和根目录的 `cordis.patch.yml`。patch 使用 `id: dsh-langfuse-plugin` 和 `name: dsh-langfuse-plugin` 挂载插件。

## 凭证

推荐直接在 Cordis 插件配置中设置凭证。缺少任意一个配置项时，再按以下顺序使用后备来源：

1. 环境变量 `LANGFUSE_PUBLIC_KEY` 和 `LANGFUSE_SECRET_KEY`
2. `$DSH_HOME/langfuse.json`（通常是 `~/.dsh/langfuse.json`）

```json
{
  "publicKey": "pk-lf-...",
  "secretKey": "sk-lf-..."
}
```

没有完整凭证时插件保持停用。设置 `debug: true` 可打印警告。

## 配置

通过 Cordis 配置插件：

```yaml
- id: dsh-langfuse-plugin
  name: dsh-langfuse-plugin
  config:
    publicKey: "pk-lf-..."
    secretKey: "sk-lf-..."
    baseUrl: "https://cloud.langfuse.com"
    environment: "development"
    userId: "user-123"
    capturePrompts: true
    timeoutMs: 30000
    debug: false
```

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `publicKey` | 后备来源 | Langfuse 项目公钥。 |
| `secretKey` | 后备来源 | Langfuse 项目私钥。 |
| `baseUrl` | `https://cloud.langfuse.com` | Langfuse 实例地址，自托管时可修改。 |
| `environment` | `development` | Langfuse environment 标签。 |
| `userId` | 未设置 | 可选的用户 ID。 |
| `capturePrompts` | `true` | 设为 `false` 后不记录用户 prompt，但保留 trace 结构。 |
| `timeoutMs` | `30000` | 导出超时和关闭时等待在途请求的预算，单位为毫秒。 |
| `debug` | `false` | 在警告中包含诊断详情。 |

## Trace 内容

收到 `turn/end` 后，插件发送一份 OTLP 文档，包含 `DSH Turn` 根 observation、`dsh.assistant` generation，以及每个工具调用对应的 `tool.<name>` observation。工具失败和 `agent/error` 会被标记为错误。

事件组装器处理 `turn/start`、`user/message`、`request/context`、`request/header`、`tool/call`、`tool/result`、`assistant/message` 和 `turn/end`。未知或格式错误的事件会被安全忽略。

## 开发

```bash
npm install
npm run typecheck
npm run build
```

- `src/turn-tracker.ts`：从 session 事件组装 turn trace
- `src/otlp-sink.ts`：编码并发送 OTLP/JSON
- `src/plugin.ts`：Cordis service 和事件监听
- `src/credentials.ts`：环境变量及 `$DSH_HOME` 凭证查找

## 许可证

MIT
