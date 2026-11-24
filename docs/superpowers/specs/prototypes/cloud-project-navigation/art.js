// Small locally drawn landscape covers identify the same project across the directory, switcher and cards.
const landscapes = (() => {
  const colors = {
    fjord: [
      '#afdbcf',
      '#e0edc8',
      '#9ac6ad',
      '#75ac99',
      '#4f8c81',
      '#326c68',
      '#235351'
    ],
    dusk: [
      '#a59dc6',
      '#ffdfac',
      '#c8a7b7',
      '#aa8ba5',
      '#896f91',
      '#665772',
      '#50485e'
    ],
    coast: [
      '#99cada',
      '#f9e7ae',
      '#a1c8b2',
      '#76aea8',
      '#6199a0',
      '#477b86',
      '#365e71'
    ],
    ember: [
      '#e5ba90',
      '#fff0bb',
      '#d5a776',
      '#b98568',
      '#a16b58',
      '#845a50',
      '#664b48'
    ],
    night: [
      '#273f50',
      '#dfdcb6',
      '#365461',
      '#355a61',
      '#2a5159',
      '#20464c',
      '#193a42'
    ],
    day: [
      '#80b5aa',
      '#f6deb0',
      '#91baa9',
      '#73a798',
      '#558f83',
      '#417b71',
      '#30655f'
    ]
  };
  const cache = new Map();
  function cover(kind, wide = false, dark = false) {
    const key = kind + wide + dark;
    if (cache.has(key)) return cache.get(key);
    const canvas = document.createElement('canvas');
    const w = (canvas.width = wide ? 1750 : 420),
      h = (canvas.height = wide ? 860 : 152);
    const ctx = canvas.getContext('2d');
    const original = colors[kind] || colors.fjord;
    const palette = dark
      ? original.map((color, index) => {
          const value = Number.parseInt(color.slice(1), 16),
            base = [11, 26, 38],
            weight = index === 1 ? 0.74 : 0.38;
          const channels = [16, 8, 0].map((shift, i) =>
            Math.round(
              ((value >> shift) & 255) * weight + base[i] * (1 - weight)
            )
          );
          return `rgb(${channels.join(',')})`;
        })
      : original;
    let seed =
      wide && !dark && ['day', 'night'].includes(kind)
        ? 41
        : Object.keys(colors).indexOf(kind) * 37 + 7;
    function rand() {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    }
    ctx.fillStyle = palette[0];
    ctx.fillRect(0, 0, w, h);
    const sunX = (wide ? 0.8 : 0.67 + 0.14 * rand()) * w,
      sunY = (wide ? 0.44 : 0.28) * h;
    ctx.fillStyle = palette[1];
    ctx.beginPath();
    ctx.arc(sunX, sunY, h * (wide ? 0.069 : 0.116), 0, Math.PI * 2);
    ctx.fill();
    if (kind === 'night' || dark) {
      ctx.fillStyle = '#b7d6d1';
      for (let i = 0; i < 100; i++) {
        ctx.globalAlpha = 0.2 + rand() * 0.5;
        ctx.fillRect(rand() * w, rand() * h * 0.58, 1.2, 1.2);
      }
      ctx.globalAlpha = 1;
    }
    for (let layer = 0; layer < 5; layer++) {
      const points = [],
        count = wide ? 140 : 77,
        phase = rand() * 6;
      const horizon = wide ? 0.59 + layer * 0.091 : 0.5 + layer * 0.103;
      const amplitude = wide ? 0.083 : 0.115;
      let walk = 0;
      for (let i = 0; i <= count; i++) {
        const t = i / count;
        walk = walk * 0.75 + (rand() - 0.5) * 0.019;
        const y =
          h *
          (horizon +
            Math.sin(t * 7.4 + phase) * amplitude +
            Math.sin(t * 17 + phase) * amplitude * 0.4 +
            walk);
        points.push([t * w, y]);
      }
      ctx.fillStyle = palette[layer + 2];
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (const [x, y] of points) ctx.lineTo(x, y);
      ctx.lineTo(w, h);
      ctx.fill();
      if (layer === 3 || layer === 4) {
        for (let i = 0; i < count; i++) {
          const [x, y] = points[i];
          const [nx, ny] = points[i + 1];
          for (let k = 0; k < (wide ? 5 : 2); k++) {
            const t = rand(),
              xx = x + (nx - x) * t,
              yy = y + (ny - y) * t,
              sz = h * (layer === 4 ? 0.045 : 0.021) * (0.3 + rand() * 0.85);
            ctx.beginPath();
            ctx.moveTo(xx, yy - sz);
            ctx.lineTo(xx + sz * 0.27, yy + 0.7);
            ctx.lineTo(xx - sz * 0.27, yy + 0.7);
            ctx.fill();
          }
        }
      }
    }
    const url = canvas.toDataURL();
    cache.set(key, url);
    return url;
  }
  return { cover };
})();
