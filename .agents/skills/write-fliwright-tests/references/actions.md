# 操作（Actions）

对 `Locator` 执行操作。每个操作都返回 `Promise<void>`；当找不到控件时抛出的 `Error`，其 message 会包含桥接层的诊断 `contextDump`（最多 10 个可见控件）—— 当一次点击莫名失败时，先读它。

所有操作都发送到 `ext.fliwright.action`，载荷为 `{ action, ...selectorParams, ...options }`。`alignment`（默认 `'center'`）控制在匹配到的 rect 内的点击点：
`'center' | 'topLeft' | 'topCenter' | 'topRight' | 'centerLeft' | 'centerRight' |
'bottomLeft' | 'bottomCenter' | 'bottomRight'`。

## 点击与按压

```typescript
click(options?: {
  alignment?: AlignmentOption;
  timeout?: number;
  waitForAnimations?: boolean;   // settle Flutter animations after the tap
  settleTimeout?: number;        // ms for the settle step (default 2000)
}): Promise<void>
```

```typescript
await page.getByText('Continue').click();
await page.getByKey('go').click({ waitForAnimations: true, settleTimeout: 3000 });

// multi-clicks
await loc.doubleClick();
await loc.tripleClick();
await loc.rightClick();          // long-press-equivalent on touch

// hover / focus
await loc.hover();
await loc.focus();
await loc.blur();
```

`doubleClick` / `tripleClick` / `rightClick` / `hover` / `focus` 接受 `{ alignment?, timeout? }`。
`blur` 接受 `{ timeout? }`。

## 长按（Long press）

```typescript
longPress(options?: { duration?: number; alignment?: AlignmentOption; timeout?: number }): Promise<void>
```

```typescript
await page.getByText('Delete').longPress({ duration: 700 });
```

## 拖拽（Drag，按相对位移）

从控件中心按位移进行拖拽。Y 轴正方向向下。

```typescript
drag(deltaX: number, deltaY: number, options?: {
  steps?: number; alignment?: AlignmentOption; timeout?: number;
}): Promise<void>

dragTo(direction: 'left' | 'right' | 'up' | 'down', distance?: number, options?: {
  steps?: number; alignment?: AlignmentOption; timeout?: number;
}): Promise<void>
```

```typescript
await page.getByType('Slider').drag(120, 0, { steps: 12 });        // 120px right
await listTile.dragTo('left', 160);                                // swipe-to-reveal action
```

## 双指缩放（Pinch / zoom）

```typescript
pinch(scale: number, options?: {
  steps?: number; alignment?: AlignmentOption; timeout?: number;
}): Promise<void>
```

```typescript
await page.getByType('InteractiveViewer').pinch(1.25);   // zoom in
await page.getByType('InteractiveViewer').pinch(0.8);    // zoom out
```

## 滑块 / 验证码：`slideTo`

把一个控件滑动到绝对 X 坐标（例如验证码滑块上的滑块旋钮）。

```typescript
slideTo(targetX: number, options?: {
  steps?: number; alignment?: AlignmentOption; timeout?: number;
}): Promise<void>
```

```typescript
await page.getByKey('sliderKnob').slideTo(340, { steps: 25 });
```

## 文本输入

```typescript
type(text: string, options?: { delay?: number; charDelay?: number; timeout?: number }): Promise<void>
fill(text: string, options?: { delay?: number; charDelay?: number; timeout?: number }): Promise<void>
clear(options?: { timeout?: number }): Promise<void>
```

- **`fill()`** 会替换字段当前值（`replaceAll: true`）。用于设置一个已知值。
- **`type()`** 是追加/键入（`replaceAll: false`）。当你想要真实的按键行为时使用。
- `charDelay`（别名：`delay`）设置每个字符之间的延迟，单位毫秒。

```typescript
await page.getByKey('email').fill('alice@example.com');
await page.getByKey('search').type('hello', { charDelay: 30 });
await page.getByKey('email').clear();
```

### 关闭移动端软键盘

```typescript
page.dismissKeyboard(): Promise<void>
```

`dismissKeyboard()` 是 page-level action：它先清除 Flutter 当前焦点，再通过原生 text-input channel 请求隐藏软键盘。移动端表单填完最后一个输入框后，如果下一步/提交按钮可能被键盘遮挡，先调用它，再滚动并点击按钮。

```typescript
const next = page.getByKey('register.submitButton');

await page.getByKey('passwordConfirmField').fill(password);
await page.dismissKeyboard();
await page.settle({ timeout: 1000, stableFrames: 1 });
await next.scrollIntoViewAndClick({
  scroll: { alignment: 0.25, timeout: 10_000 },
  click: { timeout: 10_000, waitForAnimations: false },
});
```

如果 `dismissKeyboard()` 返回 `VM Service error [-32000]: Server error`，或手机上键盘仍然没有收起，通常是运行中的 Flutter app 还没加载新版 `fliwright_bridge`。停止当前 debug session 并重新 `flutter run` / hot restart；只重跑 TypeScript 脚本不会更新设备上的 Dart bridge 实现。

## 按键、复选框、选项

```typescript
pressKey(key: string, options?: { timeout?: number }): Promise<void>          // e.g. 'Enter', 'Backspace'
setCheckbox(checked: boolean, options?: { timeout?: number }): Promise<void>
check(options?: { timeout?: number }): Promise<void>
uncheck(options?: { timeout?: number }): Promise<void>
selectOption(value: string | number, options?: { timeout?: number }): Promise<void>  // dropdown / picker
```

```typescript
await page.getByKey('agree').setCheckbox(true);
await page.getBySemantics({ identifier: 'terms.accept' }).check();
await page.getByKey('country').selectOption('CN');
await page.getByKey('search').pressKey('Enter');
```

`check()` / `uncheck()` 是 `setCheckbox(true/false)` 的语义化别名。它们先读取当前选中状态，只有目标状态不同才点击。当前状态来自原生 `Checkbox` / `Switch` / `Radio`，或自定义控件暴露的 `Semantics(checked: ...)`、`Semantics(toggled: ...)`、`Semantics(selected: ...)`。Radio 通常只使用 `check()` 选择目标项，不要试图用 `uncheck()` 取消单个 radio。

### Select 操作策略

Flutter 应用里 select 的实现差异很大，先判断组件类型再选动作：

- 标准 `DropdownButton` 或桥接能直接看到 `items` + `onChanged` 的控件：优先用 `selectOption(value)`。
- 自定义 bottom sheet / dialog select：按真实用户路径写脚本，先点击字段打开弹层，再点击弹层里的 option。多选通常还要点击 `Done` / `完成` / 确认按钮。
- 带搜索框和虚拟列表的 picker：把搜索、等待 option、必要时滚动封装成该组件专用 helper。不要把某一个组件的流程泛化给所有 select。

常用 select 流程可以通过 `page.select.use(recipe, options)` 复用：

```typescript
await page.select.use('standardDropdown', {
  field: { key: 'employmentStatus' },
  value: 'FULL_TIME',
});

await page.select.use('bottomSheetOption', {
  open: { semantics: { identifier: 'myForm.jobNature.select' } },
  option: { semantics: { identifier: 'myForm.jobNature.option.FIN_INSURANCE' } },
});
```

内置 recipe 包括 `standardDropdown`、`bottomSheetOption`、`bottomSheetMultiOption`、
`searchablePicker`、`countryPicker`。项目也可以注册自己的组件动作：

```typescript
page.select.register('myProject.quickSelect', async ({ page }, options) => {
  await page.locator(options.open!).click({ waitForAnimations: true });
  await page.locator({ text: String(options.value) }).click({ waitForAnimations: true });
});
```

#### 国家/地区 picker 示例

国家/地区选择器是一个特殊的 searchable picker：点击字段后打开 bottom sheet，
搜索框会过滤国家列表，option 通常有稳定 semantics identifier。这个组件的推荐流程：

1. 点击国家字段本身，优先用字段 semantics identifier。
2. 等待搜索框（如 `countrySelect.searchField`）或首批国家 option 出现。
3. 用 `fill()` 设置完整国家名，或用 `type()` 逐字输入；两者都会通过 bridge 触发 `TextField.onChanged`。判断成功时看目标 option 是否出现，不只看搜索框文字。
4. 点击目标 option 的 semantics identifier，例如 `*.option.HK`。
5. 如果目标 option 没出现，说明搜索未命中或列表未渲染；在该 bottom sheet 的列表区域滚动，直到目标 option 可见再点击。

```typescript
await page.select.use('countryPicker', {
  open: { semantics: { identifier: 'myForm.countryField.select' } },
  search: { match: { key: 'myForm.countrySelect.searchField', type: 'EditableText' } },
  searchText: 'Hong Kong',
  value: 'HK',
  optionSemanticsId: 'myForm.countryField.option.${value}',
});
```

## 滚动到可视区域（Scroll into view）

```typescript
scrollIntoView(options?: { alignment?: number; duration?: number; timeout?: number }): Promise<void>
```

`alignment`（默认 `0.5`）决定控件应该在 viewport 的哪个位置停下（0 = 顶部，1 = 底部）。

```typescript
await page.getByText('Checkout').scrollIntoView();
await page.getByText('Checkout').scrollIntoView({ alignment: 0.2, duration: 400 });
```

## 原始坐标（控件树之外）

对那些**不在** Flutter 控件树里的表面使用这些方法 —— WebView 覆盖层、验证码滑块、广告等。

```typescript
// on Page:
page.clickAt(x: number, y: number): Promise<void>
page.dragFrom(x: number, y: number, deltaX: number, deltaY: number, options?: { steps?: number }): Promise<void>
```

`clickAt` 发送 `ext.fliwright.click`；`dragFrom` 发送 `ext.fliwright.dragFrom`（默认 20 步）。

```typescript
await page.clickAt(114, 204);
await page.dragFrom(120, 420, 0, -280, { steps: 16 });   // swipe up
```

> 基于坐标的测试天生脆弱（依赖分辨率/缩放）。只在 locator 无法表达目标时才使用，并且优先选用可由环境变量覆盖的坐标（`process.env.MY_TAP_X`），这样无需改代码就能微调测试。

## 对已解析控件做操作（fast path）

当你已经解析过某个控件（例如通过 `formHelper.analyze()`），就别再重新解析一次：

```typescript
await loc.fillWithResolved(text, resolvedWidget, options?: { charDelay?: number });
await loc.clickResolved(resolvedWidget);
```

## 失败诊断

当某个操作找不到目标时，抛出的错误会包含桥接层的 `contextDump`：

```
tap failed debug=… 

Visible widgets on screen:
  - ElevatedButton "Submit" [key=submit] role=button
  - TextField "Email" semantics="Email address"
  ...
```

先读这个列表 —— 它告诉你屏幕上实际有什么、以及为什么你的选择器没匹配到。
