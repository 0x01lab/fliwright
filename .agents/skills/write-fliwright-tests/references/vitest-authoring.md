# Vitest 测试编写

适用：新建测试，调整用例注册、参数化、hooks 或 fixtures。Fliwright 负责 Flutter 操作、场景准备与 locator 断言；测试注册及生命周期遵循目标项目支持的 Vitest API。

需要起步代码时，按需求选择 [基础测试模板](./test-templates.md)，本页用于核对签名与生命周期规则。

## API 来源与版本

先从目标项目的安装结果确认 Vitest 版本，例如本地 `vitest --version`，再核对 package.json / lockfile。按本次用到的接口查阅官方文档：

- [test API](https://cn.vitest.dev/api/test.html)：`test.for`、`test.each`、标题格式、options、`test.beforeEach` / `test.afterEach`。
- [hooks](https://cn.vitest.dev/api/hooks.html)：生命周期、cleanup 和执行顺序。
- [TestContext](https://cn.vitest.dev/guide/test-context.html)：扩展 fixtures 与 `onTestFinished`。
- [CLI](https://cn.vitest.dev/guide/cli.html)：`vitest list`；具体选项以安装版本的 `list --help` 为准。

官网可能描述比项目更新的接口；核对版本标记与本地类型，不因示例需要而升级依赖。`test.scenario(name)` 是 Fliwright 扩展，签名以当前 `@fliwright/vitest` 的实现/类型为准，不把它当成 Vitest 原生 API。

## 参数化与场景

同一个行为、相同基线、不同输入使用标准参数化。需要 Fliwright 或项目 fixtures 时优先 `test.for`：第一参数保留完整数据行，第二参数是测试上下文。

```typescript
test.scenario('home.logged-in').for([
  { target: 'home', key: 'home.balance' },
  { target: 'assets', key: 'assets.balance' },
] as const)('$target 显示已登录用户余额', async ({ target, key }, { page }) => {
  await page.goto(`/${target}`);
  await expect(page.getByKey(key), '余额可见').toBeVisible();
});
```

`test.each` 适合普通数据参数，也应支持；数组行会展开为位置参数，不要把第二个数据参数误写成 `{ page }`。`test.for` 的数组行不展开。两者都须按官方接口编写，不自造回调签名。

不要这样注册独立用例：

```typescript
for (const target of targets) {
  test(`打开 ${target}`, async ({ page }) => { /* ... */ });
}
```

顶层循环在 Vitest 运行时合法，但不符合本 skill 的可发现性约定。使用字面量表格或本文件可静态确定的 `const` 数据，以及 `%s` / `$property` 等标准标题模板。保持标题在文件/套件内唯一；保留计划绑定使用的用例 ID 与名称。导入的数据或函数生成的标题可能在编辑器中显示为 `<dynamic>`，运行时可收集不等于编辑器可展开。

数据行需要不同场景时，先判断它们是否属于不同前置条件。不能使用 `.scenario(row.scenario).for(rows)`，因为选择场景时还没有 `row`；也不能在测试体里补做场景准备。分别用字面量声明场景和测试，提取共用操作函数；仅将共享同一场景的行组成参数表。不要为了复用测试体而修改原有场景语义。

用例内部遍历控件或执行有界重复操作可以保留。要独立重试、报告或建立前置状态的分支才应拆为独立用例。滚动等操作应有可观察的终止条件和失败上限，不能用固定次数代替“已到底”的验证。

## Hooks、清理与隔离

可复用的认证、Mock、storage 和入口状态用命名 `TestScenario`。hooks 用于局部准备、观测或清理，不能用它替代已有场景体系。

本工作流在每个测试脚本中显式声明 hooks：`test.beforeEach` 调用项目 support 中适用的回首页方法（例如 Exio 的 `exio.openHome()`），`test.afterEach` 清除全部 App HTTP Mock 路由。support 封装不同 App 的路由重置、弹层处理与首页就绪逻辑；方法调用及 hook 注册保留在测试脚本中。优先复用已验证的方法，不统一硬编码 `page.goto('/home')`。完整代码及与场景准备、临时状态恢复的顺序见 [脚本内生命周期](./test-templates.md#脚本内生命周期)。

`test.beforeEach` / `test.afterEach` 是 Vitest 标准 API；安装版本支持时，优先在项目导出的扩展 `test` 上注册，继承项目 fixture 类型。Fliwright 顶层导出的 `beforeEach` / `afterEach` 只声明基础 `{ page }` 类型，不能据此假设能访问项目 fixture。`beforeAll` / `afterAll` 没有每条测试的 Fliwright fixture 生命周期，不在其中访问 `page` 或 app fixture。

将临时状态保存在每次调用的局部变量中，通过 `beforeEach` 返回 cleanup 或 fixture 的 `try/finally` + `use` 释放，避免模块级 `let savedState`。在修改状态前安排清理；如果使用返回 cleanup 的方式，准备阶段发生异常时也须恢复已做的修改。所有异步清理都要等待。

`beforeEach` 返回的 cleanup 在其他 `afterEach` 之后、普通测试 fixture 释放之前执行，适合恢复通过 `exio` 等项目 fixture 修改的状态。`onTestFinished` 适合清理不依赖这些 fixture 的资源：当前 Vitest runner 在普通测试 fixture 释放后才调用它，不能在其中使用已释放的 driver/page。涉及生命周期时核对安装版本。需要跨多个用例复用的资源生命周期优先放进 fixture。

共享同一个 Flutter app 的用例保持串行，包括文件间执行。不要对它们使用 `.concurrent`；只把单文件设置为顺序执行不能阻止其他文件同时修改 app。

## 断言与可读性

- 可见文本、状态使用 Fliwright `expect(locator, title)`，复杂返回值使用单独导入的 Vitest `expect`。wrapper 没有 own text 时定位实际文字后代，不通过拼接整棵子树绕过 locator 断言。
- 无匹配器的原始属性、几何关系、请求数据可以用 Vitest 断言/`expect.poll`；必要时说明理由。轮询必须等待目标状态，不能将“第一次满足”解释为持续不变。
- 精确次数和无请求检查见 [assertions.md](./assertions.md#请求断言)。固定 Mock ID 可能让 UI 去重掩盖重复请求，不能用一个消息节点替代请求总数。
- imports 放文件开头；操作、等待、断言分行。helper 描述业务动作，保留场景声明、用例名和关键预期的可读性。

## 用例收集与交付

变更测试注册后，先运行目标文件的收集检查，再按任务运行类型检查和真实测试。安装版本支持时，例如：

```bash
pnpm exec vitest list .fliwright/tests/example.test.ts --json --staticParse=false
```

`--staticParse=false` 用运行时注册结果核对包装后的测试；先用本地 `list --help` 确认支持。收集会加载测试模块，但不执行测试体，不把连接 app、提交请求等副作用放在模块顶层。

核对预期用例 ID、完整名称、数量与唯一性；绑定已有计划时保持绑定一致。编辑器发现相关任务还要核对 Tests 列表或当前插件解析器的输出，不能以 Vitest 收集成功替代静态展开验证。

类型检查必须包含改动的 `.fliwright/tests` 文件，不能只检查接入配置。交付区分：收集/编辑器发现、类型检查、真实 app 执行；未运行 app 时不声称业务通过。
