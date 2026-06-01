# Graph Report - .  (2026-05-31)

## Corpus Check
- 134 files · ~80,514 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 822 nodes · 1410 edges · 66 communities (53 shown, 13 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 51 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Semantic Form Filling|Semantic Form Filling]]
- [[_COMMUNITY_Plugin System Interfaces|Plugin System Interfaces]]
- [[_COMMUNITY_Self-Healing Engine|Self-Healing Engine]]
- [[_COMMUNITY_MCP Server|MCP Server]]
- [[_COMMUNITY_Core Recorder & Page|Core Recorder & Page]]
- [[_COMMUNITY_VM Protocol & Transport|VM Protocol & Transport]]
- [[_COMMUNITY_Project Config & Docs|Project Config & Docs]]
- [[_COMMUNITY_Locator & Page Model|Locator & Page Model]]
- [[_COMMUNITY_Architecture Concepts|Architecture Concepts]]
- [[_COMMUNITY_Multi-Dimensional Scoring|Multi-Dimensional Scoring]]
- [[_COMMUNITY_MCP Package Config|MCP Package Config]]
- [[_COMMUNITY_Test Failure Types|Test Failure Types]]
- [[_COMMUNITY_Core Package Config|Core Package Config]]
- [[_COMMUNITY_Riverpod Plugin|Riverpod Plugin]]
- [[_COMMUNITY_Vitest Integration|Vitest Integration]]
- [[_COMMUNITY_Riverpod Package Config|Riverpod Package Config]]
- [[_COMMUNITY_Vitest Package Config|Vitest Package Config]]
- [[_COMMUNITY_Core TSConfig|Core TSConfig]]
- [[_COMMUNITY_Vitest TSConfig|Vitest TSConfig]]
- [[_COMMUNITY_MCP TSConfig|MCP TSConfig]]
- [[_COMMUNITY_Bridge Package Config|Bridge Package Config]]
- [[_COMMUNITY_Bridge TSConfig|Bridge TSConfig]]
- [[_COMMUNITY_Core Test Utilities|Core Test Utilities]]
- [[_COMMUNITY_Recorder Test Suite|Recorder Test Suite]]
- [[_COMMUNITY_MCP Resources & Tools|MCP Resources & Tools]]
- [[_COMMUNITY_Event Serialization|Event Serialization]]
- [[_COMMUNITY_Service Registry|Service Registry]]
- [[_COMMUNITY_Coverage System|Coverage System]]
- [[_COMMUNITY_Channel Transport|Channel Transport]]
- [[_COMMUNITY_Logger System|Logger System]]
- [[_COMMUNITY_VM Service Client|VM Service Client]]
- [[_COMMUNITY_Frame Codec|Frame Codec]]
- [[_COMMUNITY_Driver Tests|Driver Tests]]
- [[_COMMUNITY_Code Generator Tests|Code Generator Tests]]
- [[_COMMUNITY_Event Aggregator Tests|Event Aggregator Tests]]
- [[_COMMUNITY_Mock Manager Tests|Mock Manager Tests]]
- [[_COMMUNITY_Plugin Registry Tests|Plugin Registry Tests]]
- [[_COMMUNITY_Form Helper Tests|Form Helper Tests]]
- [[_COMMUNITY_Semantic Inferrer Tests|Semantic Inferrer Tests]]
- [[_COMMUNITY_Faker Generator Tests|Faker Generator Tests]]
- [[_COMMUNITY_Skill Registry Tests|Skill Registry Tests]]
- [[_COMMUNITY_Json Rule Loader Tests|Json Rule Loader Tests]]
- [[_COMMUNITY_Assertion Error Tests|Assertion Error Tests]]
- [[_COMMUNITY_Failure Collector Tests|Failure Collector Tests]]
- [[_COMMUNITY_Snapshot Store Tests|Snapshot Store Tests]]
- [[_COMMUNITY_Strategy Tests|Strategy Tests]]
- [[_COMMUNITY_Riverpod Tests|Riverpod Tests]]
- [[_COMMUNITY_Vitest Integration Tests|Vitest Integration Tests]]
- [[_COMMUNITY_Root Workspace|Root Workspace]]
- [[_COMMUNITY_PRD Concepts|PRD Concepts]]
- [[_COMMUNITY_Agents Guidelines|Agents Guidelines]]
- [[_COMMUNITY_Recorder Controller Tests|Recorder Controller Tests]]
- [[_COMMUNITY_Multi-Dimensional Weights|Multi-Dimensional Weights]]
- [[_COMMUNITY_Cosine Similarity|Cosine Similarity]]
- [[_COMMUNITY_Context Scoring|Context Scoring]]
- [[_COMMUNITY_Code Binding Score|Code Binding Score]]
- [[_COMMUNITY_N-Gram Frequency|N-Gram Frequency]]
- [[_COMMUNITY_Center Calculation|Center Calculation]]
- [[_COMMUNITY_Default Strategy Weights|Default Strategy Weights]]

## God Nodes (most connected - your core abstractions)
1. `Locator` - 32 edges
2. `FliwrightDriver` - 27 edges
3. `WidgetSnapshot` - 27 edges
4. `SelfHealingEngine` - 22 edges
5. `PluginRegistry` - 22 edges
6. `RecorderController` - 20 edges
7. `FormHelper` - 20 edges
8. `VMServiceConnector` - 19 edges
9. `FormFieldMeta` - 18 edges
10. `Assertion` - 16 edges

## Surprising Connections (you probably didn't know these)
- `streamListen VM service method` --references--> `Dart Bridge (fliwright_bridge)`  [INFERRED]
  packages/fliwright-core/tests/RecorderController.test.ts → docs/PRD.md
- `Melos workspace configuration` --semantically_similar_to--> `pnpm workspace configuration`  [INFERRED] [semantically similar]
  melos.yaml → pnpm-workspace.yaml
- `RecorderController test suite` --implements--> `Codegen (Test Case Recording)`  [INFERRED]
  packages/fliwright-core/tests/RecorderController.test.ts → docs/PRD.md
- `pnpm workspace configuration` --conceptually_related_to--> `Root pnpm workspace (fliwright monorepo)`  [INFERRED]
  pnpm-workspace.yaml → package.json
- `Build, test, and development commands` --references--> `Root pnpm workspace (fliwright monorepo)`  [EXTRACTED]
  AGENTS.md → package.json

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Recording Pipeline: Raw Events to Test Code** — src_recordercontroller, src_eventaggregator, src_codegenerator, src_types_rawinputevent, src_types_recordedoperation [EXTRACTED 1.00]
- **Self-Healing Pipeline: Snapshot, Score, Heal** — src_selfhealingengine, src_snapshotstore, strategies_multidimensionalhealingstrategy, src_types_widgetsnapshot, src_types_healingreport [EXTRACTED 1.00]
- **Form Filling Pipeline: Infer Semantics, Generate Data, Fill Fields** — src_formhelper, src_semanticinferrer, src_fakergenerator, src_skillregistry, src_jsonruleloader, src_types_formfieldmeta, src_types_semantictype [EXTRACTED 1.00]
- **VM Service JSON-RPC communication pipeline** — fliwright_core_src_protocol, fliwright_core_src_vmserviceconnector, fliwright_core_src_protocolmessage, concept_jsonrpc_protocol [EXTRACTED 0.95]
- **MCP server assembly from tools, resources, and shared state** — fliwright_mcp_src_creatfliwrightserver, fliwright_mcp_src_serverstate, fliwright_mcp_src_handlerruntest, fliwright_mcp_src_handlegetfailure, fliwright_mcp_src_handlegeneratetest, fliwright_mcp_src_registertestreportresource [EXTRACTED 0.95]
- **Test failure propagation from vitest through state to MCP resources** — fliwright_mcp_src_runvitest, fliwright_mcp_src_handlerruntest, fliwright_mcp_src_serverstate, fliwright_mcp_src_handlegetfailure, fliwright_mcp_src_handlereadtestreport [INFERRED 0.85]
- **AI feedback closed-loop: test failure to self-healing to MCP report** — prd_ai_feedback_loop, prd_self_healing_engine, prd_mcp_server, prd_smart_assertion [EXTRACTED 0.95]
- **Recording pipeline: VM Service events to pointer operations to test code** — tests_recordercontroller_test_start_method, tests_recordercontroller_test_fliwrightrecording_event, tests_recordercontroller_test_pointer_event_processing, tests_recordercontroller_test_stop_method, tests_recordercontroller_test_code_generation [EXTRACTED 0.95]
- **@fliwright/core as central dependency for mcp, vitest, riverpod, e2e** — pnpmlock_fliwright_mcp_dep_core, pnpmlock_fliwright_vitest_dep_core, pnpmlock_fliwright_plugin_riverpod_dep_core, pnpmlock_e2e_dep_core [EXTRACTED 1.00]
- **Recording pipeline: capture raw events, aggregate into operations, generate test code** — src_recordercontroller_recordercontroller, src_eventaggregator_eventaggregator, src_codegenerator_codegenerator [EXTRACTED 0.95]
- **Self-healing pipeline: detect failure, snapshot, score candidates, suggest new selector** — src_assertion_assertion, src_selfhealingengine_selfhealingengine, src_snapshotstore_snapshotstore, src_multidimensionalhealingstrategy_multidimensionalhealingstrategy [EXTRACTED 0.95]
- **Form fill pipeline: extract fields, infer semantics, load rules, generate values, fill via locator** — src_formhelper_formhelper, src_semanticinferrer_semanticinferrer, src_fakergenerator_fakergenerator, src_skillregistry_skillregistry, src_jsonruleloader_jsonruleloader [EXTRACTED 0.95]

## Communities (66 total, 13 thin omitted)

### Community 0 - "Semantic Form Filling"
Cohesion: 0.07
Nodes (25): Semantic Form Filling Pipeline, FakerGenerator, FakerGenerator, FakerGeneratorOptions, FormHelper, FormHelper, SendRequest, JsonRuleLoader (+17 more)

### Community 1 - "Plugin System Interfaces"
Cohesion: 0.08
Nodes (12): FinderStrategy, HealingStrategy, MockAdapter, FliwrightPlugin, PluginContext, StateAdapter, DriverOptions, FliwrightDriver (+4 more)

### Community 2 - "Self-Healing Engine"
Cohesion: 0.08
Nodes (21): Assertion, AssertionError, createExpect(), pollUntil(), FailureCollector, SendRequest, SendRequest, MultiDimensionalHealingStrategy (+13 more)

### Community 3 - "MCP Server"
Cohesion: 0.08
Nodes (37): handleReadTestReport(), registerTestReportResource(), main(), createFliwrightServer(), createServerState(), ServerState, FailureEntry, GenerateTestResult (+29 more)

### Community 4 - "Core Recorder & Page"
Cohesion: 0.10
Nodes (25): CodeGenerator, CodeGenerator, escapeString(), EventAggregator, EventAggregator, findEditableOperationForTextInput(), SendRequest, SendRequest (+17 more)

### Community 5 - "VM Protocol & Transport"
Cohesion: 0.08
Nodes (17): Dart VM Service WebSocket communication, Isolate resolution strategy, JSON-RPC 2.0 Protocol, Pending request correlation map, fliwright-core barrel export, Protocol, ProtocolMessage, VMServiceConnector (+9 more)

### Community 6 - "Project Config & Docs"
Cohesion: 0.09
Nodes (33): Build, test, and development commands, Commit and PR conventions, Project structure and module organization, Testing guidelines, Melos workspace configuration, Root pnpm workspace (fliwright monorepo), @fliwright/core depends on @faker-js/faker, @fliwright/core depends on randexp (+25 more)

### Community 7 - "Locator & Page Model"
Cohesion: 0.10
Nodes (6): Locator, Page, Selector, SelectorInput, SelectorInput, testWidget

### Community 8 - "Architecture Concepts"
Cohesion: 0.13
Nodes (23): Multi-Dimensional Widget Scoring, Playwright-Style API Design, Plugin Architecture, Self-Healing Selector Pattern, FinderStrategy, FliwrightPlugin, HealingStrategy, MockAdapter (+15 more)

### Community 9 - "Multi-Dimensional Scoring"
Cohesion: 0.17
Nodes (14): buildNgramFreq(), center(), codeBindingScore(), contextScore(), cosineSimilarity(), DEFAULT_WEIGHTS, euclidean(), jaccard() (+6 more)

### Community 10 - "MCP Package Config"
Cohesion: 0.10
Nodes (19): bin, fliwright-mcp, dependencies, @fliwright/core, @modelcontextprotocol/sdk, vitest, zod, devDependencies (+11 more)

### Community 11 - "Test Failure Types"
Cohesion: 0.12
Nodes (20): MCP tool registration pattern, Test failure context propagation, FailureContext, HealingReport, TestResult, createFliwrightServer, FailureEntry, GenerateTestResult (+12 more)

### Community 12 - "Core Package Config"
Cohesion: 0.11
Nodes (17): dependencies, @faker-js/faker, randexp, ws, devDependencies, @types/ws, typescript, vitest (+9 more)

### Community 13 - "Riverpod Plugin"
Cohesion: 0.17
Nodes (3): riverpodPlugin(), RiverpodStateAdapter, SendRequest

### Community 14 - "Vitest Integration"
Cohesion: 0.18
Nodes (13): appendFailureEntry(), collectFailureEntry(), createFliwrightTest(), defineConfig(), expect(), FliwrightConfig, FliwrightTestContext, latestHealingSuggestion() (+5 more)

### Community 15 - "Riverpod Package Config"
Cohesion: 0.13
Nodes (14): dependencies, @fliwright/core, devDependencies, typescript, vitest, main, name, scripts (+6 more)

### Community 16 - "Vitest Package Config"
Cohesion: 0.13
Nodes (14): dependencies, @fliwright/core, vitest, devDependencies, typescript, main, name, scripts (+6 more)

### Community 17 - "Core TSConfig"
Cohesion: 0.14
Nodes (13): compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, outDir, rootDir (+5 more)

### Community 18 - "Vitest TSConfig"
Cohesion: 0.14
Nodes (13): compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, outDir, rootDir (+5 more)

### Community 19 - "MCP TSConfig"
Cohesion: 0.15
Nodes (12): compilerOptions, declaration, esModuleInterop, module, moduleResolution, outDir, rootDir, skipLibCheck (+4 more)

### Community 20 - "Bridge Package Config"
Cohesion: 0.15
Nodes (12): extension_registry.dart, extensions/form_extract.dart, extensions/gesture.dart, extensions/http_overrides.dart, extensions/inspect.dart, extensions/mock_server.dart, extensions/recording.dart, extensions/riverpod.dart (+4 more)

### Community 21 - "Bridge TSConfig"
Cohesion: 0.15
Nodes (12): compilerOptions, declaration, esModuleInterop, module, moduleResolution, outDir, rootDir, skipLibCheck (+4 more)

### Community 22 - "Core Test Utilities"
Cohesion: 0.17
Nodes (11): dependencies, @fliwright/core, devDependencies, typescript, vitest, name, private, scripts (+3 more)

### Community 23 - "Recorder Test Suite"
Cohesion: 0.17
Nodes (11): matches, MockCallRecord, MockRoute, MockServerExtension, _passthroughRequest, register, _respondWithRoute, stopServer (+3 more)

### Community 24 - "MCP Resources & Tools"
Cohesion: 0.17
Nodes (11): dart:async, _pollFocusedTextInput, RecordingExtension, register, _stopRecording, ../bridge.dart, dart:developer, inspect.dart (+3 more)

### Community 25 - "Event Serialization"
Cohesion: 0.18
Nodes (10): package:flutter/material.dart, build, HomePage, main, MaterialApp, MyApp, Scaffold, SizedBox (+2 more)

### Community 26 - "Service Registry"
Cohesion: 0.18
Nodes (10): dart:convert, dart:developer, ArgumentError, ExtensionRegistry, handler, isRegistered, register, _registerWithVM (+2 more)

### Community 27 - "Coverage System"
Cohesion: 0.20
Nodes (9): devDependencies, typescript, vitest, name, private, scripts, build, lint (+1 more)

### Community 28 - "Channel Transport"
Cohesion: 0.20
Nodes (9): _addTextField, FormExtractExtension, _markEditableSeen, register, visitor, ../bridge.dart, inspect.dart, package:flutter/material.dart (+1 more)

### Community 29 - "Logger System"
Cohesion: 0.20
Nodes (9): dart:math, _drag, GestureExtension, _longPress, _pinch, register, ../bridge.dart, package:flutter/gestures.dart (+1 more)

### Community 30 - "VM Service Client"
Cohesion: 0.20
Nodes (9): _hasAncestor, InspectExtension, _matches, ParsedSelector, _parseSelector, register, walkTree, ../bridge.dart (+1 more)

### Community 31 - "Frame Codec"
Cohesion: 0.22
Nodes (8): compilerOptions, esModuleInterop, module, moduleResolution, skipLibCheck, strict, target, include

### Community 32 - "Driver Tests"
Cohesion: 0.29
Nodes (6): Function, register, SnapshotExtension, _walkTree, ../bridge.dart, package:flutter/material.dart

### Community 33 - "Code Generator Tests"
Cohesion: 0.33
Nodes (6): Test code generation from recorded operations, ext.fliwright.hitTest VM service extension, ext.fliwright.stopRecording VM service extension, FliwrightRecording event stream, Pointer event down/up to tap operation conversion, RecorderController.stop()

### Community 34 - "Event Aggregator Tests"
Cohesion: 0.33
Nodes (5): register, ScrollExtension, _walkTree, ../bridge.dart, package:flutter/widgets.dart

### Community 35 - "Mock Manager Tests"
Cohesion: 0.33
Nodes (5): clearProviderContainer, register, RiverpodExtension, setProviderContainer, ../bridge.dart

### Community 36 - "Plugin Registry Tests"
Cohesion: 0.33
Nodes (5): register, TypeExtension, _walkTree, ../bridge.dart, package:flutter/widgets.dart

### Community 37 - "Form Helper Tests"
Cohesion: 0.33
Nodes (5): dart:convert, dart:io, package:fliwright_bridge/fliwright_bridge.dart, package:flutter_test/flutter_test.dart, main

### Community 39 - "Faker Generator Tests"
Cohesion: 0.50
Nodes (3): enabledPlugins, frontend-design@claude-plugins-official, github@claude-plugins-official

### Community 40 - "Skill Registry Tests"
Cohesion: 0.50
Nodes (3): package:fliwright_bridge/fliwright_bridge.dart, package:riverpod_demo/main.dart, main

### Community 41 - "Json Rule Loader Tests"
Cohesion: 0.50
Nodes (3): package:fliwright_bridge/fliwright_bridge.dart, package:flutter_test/flutter_test.dart, main

### Community 42 - "Assertion Error Tests"
Cohesion: 0.50
Nodes (3): FliwrightHttpOverrides, install, dart:io

### Community 43 - "Failure Collector Tests"
Cohesion: 0.50
Nodes (3): package:fliwright_bridge/fliwright_bridge.dart, package:flutter_test/flutter_test.dart, main

### Community 44 - "Snapshot Store Tests"
Cohesion: 0.50
Nodes (3): package:fliwright_bridge/fliwright_bridge.dart, package:flutter_test/flutter_test.dart, main

### Community 45 - "Strategy Tests"
Cohesion: 0.50
Nodes (3): package:fliwright_bridge/fliwright_bridge.dart, package:flutter_test/flutter_test.dart, main

### Community 46 - "Riverpod Tests"
Cohesion: 0.50
Nodes (3): package:fliwright_bridge/fliwright_bridge.dart, package:flutter_test/flutter_test.dart, main

## Knowledge Gaps
- **323 isolated node(s):** `name`, `private`, `build`, `test`, `lint` (+318 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Locator` connect `Locator & Page Model` to `Semantic Form Filling`, `Self-Healing Engine`, `Core Recorder & Page`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Why does `createExpect()` connect `Self-Healing Engine` to `Core Recorder & Page`, `Vitest Integration`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Why does `expect()` connect `Vitest Integration` to `Self-Healing Engine`, `VM Protocol & Transport`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `SelfHealingEngine` (e.g. with `FailureCollector` and `MultiDimensionalHealingStrategy`) actually correct?**
  _`SelfHealingEngine` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `private`, `build` to the rest of the system?**
  _327 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Semantic Form Filling` be split into smaller, more focused modules?**
  _Cohesion score 0.06944444444444445 - nodes in this community are weakly interconnected._
- **Should `Plugin System Interfaces` be split into smaller, more focused modules?**
  _Cohesion score 0.07570621468926554 - nodes in this community are weakly interconnected._