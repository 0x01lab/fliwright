# Fliwright Support 参数设计

## 用户流程

项目作者在 `.fliwright/support/` 声明参数，并在 `fliwright.config.ts` 注册。开发者从 VS Code 的 Fliwright 侧栏打开 **Support Settings**，选择项目和 support，填写表单后点击 **Save**。下一次使用该 support 时，CLI、Vitest 测试和 Node 脚本均可通过 `@fliwright/core` 读取已保存的值。参数属于执行 Fliwright 的主机和项目，同一项目的成员可以各自填写。

仓库已有通过项目配置显式导入 support 的用法。当前 `.fliwright/support/` 下的模块也可直接作为测试夹具使用。表单注册沿用显式导入，运行时通过 support 自己持有的声明读取参数。发现表单只需要导入项目配置及其声明依赖，support 的执行逻辑在实际调用时运行。[E2E 项目配置](../../../e2e/fliwright.config.ts) · [CLI 配置加载器](../../../packages/fliwright-cli/src/config.ts) · [VS Code 项目配置缓存](../../../packages/fliwright-vscode/src/WorkspaceProjectConfig.ts)

## 项目声明与使用

声明保留字面量类型，让 `readSupportSettings` 推导字段类型。有默认值或标为必填的字段在成功读取后有值，其余字段可为 `undefined`。

```ts
// .fliwright/support/navigation-settings.ts
import { defineSupportSettings } from '@fliwright/core';

export const navigationSettings = defineSupportSettings({
  id: 'navigation',
  title: 'Navigation',
  fields: {
    homeRoute: {
      type: 'string',
      label: 'Home route',
      default: '/home',
      env: 'APP_HOME_ROUTE',
    },
    settleTimeoutMs: {
      type: 'number',
      label: 'Settle timeout (ms)',
      integer: true,
      min: 0,
      default: 3000,
    },
    waitForIdle: { type: 'boolean', label: 'Wait for idle', default: true },
  },
});
```

```ts
// fliwright.config.ts
import { defineConfig } from '@fliwright/cli';
import { navigationSettings } from './.fliwright/support/navigation-settings.js';

export default defineConfig({ supportSettings: [navigationSettings] });
```

```ts
// .fliwright/support/open-home.ts
import { readSupportSettings, type Page } from '@fliwright/core';
import { navigationSettings } from './navigation-settings.js';

export async function openHome(page: Page) {
  const settings = await readSupportSettings(navigationSettings);
  await page.navigate(settings.homeRoute);
  if (settings.waitForIdle) {
    await page.settle({ timeout: settings.settleTimeoutMs });
  }
}
```

| 字段类型 | VS Code 控件 | 首版约束 |
| --- | --- | --- |
| `string` | 单行文本输入框 | `minLength`、`maxLength` |
| `number` | 数字输入框 | 有限数值、`min`、`max`、`integer` |
| `boolean` | 复选框，可恢复默认或未填写状态 | 保留显式的 `false` |
| `select` | 下拉列表 | 从 `{ value, label }` 列表选择一个字符串值 |

所有字段支持 `label`、`description`、`required`、`default` 和显式 `env` 绑定。声明只包含可序列化的数据。Core 在配置加载时校验重复 support ID、字段类型、范围、默认值及选项，项目配置错误包含对应声明的位置。Support ID 使用稳定的 ASCII 标识符，并限制为适合作为单个文件名的格式。字段键和选项的 `value` 用于存储，改标题和选项显示名称时沿用原键。

## 读取与保存

- **逐字段解析**。优先级为调用方传入的 `overrides` → 声明绑定的环境变量 → 本机保存值 → 项目默认值。只有 `env` 显式声明的变量参与解析。布尔环境值接受 `true` 和 `false`，数字值必须是有效的有限十进制数。字符串、空值和枚举按表单约束校验。高优先级来源的非法值报告该来源的错误。`false`、`0` 和允许为空的字符串均是已填写值。
- **按需加载**。`readSupportSettings(definition, { projectRoot?, overrides? })` 在 support 实际使用时读取。项目根依次取显式 `projectRoot`、`FLIWRIGHT_PROJECT_ROOT`、从当前工作目录向上查找的项目根。每次调用独立解析，下一次调用读到最近保存的值。需要在整次测试中固定参数的 support 可在测试或操作开始时读取一次并复用结果。必填字段最终缺失时，只在该 support 的调用中报告 support ID、字段及可填写位置。现有命令参数可由调用方经 `overrides` 传入。
- **按项目和 support 存储**。复用 `resolveFliwrightRuntimeRoot`，默认位置为 `~/.fliwright/<project-path>/support-settings/<project-key>/<support-id>.json`。`<project-key>` 由规范化后的实际项目根路径生成，用于区分被映射到同一个运行目录的项目。符号链接指向同一项目时共享配置。`FLIWRIGHT_RUNTIME_ROOT` 按现有约定改变父目录。文件存储 `{ version: 1, values: { ... } }`，只记录本机显式保存的值。项目默认值和环境值继续从各自来源获取。[项目运行目录解析](../../../packages/fliwright-core/src/runArtifacts.ts)
- **原子保存**。每个 support 独立存储，以同目录临时文件加原子替换写入，在支持的系统上使用 `0700` 目录和 `0600` 文件权限。按文件串行执行修订检查和写入。其他窗口已经保存时，编辑窗口保留草稿并提示重新加载。只保存当前字段的编辑，定义中已移除的键不参与运行时读取。字段类型变化使旧值失效时，面板提示修改或重置，运行时报告字段错误。损坏或版本不支持的文件显示读取错误，保留原文件。
- **首版保存普通参数**。令牌和密码由 support 通过既有环境变量获取。本机参数文件用于项目参数，保存值不进入项目配置快照、测试报告或诊断日志。远程工作区和 CI 由各自执行主机读取其本地文件或环境变量。

## VS Code 面板

面板作为 Fliwright 侧栏的 `WebviewView`，复用 VS Code 主题变量和窄列布局。单目录打开时直接显示该项目。多目录打开时提供项目选择器，读写始终使用所选项目根。选中 support 后按声明顺序显示字段。控件展示用户保存值，未设置时展示默认值或空态。绑定环境变量时提示变量名，实际执行环境决定覆盖值。必填字段缺失时显示待填状态，允许先保存已填且合法的字段。清除某字段的本机覆盖后，运行时继续按优先级解析。

面板提供保存、恢复所选字段的继承状态和刷新。切换项目、切换 support 或手动刷新时保留未保存的修改，用户确认后可以丢弃。扩展宿主校验表单请求，并绑定当前项目、声明版本和文件修订值。在受信任的工作区读取注册声明，未受信任时面板显示相应状态。打开面板、手动刷新及配置或 `.fliwright/support/` 变化时更新声明。配置加载失败和保存冲突在面板内反馈。打开或保存表单不需要连接 Flutter App。[Fliwright 侧栏视图](../../../packages/fliwright-vscode/package.json) · [VS Code 扩展入口](../../../packages/fliwright-vscode/src/extension.ts)

## 实现归属与验收

`@fliwright/core` 提供声明、统一校验、项目路径解析、本机存储和类型化读取。CLI 的项目配置和 Core 共享配置识别 `supportSettings`，延续现有 CLI 和 Vitest 的项目根传递。VS Code 扩展复用配置加载器发现声明，调用 Core 读取或保存本机值。普通 Node 脚本从工作目录发现项目，VS Code 启动脚本时传入所选项目根。Flutter Bridge 及设备 RPC 维持现有接口。[Core 共享配置](../../../packages/fliwright-core/src/RecordingConfig.ts) · [Vitest preset](../../../packages/fliwright-vitest/src/preset.ts) · [VS Code 脚本入口](../../../packages/fliwright-vscode/src/scripts/ScriptRunner.ts)

| 验收项 | 可观测结果 |
| --- | --- |
| 注册和渲染 | 同一份声明生成四类控件。重复 ID、非法默认值、非法选项在配置加载时定位。 |
| 保存和读取 | 保存后重开 VS Code 值仍存在。终端 CLI、Vitest 和 Node 脚本使用同一项目时读到相同本机值，测试已保存的 `false`、`0` 和空字符串。 |
| 优先级与缺参 | 显式值和已绑定环境变量按约定覆盖。缺失必填值只影响使用该 support 的操作，错误标明字段。 |
| 项目隔离 | 两个工作区目录即使共享 `FLIWRIGHT_RUNTIME_ROOT`，相同 support ID 也各自读写。嵌套目录启动和符号链接访问命中同一项目文件。 |
| 重置与冲突 | 清除保存值后恢复按优先级解析。旧窗口保存时发现修订不匹配，保留草稿。无效文件能在面板和运行时报错。 |
