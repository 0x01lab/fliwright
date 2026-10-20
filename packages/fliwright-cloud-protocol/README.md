# @fliwright/cloud-protocol

Cloud Server、Worker 与 CI 使用的共享 wire contracts、Zod schemas、HTTP 客户端和报告上传路径约束。
不导入 Server、SQLite、Worker 执行器或本机设备扫描库。设备快照类型由协议 schema 推导；`@fliwright/devices` 扫描结果按结构满足该协议。

```ts
import { CloudClient, deviceInventorySchema } from '@fliwright/cloud-protocol';

const token = process.env.FLIWRIGHT_CLOUD_WORKER_TOKEN;
if (!token) throw new Error('Missing Worker credential');
const client = new CloudClient('https://cloud.example.com', token);
const snapshot = deviceInventorySchema.parse({
  scannedAt: new Date().toISOString(), devices: [], diagnostics: [],
});
await client.request('/api/worker/devices', { method: 'POST', body: snapshot });
```

`CloudError` 保留 HTTP 状态码；`safeArtifactPath` 供上传方和接收方共同约束文件路径；`passesGitLabGate` 检查最新执行清理成功且报告已发布。运行时包自行管理配置与凭据读取。

当前与 Cloud/Worker 一同作为私有 workspace 包构建和部署，未发布 npm。
