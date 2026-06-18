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

## 按键、复选框、选项

```typescript
pressKey(key: string, options?: { timeout?: number }): Promise<void>          // e.g. 'Enter', 'Backspace'
setCheckbox(checked: boolean, options?: { timeout?: number }): Promise<void>
selectOption(value: string | number, options?: { timeout?: number }): Promise<void>  // dropdown / picker
```

```typescript
await page.getByKey('agree').setCheckbox(true);
await page.getByKey('country').selectOption('CN');
await page.getByKey('search').pressKey('Enter');
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
