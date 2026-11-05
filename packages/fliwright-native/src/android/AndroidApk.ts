import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { SaxesParser } from 'saxes';
import { NativeError, type NativeOperationContext } from '@fliwright/core';
import type { ToolExecutor } from '../ToolExecutor.js';

export interface AndroidApkManifest { appId: string; activity: string; minSdk: number; targetSdk: number; permissions: string[]; }

/** Inspect an immutable local copy so caller file replacement cannot redirect installation. */
export async function withAndroidApk<T>(input: { apkPath: string; apkAnalyzerPath: string }, appId: string,
  executor: ToolExecutor, context: NativeOperationContext,
  action: (apk: AndroidApkManifest & { path: string; sha256: string }) => Promise<T>): Promise<T> {
  if (!input || Object.keys(input).some(key => !['apkPath', 'apkAnalyzerPath'].includes(key))
    || typeof input.apkPath !== 'string' || !isAbsolute(input.apkPath) || input.apkPath.includes('\0')
    || typeof input.apkAnalyzerPath !== 'string' || !input.apkAnalyzerPath || input.apkAnalyzerPath.includes('\0')) {
    throw new NativeError('precondition_failed', 'Provide an absolute APK file and an explicit APK analyzer executable.');
  }
  input = { ...input };
  checkAndroidAppDeadline(context);
  const size = await stat(input.apkPath);
  if (!size.isFile() || size.size <= 0 || size.size > 512 * 1024 * 1024) throw new NativeError('precondition_failed', 'Provide a single APK no larger than 512 MiB.');
  const root = await mkdtemp(join(tmpdir(), 'fliwright-apk-'));
  try {
    const path = join(root, 'app.apk');
    await copyFile(input.apkPath, path);
    checkAndroidAppDeadline(context);
    const copied = await stat(path);
    if (copied.size <= 0 || copied.size > 512 * 1024 * 1024) throw new NativeError('precondition_failed', 'The staged APK changed beyond its size limit.');
    const sha256 = await hashAndroidApk(path, context);
    const xml = await executor(input.apkAnalyzerPath, ['manifest', 'print', path], context);
    checkAndroidAppDeadline(context);
    const manifest = parseAndroidApkManifest(xml.toString('utf8'), appId);
    return await action({ ...manifest, path, sha256 });
  } finally { await rm(root, { recursive: true, force: true }); }
}

async function hashAndroidApk(path: string, context: NativeOperationContext): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { signal: context.signal })) {
    checkAndroidAppDeadline(context); hash.update(chunk);
  }
  checkAndroidAppDeadline(context);
  return hash.digest('hex');
}

interface Element { tag: string; attributes: Record<string, string>; children: Element[]; }
function parseAndroidApkManifest(xml: string, appId: string): AndroidApkManifest {
  const invalid = () => new NativeError('precondition_failed', 'APK must be a single Debug runtime-permission app with one exported launcher and no custom app process.');
  if (Buffer.byteLength(xml) > 1024 * 1024) throw invalid();
  const parser = new SaxesParser({ xmlns: true });
  const stack: Element[] = []; let root: Element | undefined, count = 0;
  parser.on('doctype', () => { throw invalid(); });
  parser.on('error', () => { throw invalid(); });
  parser.on('opentag', tag => {
    if (++count > 10000 || stack.length >= 128 || tag.uri) throw invalid();
    const attributes: Record<string, string> = {};
    for (const attribute of Object.values(tag.attributes)) {
      if (attribute.uri === 'http://schemas.android.com/apk/res/android') attributes[`android:${attribute.local}`] = attribute.value;
      else if (!attribute.uri) attributes[attribute.local] = attribute.value;
    }
    const node: Element = { tag: tag.local, attributes, children: [] };
    if (stack.length) stack.at(-1)!.children.push(node);
    else { if (root) throw invalid(); root = node; }
    stack.push(node);
  });
  parser.on('closetag', () => { stack.pop(); });
  try { parser.write(xml).close(); } catch { throw invalid(); }
  if (!root || root.tag !== 'manifest' || root.attributes.package !== appId || root.attributes.split
    || root.attributes['android:sharedUserId']) throw invalid();
  const children = (node: Element, tag: string) => node.children.filter(child => child.tag === tag);
  const apps = children(root, 'application'), sdks = children(root, 'uses-sdk');
  if (apps.length !== 1 || sdks.length !== 1) throw invalid();
  const app = apps[0], sdk = sdks[0];
  const number = (value: string | undefined) => value && /^[1-9]\d*$/.test(value) ? Number(value) : NaN;
  const minSdk = number(sdk.attributes['android:minSdkVersion']), targetSdk = number(sdk.attributes['android:targetSdkVersion']);
  if (![minSdk, targetSdk].every(Number.isSafeInteger) || minSdk < 23 || targetSdk < minSdk
    || app.attributes['android:debuggable'] !== 'true' || app.attributes['android:enabled'] === 'false'
    || (app.attributes['android:process'] && app.attributes['android:process'] !== appId)
    || children(app, 'activity-alias').length) throw invalid();
  const launchers = children(app, 'activity').filter(activity => children(activity, 'intent-filter').some(filter =>
    children(filter, 'action').some(action => action.attributes['android:name'] === 'android.intent.action.MAIN')
    && children(filter, 'category').some(category => category.attributes['android:name'] === 'android.intent.category.LAUNCHER')));
  if (launchers.length !== 1) throw invalid();
  const launcher = launchers[0].attributes;
  if (launcher['android:exported'] !== 'true' || launcher['android:enabled'] === 'false'
    || (launcher['android:process'] && launcher['android:process'] !== appId)) throw invalid();
  const name = launcher['android:name'] ?? '';
  const activity = name.startsWith('.') ? appId + name : name.includes('.') ? name : `${appId}.${name}`;
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(activity)) throw invalid();
  const permissions = children(root, 'uses-permission').map(item => item.attributes['android:name']);
  if (permissions.some(value => !value || !/^[\w.]+$/.test(value))) throw invalid();
  return { appId, activity, minSdk, targetSdk, permissions: [...new Set(permissions)].sort() };
}

export function checkAndroidAppDeadline(context: NativeOperationContext): void {
  context.signal.throwIfAborted();
  if (context.deadline <= Date.now()) throw new NativeError('timeout', 'Android installed app operation exceeded its deadline.');
}
