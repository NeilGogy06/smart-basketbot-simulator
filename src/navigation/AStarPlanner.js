/**
 * AStarPlanner.js
 * High-performance A* pathfinding algorithm for 2D grid navigation with:
 * - 8-connected diagonal movements with corner-cutting prevention
 * - Admissible Euclidean heuristic
 * - Binary Min-Heap priority queue for sub-millisecond graph search
 * - Raycasting string-pulling path smoothing to eliminate zig-zag artifacts
 * - Direct world-coordinate waypoint generation.
 */

class MinHeap {
  constructor(compare) {
    this.data = [];
    this.compare = compare;
  }

  push(val) {
    this.data.push(val);
    this.bubbleUp(this.data.length - 1);
  }

  pop() {
    if (this.data.length === 0) return null;
    const top = this.data[0];
    const bottom = this.data.pop();
    if (this.data.length > 0) {
      this.data[0] = bottom;
      this.sinkDown(0);
    }
    return top;
  }

  size() {
    return this.data.length;
  }

  bubbleUp(index) {
    const item = this.data[index];
    while (index > 0) {
      const parentIdx = (index - 1) >> 1;
      const parent = this.data[parentIdx];
      if (this.compare(item, parent) < 0) {
        this.data[index] = parent;
        index = parentIdx;
      } else {
        break;
      }
    }
    this.data[index] = item;
  }

  sinkDown(index) {
    const len = this.data.length;
    const item = this.data[index];
    while (true) {
      const leftIdx = (index << 1) + 1;
      const rightIdx = leftIdx + 1;
      let swapIdx = -1;

      if (leftIdx < len) {
        if (this.compare(this.data[leftIdx], item) < 0) {
          swapIdx = leftIdx;
        }
      }

      if (rightIdx < len) {
        const compareTarget = swapIdx === -1 ? item : this.data[leftIdx];
        if (this.compare(this.data[rightIdx], compareTarget) < 0) {
          swapIdx = rightIdx;
        }
      }

      if (swapIdx === -1) break;

      this.data[index] = this.data[swapIdx];
      index = swapIdx;
    }
    this.data[index] = item;
  }
}

export class AStarPlanner {
  /**
   * @param {import('./NavigationGrid.js').NavigationGrid} grid
   */
  constructor(grid) {
    this.grid = grid;
  }

  /**
   * Plans an optimal smoothed path from start world position to target world position.
   * @param {{ x: number, z: number }} startWorld
   * @param {{ x: number, z: number }} targetWorld
   * @returns {{
   *   success: boolean,
   *   waypoints: Array<{ x: number, z: number }>,
   *   rawGridPath: Array<{ col: number, row: number }>,
   *   message?: string
   * }}
   */
  planPath(startWorld, targetWorld) {
    const startGrid = this.grid.worldToGrid(startWorld.x, startWorld.z);
    const targetGrid = this.grid.worldToGrid(targetWorld.x, targetWorld.z);

    if (!this.grid.isInside(startGrid.col, startGrid.row)) {
      return { success: false, waypoints: [], rawGridPath: [], message: 'Start position outside court bounds' };
    }

    if (!this.grid.isInside(targetGrid.col, targetGrid.row)) {
      return { success: false, waypoints: [], rawGridPath: [], message: 'Target position outside court bounds' };
    }

    if (!this.grid.isWalkable(targetGrid.col, targetGrid.row)) {
      return { success: false, waypoints: [], rawGridPath: [], message: 'Target position is obstructed or unreachable' };
    }

    // If start and target are in the same cell, trivial path
    if (startGrid.col === targetGrid.col && startGrid.row === targetGrid.row) {
      return {
        success: true,
        waypoints: [{ x: targetWorld.x, z: targetWorld.z }],
        rawGridPath: [startGrid]
      };
    }

    const cols = this.grid.cols;
    const totalCells = cols * this.grid.rows;

    const gScore = new Float32Array(totalCells).fill(Infinity);
    const fScore = new Float32Array(totalCells).fill(Infinity);
    const cameFrom = new Int32Array(totalCells).fill(-1);
    const closed = new Uint8Array(totalCells);

    const startIndex = startGrid.row * cols + startGrid.col;
    const targetIndex = targetGrid.row * cols + targetGrid.col;

    const heuristic = (c, r) => {
      const dc = c - targetGrid.col;
      const dr = r - targetGrid.row;
      return Math.hypot(dc, dr);
    };

    gScore[startIndex] = 0;
    fScore[startIndex] = heuristic(startGrid.col, startGrid.row);

    const openHeap = new MinHeap((idxA, idxB) => fScore[idxA] - fScore[idxB]);
    openHeap.push(startIndex);

    // 8-connected neighbor offsets: [dCol, dRow, cost]
    const SQRT2 = Math.SQRT2;
    const neighbors = [
      [1, 0, 1.0],
      [-1, 0, 1.0],
      [0, 1, 1.0],
      [0, -1, 1.0],
      [1, 1, SQRT2],
      [-1, 1, SQRT2],
      [1, -1, SQRT2],
      [-1, -1, SQRT2]
    ];

    let foundTarget = false;

    while (openHeap.size() > 0) {
      const currentIdx = openHeap.pop();

      if (currentIdx === targetIndex) {
        foundTarget = true;
        break;
      }

      if (closed[currentIdx]) continue;
      closed[currentIdx] = 1;

      const currentCol = currentIdx % cols;
      const currentRow = Math.floor(currentIdx / cols);
      const currentG = gScore[currentIdx];

      for (let i = 0; i < neighbors.length; i++) {
        const [dc, dr, stepCost] = neighbors[i];
        const nCol = currentCol + dc;
        const nRow = currentRow + dr;

        if (!this.grid.isWalkable(nCol, nRow)) continue;

        // Prevent corner-cutting around obstacles on diagonal steps
        if (dc !== 0 && dr !== 0) {
          if (!this.grid.isWalkable(currentCol + dc, currentRow) || !this.grid.isWalkable(currentCol, currentRow + dr)) {
            continue;
          }
        }

        const nIdx = nRow * cols + nCol;
        if (closed[nIdx]) continue;

        const tentativeG = currentG + stepCost;

        if (tentativeG < gScore[nIdx]) {
          cameFrom[nIdx] = currentIdx;
          gScore[nIdx] = tentativeG;
          fScore[nIdx] = tentativeG + heuristic(nCol, nRow);
          openHeap.push(nIdx);
        }
      }
    }

    if (!foundTarget) {
      return { success: false, waypoints: [], rawGridPath: [], message: 'No traversable path to target exists' };
    }

    // Reconstruct raw grid path from target back to start
    const rawGridPath = [];
    let curr = targetIndex;
    while (curr !== -1) {
      const c = curr % cols;
      const r = Math.floor(curr / cols);
      rawGridPath.push({ col: c, row: r });
      curr = cameFrom[curr];
    }
    rawGridPath.reverse();

    // Smooth path using raycast line-of-sight string-pulling
    const smoothedWaypoints = this.smoothPath(rawGridPath, startWorld, targetWorld);

    return {
      success: true,
      waypoints: smoothedWaypoints,
      rawGridPath
    };
  }

  /**
   * Smooths grid paths using line-of-sight raycasting.
   * Connects waypoints with direct straight lines where no obstacles intervene.
   */
  smoothPath(rawGridPath, startWorld, targetWorld) {
    if (rawGridPath.length <= 2) {
      return [
        { x: startWorld.x, z: startWorld.z },
        { x: targetWorld.x, z: targetWorld.z }
      ];
    }

    const waypoints = [{ x: startWorld.x, z: startWorld.z }];
    let currentIdx = 0;

    while (currentIdx < rawGridPath.length - 1) {
      // Look as far ahead as possible
      let furthestIdx = currentIdx + 1;

      for (let testIdx = rawGridPath.length - 1; testIdx > currentIdx + 1; testIdx--) {
        const from = rawGridPath[currentIdx];
        const to = rawGridPath[testIdx];

        if (this.hasLineOfSight(from.col, from.row, to.col, to.row)) {
          furthestIdx = testIdx;
          break;
        }
      }

      const gridPt = rawGridPath[furthestIdx];
      const worldPt = this.grid.gridToWorld(gridPt.col, gridPt.row);

      // If at end, use exact target coordinates
      if (furthestIdx === rawGridPath.length - 1) {
        waypoints.push({ x: targetWorld.x, z: targetWorld.z });
      } else {
        waypoints.push(worldPt);
      }

      currentIdx = furthestIdx;
    }

    return waypoints;
  }

  /**
   * Bresenham raycast line-of-sight check between two grid cells.
   * Returns true if all cells along the ray are walkable.
   */
  hasLineOfSight(col0, row0, col1, row1) {
    let dx = Math.abs(col1 - col0);
    let dy = Math.abs(row1 - row0);
    let x = col0;
    let y = row0;
    let n = 1 + dx + dy;
    const xInc = col1 > col0 ? 1 : -1;
    const yInc = row1 > row0 ? 1 : -1;
    let error = dx - dy;

    dx *= 2;
    dy *= 2;

    for (; n > 0; --n) {
      if (!this.grid.isWalkable(x, y)) {
        return false;
      }

      if (error > 0) {
        x += xInc;
        error -= dy;
      } else if (error < 0) {
        y += yInc;
        error += dx;
      } else {
        // Diagonal step: check adjacent cells for corner clipping
        if (!this.grid.isWalkable(x + xInc, y) || !this.grid.isWalkable(x, y + yInc)) {
          return false;
        }
        x += xInc;
        y += yInc;
        error += dx - dy;
        --n;
      }
    }

    return true;
  }
}
