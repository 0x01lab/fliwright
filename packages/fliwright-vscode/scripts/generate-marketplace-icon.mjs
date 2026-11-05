import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// SVG is the editable source of truth. PNG export uses an externally supplied
// Sharp installation so artwork tooling adds no extension runtime dependency.
const root = fileURLToPath(new URL('../', import.meta.url));
const colors = { cyan: '#00C9D8', teal: '#00BFA6', green: '#36D98A', lime: '#B7F34A', yellow: '#FFD84D', navy: '#142D4E' };
const silhouette = 'M127 58C70 33 16 75 16 139C16 202 55 241 103 241C144 241 166 217 164 188C162 160 142 148 123 154C105 159 98 177 104 190C108 199 119 201 127 196C112 199 106 188 112 179C121 165 142 175 138 194C133 220 94 222 77 200C56 173 66 139 95 133C123 127 139 151 173 155C213 160 244 140 244 113C244 94 225 70 204 60C179 49 149 48 127 58Z';
const crest = 'M80 64C83 20 122 6 150 16C177 24 199 42 211 68C170 87 126 83 80 80Z';

function mark({ id = 'logo', tone, happy = false } = {}) {
  const flat = Boolean(tone);
  return `<defs>
    <linearGradient id="${id}-crest" x1="96" y1="64" x2="167" y2="16" gradientUnits="userSpaceOnUse"><stop stop-color="${colors.green}"/><stop offset="1" stop-color="${colors.lime}"/></linearGradient>
    <linearGradient id="${id}-body" x1="37" y1="202" x2="210" y2="60" gradientUnits="userSpaceOnUse"><stop stop-color="#009FF0"/><stop offset=".38" stop-color="${colors.cyan}"/><stop offset=".7" stop-color="${colors.green}"/><stop offset="1" stop-color="${colors.lime}"/></linearGradient>
    <linearGradient id="${id}-fold" x1="53" y1="167" x2="134" y2="89" gradientUnits="userSpaceOnUse"><stop stop-color="${colors.cyan}"/><stop offset="1" stop-color="${colors.teal}"/></linearGradient>
    <linearGradient id="${id}-tail" x1="105" y1="211" x2="143" y2="158" gradientUnits="userSpaceOnUse"><stop stop-color="${colors.teal}"/><stop offset="1" stop-color="${colors.lime}"/></linearGradient>
  </defs>
  <path d="${crest}" fill="${tone ?? `url(#${id}-crest)`}"/>
  <path d="${silhouette}" fill="${tone ?? `url(#${id}-body)`}"/>
  ${flat ? '' : `<path d="M127 58C87 54 47 81 39 121C29 169 55 211 91 220C63 202 60 170 78 148C96 126 121 128 143 144C122 126 113 104 127 58Z" fill="url(#${id}-fold)" opacity=".72"/><path d="M123 154C105 159 98 177 104 190C108 199 119 201 127 196C112 199 106 188 112 179C121 165 142 175 138 194C135 209 123 215 110 216C144 219 165 200 158 178C153 159 137 150 123 154Z" fill="url(#${id}-tail)"/>`}
  ${happy ? `<path d="M174 105Q191 80 211 102" fill="none" stroke="${colors.navy}" stroke-width="11" stroke-linecap="round"/>` : `<circle cx="194" cy="99" r="32" fill="${tone === '#FFFFFF' ? colors.navy : '#FFFFFF'}"/><circle cx="205" cy="99" r="20" fill="${tone === '#FFFFFF' ? '#FFFFFF' : colors.navy}"/><circle cx="212" cy="89" r="6" fill="${tone === '#FFFFFF' ? colors.navy : '#FFFFFF'}"/>`}`;
}

function svg(content, width = 256, height = width, label = 'Fliwright chameleon') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">${content}</svg>\n`;
}
const files = new Map();
files.set('brand/logo.svg', svg(mark()));
files.set('brand/logo-teal.svg', svg(mark({ tone: colors.teal })));
files.set('brand/logo-navy.svg', svg(mark({ tone: colors.navy })));
files.set('brand/logo-white.svg', svg(mark({ tone: '#FFFFFF' })));

// Purpose-drawn small-size silhouette: no gradients or fine eye highlights.
files.set('fliwright-activitybar.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><path fill="currentColor" fill-rule="evenodd" d="M7.2 6.2C7.8 2.1 11.2 1.1 14 2.1C16 2.8 17.4 4.2 18.4 5.5C21.5 6.6 23 8.7 23 10.7C23 13.5 19.4 15 16.5 14.4C13.7 13.8 12 12 9.5 12.7C6.5 13.5 5.7 16.9 7.4 19.2C9 21.4 12.9 21 13.5 18.8C13.9 17.3 12.5 16.5 11.6 17.1C11 17.5 11 18.2 11.8 18.6C9.3 19 8.9 16.1 10.8 15.1C13.5 13.5 16.4 15.6 16.4 18.1C16.4 21.1 13.8 23 10.2 23C4.9 23 1.5 19.2 1.5 13.5C1.5 9.8 3.7 7.1 7.2 6.2ZM20.3 9.1A2.3 2.3 0 1 0 15.7 9.1A2.3 2.3 0 0 0 20.3 9.1Z"/></svg>\n`);
for (const [name, background] of [['dark', null], ['light', '#FFFFFF']]) {
  const backdrop = background ? `<rect width="256" height="256" rx="56" fill="${background}"/>` : '';
  files.set(`brand/icon-${name}.svg`, svg(`${backdrop}<g transform="translate(24 24) scale(.8125)">${mark({ id: name })}</g>`));
}

for (const state of ['idle', 'running', 'success', 'error', 'thinking']) {
  const id = `mascot-${state}`;
  let badge = '';
  if (state === 'running') badge = `<path d="M8 102H32M0 128H23M11 155H32" stroke="${colors.cyan}" stroke-width="7" stroke-linecap="round"/>`;
  if (state === 'success') badge = `<circle cx="230" cy="35" r="24" fill="${colors.green}"/><path d="m219 35 8 8 15-17" fill="none" stroke="${colors.navy}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (state === 'error') badge = `<circle cx="230" cy="35" r="24" fill="#FF6B57"/><path d="M230 23v13" stroke="${colors.navy}" stroke-width="5" stroke-linecap="round"/><circle cx="230" cy="45" r="3" fill="${colors.navy}"/>`;
  if (state === 'thinking') badge = `<path d="M210 56l-1 12 15-10h18a23 23 0 0 0 0-46h-20a23 23 0 0 0-12 44" fill="#E4F5F4"/><g fill="${colors.navy}"><circle cx="220" cy="35" r="3"/><circle cx="232" cy="35" r="3"/><circle cx="244" cy="35" r="3"/></g>`;
  files.set(`brand/${id}.svg`, svg(`<ellipse cx="140" cy="266" rx="98" ry="7" fill="${colors.navy}" opacity=".06"/><g transform="translate(27 28) scale(.9)">${mark({ id, happy: state === 'success' })}</g>${badge}`, 280, 280, `Fliwright ${state}`));
}

files.set('brand/banner.svg', svg(`<rect width="1440" height="480" rx="24" fill="${colors.navy}"/>
  <g transform="translate(77 80) scale(1.22)">${mark({ id: 'banner' })}</g>
  <text x="456" y="139" fill="${colors.green}" font-family="Inter, Arial, sans-serif" font-size="16" font-weight="600" letter-spacing="3">FLUTTER AUTOMATION · VS CODE</text>
  <text x="451" y="246" fill="#FFFFFF" font-family="Inter, Arial, sans-serif" font-size="96" font-weight="700" letter-spacing="-4">Fliwright</text>
  <text x="456" y="307" fill="#C1D4E4" font-family="Inter, Arial, sans-serif" font-size="30">See. Adapt. Test. Repeat.</text>
  <g font-family="Inter, Arial, sans-serif" font-size="16" fill="#C1D4E4"><text x="456" y="387">RECORD</text><circle cx="549" cy="381" r="3" fill="${colors.teal}"/><text x="573" y="387">AUTOMATE</text><circle cx="702" cy="381" r="3" fill="${colors.teal}"/><text x="726" y="387">INSPECT</text><circle cx="831" cy="381" r="3" fill="${colors.teal}"/><text x="855" y="387">REPEAT</text></g>`, 1440, 480, 'Fliwright — See. Adapt. Test. Repeat.'));

const text = (x, y, content, size = 16, fill = colors.navy, weight = 400) => `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}">${content}</text>`;
const embed = (file, x, y, width) => `<image href="data:image/svg+xml;base64,${Buffer.from(files.get(file)).toString('base64')}" x="${x}" y="${y}" width="${width}" height="${width}"/>`;
files.set('brand/identity.svg', svg(`<rect width="1440" height="1140" rx="24" fill="#F5F8F7"/>
  <g font-family="Inter, Arial, sans-serif">
  ${text(56, 48, 'FLIWRIGHT / VISUAL IDENTITY', 14, '#536779', 600)}${text(1170, 48, 'VS CODE · 2026', 14, '#536779', 500)}
  <rect x="40" y="76" width="1360" height="330" rx="24" fill="${colors.navy}"/>
  ${embed('brand/logo.svg', 100, 108, 264)}
  ${text(430, 160, 'SEE. ADAPT. TEST. REPEAT.', 14, colors.green, 600)}
  ${text(425, 259, 'Fliwright', 88, '#FFFFFF', 700)}
  ${text(430, 317, 'A curious companion for Flutter automation.', 25, '#C1D4E4')}
  ${text(56, 457, '01 / THE MARK', 14, '#536779', 600)}
  <rect x="40" y="480" width="830" height="236" rx="20" fill="#FFFFFF"/>
  ${embed('brand/logo.svg', 75, 501, 144)}${embed('brand/logo-teal.svg', 274, 501, 144)}${embed('brand/logo-navy.svg', 473, 501, 144)}
  <rect x="664" y="498" width="164" height="164" rx="20" fill="${colors.navy}"/>${embed('brand/logo-white.svg', 674, 508, 144)}
  ${text(106, 690, 'Primary', 15)}${text(305, 690, 'Solid teal', 15)}${text(507, 690, 'Navy', 15)}${text(723, 690, 'White', 15)}
  ${text(910, 457, '02 / EDITOR ICONS', 14, '#536779', 600)}
  <rect x="894" y="480" width="506" height="236" rx="20" fill="#FFFFFF"/>
  ${embed('brand/icon-dark.svg', 922, 514, 128)}${embed('brand/icon-light.svg', 1082, 514, 128)}
  <rect x="1252" y="516" width="112" height="124" rx="16" fill="#F0F4F3"/>
  <g transform="translate(1284 548) scale(2)" fill="${colors.navy}">${files.get('fliwright-activitybar.svg').replace(/<svg[^>]*>|<\/svg>/g, '').replace('currentColor', colors.navy)}</g>
  ${text(937, 690, 'Marketplace', 15)}${text(1104, 690, 'Light', 15)}${text(1275, 690, 'Activity', 15)}
  ${text(56, 765, '03 / A LITTLE PERSONALITY', 14, '#536779', 600)}
  <rect x="40" y="788" width="1360" height="180" rx="20" fill="#FFFFFF"/>
  ${['idle', 'running', 'success', 'error', 'thinking'].map((state, i) => `${embed(`brand/mascot-${state}.svg`, 115 + i * 264, 798, 130)}${text(158 + i * 264, 949, state[0].toUpperCase() + state.slice(1), 15)}`).join('')}
  ${text(56, 1015, '04 / COLOR', 14, '#536779', 600)}
  ${Object.entries(colors).map(([name, color], i) => `<rect x="${56 + i * 225}" y="1040" width="32" height="52" rx="10" fill="${color}"/>${text(100 + i * 225, 1059, name[0].toUpperCase() + name.slice(1), 15, colors.navy, 600)}${text(100 + i * 225, 1083, color, 13, '#536779')}`).join('')}
  </g>`, 1440, 1140, 'Fliwright VS Code visual identity'));

for (const [name, source] of files) {
  const target = resolve(root, 'media', name);
  await mkdir(resolve(target, '..'), { recursive: true });
  await writeFile(target, source);
}

if (!process.argv.includes('--svg-only')) {
  const moduleIndex = process.argv.indexOf('--sharp-module');
  const modulePath = moduleIndex >= 0 ? process.argv[moduleIndex + 1] : undefined;
  const { default: sharp } = await import(modulePath ? pathToFileURL(resolve(modulePath)).href : 'sharp');
  const exportPng = async (source, target, width) => {
    await sharp(Buffer.from(files.get(source))).resize(width).png().toFile(resolve(root, 'media', target));
  };
  await exportPng('brand/icon-dark.svg', 'fliwright-marketplace.png', 256);
  await exportPng('brand/icon-light.svg', 'brand/icon-light.png', 256);
  for (const size of [16, 32, 64, 128, 512]) {
    await exportPng('brand/icon-dark.svg', `brand/icon-dark-${size}.png`, size);
  }
  await exportPng('brand/logo.svg', 'brand/logo.png', 512);
  await exportPng('brand/banner.svg', 'brand/banner.png', 1440);
  await exportPng('brand/identity.svg', 'brand/identity.png', 1440);
}
console.log(`Generated ${files.size} SVG assets${process.argv.includes('--svg-only') ? '' : ' and PNG exports'}.`);
