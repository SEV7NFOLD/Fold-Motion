import fs from 'node:fs';
import path from 'node:path';

/**
 * Manages audio tracks and timing cues for FOLD Motion productions.
 */
export class AudioTrackManager {
  constructor(options = {}) {
    this.fps = options.fps ?? 24;
    if (!Number.isFinite(this.fps) || this.fps <= 0) {
      throw new Error('Audio track frame rate must be a positive number.');
    }
    this.tracks = [];
  }

  /**
   * Adds an audio track to the production timeline.
   * @param {Object} trackConfig Configuration for the audio track
   * @returns {Object} Added track reference
   */
  addTrack(trackConfig) {
    if (
      !trackConfig
      || typeof trackConfig.id !== 'string'
      || !trackConfig.id.trim()
      || typeof trackConfig.filePath !== 'string'
      || !trackConfig.filePath.trim()
    ) {
      throw new Error('Audio track must have a valid "id" and "filePath".');
    }

    const resolvedPath = path.resolve(trackConfig.filePath);
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
      throw new Error(`Audio file not found: ${resolvedPath}`);
    }

    const startFrame = trackConfig.startFrame ?? 0;
    if (!Number.isInteger(startFrame) || startFrame < 0) {
      throw new Error('Audio track "startFrame" must be a non-negative integer.');
    }

    const volume = trackConfig.volume ?? 1;
    if (!Number.isFinite(volume) || volume < 0) {
      throw new Error('Audio track "volume" must be a non-negative number.');
    }

    const cues = trackConfig.cues ?? [];
    if (!Array.isArray(cues)) {
      throw new Error('Audio track "cues" must be an array.');
    }

    const startTimeSeconds = startFrame / this.fps;
    const track = {
      id: trackConfig.id,
      filePath: resolvedPath,
      startFrame,
      startTimeSeconds,
      volume,
      cues,
    };

    this.tracks.push(track);
    return track;
  }

  /**
   * Generates FFmpeg input and filter arguments for muxing all audio tracks.
   * @returns {Object} { inputs: string[], filterComplex: string }
   */
  buildFFmpegAudioArgs() {
    if (this.tracks.length === 0) {
      return { inputs: [], filterComplex: '' };
    }

    const inputs = [];
    const filterParts = [];

    this.tracks.forEach((track, index) => {
      inputs.push('-i', track.filePath);

      const delayMs = Math.round(track.startTimeSeconds * 1000);
      filterParts.push(
        `[${index}:a]adelay=${delayMs}|${delayMs},volume=${track.volume}[a${index}]`,
      );
    });

    let filterComplex = filterParts.join(';');
    if (this.tracks.length > 1) {
      const mixInputs = this.tracks.map((_, index) => `[a${index}]`).join('');
      filterComplex += `;${mixInputs}amix=inputs=${this.tracks.length}:duration=longest[outa]`;
    }

    return {
      inputs,
      filterComplex: this.tracks.length > 1 ? filterComplex : filterParts[0],
    };
  }
}
