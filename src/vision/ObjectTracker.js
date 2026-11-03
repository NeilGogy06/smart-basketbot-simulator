/**
 * ObjectTracker.js
 * Temporal multi-object tracking system for detected basketballs.
 * Manages:
 * - Deterministic, stable object IDs across frames
 * - Spatial data association (nearest-neighbor gating in 3D world space)
 * - Track lifecycle states: 'TRACKED', 'LOST'
 * - Temporal velocity estimation and position smoothing
 * - Graceful handling of temporary occlusion or FOV departure with configurable timeout
 * - Cleanup and track retirement.
 */

export class ObjectTracker {
  /**
   * @param {Object} [options]
   * @param {number} [options.matchDistanceThreshold=0.85] Max 3D distance to associate detection with track (meters)
   * @param {number} [options.lostTimeout=1.5] Time in seconds before a lost track is purged
   * @param {number} [options.smoothingAlpha=0.65] Alpha smoothing factor for position filtering (0..1)
   */
  constructor(options = {}) {
    this.matchDistanceThreshold = options.matchDistanceThreshold ?? 0.85;
    this.lostTimeout = options.lostTimeout ?? 1.5; // seconds
    this.smoothingAlpha = options.smoothingAlpha ?? 0.65;

    // Active tracks map: trackId -> Track
    this.tracks = new Map();

    // Monotonic deterministic ID generator
    this.nextTrackId = 1;
  }

  /**
   * Updates tracks with fresh detections from the current frame.
   * @param {Array<Object>} detections List of fresh detections from BallDetection
   * @param {number} dt Frame time delta in seconds
   * @returns {Array<Object>} List of currently active tracks
   */
  update(detections = [], dt = 0.016) {
    const matchedTrackIds = new Set();
    const unmatchedDetections = [];

    // 1. Data Association: Match each detection to existing track using nearest 3D Euclidean distance
    for (let i = 0; i < detections.length; i++) {
      const det = detections[i];
      let bestTrackId = null;
      let minDistance = Infinity;

      for (const [trackId, track] of this.tracks) {
        if (matchedTrackIds.has(trackId)) continue;

        const dx = det.worldPosition.x - track.worldPosition.x;
        const dy = det.worldPosition.y - track.worldPosition.y;
        const dz = det.worldPosition.z - track.worldPosition.z;
        const dist = Math.hypot(dx, dy, dz);

        if (dist < minDistance && dist <= this.matchDistanceThreshold) {
          minDistance = dist;
          bestTrackId = trackId;
        }
      }

      if (bestTrackId !== null) {
        matchedTrackIds.add(bestTrackId);
        this.updateTrack(bestTrackId, det, dt);
      } else {
        unmatchedDetections.push(det);
      }
    }

    // 2. Initiate new tracks for unmatched detections
    for (let i = 0; i < unmatchedDetections.length; i++) {
      const newTrack = this.createTrack(unmatchedDetections[i]);
      matchedTrackIds.add(newTrack.id);
    }

    // 3. Update unmatched tracks (mark as LOST or purge after timeout)
    const tracksToPurge = [];
    const currentTime = Date.now();

    for (const [trackId, track] of this.tracks) {
      if (!matchedTrackIds.has(trackId)) {
        track.timeSinceLastSeen += dt;
        track.state = 'LOST';
        track.status = 'LOST';
        track.isVisible = false;

        // Apply dead reckoning coasting if velocity is known
        if (track.velocity) {
          track.worldPosition.x += track.velocity.x * dt;
          track.worldPosition.y += track.velocity.y * dt;
          track.worldPosition.z += track.velocity.z * dt;
        }

        if (track.timeSinceLastSeen >= this.lostTimeout) {
          tracksToPurge.push(trackId);
        }
      }
    }

    // Purge expired tracks
    for (let i = 0; i < tracksToPurge.length; i++) {
      this.tracks.delete(tracksToPurge[i]);
    }

    // Return array of active tracks
    return this.getActiveTracks();
  }

  /**
   * Updates an existing track with new detection data.
   */
  updateTrack(trackId, detection, dt) {
    const track = this.tracks.get(trackId);
    if (!track) return;

    // Calculate instantaneous velocity vector
    const dtSafe = Math.max(0.001, dt);
    const vx = (detection.worldPosition.x - track.worldPosition.x) / dtSafe;
    const vy = (detection.worldPosition.y - track.worldPosition.y) / dtSafe;
    const vz = (detection.worldPosition.z - track.worldPosition.z) / dtSafe;

    // Velocity smoothing
    track.velocity = {
      x: track.velocity.x * (1 - this.smoothingAlpha) + vx * this.smoothingAlpha,
      y: track.velocity.y * (1 - this.smoothingAlpha) + vy * this.smoothingAlpha,
      z: track.velocity.z * (1 - this.smoothingAlpha) + vz * this.smoothingAlpha
    };

    // Position smoothing
    track.worldPosition = {
      x: track.worldPosition.x * (1 - this.smoothingAlpha) + detection.worldPosition.x * this.smoothingAlpha,
      y: track.worldPosition.y * (1 - this.smoothingAlpha) + detection.worldPosition.y * this.smoothingAlpha,
      z: track.worldPosition.z * (1 - this.smoothingAlpha) + detection.worldPosition.z * this.smoothingAlpha
    };

    track.relativePosition = { ...detection.relativePosition };
    track.distance = detection.distance;
    track.azimuthDeg = detection.azimuthDeg;
    track.elevationDeg = detection.elevationDeg;
    track.screenPosition = { ...detection.screenPosition };
    track.screen = { ...detection.screenPosition };
    track.boundingBox = { ...detection.boundingBox };
    track.screenBoundingBox = { ...detection.boundingBox };
    track.confidence = detection.confidence;

    track.state = 'TRACKED';
    track.status = 'TRACKED';
    track.isVisible = true;
    track.timeSinceLastSeen = 0.0;
    track.totalObservations++;
    track.lastSeenTimestamp = Date.now();
  }

  /**
   * Spawns a new track for a newly discovered object.
   */
  createTrack(detection) {
    const idNum = this.nextTrackId++;
    const trackId = `BALL_${idNum}`;

    const newTrack = {
      id: trackId,
      idNum: idNum,
      type: 'BASKETBALL',
      state: 'TRACKED',
      status: 'TRACKED',
      isVisible: true,
      worldPosition: { ...detection.worldPosition },
      relativePosition: { ...detection.relativePosition },
      distance: detection.distance,
      azimuthDeg: detection.azimuthDeg,
      elevationDeg: detection.elevationDeg,
      screenPosition: { ...detection.screenPosition },
      screen: { ...detection.screenPosition },
      boundingBox: { ...detection.boundingBox },
      screenBoundingBox: { ...detection.boundingBox },
      confidence: detection.confidence,
      velocity: { x: 0, y: 0, z: 0 },
      firstSeenTimestamp: Date.now(),
      lastSeenTimestamp: Date.now(),
      timeSinceLastSeen: 0.0,
      totalObservations: 1
    };

    this.tracks.set(trackId, newTrack);
    return newTrack;
  }

  /**
   * Returns array of all current tracks sorted by distance (nearest first).
   * @param {boolean} [visibleOnly=false]
   * @returns {Array<Object>}
   */
  getActiveTracks(visibleOnly = false) {
    const result = [];
    for (const [_, track] of this.tracks) {
      if (!visibleOnly || track.isVisible) {
        result.push({ ...track });
      }
    }
    result.sort((a, b) => a.distance - b.distance);
    return result;
  }

  /**
   * Alias for getActiveTracks(visibleOnly).
   * @param {boolean} [visibleOnly=false]
   * @returns {Array<Object>}
   */
  getTrackedObjects(visibleOnly = false) {
    return this.getActiveTracks(visibleOnly);
  }

  /**
   * Returns the primary selected track (nearest visible basketball).
   * @returns {Object|null}
   */
  getSelectedTrack() {
    const visible = this.getActiveTracks(true);
    return visible.length > 0 ? visible[0] : null;
  }

  /**
   * Resets all tracking history and resets ID sequence to 1.
   */
  reset() {
    this.tracks.clear();
    this.nextTrackId = 1;
  }

  /**
   * Telemetry summary of tracking subsystem.
   */
  getTelemetry() {
    let visibleCount = 0;
    let lostCount = 0;

    for (const [_, track] of this.tracks) {
      if (track.isVisible) visibleCount++;
      else lostCount++;
    }

    const selected = this.getSelectedTrack();

    return {
      totalTracks: this.tracks.size,
      visibleTracks: visibleCount,
      lostTracks: lostCount,
      selectedId: selected ? selected.id : null,
      selectedDistance: selected ? selected.distance : null,
      selectedBearingDeg: selected ? selected.azimuthDeg : null,
      tracks: this.getActiveTracks()
    };
  }
}
