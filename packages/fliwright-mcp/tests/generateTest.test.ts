import { describe, it, expect } from 'vitest';
import { handleGenerateTest } from '../src/tools/generateTest.js';

describe('handleGenerateTest', () => {
  it('generates test code from Flutter source with Text widgets', () => {
    const source = `
      Column(
        children: [
          Text('用户名'),
          TextField(decoration: InputDecoration(hintText: '请输入用户名')),
          Text('密码'),
          TextField(decoration: InputDecoration(hintText: '请输入密码')),
          ElevatedButton(onPressed: () {}, child: Text('登录')),
        ],
      )
    `;
    const result = handleGenerateTest({ source, testName: 'login flow' });
    expect(result.testName).toBe('login flow');
    expect(result.testCode).toContain("test('login flow'");
    expect(result.testCode).toContain("page.locator");
    expect(result.testCode).toContain("请输入用户名");
    expect(result.testCode).toContain("请输入密码");
    expect(result.testCode).toContain("登录");
  });

  it('generates type operations for TextField widgets', () => {
    const source = `
      TextField(decoration: InputDecoration(hintText: '邮箱'))
    `;
    const result = handleGenerateTest({ source });
    expect(result.testCode).toContain('.type(');
  });

  it('generates click operations for button widgets', () => {
    const source = `
      ElevatedButton(onPressed: () {}, child: Text('Submit'))
    `;
    const result = handleGenerateTest({ source });
    expect(result.testCode).toContain('.click()');
    expect(result.testCode).toContain('Submit');
  });

  it('uses default test name when not provided', () => {
    const result = handleGenerateTest({ source: "Text('Hello')" });
    expect(result.testName).toBe('generated test');
    expect(result.testCode).toContain("test('generated test'");
  });

  it('handles source with TextFormField', () => {
    const source = `
      TextFormField(decoration: InputDecoration(labelText: '姓名'))
    `;
    const result = handleGenerateTest({ source });
    expect(result.testCode).toContain('.type(');
    expect(result.testCode).toContain('姓名');
  });

  it('generates import statement', () => {
    const result = handleGenerateTest({ source: "Text('test')" });
    expect(result.testCode).toContain("import { test, expect } from '@fliwright/vitest'");
  });

  it('handles empty source gracefully', () => {
    const result = handleGenerateTest({ source: '' });
    expect(result.testCode).toContain("test('generated test'");
    expect(result.testCode).toBeDefined();
  });

  it('adds toBeVisible assertion for text that looks like titles', () => {
    const source = `
      Scaffold(
        appBar: AppBar(title: Text('我的应用')),
        body: Column(children: [
          Text('欢迎回来'),
          ElevatedButton(onPressed: () {}, child: Text('确定')),
        ]),
      )
    `;
    const result = handleGenerateTest({ source });
    expect(result.testCode).toContain('toBeVisible');
  });
});
