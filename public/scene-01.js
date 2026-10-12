import { SCENE_01_META, sceneState } from './scene-01-core.js';
import { renderSceneSvg } from './scene-01-svg.mjs';

const stage = document.getElementById('stage');

export const scene = {
  meta: SCENE_01_META,
  async mount() {
    await document.fonts?.ready;
  },
  seek(tLocalSeconds) {
    const state = sceneState(tLocalSeconds);
    stage.innerHTML = renderSceneSvg(state);
    document.documentElement.dataset.sceneTime = state.time.toFixed(6);
    return state;
  },
};

const params = new URLSearchParams(window.location.search);
const requestedTime = Number.parseFloat(params.get('t') ?? '0');
await scene.mount();
scene.seek(requestedTime);
window.__FOLD_MOTION_SCENE__ = scene;
window.__FOLD_MOTION_READY__ = true;
