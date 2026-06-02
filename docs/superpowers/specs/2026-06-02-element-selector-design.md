# 元素选择方案设计

> 日期：2026-06-02
> 状态：待实施

## 背景

Fliwright 当前使用前缀字符串格式的选择器（`text=邮箱`、`key=loginBtn`），存在三个核心问题：

1. **准确性不够** — 纯字符串匹配在复杂 UI 中容易选错元素，表单填写经常找不到目标
2. **性能瓶颈** — 每次查询都全树遍历 O(N)，大型应用下效率低
3. **表达能力不足** — 无法表达「Scaffold 下的 Form 里的 TextField」这种嵌套作用域查询

参考 Patrol 的链式 `$()` 选择器设计，结合 Fliwright 已有的自愈和语义匹配能力，重新设计选择器系统。

## 方案概述

**结构化查询对象 + 多级匹配引擎**：

- TS 端：`find()` API，支持链式和结构化两种调用方式
- Wire 格式：统一 JSON，`params['selector']` 为 JSON 字符串
- Dart 端：`SelectorParser` 解析 + `SelectorEngine` 执行多级匹配
- 不兼容旧格式，直接替换

---

## 1. 数据模型

### 1.1 SelectorQuery（TS + Dart 共享结构）

```
SelectorQuery {
  match?: MatchCriteria        // 主匹配条件
  within?: SelectorQuery       // 作用域（递归嵌套）
  fallback?: FallbackCriteria  // 主匹配失败时的回退
  position?: PositionFilter    // 位置过滤
}

MatchCriteria {
  type?: string          // Widget 类型，如 "ElevatedButton"
  key?: string           // Flutter Key
  text?: string          // 精确文本匹配
  textContains?: string  // 包含文本
  textRegex?: string     // 正则匹配文本
  role?: string          // 语义角色：button, textField, checkbox...
}

FallbackCriteria {
  semanticsLabel?: string  // 语义标签
  hintText?: string        // 输入框 hint
  tooltip?: string         // Tooltip 文本
}

PositionFilter {
  nth?: number       // 第 N 个匹配（0-based）
  first?: boolean    // 取第一个
  last?: boolean     // 取最后一个
  visible?: boolean  // 只匹配可见元素（默认 true）
}
```

### 1.2 Wire 格式

TS 端通过 `JSON.stringify` 序列化，作为 `params['selector']` 传入：

```json
{
  "method": "ext.fliwright.inspect",
  "params": {
    "selector": "{\"match\":{\"type\":\"TextField\",\"textContains\":\"邮箱\"},\"within\":{\"match\":{\"type\":\"Scaffold\"}}}"
  }
}
```

Dart 端 `SelectorParser` 通过 `jsonDecode` 反序列化为类型化对象。

---

## 2. TS 端 API 设计

### 2.1 `find()` 入口 — 三种调用方式

**方式一：结构化对象**（AI Agent 友好）

```ts
await page.find({
  match: { type: 'TextField', textContains: '邮箱' },
  within: { match: { type: 'Scaffold' } },
  fallback: { semanticsLabel: '邮箱地址', hintText: '请输入邮箱' }
}).fill('test@example.com');
```

**方式二：链式调用**（开发者友好）

```ts
await page.find({ type: 'Scaffold' })
  .descendant({ type: 'TextField', textContains: '邮箱' })
  .withFallback({ semanticsLabel: '邮箱地址' })
  .fill('test@example.com');
```

### 2.2 FluentSelector 类

```ts
class FluentSelector {
  // 缩小到后代范围
  descendant(match: Partial<MatchCriteria>): FluentSelector;
  // 找包含指定后代的祖先
  containing(childMatch: Partial<MatchCriteria>): FluentSelector;
  // 设置回退策略
  withFallback(fallback: FallbackCriteria): FluentSelector;
  // 位置过滤
  nth(index: number): FluentSelector;
  first(): FluentSelector;
  last(): FluentSelector;

  // 操作方法
  click(): Promise<void>;
  fill(value: string): Promise<void>;
  type(text: string): Promise<void>;
  scrollIntoView(): Promise<FluentSelector>;
  isVisible(): Promise<boolean>;
  text(): Promise<string>;
  bounds(): Promise<Rect>;

  // 序列化
  toQuery(): SelectorQuery;
}
```

### 2.3 `find()` 直接替换旧 `locator()`

`find()` 是新唯一入口，旧的 `locator()` 删除。内部复用现有 `Driver` 和 JSON-RPC 通信层。

---

## 3. Dart 端实现

### 3.1 文件结构

```
fliwright-bridge/lib/src/extensions/
├── selector_query.dart     # 数据模型：SelectorQuery, MatchCriteria, FallbackCriteria, PositionFilter
├── selector_parser.dart    # JSON 解析器
├── selector_engine.dart    # 匹配引擎
├── inspect.dart            # 改造：入口调用 SelectorEngine
└── ...
```

### 3.2 数据模型 — `selector_query.dart`

```dart
class SelectorQuery {
  final MatchCriteria? match;
  final SelectorQuery? within;
  final FallbackCriteria? fallback;
  final PositionFilter? position;
  const SelectorQuery({this.match, this.within, this.fallback, this.position});
}

class MatchCriteria {
  final String? type;
  final String? key;
  final String? text;
  final String? textContains;
  final String? textRegex;
  final String? role;
  const MatchCriteria({this.type, this.key, this.text, this.textContains, this.textRegex, this.role});
  int get conditionCount => [type, key, text, textContains, textRegex, role].where((v) => v != null).length;
}

class FallbackCriteria {
  final String? semanticsLabel;
  final String? hintText;
  final String? tooltip;
  const FallbackCriteria({this.semanticsLabel, this.hintText, this.tooltip});
}

class PositionFilter {
  final int? nth;
  final bool first;
  final bool last;
  final bool visible;
  const PositionFilter({this.nth, this.first = false, this.last = false, this.visible = true});
}
```

### 3.3 JSON 解析器 — `selector_parser.dart`

```dart
import 'dart:convert';

class SelectorParser {
  /// 从 JSON 字符串解析为 SelectorQuery
  static SelectorQuery parse(String json) {
    final map = jsonDecode(json) as Map<String, dynamic>;
    return _parseQuery(map);
  }

  static SelectorQuery _parseQuery(Map<String, dynamic> map) {
    return SelectorQuery(
      match: map['match'] != null ? _parseMatch(map['match'] as Map<String, dynamic>) : null,
      within: map['within'] != null ? _parseQuery(map['within'] as Map<String, dynamic>) : null,
      fallback: map['fallback'] != null ? _parseFallback(map['fallback'] as Map<String, dynamic>) : null,
      position: map['position'] != null ? _parsePosition(map['position'] as Map<String, dynamic>) : null,
    );
  }

  static MatchCriteria _parseMatch(Map<String, dynamic> map) {
    return MatchCriteria(
      type: map['type'] as String?,
      key: map['key'] as String?,
      text: map['text'] as String?,
      textContains: map['textContains'] as String?,
      textRegex: map['textRegex'] as String?,
      role: map['role'] as String?,
    );
  }

  static FallbackCriteria _parseFallback(Map<String, dynamic> map) {
    return FallbackCriteria(
      semanticsLabel: map['semanticsLabel'] as String?,
      hintText: map['hintText'] as String?,
      tooltip: map['tooltip'] as String?,
    );
  }

  static PositionFilter _parsePosition(Map<String, dynamic> map) {
    return PositionFilter(
      nth: map['nth'] as int?,
      first: map['first'] as bool? ?? false,
      last: map['last'] as bool? ?? false,
      visible: map['visible'] as bool? ?? true,
    );
  }
}
```

### 3.4 匹配引擎 — `selector_engine.dart`

执行流程：

```
SelectorQuery
  ↓
1. ScopeResolver    — 递归解析 within 链，确定搜索范围
  ↓
2. TreeWalker       — 仅遍历作用域子树（非全树），跳过不可见元素
  ↓
3. MatchPipeline    — 多级匹配：primary → fallback → fuzzy（自愈）
  ↓
4. PositionFilter   — nth / first / last / visible
  ↓
MatchResult[]（按 score 排序）
```

```dart
class MatchResult {
  final Element element;
  final double score;       // 0.0 ~ 1.0
  final String strategy;    // 'primary' | 'fallback' | 'fuzzy'
  MatchResult({required this.element, required this.score, required this.strategy});
}

class SelectorEngine {
  static List<MatchResult> execute(SelectorQuery query, Element root) {
    // 1. 解析作用域
    final scope = _resolveScope(query.within, root);
    if (scope == null) return [];

    // 2. 收集候选（仅作用域子树）
    final candidates = _collectCandidates(scope);

    // 3. 多级匹配
    var results = _matchPrimary(candidates, query.match);
    if (results.isEmpty && query.fallback != null) {
      results = _matchFallback(candidates, query.fallback!);
    }

    // 4. 可见性 + 位置过滤
    if (query.position?.visible ?? true) {
      results = results.where((r) => _isVisible(r.element)).toList();
    }
    return _applyPosition(results, query.position);
  }

  // --- 作用域解析（递归处理嵌套 within） ---
  static Element? _resolveScope(SelectorQuery? withinQuery, Element root) {
    if (withinQuery == null) return root;
    final outerScope = _resolveScope(withinQuery.within, root);
    if (outerScope == null) return null;
    Element? found;
    _walkTree(outerScope, (element) {
      if (_scoreMatch(element, withinQuery.match) > 0.5) {
        found = element;
        return false;
      }
      return true;
    });
    return found;
  }

  // --- 主匹配：多条件评分 ---
  static List<MatchResult> _matchPrimary(List<Element> candidates, MatchCriteria? criteria) {
    if (criteria == null) return [];
    return candidates
        .map((e) => MatchResult(element: e, score: _scoreMatch(e, criteria), strategy: 'primary'))
        .where((r) => r.score > 0.5)
        .toList()
      ..sort((a, b) => b.score.compareTo(a.score));
  }

  // --- 回退匹配 ---
  static List<MatchResult> _matchFallback(List<Element> candidates, FallbackCriteria fallback) {
    // 用 semanticsLabel / hintText 匹配
    // 评分逻辑同主匹配
  }

  // --- 评分核心 ---
  static double _scoreMatch(Element element, MatchCriteria? criteria) {
    if (criteria == null || criteria.conditionCount == 0) return 0;
    double score = 0;
    final widget = element.widget;

    if (criteria.type != null) {
      final rt = widget.runtimeType.toString();
      if (rt == criteria.type) score += 1.0;
      else if (rt.contains(criteria.type!)) score += 0.6;  // 子类部分匹配
    }
    if (criteria.key != null) {
      if (InspectExtension.extractKeyValue(widget.key) == criteria.key) score += 1.0;
    }
    if (criteria.text != null) {
      final t = InspectExtension.extractText(widget);
      if (t != null && t == criteria.text) score += 1.0;
    }
    if (criteria.textContains != null) {
      final t = InspectExtension.extractText(widget);
      if (t != null && t.contains(criteria.textContains!)) score += 1.0;
    }
    if (criteria.textRegex != null) {
      try {
        final t = InspectExtension.extractText(widget);
        if (t != null && RegExp(criteria.textRegex!).hasMatch(t)) score += 1.0;
      } catch (_) {}
    }
    if (criteria.role != null) {
      if (InspectExtension.extractSemantics(element).role == criteria.role) score += 1.0;
    }

    return score / criteria.conditionCount;
  }

  // --- 辅助方法 ---
  static bool _isVisible(Element element) { /* 检查 renderBox 尺寸 > 0 */ }
  static List<MatchResult> _applyPosition(List<MatchResult> results, PositionFilter? p) { /* nth/first/last */ }
  static void _walkTree(Element root, bool Function(Element) visitor) { /* DFS 遍历 */ }
  static List<Element> _collectCandidates(Element scope) { /* 收集作用域内所有元素 */ }
}
```

### 3.5 改造 InspectExtension

```dart
class InspectExtension {
  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.inspect', _inspect);
  }

  static Future<Map<String, dynamic>> _inspect(Map<String, String> params) async {
    final root = WidgetsBinding.instance.rootElement;
    if (root == null) return {'error': 'No widget tree available', 'widgets': <dynamic>[]};

    final query = SelectorParser.parse(params['selector']!);
    final results = SelectorEngine.execute(query, root);

    final widgets = results.map((r) => {
      ...extractWidgetInfo(r.element),
      '_score': r.score,
      '_strategy': r.strategy,
    }).toList();

    return {'widgets': widgets, 'count': widgets.length};
  }

  // extractWidgetInfo、extractText、extractSemantics 等工具方法保持不变
}
```

---

## 4. 表单助手集成

### 4.1 新的表单填写流程

```
form_extract.dart 提取快照 [{ type, hintText, key, label, semantics }]
                    ↓
FormHelperService 快照 + AI 建议 → 构造带 within + fallback 的 SelectorQuery
                    ↓
SelectorEngine 多级匹配（match → fallback → fuzzy）
                    ↓
找到目标元素 → 执行填写
```

### 4.2 FormFillRule

```ts
interface FormFillRule {
  value: string;
  description: string;
  target: SelectorQuery;
}
```

### 4.3 批量表单填写

```ts
class FormFiller {
  constructor(page: Page, formScope?: SelectorQuery);
  async fillForm(rules: FormFillRule[]): Promise<FillResult[]>;
}
```

FormHelperService 根据表单快照自动构造 `SelectorQuery`：
- `match`：type + key（优先）或 hintText/label
- `within`：锁定到 Form/Scaffold 范围
- `fallback`：semanticsLabel + hintText 兜底

---

## 5. 解决的痛点

| 痛点 | 解决机制 |
|------|---------|
| **准确性** | 多条件评分匹配 + 多级回退（match → fallback → fuzzy） |
| **性能** | `within` 作用域遍历减少 50%~90% 节点 + 可见性过滤提前跳过 |
| **表达力** | 链式 `descendant()` + 结构化 `within` + 反向 `containing()` |

## 6. 实施范围

### 改动文件

| 文件 | 操作 |
|------|------|
| `fliwright-bridge/lib/src/extensions/selector_query.dart` | **新增** — 数据模型 |
| `fliwright-bridge/lib/src/extensions/selector_parser.dart` | **新增** — JSON 解析器 |
| `fliwright-bridge/lib/src/extensions/selector_engine.dart` | **新增** — 匹配引擎 |
| `fliwright-bridge/lib/src/extensions/inspect.dart` | **改造** — 入口改为调用 SelectorEngine |
| `fliwright-core/src/Selector.ts` | **改造** — 替换为 SelectorQuery + FluentSelector |
| `fliwright-core/src/Locator.ts` | **改造** — 替换为 find() API |
| `fliwright-vscode/src/form/FormHelperService.ts` | **改造** — 用 SelectorQuery 替代字符串构造 |

### 不改动的文件

- `extension_registry.dart` — 不变，仍用 `Map<String, String>`
- `bridge.dart` — 不变
- `form_extract.dart` — 不变，仍负责快照提取
- 现有工具方法（extractText、extractSemantics、extractWidgetInfo）— 全部复用

## 7. 数据流完整链路

```
TS: page.find({ match: { type: 'TextField', textContains: '邮箱' }, within: { match: { type: 'Scaffold' } } })
       ↓ JSON.stringify
Wire: params['selector'] = '{"match":{"type":"TextField","textContains":"邮箱"},"within":{"match":{"type":"Scaffold"}}}'
       ↓ JSON-RPC via VM Service Extension
Dart: SelectorParser.parse(json)
       ↓ → SelectorQuery 对象
      SelectorEngine.execute(query, rootElement)
       ↓ Step 1: _resolveScope → 找到 Scaffold Element
       ↓ Step 2: _collectCandidates → 只遍历 Scaffold 子树
       ↓ Step 3: _matchPrimary → 评分匹配 type=TextField + textContains=邮箱
       ↓ Step 4: fallback（如果主匹配无结果）
       ↓ Step 5: 可见性 + 位置过滤
      返回 WidgetInfo[]（附带 _score 和 _strategy）
       ↓ JSON-RPC Response
TS: FluentSelector 操作方法（fill、click 等）执行后续动作
```
