import fs from 'node:fs';
import path from 'node:path';

/** Validate native source/toolchain inputs without requiring Xcode on the checker host. */
export function validateNativeStack(root, stack) {
  const errors = [];
  for (const [relativeRoot, contract] of Object.entries(stack.nativeProjects ?? {})) {
    const projectRoot = path.join(root, relativeRoot);
    if (!fs.existsSync(projectRoot)) { errors.push(`${relativeRoot}: native project is missing.`); continue; }
    const files = validateSources(root, relativeRoot, contract, errors);
    const projectPath = path.join(projectRoot, contract.project);
    if (!fs.existsSync(projectPath)) { errors.push(`${relativeRoot}: native Xcode project is missing.`); continue; }
    const project = fs.readFileSync(projectPath, 'utf8');
    for (const [key, value] of Object.entries(contract.requiredBuildSettings)) {
      const entries = [...project.matchAll(new RegExp(`\\b${key}\\s*=\\s*([^;]+);`, 'g'))];
      if (!entries.length || entries.some(entry => entry[1].trim().replace(/^"|"$/g, '') !== value)) {
        errors.push(`${relativeRoot}: ${key} must equal ${value}.`);
      }
    }
    if (/XCRemoteSwiftPackageReference|XCSwiftPackageProductDependency|packageReferences\s*=/.test(project)
      || /PBXFileReference[^\n]*\.(?:a|framework|xcframework)/.test(project)) {
      errors.push(`${relativeRoot}: external dependencies require an explicit native stack contract.`);
    }
    for (const file of files) {
      if (/(?:^|\/)(?:Podfile|Cartfile|Package\.swift)$|\.podspec$|\.xcconfig$/.test(file)) {
        errors.push(`${relativeRoot}/${file}: unapproved native dependency/build manifest.`);
      }
    }
    for (const scheme of contract.schemes) if (!files.includes(scheme)) errors.push(`${relativeRoot}/${scheme}: shared Xcode scheme is missing.`);
  }
  for (const [relativeRoot, contract] of Object.entries(stack.nativeSourceFixtures ?? {})) {
    const fixtureRoot = path.join(root, relativeRoot);
    if (!fs.existsSync(fixtureRoot)) { errors.push(`${relativeRoot}: native source fixture is missing.`); continue; }
    const files = validateSources(root, relativeRoot, contract, errors);
    for (const file of files) {
      if (/(?:^|\/)(?:Podfile|Cartfile|Package\.swift|(?:build|settings)\.gradle(?:\.kts)?|gradle\.properties|gradlew(?:\.bat)?|libs\.versions\.toml)$|\.podspec$|\.xcconfig$|\.(?:xcodeproj|xcworkspace)(?:\/|$)/.test(file)) {
        errors.push(`${relativeRoot}/${file}: generated Xcode/Gradle projects and dependency/build manifests do not belong in source fixtures.`);
      }
    }
    for (const entry of fs.readdirSync(fixtureRoot)) {
      if (/\.(?:xcodeproj|xcworkspace)$/.test(entry)) errors.push(`${relativeRoot}/${entry}: generated Xcode project in a source fixture.`);
    }
  }
  return errors;
}

function validateSources(root, relativeRoot, contract, errors) {
  const projectRoot = path.join(root, relativeRoot);
  const files = walk(projectRoot, errors).map(file => path.relative(projectRoot, file).split(path.sep).join('/'));
  const sources = files.filter(file => /\.(swift|m|mm|h|c|cpp|java|kt)$/.test(file)).sort();
  if (JSON.stringify(sources) !== JSON.stringify([...contract.sources].sort())) errors.push(`${relativeRoot}: native source roster differs from framework.json.`);
  for (const source of sources.filter(file => file.endsWith('.swift'))) {
    const contents = fs.readFileSync(path.join(projectRoot, source), 'utf8');
    for (const match of contents.matchAll(/^\s*(?:@[\w() ]+\s+)?(?:public |internal )?import\s+(?:(?:class|struct|enum|protocol|func|var|typealias)\s+)?([\w]+)/gm)) {
      if (!contract.allowedImports.includes(match[1])) errors.push(`${relativeRoot}/${source}: unapproved Swift framework ${match[1]}.`);
    }
  }
  for (const source of sources.filter(file => /\.(java|kt)$/.test(file))) {
    const contents = fs.readFileSync(path.join(projectRoot, source), 'utf8');
    for (const match of contents.matchAll(/(?:^|[;\n])\s*import\s+(?:static\s+)?([\w.*]+)/g)) {
      if (!contract.allowedImports.includes(match[1])) errors.push(`${relativeRoot}/${source}: unapproved Android import ${match[1]}.`);
    }
  }
  return files;
}

function walk(directory, errors) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) { errors.push(`${file}: native source symlinks are not governed.`); return []; }
    if (entry.name === 'xcuserdata' || entry.name === '.DS_Store') return [];
    return entry.isDirectory() ? walk(file, errors) : [file];
  });
}
