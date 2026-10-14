/**
 * Manages a multi-shot sequence for FOLD Motion productions.
 */
export class Timeline {
  constructor(options = {}) {
    this.id = options.id || `timeline-${Date.now()}`;
    this.fps = options.fps || 24;
    this.width = options.width || 1280;
    this.height = options.height || 720;
    this.shots = [];
  }

  /**
   * Adds a scene/shot to the timeline sequence.
   * @param {Object} shotSpec Validated scene specification
   */
  addShot(shotSpec) {
    if (!shotSpec || !shotSpec.id) {
      throw new Error('Invalid shot specification provided to timeline.');
    }

    const shotIndex = this.shots.length;
    const durationFrames = Math.round((shotSpec.durationInSeconds || 4) * this.fps);
    const startFrame = this.shots.reduce((acc, shot) => acc + shot.durationFrames, 0);
    const endFrame = startFrame + durationFrames - 1;

    this.shots.push({
      index: shotIndex,
      spec: shotSpec,
      durationFrames,
      startFrame,
      endFrame,
    });

    return this;
  }

  /**
   * Computes total duration and timeline metadata.
   */
  getSummary() {
    const totalFrames = this.shots.reduce((acc, shot) => acc + shot.durationFrames, 0);
    const totalDurationSeconds = totalFrames / this.fps;

    return {
      id: this.id,
      fps: this.fps,
      width: this.width,
      height: this.height,
      totalShots: this.shots.length,
      totalFrames,
      totalDurationSeconds,
      shots: this.shots,
    };
  }
}
