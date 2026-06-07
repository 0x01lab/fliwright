import { describe, it, expect } from 'vitest';
import { AnnotationParser } from '../src/editor/AnnotationParser';

describe('AnnotationParser', () => {
  const parser = new AnnotationParser();

  it('从 TS 代码中提取 @fliwright-step 注解和步骤', () => {
    const code = `test('购物流程', async ({ page }) => {
  // @fliwright-step: {"name":"填写登录表单"}
  await page.locator({ text: '手机号' }).fill('13800138000');
  await page.locator({ text: '登录' }).click();

  // @fliwright-step: {"name":"浏览商品","screenshot":"snapshots/step-2.png"}
  await page.locator({ text: '商品卡片' }).tap();
});`;

    const result = parser.parse(code);

    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].annotation.name).toBe('填写登录表单');
    expect(result.steps[0].annotationLine).toBe(1);
    expect(result.steps[0].atoms).toHaveLength(2);
    expect(result.steps[0].atoms[0].action).toBe('fill');
    expect(result.steps[0].atoms[0].selector).toBe("{ text: '手机号' }");
    expect(result.steps[0].sourceCode).toContain("fill('13800138000')");

    expect(result.steps[1].annotation.name).toBe('浏览商品');
    expect(result.steps[1].annotation.screenshot).toBe('snapshots/step-2.png');
    expect(result.steps[1].atoms).toHaveLength(1);
  });

  it('处理无注解的普通文件（返回空数组）', () => {
    const code = `test('hello', async ({ page }) => {
  await page.locator({ text: 'ok' }).click();
});`;

    const result = parser.parse(code);

    expect(result.steps).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('处理损坏的注解 JSON（标记为解析错误）', () => {
    const code = `test('test', async ({ page }) => {
  // @fliwright-step: {invalid json}
  await page.locator({ text: 'ok' }).click();
});`;

    const result = parser.parse(code);

    expect(result.steps).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].line).toBe(1);
    expect(result.errors[0].message).toContain('JSON');
  });

  it('步骤之间的代码行号范围正确', () => {
    const code = `test('test', async ({ page }) => {
  // @fliwright-step: {"name":"step1"}
  await page.locator({ text: 'a' }).click();

  // @fliwright-step: {"name":"step2"}
  await page.locator({ text: 'b' }).fill('hello');
  await page.locator({ text: 'c' }).tap();
});`;

    const result = parser.parse(code);

    expect(result.steps[0].sourceStartLine).toBe(2);
    expect(result.steps[0].sourceEndLine).toBe(2);
    expect(result.steps[1].sourceStartLine).toBe(5);
    expect(result.steps[1].sourceEndLine).toBe(6);
  });

  it('识别不同的 action 类型', () => {
    const code = `test('test', async ({ page }) => {
  // @fliwright-step: {"name":"mixed"}
  await page.locator({ text: 'btn' }).click();
  await page.locator({ text: 'input' }).fill('val');
  await page.locator({ text: 'list' }).scroll({ dy: 300 });
  await expect(page.locator({ text: 'title' })).toBeVisible();
});`;

    const result = parser.parse(code);
    const atoms = result.steps[0].atoms;

    expect(atoms[0].action).toBe('click');
    expect(atoms[1].action).toBe('fill');
    expect(atoms[2].action).toBe('scroll');
    expect(atoms[3].action).toBe('assert');
  });

  it('提取测试函数名', () => {
    const code = `test('购物流程测试', async ({ page }) => {
  // @fliwright-step: {"name":"step1"}
  await page.locator({ text: 'ok' }).click();
});`;

    const result = parser.parse(code);

    expect(result.testName).toBe('购物流程测试');
  });
});
