/* ThemeEngine: string -> VS Code theme palette, with contrast checks.
   Pure functions, no DOM. Colors are designed in OKLCH and emitted as sRGB hex,
   because VS Code theme colors only accept hex (#RRGGBB / #RRGGBBAA). */
const ThemeEngine = (function () {
  'use strict';

  /* ---------- hashing ---------- */
  function hash32(str) {
    let h = 0x811c9dc5; // FNV-1a
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); // murmur3 finalizer (avalanche)
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }
  function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- color math ---------- */
  const clamp01 = v => Math.min(1, Math.max(0, v));
  const EPS = 1e-5;

  function oklchToLinear(L, C, H) {
    const h = (H * Math.PI) / 180, a = C * Math.cos(h), b = C * Math.sin(h);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    ];
  }
  const inGamut = rgb => rgb.every(v => v >= -EPS && v <= 1 + EPS);
  const enc = v => { v = clamp01(v); return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; };
  const dec = v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

  // Gamut-map by lowering chroma at fixed lightness and hue.
  function fitChroma(L, C, H) {
    if (inGamut(oklchToLinear(L, C, H))) return C;
    let lo = 0, hi = C;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear(L, mid, H))) lo = mid; else hi = mid;
    }
    return lo;
  }
  function oklchToHex(L, C, H) {
    L = clamp01(L);
    H = ((H % 360) + 360) % 360;
    const c = fitChroma(L, Math.max(0, C), H);
    return '#' + oklchToLinear(L, c, H)
      .map(v => Math.round(enc(v) * 255).toString(16).padStart(2, '0')).join('');
  }
  function hexToLin(hex) {
    const n = parseInt(hex.slice(1, 7), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => dec(v / 255));
  }
  function lum(hex) {
    const [r, g, b] = hexToLin(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrast(a, b) {
    const la = lum(a), lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  function linToOklab(rgb) {
    const [r, g, b] = rgb;
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    ];
  }

  /* Color-vision-deficiency simulation (Machado et al. 2009, severity 1.0, linear RGB). */
  const CVD = {
    normal: { label: 'Normal vision', m: null },
    protan: { label: 'Protanopia (no red)', m: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]] },
    deutan: { label: 'Deuteranopia (no green)', m: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]] },
    tritan: { label: 'Tritanopia (no blue)', m: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]] }
  };
  function hexToLab(hex, m) {
    let lin = hexToLin(hex);
    if (m) lin = m.map(r => clamp01(r[0] * lin[0] + r[1] * lin[1] + r[2] * lin[2]));
    return linToOklab(lin);
  }
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  function separation(hexes, view) {
    const labs = hexes.map(h => hexToLab(h, CVD[view].m));
    let min = Infinity, pair = [0, 1];
    for (let i = 0; i < labs.length; i++) for (let j = i + 1; j < labs.length; j++) {
      const d = dist(labs[i], labs[j]);
      if (d < min) { min = d; pair = [i, j]; }
    }
    return { min, pair };
  }

  /* Move lightness (direction d: +1 lighter, -1 darker) until contrast >= min on every surface. */
  function fit(L, C, H, surfaces, min, d) {
    let l = L, hex = oklchToHex(l, C, H), n = 0;
    const ok = x => surfaces.every(s => contrast(x, s) >= min + 0.03);
    while (!ok(hex) && n < 300) {
      l += d * 0.004;
      if (l < 0 || l > 1) { l = clamp01(l); hex = oklchToHex(l, C, H); break; }
      hex = oklchToHex(l, C, H);
      n++;
    }
    return { hex, L: l };
  }

  /* ---------- theme builder ---------- */
  /* The outer frame: title bar, activity bar (left icon strip) and status bar. */
  const FRAME_KEYS = [
    'titleBar.activeBackground', 'titleBar.activeForeground', 'titleBar.inactiveBackground',
    'titleBar.inactiveForeground', 'titleBar.border',
    'activityBar.background', 'activityBar.foreground', 'activityBar.inactiveForeground',
    'activityBar.activeBorder', 'activityBar.border', 'activityBarBadge.background', 'activityBarBadge.foreground',
    'statusBar.background', 'statusBar.foreground', 'statusBar.noFolderBackground',
    'statusBar.noFolderForeground', 'statusBar.border',
    'statusBarItem.hoverBackground', 'statusBarItem.hoverForeground', 'statusBarItem.activeBackground',
    'modernActivityBarItem.hoverBackground', 'modernActivityBarItem.hoverForeground'
  ];
  /* The Explorer side bar, plus the list and text keys that show up inside it. */
  const EXPLORER_KEYS = [
    'sideBar.background', 'sideBar.foreground', 'sideBar.border', 'sideBarTitle.foreground',
    'sideBarSectionHeader.background', 'sideBarSectionHeader.foreground',
    'list.hoverBackground', 'list.hoverForeground', 'list.activeSelectionBackground', 'list.activeSelectionForeground',
    'list.inactiveSelectionBackground', 'list.inactiveSelectionForeground', 'list.focusBackground',
    'list.focusForeground', 'list.focusOutline', 'list.errorForeground', 'list.warningForeground',
    'tree.indentGuidesStroke', 'descriptionForeground', 'icon.foreground'
  ];
  /* The coding area: editor surface, tabs, breadcrumbs, editor widgets. Token rules are added separately. */
  const EDITOR_KEYS = [
    'editor.background', 'editor.foreground', 'editor.lineHighlightBackground', 'editor.selectionBackground',
    'editor.inactiveSelectionBackground', 'editor.findMatchBackground', 'editor.findMatchHighlightBackground',
    'editorCursor.foreground', 'editorLineNumber.foreground', 'editorLineNumber.activeForeground',
    'editorIndentGuide.background1', 'editorIndentGuide.activeBackground1', 'editorWhitespace.foreground',
    'editorBracketMatch.background', 'editorBracketMatch.border',
    'editorError.foreground', 'editorWarning.foreground', 'editorInfo.foreground',
    'editorWidget.background', 'editorWidget.foreground', 'editorWidget.border',
    'editorGroupHeader.tabsBackground', 'editorGroup.border',
    'breadcrumb.foreground', 'breadcrumb.focusForeground', 'breadcrumb.activeSelectionForeground', 'breadcrumb.background',
    'tab.activeBackground', 'tab.activeForeground', 'tab.activeBorderTop',
    'tab.inactiveBackground', 'tab.inactiveForeground', 'tab.border',
    'tab.hoverBackground', 'tab.hoverForeground', 'tab.unfocusedHoverBackground', 'tab.unfocusedHoverForeground',
    'editor.hoverHighlightBackground'
  ];
  /* The bottom panel (Terminal, Problems, Output tabs) and the terminal's own colors, including its 16 ANSI colors. */
  const PANEL_KEYS = [
    'panel.background', 'panel.border',
    'panelTitle.activeForeground', 'panelTitle.inactiveForeground', 'panelTitle.activeBorder',
    'terminal.background', 'terminal.foreground', 'terminal.selectionBackground', 'terminalCursor.foreground'
  ].concat(['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White'].reduce(function (a, n) {
    return a.concat(['terminal.ansi' + n, 'terminal.ansiBright' + n]);
  }, []));
  /* Which option turns each contrast check on in the report. Anything not listed needs "everything". */
  const CHECK_AREA = {
    'Title bar': 'frame', 'Inactive window title': 'frame', 'Activity bar icons and active marker': 'frame',
    'Inactive activity bar icons': 'frame', 'Activity bar badge': 'frame', 'Status bar': 'frame',
    'Status bar item on hover or press': 'frame', 'Status bar hover visible against bar': 'frame',
    'Activity bar icon on hover': 'frame',
    'Hovered tab': 'editor',
    'Side bar text': 'explorer', 'Side bar secondary text': 'explorer', 'Selected and hovered rows': 'explorer',
    'Error and warning rows in lists': 'explorer', 'Focus ring': 'explorer',
    'Code text': 'editor', 'Line numbers': 'editor', 'Cursor': 'editor', 'Selection visible against background': 'editor',
    'Breadcrumbs': 'editor', 'Active tab': 'editor', 'Inactive tab': 'editor',
    'Warning squiggles': 'editor', 'Info squiggles': 'editor',
    'Panel tabs': 'panel', 'All 16 ANSI colors': 'panel'
  };
  const ROLES = ['keyword', 'string', 'number', 'function', 'type', 'property'];
  const ROLE_LABEL = { keyword: 'Keywords', string: 'Strings', number: 'Numbers and constants', function: 'Functions', type: 'Types and classes', property: 'Properties and attributes' };

  /* ---------- CSS named colors ----------
     The 148 names from CSS Color Module Level 4, kept here (not read from a browser) so Node and the page agree.
     A test compares this table with the browser's own idea of each name. */
  const CSS_COLORS = Object.freeze({
    aliceblue: '#f0f8ff', antiquewhite: '#faebd7', aqua: '#00ffff', aquamarine: '#7fffd4', azure: '#f0ffff',
    beige: '#f5f5dc', bisque: '#ffe4c4', black: '#000000', blanchedalmond: '#ffebcd', blue: '#0000ff',
    blueviolet: '#8a2be2', brown: '#a52a2a', burlywood: '#deb887', cadetblue: '#5f9ea0', chartreuse: '#7fff00',
    chocolate: '#d2691e', coral: '#ff7f50', cornflowerblue: '#6495ed', cornsilk: '#fff8dc', crimson: '#dc143c',
    cyan: '#00ffff', darkblue: '#00008b', darkcyan: '#008b8b', darkgoldenrod: '#b8860b', darkgray: '#a9a9a9',
    darkgreen: '#006400', darkgrey: '#a9a9a9', darkkhaki: '#bdb76b', darkmagenta: '#8b008b',
    darkolivegreen: '#556b2f', darkorange: '#ff8c00', darkorchid: '#9932cc', darkred: '#8b0000',
    darksalmon: '#e9967a', darkseagreen: '#8fbc8f', darkslateblue: '#483d8b', darkslategray: '#2f4f4f',
    darkslategrey: '#2f4f4f', darkturquoise: '#00ced1', darkviolet: '#9400d3', deeppink: '#ff1493',
    deepskyblue: '#00bfff', dimgray: '#696969', dimgrey: '#696969', dodgerblue: '#1e90ff', firebrick: '#b22222',
    floralwhite: '#fffaf0', forestgreen: '#228b22', fuchsia: '#ff00ff', gainsboro: '#dcdcdc', ghostwhite: '#f8f8ff',
    gold: '#ffd700', goldenrod: '#daa520', gray: '#808080', green: '#008000', greenyellow: '#adff2f', grey: '#808080',
    honeydew: '#f0fff0', hotpink: '#ff69b4', indianred: '#cd5c5c', indigo: '#4b0082', ivory: '#fffff0',
    khaki: '#f0e68c', lavender: '#e6e6fa', lavenderblush: '#fff0f5', lawngreen: '#7cfc00', lemonchiffon: '#fffacd',
    lightblue: '#add8e6', lightcoral: '#f08080', lightcyan: '#e0ffff', lightgoldenrodyellow: '#fafad2',
    lightgray: '#d3d3d3', lightgreen: '#90ee90', lightgrey: '#d3d3d3', lightpink: '#ffb6c1', lightsalmon: '#ffa07a',
    lightseagreen: '#20b2aa', lightskyblue: '#87cefa', lightslategray: '#778899', lightslategrey: '#778899',
    lightsteelblue: '#b0c4de', lightyellow: '#ffffe0', lime: '#00ff00', limegreen: '#32cd32', linen: '#faf0e6',
    magenta: '#ff00ff', maroon: '#800000', mediumaquamarine: '#66cdaa', mediumblue: '#0000cd',
    mediumorchid: '#ba55d3', mediumpurple: '#9370db', mediumseagreen: '#3cb371', mediumslateblue: '#7b68ee',
    mediumspringgreen: '#00fa9a', mediumturquoise: '#48d1cc', mediumvioletred: '#c71585', midnightblue: '#191970',
    mintcream: '#f5fffa', mistyrose: '#ffe4e1', moccasin: '#ffe4b5', navajowhite: '#ffdead', navy: '#000080',
    oldlace: '#fdf5e6', olive: '#808000', olivedrab: '#6b8e23', orange: '#ffa500', orangered: '#ff4500',
    orchid: '#da70d6', palegoldenrod: '#eee8aa', palegreen: '#98fb98', paleturquoise: '#afeeee',
    palevioletred: '#db7093', papayawhip: '#ffefd5', peachpuff: '#ffdab9', peru: '#cd853f', pink: '#ffc0cb',
    plum: '#dda0dd', powderblue: '#b0e0e6', purple: '#800080', rebeccapurple: '#663399', red: '#ff0000',
    rosybrown: '#bc8f8f', royalblue: '#4169e1', saddlebrown: '#8b4513', salmon: '#fa8072', sandybrown: '#f4a460',
    seagreen: '#2e8b57', seashell: '#fff5ee', sienna: '#a0522d', silver: '#c0c0c0', skyblue: '#87ceeb',
    slateblue: '#6a5acd', slategray: '#708090', slategrey: '#708090', snow: '#fffafa', springgreen: '#00ff7f',
    steelblue: '#4682b4', tan: '#d2b48c', teal: '#008080', thistle: '#d8bfd8', tomato: '#ff6347',
    turquoise: '#40e0d0', violet: '#ee82ee', wheat: '#f5deb3', white: '#ffffff', whitesmoke: '#f5f5f5',
    yellow: '#ffff00', yellowgreen: '#9acd32'
  });
  // Below this OKLCH chroma a color is a gray (gray, silver, white, black, near-white tints): it has no hue worth using.
  const MIN_COLOR_CHROMA = 0.03;
  // A typed color at least this light (OKLCH L) cannot carry light text, so its bars stay bright and get dark text.
  // Roughly: the colors for which white text on them would fall below 4.5:1. The bar is never lighter than BRIGHT_BAR_MAX_L.
  const SNIPPET_COMMENT = '// Generated by String-to-VS-Code-theme util: ';
  const BRIGHT_BAR_L = 0.6, BRIGHT_BAR_MAX_L = 0.93;
  // A typed gray, white or black has no hue. It still gives a theme (a neutral one: no tint on the surfaces, text or
  // bars), and the syntax colors, which need a hue to spread from, start at this one. Its deep bar is no darker than this.
  const NEUTRAL_BASE_HUE = 250, NEUTRAL_MIN_BAR_L = 0.3;
  // Text that is not a color gets a bright bar too, for this share of strings (chosen by its own hash, so nothing
  // else about the theme moves). Its lightness spreads over this range, below the cap a typed color may reach.
  const BRIGHT_SHARE = 0.35, BRIGHT_HASH_L = [0.64, 0.88];

  function hexToOklch(hex) {
    const [r, g, b] = hexToLin(hex);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    const bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    return {
      L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      C: Math.hypot(a, bb),
      H: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360
    };
  }
  /* ---------- Tailwind CSS default palette ----------
     26 families x 11 shades, from the tailwindcss package, converted from OKLCH to sRGB hex with this file's own
     gamut mapping. scripts/gen-tailwind.js regenerates these lines. */
  const TAILWIND_SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
  const TAILWIND_SRC = {
    // tailwindcss 4.3.5: 26 families x 11 shades (50 100 200 300 400 500 600 700 800 900 950)
    red: '#fef2f2 #ffe2e2 #ffcaca #ffa3a4 #ff6568 #fb2c36 #e40016 #bf000f #9f0712 #82181a #460809',
    orange: '#fff7ed #ffedd5 #ffd7a8 #ffb970 #ff8b1f #fc7100 #ec5600 #c43e00 #9f2d00 #7e2a0c #441306',
    amber: '#fffbeb #fef3c6 #fee685 #ffd237 #fabc00 #f69e00 #da7700 #b55200 #953d00 #7b3306 #461901',
    yellow: '#fefce8 #fef9c2 #fff085 #ffe030 #f7c900 #eab300 #ca8a00 #a26200 #874c00 #733e0a #432004',
    lime: '#f7fee7 #ecfcca #d8f999 #bbf451 #9de500 #83cc00 #64a300 #4b7c00 #3d6300 #35530e #192e03',
    green: '#f0fdf4 #dcfce7 #b9f8cf #7bf1a8 #05df72 #00c65a #00a447 #00813a #016630 #0d542b #032e15',
    emerald: '#ecfdf5 #d0fae5 #a4f4cf #5ee9b5 #00d294 #00b981 #009669 #007857 #005f46 #004e3b #002c22',
    teal: '#f0fdfa #cbfbf1 #96f7e4 #46ecd5 #00d3bd #00b9a6 #009488 #00776e #005f5a #0b4f4a #022f2e',
    cyan: '#ecfeff #cefafe #a2f4fd #53eafd #00d1ec #00b6d4 #0091b3 #007491 #005f78 #104e64 #053345',
    sky: '#f0f9ff #dff2fe #b8e6fe #78d4ff #00bbfd #00a5ea #0084c7 #0069a2 #005986 #024a70 #052f4a',
    blue: '#eff6ff #dbeafe #bedbff #91c5ff #56a2ff #3280ff #155dfc #1447e6 #193cb8 #1c398e #162456',
    indigo: '#eef2ff #e0e7ff #c7d2ff #a4b4ff #7d87ff #6260ff #4f39f6 #432dd7 #372aac #312c85 #1e1a4d',
    violet: '#f5f3ff #ede9fe #ddd6ff #c4b4ff #a686ff #8d56ff #7f22fe #7008e7 #5d0ec0 #4d179a #2f0d68',
    purple: '#faf5ff #f3e8ff #e9d5ff #d8b4ff #bf7eff #ab4eff #9810fa #8200d9 #6e11b0 #59168b #3c0366',
    fuchsia: '#fdf4ff #fae8ff #f6cfff #f2a9ff #ec6dff #e12afb #c500da #a600b4 #8a0194 #721378 #4b004f',
    pink: '#fdf2f8 #fce7f3 #fccee8 #fda5d5 #fb64b6 #f6339a #e30076 #c2005c #a2004c #861043 #510424',
    rose: '#fff1f2 #ffe4e6 #ffccd3 #ffa3ae #ff6880 #ff2357 #e60045 #c1003a #a30037 #8b0836 #4d0218',
    slate: '#f8fafc #f1f5f9 #e2e8f0 #cad5e2 #90a1b9 #62748e #45556c #314158 #1d293d #0f172b #020618',
    gray: '#f9fafb #f3f4f6 #e5e7eb #d1d5dc #99a1af #6a7282 #4a5565 #364153 #1e2939 #101828 #030712',
    zinc: '#fafafa #f4f4f5 #e4e4e7 #d4d4d8 #9f9fa9 #71717b #52525c #3f3f46 #27272a #18181b #09090b',
    neutral: '#fafafa #f5f5f5 #e5e5e5 #d4d4d4 #a1a1a1 #737373 #525252 #404040 #262626 #171717 #0a0a0a',
    stone: '#fafaf9 #f5f5f4 #e7e5e4 #d6d3d1 #a6a09b #79716b #57534d #44403b #292524 #1c1917 #0c0a09',
    mauve: '#fafafa #f3f1f3 #e7e4e7 #d7d0d7 #a89ea9 #79697b #594c5b #463947 #2a212c #1d161e #0c090c',
    olive: '#fbfbf9 #f4f4f0 #e8e8e3 #d8d8d0 #abab9c #7c7c67 #5b5b4b #474739 #2b2b22 #1d1d16 #0c0c09',
    mist: '#f9fbfb #f1f3f3 #e3e7e8 #d0d6d8 #9ca8ab #67787c #4b585b #394447 #22292b #161b1d #090b0c',
    taupe: '#fbfaf9 #f3f1f1 #e8e4e3 #d8d2d0 #aba09c #7c6d67 #5b4f4b #473c39 #2b2422 #1d1816 #0c0a09',
  };
  const TAILWIND_COLORS = (function () {
    const out = {};
    Object.keys(TAILWIND_SRC).forEach(f => { out[f] = Object.freeze(TAILWIND_SRC[f].split(' ')); });
    return Object.freeze(out);
  })();

  /* ---------- parsing what someone typed as a color ---------- */
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const toHex = rgb01 => '#' + rgb01.map(v => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('');

  function parseHex(s) {
    const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
    if (!m) return null;
    let h = m[1];
    if (h.length <= 4) h = h.replace(/./g, c => c + c);
    return { kind: 'hex', hex: '#' + h.slice(0, 6) }; // alpha, if any, is ignored: a theme color has none to borrow
  }
  // "teal", "Dark Red", "dark-red", "dark_red" and "darkred" are all the CSS name darkred.
  // Separators count only between words: "red-" and "_red" are ordinary names.
  function parseCssName(s) {
    if (!/^[a-z]+(?:[\s_-]+[a-z]+)*$/.test(s)) return null;
    const k = s.replace(/[\s_-]+/g, '');
    return Object.prototype.hasOwnProperty.call(CSS_COLORS, k) ? { kind: 'name', hex: CSS_COLORS[k] } : null;
  }
  // "sky", "sky-500", "Sky 500", "sky500". A bare family is its 500 shade. The CSS names win for bare names
  // that are in both (red, green, olive...); a shade always means Tailwind.
  function parseTailwind(s) {
    const m = /^([a-z]+)(?:[\s_-]*([0-9]{2,3}))?$/.exec(s);
    if (!m || !Object.prototype.hasOwnProperty.call(TAILWIND_COLORS, m[1])) return null;
    const i = m[2] === undefined ? TAILWIND_SHADES.indexOf(500) : TAILWIND_SHADES.indexOf(Number(m[2]));
    return i < 0 ? null : { kind: 'tailwind', hex: TAILWIND_COLORS[m[1]][i] };
  }

  const NUMBER = /^([+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:e[+-]?[0-9]+)?)(%|deg|grad|rad|turn)?$/;
  function token(t) { const m = NUMBER.exec(t); return m ? { v: parseFloat(m[1]), u: m[2] || '' } : null; }
  const angle = t => (t === null || t.u === '%' ? null : t.u === 'grad' ? t.v * 0.9 : t.u === 'rad' ? (t.v * 180) / Math.PI : t.u === 'turn' ? t.v * 360 : t.v);
  const percent = (t, whole) => (t === null ? null : t.u === '%' ? (t.v / 100) * whole : t.u === '' ? t.v : null);
  function hslToRgb(h, s, l) { // h in degrees, s and l in 0..1 -> r, g, b in 0..1
    h = ((h % 360) + 360) % 360;
    const a = s * Math.min(l, 1 - l);
    const f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return [f(0), f(8), f(4)];
  }
  /* rgb() rgba() hsl() hsla() hwb() oklch(), legacy comma or modern space syntax, optional alpha (ignored).
     Anything it cannot read in full (relative colors, var(), calc(), "none", wrong counts) is not a color. */
  function parseFunction(s) {
    const m = /^(rgba?|hsla?|hwb|oklch)\(\s*([^()]*?)\s*\)$/.exec(s);
    if (!m) return null;
    const args = m[2].split(/[\s,/]+/).filter(Boolean).map(token);
    if (args.length < 3 || args.length > 4 || args.some(a => a === null)) return null;
    if (args.length === 4 && percent(args[3], 1) === null) return null;
    const fn = m[1].replace(/a$/, ''), [a, b, c] = args;
    let hex = null;
    if (fn === 'rgb') {
      const rgb = [a, b, c].map(t => percent(t, 255));
      if (rgb.some(v => v === null)) return null;
      hex = toHex(rgb.map(v => v / 255));
    } else if (fn === 'hsl' || fn === 'hwb') {
      const h = angle(a), x = percent(b, 100), y = percent(c, 100);
      if (h === null || x === null || y === null) return null;
      if (fn === 'hsl') hex = toHex(hslToRgb(h, clamp(x, 0, 100) / 100, clamp(y, 0, 100) / 100));
      else {
        const w = clamp(x, 0, 100) / 100, k = clamp(y, 0, 100) / 100;
        hex = w + k >= 1 ? toHex([w / (w + k), w / (w + k), w / (w + k)]) : toHex(hslToRgb(h, 1, 0.5).map(v => v * (1 - w - k) + w));
      }
    } else { // oklch(L C H): L is 0..1 or a percentage, C is a number or a percentage of 0.4; out-of-gamut colors lose chroma
      const L = percent(a, 1), C = percent(b, 0.4), h = angle(c);
      if (L === null || C === null || h === null) return null;
      hex = oklchToHex(clamp(L, 0, 1), Math.max(0, C), h);
    }
    return { kind: 'function', hex };
  }

  /* Something typed in the name field -> { kind, hex, hue, chroma } if it is a color, else null. Accepted: CSS color
     names (any case, with or without spaces, hyphens or underscores), #rgb #rgba #rrggbb #rrggbbaa, Tailwind
     families with an optional shade, and rgb() hsl() hwb() oklch(). Bare hex digits are NOT accepted: "facade" and
     "bad" are valid hex and also ordinary words. hue is null for grays (too little chroma for a hue). */
  function parseColor(input) {
    const s = String(input == null ? '' : input).trim().toLowerCase();
    const r = s.charAt(0) === '#' ? parseHex(s) : s.indexOf('(') >= 0 ? parseFunction(s) : parseCssName(s) || parseTailwind(s);
    if (r === null) return null;
    const k = hexToOklch(r.hex);
    return { kind: r.kind, hex: r.hex, hue: k.C < MIN_COLOR_CHROMA ? null : k.H, chroma: k.C, lightness: k.L };
  }

  function buildTheme(seedRaw, mode) {
    const seed = String(seedRaw == null ? '' : seedRaw).trim();
    // A color (name, hex, Tailwind, function) is always used as the color it is, never hashed as text. It gives the
    // theme that color's hue, or, for a gray with no hue, a neutral theme. Hashing the canonical hex (not the typed
    // text) makes "Tomato", "tomato" and "#FF6347" the same theme.
    const col = parseColor(seed);
    const neutral = col !== null && col.hue === null;
    const T = neutral ? 0 : 1;               // how much hue tints the surfaces, text and bars: none for a gray
    const tint = c => c * T;
    const key = col !== null ? col.hex : seed;
    const h1 = hash32(key), h2 = hash32('\u0001' + key), h3 = hash32('\u0002' + key);
    const rand = rng((h2 ^ h3) >>> 0);
    const hue = col === null ? (h1 / 4294967296) * 360 : neutral ? NEUTRAL_BASE_HUE : col.hue;
    const dark = mode === 'dark' ? true : mode === 'light' ? false : h2 % 100 < 62;
    const dir = dark ? 1 : -1; // direction from background toward text
    const f = n => ((h3 >>> n) & 255) / 255;
    const bgC = 0.012 + f(0) * 0.03;
    const bgL = dark ? 0.19 + f(8) * 0.07 : 0.95 + f(8) * 0.04;
    const accC = T * (0.11 + f(16) * 0.07);
    const S = (L, C, H) => H === undefined ? oklchToHex(L, tint(C), hue) : oklchToHex(L, C, H); // no hue given: the theme's tint

    /* surfaces */
    const bg = S(bgL, bgC);
    const sideL = bgL - 0.025, actL = bgL - 0.045;
    const sideBg = S(sideL, bgC);
    const actBg = S(actL, bgC);
    const hl = S(bgL + dir * 0.03, bgC + 0.004);
    let selL = bgL + dir * 0.1;
    let sel = S(selL, tint(0.05), hue);
    while (contrast(sel, bg) < 1.3 && Math.abs(selL - bgL) < 0.3) { selL += dir * 0.01; sel = S(selL, tint(0.05), hue); }
    const findCur = S(selL + dir * 0.05, tint(0.08), hue + 40);
    const border = S(bgL + dir * 0.09, bgC + 0.005);
    const inputBg = S(bgL + dir * 0.035, bgC);
    const listHover = S(sideL + dir * 0.04, bgC);
    const listInactive = S(sideL + dir * 0.07, bgC);
    const slider = S(bgL + dir * 0.14, bgC + 0.005);
    const sliderHover = S(bgL + dir * 0.2, bgC + 0.005);
    const sliderActive = S(bgL + dir * 0.26, bgC + 0.005);

    const editorSurf = [bg, hl, sel];
    const allSurf = [bg, hl, sel, findCur, sideBg, actBg, inputBg, listHover, listInactive];
    const dimSurf = [bg, hl, sel, sideBg, actBg, inputBg, listHover];

    /* text */
    const fg = fit(dark ? 0.93 : 0.22, tint(0.012), hue, allSurf, 7, dir).hex;
    const dim = fit(dark ? 0.68 : 0.46, tint(0.03), hue, dimSurf, 4.5, dir).hex;
    const punct = fit(dark ? 0.8 : 0.36, tint(0.02), hue, editorSurf, 4.5, dir).hex;
    const accent = fit(dark ? 0.74 : 0.48, accC, hue, [bg, sideBg, sel, actBg, inputBg], 4.5, dir).hex;
    const errFg = fit(dark ? 0.7 : 0.5, 0.17, 25, [bg, sel, sideBg], 4.5, dir).hex;
    const warnFg = fit(dark ? 0.78 : 0.5, 0.14, 85, [bg, sel, sideBg], 4.5, dir).hex;
    const infoFg = fit(dark ? 0.72 : 0.48, 0.12, 245, [bg, sel, sideBg], 4.5, dir).hex;
    const inputBorder = fit(dark ? 0.5 : 0.64, tint(bgC + 0.01), hue, [bg, sideBg, inputBg], 3, dir).hex;

    /* filled surfaces: the frame (title bar, activity bar, status bar) and buttons.
       Normally the frame is dark enough for light text. A light color the user typed (yellow, gold, aqua,
       tomato, sky-300...) cannot be darkened that far and still look like itself, so its frame keeps the color's
       brightness and carries dark text instead. About a third of other strings get the same treatment, at a
       lightness taken from their hash, which widens the range of frames a name can land on. Mode plays no part,
       so the frame is still identical in dark and light. */
    const lightText = S(0.985, tint(0.008), hue);
    const brightU = hash32('\u0003' + key) / 4294967296;  // its own hash: no other part of the theme reads it
    const brightBar = col !== null ? col.lightness >= BRIGHT_BAR_L : brightU < BRIGHT_SHARE;
    const barL = col !== null ? Math.min(col.lightness, BRIGHT_BAR_MAX_L) : BRIGHT_HASH_L[0] + (brightU / BRIGHT_SHARE) * (BRIGHT_HASH_L[1] - BRIGHT_HASH_L[0]);
    const barC = col === null ? accC : tint(col.chroma);
    const darkText = S(0.17, tint(0.02), hue);
    const barFg = brightBar ? darkText : lightText;
    const deepL = neutral ? Math.min(Math.max(col.lightness, NEUTRAL_MIN_BAR_L), 0.46) : 0.46; // a deep gray bar is the gray itself, within reach of light text and a visible hover
    const sb = brightBar ? fit(barL, barC, hue, [darkText], 6, 1) : fit(deepL, accC, hue, [lightText], 6, -1); // a typed color's bar is that color; other text spreads over BRIGHT_HASH_L
    const sbBg = sb.hex; // status bar, title bar and activity bar share this
    const sbDim = brightBar ? fit(0.38, tint(0.03), hue, [sbBg], 4.5, -1).hex : fit(0.86, tint(0.025), hue, [sbBg], 4.5, 1).hex;   // quieter text on that color
    const sbHover = brightBar ? fit(sb.L - 0.06, barC, hue, [darkText], 4.5, 1).hex : fit(sb.L - 0.06, accC, hue, [lightText], 6, -1).hex;  // status bar item hover (darker)
    const sbActive = brightBar ? fit(sb.L - 0.11, barC, hue, [darkText], 4.5, 1).hex : fit(sb.L - 0.11, accC, hue, [lightText], 6, -1).hex; // status bar item pressed
    const btn = fit(0.5, accC, hue, [lightText], 5, -1);
    const btnBg = btn.hex;
    const btnHover = fit(btn.L - 0.05, accC, hue, [lightText], 5, -1).hex;

    /* syntax: choose, deterministically, the hue arrangement whose colors stay most
       distinguishable for normal vision and for the three common dichromacies */
    const baseL = dark ? 0.8 : 0.35;
    const spread = dark ? 0.08 : 0.07; // wider lightness spread keeps colors apart for dichromats
    const offs = [-1, -0.6, -0.2, 0.2, 0.6, 1].map(x => x * spread);
    const tokSurf = [bg, hl, sel, findCur];
    function makeTokens(p) {
      const t = {};
      ROLES.forEach((r, i) => {
        const H = hue + p.dirH * 60 * ((i + p.rot) % 6) + p.jit[i];
        t[r] = fit(baseL + p.off[i], p.C, H, tokSurf, 4.5, dir).hex;
      });
      return t;
    }
    function score(t) {
      const list = ROLES.map(r => t[r]).concat([fg]);
      return Math.min(separation(list, 'normal').min, separation(list, 'protan').min,
        separation(list, 'deutan').min, separation(list, 'tritan').min);
    }
    let best = null, bestScore = -1;
    for (let k = 0; k < 40; k++) {
      const off = offs.slice();
      for (let i = off.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [off[i], off[j]] = [off[j], off[i]]; }
      const p = {
        rot: Math.floor(rand() * 6), dirH: rand() < 0.5 ? 1 : -1,
        jit: ROLES.map(() => (rand() * 2 - 1) * 10), off, C: 0.11 + rand() * 0.06
      };
      const t = makeTokens(p), s = score(t);
      if (s > bestScore) { bestScore = s; best = t; }
    }
    const tok = best;

    /* terminal colors */
    const ansiHue = { Red: 25, Green: 145, Yellow: 95, Blue: 255, Magenta: 330, Cyan: 195 };
    const termSurf = [bg, sel];
    const ansi = {};
    Object.keys(ansiHue).forEach(n => {
      ansi[n] = fit(dark ? 0.74 : 0.45, 0.14, ansiHue[n], termSurf, 4.5, dir).hex;
      ansi['Bright' + n] = fit(dark ? 0.82 : 0.38, 0.15, ansiHue[n], termSurf, 4.5, dir).hex;
    });
    ansi.Black = fit(dark ? 0.55 : 0.3, tint(0.02), hue, termSurf, 4.5, dir).hex;
    ansi.BrightBlack = dim;
    ansi.White = fit(dark ? 0.86 : 0.28, tint(0.01), hue, termSurf, 4.5, dir).hex;
    ansi.BrightWhite = S(dark ? 0.98 : 0.15, tint(0.008), hue);
    const ansiOrder = ['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White'];

    /* VS Code workbench colors */
    const colors = {
      'foreground': fg, 'descriptionForeground': dim, 'errorForeground': errFg,
      'focusBorder': accent, 'icon.foreground': fg, 'selection.background': sel,
      'textLink.foreground': accent, 'textLink.activeForeground': accent,
      'widget.border': border,

      'editor.background': bg, 'editor.foreground': fg,
      'editor.lineHighlightBackground': hl,
      'editor.selectionBackground': sel, 'editor.inactiveSelectionBackground': listInactive,
      'editor.findMatchBackground': findCur, 'editor.findMatchHighlightBackground': sel,
      'editorCursor.foreground': accent,
      'editorLineNumber.foreground': dim, 'editorLineNumber.activeForeground': fg,
      'editorIndentGuide.background1': border, 'editorIndentGuide.activeBackground1': dim,
      'editorWhitespace.foreground': border,
      'editorBracketMatch.background': sel, 'editorBracketMatch.border': accent,
      'editorError.foreground': errFg, 'editorWarning.foreground': warnFg, 'editorInfo.foreground': infoFg,
      'editorWidget.background': sideBg, 'editorWidget.foreground': fg, 'editorWidget.border': border,
      'editorGroupHeader.tabsBackground': sideBg, 'editorGroup.border': border,
      'breadcrumb.foreground': dim, 'breadcrumb.focusForeground': fg,
      'breadcrumb.activeSelectionForeground': fg, 'breadcrumb.background': bg,

      'tab.activeBackground': bg, 'tab.activeForeground': fg, 'tab.activeBorderTop': accent,
      'tab.inactiveBackground': sideBg, 'tab.inactiveForeground': dim, 'tab.border': border,
      'tab.hoverBackground': listHover, 'tab.hoverForeground': fg,
      'tab.unfocusedHoverBackground': listHover, 'tab.unfocusedHoverForeground': fg,
      'editor.hoverHighlightBackground': listInactive,

      'titleBar.activeBackground': sbBg, 'titleBar.activeForeground': barFg,
      'titleBar.inactiveBackground': sbBg, 'titleBar.inactiveForeground': sbDim, 'titleBar.border': sbBg,

      'activityBar.background': sbBg, 'activityBar.foreground': barFg, 'activityBar.inactiveForeground': sbDim,
      'activityBar.activeBorder': barFg, 'activityBar.border': sbBg,
      'activityBarBadge.background': barFg, 'activityBarBadge.foreground': sbBg,

      'sideBar.background': sideBg, 'sideBar.foreground': fg, 'sideBar.border': border,
      'sideBarTitle.foreground': fg, 'sideBarSectionHeader.background': actBg,
      'sideBarSectionHeader.foreground': fg,

      'list.hoverBackground': listHover, 'list.hoverForeground': fg,
      'list.activeSelectionBackground': sel, 'list.activeSelectionForeground': fg,
      'list.inactiveSelectionBackground': listInactive, 'list.inactiveSelectionForeground': fg,
      'list.focusBackground': sel, 'list.focusForeground': fg, 'list.focusOutline': accent,
      'list.errorForeground': errFg, 'list.warningForeground': warnFg, 'tree.indentGuidesStroke': border,

      'statusBar.background': sbBg, 'statusBar.foreground': barFg,
      'statusBar.noFolderBackground': sbBg, 'statusBar.noFolderForeground': barFg, 'statusBar.border': sbBg,
      'statusBarItem.hoverBackground': sbHover, 'statusBarItem.hoverForeground': barFg,
      'statusBarItem.activeBackground': sbActive,
      'modernActivityBarItem.hoverBackground': sbHover, 'modernActivityBarItem.hoverForeground': barFg,

      'panel.background': bg, 'panel.border': border,
      'panelTitle.activeForeground': fg, 'panelTitle.inactiveForeground': dim, 'panelTitle.activeBorder': accent,

      'input.background': inputBg, 'input.foreground': fg, 'input.border': inputBorder,
      'input.placeholderForeground': dim,
      'button.background': btnBg, 'button.foreground': lightText, 'button.hoverBackground': btnHover,
      'badge.background': btnBg, 'badge.foreground': lightText,
      'quickInput.background': sideBg, 'quickInput.foreground': fg,
      'quickInputList.focusBackground': sel, 'quickInputList.focusForeground': fg,
      'pickerGroup.foreground': accent, 'pickerGroup.border': border,

      'scrollbarSlider.background': slider, 'scrollbarSlider.hoverBackground': sliderHover,
      'scrollbarSlider.activeBackground': sliderActive,

      'terminal.background': bg, 'terminal.foreground': fg, 'terminal.selectionBackground': sel,
      'terminalCursor.foreground': accent
    };
    ansiOrder.forEach(n => {
      colors['terminal.ansi' + n] = ansi[n];
      colors['terminal.ansiBright' + n] = ansi['Bright' + n];
    });

    /* TextMate token rules. Scope lists include the scopes Default Dark/Light Modern style,
       so these rules win ties over the base theme. */
    const R = (scope, foreground, fontStyle) => ({ scope, settings: fontStyle ? { foreground, fontStyle } : { foreground } });
    const textMateRules = [
      R(['comment', 'punctuation.definition.comment'], dim, 'italic'),
      R(['punctuation', 'meta.brace', 'meta.delimiter', 'punctuation.separator', 'punctuation.accessor'], punct),
      R(['variable', 'meta.definition.variable.name', 'support.variable', 'entity.name.variable', 'variable.parameter', 'variable.other.readwrite', 'constant.other.placeholder'], fg),
      R(['keyword.operator', 'keyword.operator.assignment', 'keyword.operator.arithmetic', 'keyword.operator.comparison', 'keyword.operator.logical'], punct),
      R(['keyword', 'keyword.control', 'storage', 'storage.type', 'storage.modifier', 'keyword.operator.new', 'keyword.operator.expression', 'keyword.operator.word', 'keyword.other'], tok.keyword),
      R(['entity.name.tag', 'meta.tag.sgml', 'punctuation.definition.tag'], tok.keyword),
      R(['string', 'string.quoted', 'punctuation.definition.string', 'markup.inline.raw', 'markup.fenced_code', 'support.constant.property-value', 'support.constant.font-name'], tok.string),
      R(['constant.numeric', 'constant.language', 'constant.other', 'constant.character', 'support.constant', 'keyword.other.unit', 'constant.character.escape', 'string.regexp', 'variable.other.constant', 'variable.other.enummember'], tok.number),
      R(['entity.name.function', 'support.function', 'meta.function-call.generic', 'variable.function', 'support.constant.handlebars'], tok.function),
      R(['entity.name.type', 'entity.name.class', 'entity.name.namespace', 'entity.other.inherited-class', 'entity.name.scope-resolution', 'support.class', 'support.type', 'meta.return-type', 'entity.other.attribute'], tok.type),
      R(['variable.other.property', 'variable.other.object.property', 'support.variable.property', 'meta.object-literal.key', 'entity.other.attribute-name', 'support.type.property-name', 'support.type.vendored.property-name', 'variable.object.property'], tok.property),
      R(['markup.heading', 'entity.name.section'], tok.keyword, 'bold'),
      R(['markup.bold'], fg, 'bold'),
      R(['markup.italic'], fg, 'italic'),
      R(['markup.underline.link'], accent, 'underline'),
      R(['invalid', 'invalid.illegal'], errFg)
    ];
    const semanticRules = {
      'function': tok.function, 'method': tok.function,
      'class': tok.type, 'interface': tok.type, 'enum': tok.type, 'type': tok.type,
      'typeParameter': tok.type, 'struct': tok.type,
      'property': tok.property, 'enumMember': tok.number,
      'variable': fg, 'parameter': fg,
      'newOperator': tok.keyword, 'stringLiteral': tok.string,
      'numberLiteral': tok.number, 'customLiteral': tok.function
    };

    /* contrast report */
    const checks = [];
    function chk(group, label, fgs, bgs, min, note) {
      fgs = [].concat(fgs); bgs = [].concat(bgs);
      let worst = Infinity, wf = fgs[0], wb = bgs[0];
      fgs.forEach(a => bgs.forEach(b => { const c = contrast(a, b); if (c < worst) { worst = c; wf = a; wb = b; } }));
      checks.push({ group, label, fg: wf, bg: wb, ratio: worst, min, pass: worst >= min, note: note || '', swatch: /^(Non-text|Visibility)/.test(note || '') });
    }
    const G1 = 'Editor text', G2 = 'Syntax colors', G3 = 'Interface', G4 = 'Controls and alerts', G5 = 'Terminal';
    chk(G1, 'Code text', fg, [bg, hl, sel, findCur], 7);
    chk(G1, 'Line numbers', dim, [bg, hl], 4.5);
    chk(G1, 'Cursor', accent, bg, 3, 'Non-text, 3:1');
    chk(G1, 'Selection visible against background', sel, bg, 1.3, 'Visibility, not WCAG');
    chk(G1, 'Breadcrumbs', dim, bg, 4.5);
    ROLES.forEach(r => chk(G2, ROLE_LABEL[r], tok[r], tokSurf, 4.5));
    chk(G2, 'Code under the hover highlight', ROLES.map(r => tok[r]).concat([fg]), listInactive, 4.5);
    chk(G2, 'Comments', dim, editorSurf, 4.5);
    chk(G2, 'Punctuation and operators', punct, editorSurf, 4.5);
    chk(G3, 'Side bar text', fg, sideBg, 7);
    chk(G3, 'Side bar secondary text', dim, sideBg, 4.5);
    chk(G3, 'Selected and hovered rows', fg, [sel, listHover, listInactive], 7);
    chk(G3, 'Error and warning rows in lists', [errFg, warnFg], [sideBg, listHover, listInactive, sel], 4.5);
    chk(G3, 'Active tab', fg, bg, 7);
    chk(G3, 'Inactive tab', dim, sideBg, 4.5);
    chk(G3, 'Title bar', barFg, sbBg, 4.5);
    chk(G3, 'Inactive window title', sbDim, sbBg, 4.5);
    chk(G3, 'Activity bar icons and active marker', barFg, sbBg, 4.5);
    chk(G3, 'Inactive activity bar icons', sbDim, sbBg, 3, 'Non-text, 3:1');
    chk(G3, 'Activity bar badge', sbBg, barFg, 4.5);
    chk(G3, 'Panel tabs', dim, bg, 4.5);
    chk(G3, 'Status bar', barFg, sbBg, 4.5);
    chk(G3, 'Status bar item on hover or press', barFg, [sbHover, sbActive], 4.5);
    chk(G3, 'Activity bar icon on hover', barFg, sbHover, 4.5);
    chk(G3, 'Status bar hover visible against bar', sbHover, sbBg, 1.15, 'Visibility, not WCAG');
    chk(G3, 'Hovered tab', fg, listHover, 7);
    chk(G4, 'Links', accent, [bg, sideBg, sel], 4.5);
    chk(G4, 'Focus ring', accent, [bg, sideBg, inputBg], 3, 'Non-text, 3:1');
    chk(G4, 'Button text', lightText, [btnBg, btnHover], 4.5);
    chk(G4, 'Badge text', lightText, btnBg, 4.5);
    chk(G4, 'Input text', fg, inputBg, 4.5);
    chk(G4, 'Input placeholder', dim, inputBg, 4.5);
    chk(G4, 'Input border', inputBorder, [bg, sideBg, inputBg], 3, 'Non-text, 3:1');
    chk(G4, 'Error text', errFg, [bg, sideBg, sel], 4.5);
    chk(G4, 'Warning squiggles', warnFg, [bg, sideBg, sel], 3, 'Non-text, 3:1');
    chk(G4, 'Info squiggles', infoFg, [bg, sideBg, sel], 3, 'Non-text, 3:1');
    const ansiAll = ansiOrder.map(n => ansi[n]).concat(ansiOrder.map(n => ansi['Bright' + n]));
    chk(G5, 'All 16 ANSI colors', ansiAll, termSurf, 4.5);
    checks.forEach(c => { c.area = CHECK_AREA[c.label] || (c.group === G2 ? 'editor' : 'all'); });

    /* color-vision-deficiency separation between syntax colors */
    const tokList = ROLES.map(r => tok[r]).concat([fg]);
    const tokNames = ROLES.map(r => ROLE_LABEL[r]).concat(['Plain text']);
    const cvd = Object.keys(CVD).map(k => {
      const s = separation(tokList, k);
      return { view: k, label: CVD[k].label, min: s.min, a: tokNames[s.pair[0]], b: tokNames[s.pair[1]] };
    });

    return {
      seed, color: col === null ? null : { kind: col.kind, hex: col.hex, neutral }, brightBar, dark, hue, colors, textMateRules, semanticRules, checks, cvd, tok, ansi,
      palette: { bg, sideBg, actBg, hl, sel, findCur, border, fg, dim, punct, accent, sbBg, sbFg: barFg, sbDim, sbHover, sbActive, btnBg, btnFg: lightText, btnHover, inputBg, inputBorder, errFg, warnFg, infoFg, listHover, listInactive, slider },
      baseTheme: dark ? 'Default Dark Modern' : 'Default Light Modern'
    };
  }

  /* settings.json snippet */
  /* Theme-specific blocks in VS Code settings are keyed by the theme's id: "[*Dark*]" matches any theme whose
     id contains "Dark" (case-sensitive), "[*Light*]" any with "Light". This covers Dark 2026, Dark Modern,
     Dark+, Solarized Dark and so on, and does not depend on the "Default " prefix older VS Code used. */
  const SCOPE_DARK = '[*Dark*]', SCOPE_LIGHT = '[*Light*]';
  function makeSnippet(t, opts) {
    // The frame (title bar, activity bar, status bar) is always included.
    // adapt: the frame stays the same in every theme; everything else gets a dark and a light version.
    opts = Object.assign({ explorer: true, editor: false, panel: false, everything: false, baseTheme: true, semantic: true, braces: false, adapt: false, url: '' }, opts || {});
    const o = {};
    const pick = (keys, from) => { const r = {}; keys.forEach(k => { r[k] = (from || t.colors)[k]; }); return r; };
    if (opts.adapt) {
      // Every FRAME_KEYS value is built from the accent fit alone, never from the dark flag, so both
      // versions share one frame. Take it from t and keep it out of the scoped blocks.
      const other = buildTheme(t.seed, t.dark ? 'light' : 'dark');
      const scoped = [[SCOPE_DARK, t.dark ? t : other], [SCOPE_LIGHT, t.dark ? other : t]];
      const frame = new Set(FRAME_KEYS);
      let keys;
      if (opts.everything) keys = Object.keys(t.colors).filter(k => !frame.has(k));
      else keys = (opts.explorer ? EXPLORER_KEYS : []).concat(opts.editor ? EDITOR_KEYS : []).concat(opts.panel ? PANEL_KEYS : []);
      keys = keys.filter((k, i) => keys.indexOf(k) === i);
      const c = pick(FRAME_KEYS);
      if (keys.length) scoped.forEach(sc => { c[sc[0]] = pick(keys, sc[1].colors); });
      o['workbench.colorCustomizations'] = c;
      if (opts.editor || opts.everything) {
        const tk = {}, sm = {};
        scoped.forEach(sc => {
          tk[sc[0]] = { textMateRules: sc[1].textMateRules };
          sm[sc[0]] = { rules: sc[1].semanticRules };
        });
        o['editor.tokenColorCustomizations'] = tk;
        if (opts.semantic) o['editor.semanticTokenColorCustomizations'] = sm;
      }
      // No base theme is set here: pinning one theme would defeat matching light and dark.
    } else if (opts.everything) {
      if (opts.baseTheme) o['workbench.colorTheme'] = t.baseTheme;
      o['workbench.colorCustomizations'] = t.colors;
      o['editor.tokenColorCustomizations'] = { textMateRules: t.textMateRules };
      if (opts.semantic) o['editor.semanticTokenColorCustomizations'] = { rules: t.semanticRules };
    } else {
      // Partial snippets leave the base theme alone, so they work over whatever theme is in use.
      const c = pick(FRAME_KEYS);
      if (opts.explorer) Object.assign(c, pick(EXPLORER_KEYS));
      if (opts.editor) Object.assign(c, pick(EDITOR_KEYS));
      if (opts.panel) Object.assign(c, pick(PANEL_KEYS));
      o['workbench.colorCustomizations'] = c;
      if (opts.editor) {
        o['editor.tokenColorCustomizations'] = { textMateRules: t.textMateRules };
        if (opts.semantic) o['editor.semanticTokenColorCustomizations'] = { rules: t.semanticRules };
      }
    }
    const json = JSON.stringify(o, null, 2);
    let body;
    if (opts.braces) body = json;
    else body = json.split('\n').slice(1, -1).map(l => l.slice(2)).join('\n') + ',';
    // One // comment line on top links back to the page with every option in its URL, so the setup can be reopened.
    // settings.json (and .code-workspace) accept comments. No url, no comment: the output is plain JSON as before.
    const url = String(opts.url || '').replace(/[\r\n\u2028\u2029]+/g, '');
    return url ? SNIPPET_COMMENT + url + '\n' + body : body;
  }

  /* hex as seen by a viewer with a given color-vision deficiency */
  function simulateHex(hex, view) {
    const m = CVD[view] && CVD[view].m;
    if (!m) return hex;
    const lin = hexToLin(hex);
    return '#' + m.map(r => Math.round(enc(clamp01(r[0] * lin[0] + r[1] * lin[1] + r[2] * lin[2])) * 255).toString(16).padStart(2, '0')).join('');
  }

  /* CSS custom properties for the page and the preview */
  function cssVars(t) {
    const p = t.palette, v = {};
    const map = { bg: '--bg', sideBg: '--side', actBg: '--act', hl: '--hl', sel: '--sel', findCur: '--find', border: '--border', fg: '--fg', dim: '--dim', punct: '--punct', accent: '--accent', sbBg: '--sb', sbFg: '--sbfg', sbDim: '--sbdim', sbHover: '--sbhover', sbActive: '--sbactive', btnBg: '--btn', btnFg: '--btnfg', btnHover: '--btnhover', inputBg: '--input', inputBorder: '--inputborder', errFg: '--err', warnFg: '--warn', infoFg: '--info', listHover: '--hover', listInactive: '--inactive', slider: '--slider' };
    Object.keys(map).forEach(k => { v[map[k]] = p[k]; });
    ROLES.forEach(r => { v['--tk-' + r] = t.tok[r]; });
    Object.keys(t.ansi).forEach(n => { v['--ansi-' + n.toLowerCase()] = t.ansi[n]; });
    return v;
  }

  return { hash32, parseColor, hexToOklch, CSS_COLORS, TAILWIND_COLORS, TAILWIND_SHADES, buildTheme, makeSnippet, contrast, oklchToHex, simulateHex, cssVars, CVD, ROLES, ROLE_LABEL, FRAME_KEYS, EXPLORER_KEYS, EDITOR_KEYS, PANEL_KEYS, SCOPE_DARK, SCOPE_LIGHT };
})();
/* UrlState: the page's inputs <-> a URL fragment.
   The artifact host only passes a plain #name through (ASCII letters, digits and hyphens),
   so there is no ?query or #key=value. The format is readable instead:
     #my-project                       seed only
     #my-project--dark--editor         seed plus options, separated by a double hyphen (no-adapt turns off light/dark matching)
     #--no-explorer--braces            default seed, with options
     #--s-<base32>                     a seed that can't be written plainly (capitals, spaces, unicode...)
   Only inputs that differ from their default are written. Outputs are never stored. */
const UrlState = (function () {
  'use strict';
  // adapt is on by default on the page; makeSnippet itself defaults to off, so older callers are unchanged.
  const DEFAULTS = { seed: 'food', mode: 'auto', vision: 'normal', explorer: true, editor: false, panel: false, every: false, adapt: true, base: true, sem: true, braces: false };
  const PLAIN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  const RESERVED = ['settings', 'sidebar', 'customize', 'upgrade', 'downloads']; // names claude.ai keeps for itself
  const A = 'abcdefghijklmnopqrstuvwxyz234567';

  function toB32(str) {
    const bytes = new TextEncoder().encode(str);
    let bits = 0, val = 0, out = '';
    for (let i = 0; i < bytes.length; i++) {
      val = (val << 8) | bytes[i]; bits += 8;
      while (bits >= 5) { out += A[(val >>> (bits - 5)) & 31]; bits -= 5; }
      val &= (1 << bits) - 1;
    }
    if (bits > 0) out += A[(val << (5 - bits)) & 31];
    return out;
  }
  function fromB32(s) {
    let bits = 0, val = 0;
    const bytes = [];
    for (let i = 0; i < s.length; i++) {
      const k = A.indexOf(s[i]);
      if (k < 0) throw new Error('bad base32');
      val = (val << 5) | k; bits += 5;
      if (bits >= 8) { bytes.push((val >>> (bits - 8)) & 255); bits -= 8; val &= (1 << bits) - 1; }
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
  }

  function encode(st) {
    const seed = String(st.seed == null ? '' : st.seed).trim();
    let plain = '';
    const extra = [];
    if (seed !== DEFAULTS.seed) {
      if (seed === '') extra.push('blank');
      else if (PLAIN.test(seed) && RESERVED.indexOf(seed) < 0 && seed.indexOf('comment-') !== 0) plain = seed;
      else extra.push('s-' + toB32(seed));
    }
    if (st.mode !== DEFAULTS.mode) extra.push(st.mode);
    if (st.vision !== DEFAULTS.vision) extra.push(st.vision);
    if (st.explorer !== DEFAULTS.explorer) extra.push('no-explorer');
    if (st.editor !== DEFAULTS.editor) extra.push('editor');
    if (st.panel !== DEFAULTS.panel) extra.push('panel');
    if (st.every !== DEFAULTS.every) extra.push('everything');
    if (st.adapt !== DEFAULTS.adapt) extra.push('no-adapt');
    if (st.base !== DEFAULTS.base) extra.push('no-base');
    if (st.sem !== DEFAULTS.sem) extra.push('no-semantic');
    if (st.braces !== DEFAULTS.braces) extra.push('braces');
    if (!plain && !extra.length) return '';
    return [plain].concat(extra).join('--');
  }

  function parse(hash) {
    const st = Object.assign({}, DEFAULTS);
    let h = String(hash || '').replace(/^#/, '');
    try { h = decodeURIComponent(h); } catch (e) { /* keep as typed */ }
    if (!h) return st;
    const secs = h.split('--');
    const first = secs.shift();
    if (first) st.seed = first;
    secs.forEach(function (t) {
      if (t === 'dark' || t === 'light') st.mode = t;
      else if (t === 'protan' || t === 'deutan' || t === 'tritan' || t === 'gray') st.vision = t;
      else if (t === 'no-explorer') st.explorer = false;
      else if (t === 'editor') st.editor = true;
      else if (t === 'panel') st.panel = true;
      else if (t === 'everything') st.every = true;
      else if (t === 'no-adapt') st.adapt = false;
      else if (t === 'no-base') st.base = false;
      else if (t === 'no-semantic') st.sem = false;
      else if (t === 'braces') st.braces = true;
      else if (t === 'blank') st.seed = '';
      else if (t.indexOf('s-') === 0) { try { st.seed = fromB32(t.slice(2)); } catch (e) { /* ignore a damaged seed */ } }
    });
    return st;
  }
  return { DEFAULTS, encode, parse };
})();
ThemeEngine.UrlState = UrlState;

if (typeof module !== 'undefined') module.exports = ThemeEngine;
