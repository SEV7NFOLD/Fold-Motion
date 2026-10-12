import { SCENE_01_META } from './scene-01-core.js';

function number(value) {
  return Number(value).toFixed(6);
}

function interpolate(start, end, progress) {
  return start + (end - start) * progress;
}

export function renderSceneSvg(state) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SCENE_01_META.width}" height="${SCENE_01_META.height}" viewBox="0 0 ${SCENE_01_META.width} ${SCENE_01_META.height}" role="img" aria-label="SIGNAL 001 precision in motion">
  <defs>
    <pattern id="micro-grid" width="56" height="56" patternUnits="userSpaceOnUse">
      <path d="M56 0H0V56" fill="none" stroke="#70808e" stroke-opacity="0.38" stroke-width="1" />
    </pattern>
  </defs>

  <rect width="1280" height="720" fill="#0a0d12" />
  <rect x="0" y="0" width="1280" height="122" fill="#0d1118" />
  <rect x="0" y="574" width="1280" height="146" fill="#0c1016" />
  <rect x="56" y="48" width="1168" height="624" fill="url(#micro-grid)" opacity="${number(state.gridOpacity)}" />
  <path d="M56 122H1224 M56 574H1224 M88 48V672 M1192 48V672" fill="none" stroke="#70808e" stroke-opacity="${number(0.32 * state.structureOpacity)}" stroke-width="1" />

  <g opacity="${number(state.structureOpacity)}">
    <path d="M88 94H312 M88 94V118 M312 94V118" fill="none" stroke="#f3f7fa" stroke-width="2" />
    <text x="88" y="76" fill="#a6b1bc" font-family="Segoe UI, Arial, sans-serif" font-size="13" font-weight="700" letter-spacing="3">SEV7N FOLD / MOTION SYSTEM</text>
    <text x="1078" y="76" fill="#a6b1bc" font-family="Segoe UI, Arial, sans-serif" font-size="13" font-weight="700" letter-spacing="3">FRAME 001</text>
    <path d="M88 604H312 M968 604H1192" fill="none" stroke="#70808e" stroke-width="2" />
  </g>

  <g opacity="${number(state.structureOpacity)}">
    <path d="M${number(state.upperFragmentX)} 188H1126V214H${number(state.upperFragmentX + 68)}" fill="none" stroke="#24d8ff" stroke-width="3" />
    <path d="M${number(state.lowerFragmentX)} 500H790V474H${number(state.lowerFragmentX + 68)}" fill="none" stroke="#8593a0" stroke-width="3" />
    <path d="M580 246H${number(interpolate(700, 846, state.convergence))} M580 474H${number(interpolate(676, 846, state.convergence))}" fill="none" stroke="#586572" stroke-width="2" />
    <circle cx="${number(interpolate(728, 846, state.convergence))}" cy="246" r="6" fill="#24d8ff" />
    <circle cx="${number(interpolate(700, 846, state.convergence))}" cy="474" r="6" fill="#f3f7fa" />
  </g>

  <g opacity="${number(state.titleOpacity)}" transform="translate(0 ${number(state.titleY)})">
    <text x="88" y="294" fill="#f3f7fa" font-family="Segoe UI, Arial, sans-serif" font-size="142" font-weight="700" letter-spacing="-8">SIGNAL</text>
    <text x="95" y="352" fill="#24d8ff" font-family="Segoe UI, Arial, sans-serif" font-size="30" font-weight="700" letter-spacing="5">/ 001</text>
    <path d="M94 388H612" fill="none" stroke="#24d8ff" stroke-width="4" transform="scale(${number(state.titleRuleScale)} 1)" />
    <text x="94" y="430" fill="#c5ced6" font-family="Segoe UI, Arial, sans-serif" font-size="22" font-weight="600" letter-spacing="3">PRECISION IN MOTION</text>
  </g>

  <g opacity="${number(state.markOpacity)}" transform="translate(986 360) scale(${number(state.markScale)}) translate(-986 -360)">
    <rect x="846" y="220" width="280" height="280" fill="#0e141c" stroke="#8593a0" stroke-width="2" />
    <path d="M846 276H902V220 M1126 444H1070V500 M846 444H902V500 M1126 276H1070V220" fill="none" stroke="#f3f7fa" stroke-width="4" />
    <path d="M986 248V472 M874 360H1098" fill="none" stroke="#586572" stroke-width="1" />
    <rect x="930" y="304" width="112" height="112" fill="none" stroke="#24d8ff" stroke-width="5" />
    <path d="M952 360H1020 M986 326V394" fill="none" stroke="#f3f7fa" stroke-width="5" />
    <circle cx="986" cy="360" r="10" fill="#24d8ff" />
    <path d="M888 454H${number(888 + state.signalWidth)}" fill="none" stroke="#24d8ff" stroke-width="8" />
  </g>

  <g opacity="${number(state.detailOpacity)}">
    <text x="88" y="638" fill="#a6b1bc" font-family="Segoe UI, Arial, sans-serif" font-size="14" font-weight="700" letter-spacing="3">01 / SIGNAL INTEGRITY</text>
    <text x="88" y="660" fill="#71808d" font-family="Segoe UI, Arial, sans-serif" font-size="12" font-weight="600" letter-spacing="2">ARCHITECTURE · VELOCITY · CLARITY</text>
    <text x="1052" y="638" fill="#f3f7fa" font-family="Segoe UI, Arial, sans-serif" font-size="14" font-weight="700" letter-spacing="3">00:04.00</text>
    <text x="1040" y="660" fill="#71808d" font-family="Segoe UI, Arial, sans-serif" font-size="12" font-weight="600" letter-spacing="2">SYSTEM READY</text>
  </g>
</svg>`;
}
