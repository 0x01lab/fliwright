# @fliwright/cloud-protocol

Cloud Server、Worker 与 CI 使用的共享 wire contracts、Zod schemas、WebSocket 控制客户端和 HTTP 上传客户端和报告上传路径约束。
不导入 Server、SQLite、Worker 执行器或本机设备扫描库。设备快照类型由协议 schema 推导；`@fliwright/devices` 扫描结果按结构满足该协议。

```ts
import { WorkerControlClient, deviceInventorySchema } from '@fliwright/cloud-protocol';

const token = process.env.FLIWRIGHT_CLOUD_WORKER_TOKEN;
if (!token) throw new Error('Missing Worker credential');
const client = new WorkerControlClient('https://cloud.example.com', token);
const snapshot = deviceInventorySchema.parse({
  scannedAt: new Date().toISOString(), devices: [], diagnostics: [],
});
try {
  await client.request('/api/worker/devices', { body: snapshot });
} finally { client.close(); }
```

`WorkerControlClient` 使用请求 ID 关联响应，等待队列通知并指数退避重连；断线拒绝所有未完成请求，不自动重放变更。`watchLease` / `watchScan` 处理取消和失联，执行归属仍由租约约束。`CloudClient` 用于 CI HTTP API 与报告上传。

`CloudError` 保留操作状态码；`safeArtifactPath` 供上传方和接收方共同约束文件路径；`passesGitLabGate` 检查最新执行清理成功且报告已发布。运行时包自行管理配置与凭据读取。

当前与 Cloud/Worker 一同作为私有 workspace 包构建和部署，未发布 npm。
