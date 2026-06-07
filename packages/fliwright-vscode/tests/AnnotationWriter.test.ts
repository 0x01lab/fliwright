import { describe, it, expect } from 'vitest';
import { AnnotationWriter } from '../src/editor/AnnotationWriter';

describe('AnnotationWriter', () => {
  const sampleCode = `test('test', async ({ page }) => {
  // @fliwright-step: {"name":"step1"}
  await page.locator({ text: 'a' }).click();

  // @fliwright-step: {"name":"step2"}
  await page.locator({ text: 'b' }).fill('hello');
  await page.locator({ text: 'c' }).tap();
});`;

  it('修改步骤名称时只改注解 JSON，不动业务代码', () => {
    const writer = new AnnotationWriter();
    const result = writer.updateAnnotation(sampleCode, 1, { name: '重命名步骤' });

    expect(result).toContain('"name":"重命名步骤"');
    expect(result).toContain("await page.locator({ text: 'a' }).click()");
    expect(result).toContain("await page.locator({ text: 'b' }).fill('hello')");
  });

  it('删除步骤时移除注解和对应代码行', () => {
    const writer = new AnnotationWriter();
    const result = writer.deleteStep(sampleCode, { annotationLine: 4, sourceEndLine: 7 });

    expect(result).not.toContain('"name":"step2"');
    expect(result).not.toContain("await page.locator({ text: 'b' }).fill('hello')");
    expect(result).toContain('"name":"step1"');
  });

  it('保持原有缩进和格式', () => {
    const writer = new AnnotationWriter();
    const result = writer.updateAnnotation(sampleCode, 1, { name: 'new name' });

    const lines = result.split('\n');
    expect(lines[1].startsWith('  // @fliwright-step:')).toBe(true);
  });

  it('处理不存在的行号（不修改）', () => {
    const writer = new AnnotationWriter();
    const result = writer.updateAnnotation(sampleCode, 999, { name: 'nope' });

    expect(result).toBe(sampleCode);
  });
});
