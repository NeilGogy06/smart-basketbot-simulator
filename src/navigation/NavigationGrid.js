/**
 * NavigationGrid.js
 * 2D Occupancy Grid representation of the basketball court for autonomous path planning.
 * Handles:
 * - World coordinate (meters) to Grid coordinate (discrete cell) conversions
 * - Boundary constraints and cell traversability checks
 * - Static obstacle registration (hoops, backboards, court boundaries)
 * - Dynamic obstacle registration (basketball, defense dummies)
 * - Robot footprint inflation for collision margin safety.
 */

export class NavigationGrid {
  /**
   * @param {Object} options
   * @param {number} [options.minX=-15.0] Minimum world X boundary (meters)
   * @param {number} [options.maxX=15.0] Maximum world X boundary (meters)
   * @param {number} [options.minZ=-8.5] Minimum world Z boundary (meters)
   * @param {number} [options.maxZ=8.5] Maximum world Z boundary (meters)
   * @param {number} [options.resolution=0.25] Cell size in meters
   * @param {number} [options.robotRadius=0.42] Robot bounding radius for obstacle inflation (meters)
   */
  constructor(options = {}) {
    this.minX = options.minX ?? -15.0;
    this.maxX = options.maxX ?? 15.0;
    this.minZ = options.minZ ?? -8.5;
    this.maxZ = options.maxZ ?? 8.5;
    this.resolution = options.resolution ?? 0.25;
    this.robotRadius = options.robotRadius ?? 0.42;

    this.width = this.maxX - this.minX;
    this.depth = this.maxZ - this.minZ;

    this.cols = Math.ceil(this.width / this.resolution);
    this.rows = Math.ceil(this.depth / this.resolution);

    // 0 = Traversable, 1 = Static Obstacle, 2 = Dynamic Obstacle, 3 = Inflated Margin
    this.staticGrid = new Uint8Array(this.cols * this.rows);
    this.activeGrid = new Uint8Array(this.cols * this.rows);

    this.inflationCells = Math.ceil(this.robotRadius / this.resolution);
  }

  /**
   * Converts world coordinates (meters) to grid indices [col, row].
   * @param {number} worldX
   * @param {number} worldZ
   * @returns {{ col: number, row: number }}
   */
  worldToGrid(worldX, worldZ) {
    const col = Math.floor((worldX - this.minX) / this.resolution);
    const row = Math.floor((worldZ - this.minZ) / this.resolution);
    return { col, row };
  }

  /**
   * Converts grid indices [col, row] to cell center world coordinates (meters).
   * @param {number} col
   * @param {number} row
   * @returns {{ x: number, z: number }}
   */
  gridToWorld(col, row) {
    const x = this.minX + (col + 0.5) * this.resolution;
    const z = this.minZ + (row + 0.5) * this.resolution;
    return { x, z };
  }

  /**
   * Checks if grid cell lies within grid boundaries.
   */
  isInside(col, row) {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows;
  }

  /**
   * Returns true if cell is inside and completely traversable (not an obstacle or inflation).
   */
  isWalkable(col, row) {
    if (!this.isInside(col, row)) return false;
    return this.activeGrid[row * this.cols + col] === 0;
  }

  /**
   * Direct index into flat grid array.
   */
  getIndex(col, row) {
    return row * this.cols + col;
  }

  /**
   * Registers a static rectangular box obstacle (e.g. backboard, stanchion, walls).
   * @param {number} centerX World center X (meters)
   * @param {number} centerZ World center Z (meters)
   * @param {number} sizeX Width along X (meters)
   * @param {number} sizeZ Depth along Z (meters)
   * @param {boolean} [inflate=true] Whether to apply robot footprint inflation
   */
  addStaticBox(centerX, centerZ, sizeX, sizeZ, inflate = true) {
    this.applyBoxToGrid(this.staticGrid, centerX, centerZ, sizeX, sizeZ, 1, inflate);
    this.rebuildActiveGrid();
  }

  /**
   * Registers a static circular obstacle (e.g. hoop post).
   */
  addStaticCircle(centerX, centerZ, radius, inflate = true) {
    this.applyCircleToGrid(this.staticGrid, centerX, centerZ, radius, 1, inflate);
    this.rebuildActiveGrid();
  }

  /**
   * Registers a dynamic circular obstacle (e.g. basketball or moving defense player).
   */
  addDynamicCircle(centerX, centerZ, radius, inflate = true) {
    this.applyCircleToGrid(this.activeGrid, centerX, centerZ, radius, 2, inflate);
  }

  /**
   * Clears all dynamic obstacles, restoring the base static grid.
   */
  clearDynamicObstacles() {
    this.rebuildActiveGrid();
  }

  /**
   * Rebuilds the active grid by copying the static grid.
   */
  rebuildActiveGrid() {
    this.activeGrid.set(this.staticGrid);
  }

  /**
   * Internal helper to mark box cells and optional inflation margins.
   */
  applyBoxToGrid(targetGrid, centerX, centerZ, sizeX, sizeZ, markValue, inflate) {
    const halfX = sizeX / 2;
    const halfZ = sizeZ / 2;

    const min = this.worldToGrid(centerX - halfX, centerZ - halfZ);
    const max = this.worldToGrid(centerX + halfX, centerZ + halfZ);

    const margin = inflate ? this.inflationCells : 0;

    const startCol = Math.max(0, min.col - margin);
    const endCol = Math.min(this.cols - 1, max.col + margin);
    const startRow = Math.max(0, min.row - margin);
    const endRow = Math.min(this.rows - 1, max.row + margin);

    for (let r = startRow; r <= endRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        const isCore = c >= min.col && c <= max.col && r >= min.row && r <= max.row;
        const idx = r * this.cols + c;
        if (isCore) {
          targetGrid[idx] = markValue;
        } else if (targetGrid[idx] === 0) {
          targetGrid[idx] = 3; // Inflated margin
        }
      }
    }
  }

  /**
   * Internal helper to mark circular obstacle cells and optional inflation margins.
   */
  applyCircleToGrid(targetGrid, centerX, centerZ, radius, markValue, inflate) {
    const center = this.worldToGrid(centerX, centerZ);
    const effectiveRadius = inflate ? (radius + this.robotRadius) : radius;
    const rCells = Math.ceil(effectiveRadius / this.resolution);
    const coreCells = Math.ceil(radius / this.resolution);

    const startCol = Math.max(0, center.col - rCells);
    const endCol = Math.min(this.cols - 1, center.col + rCells);
    const startRow = Math.max(0, center.row - rCells);
    const endRow = Math.min(this.rows - 1, center.row + rCells);

    for (let r = startRow; r <= endRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        const dCol = c - center.col;
        const dRow = r - center.row;
        const distSq = (dCol * dCol + dRow * dRow);

        if (distSq <= coreCells * coreCells) {
          targetGrid[r * this.cols + c] = markValue;
        } else if (distSq <= rCells * rCells) {
          const idx = r * this.cols + c;
          if (targetGrid[idx] === 0) {
            targetGrid[idx] = 3; // Inflated margin
          }
        }
      }
    }
  }

  /**
   * Resets entire grid to all traversable.
   */
  reset() {
    this.staticGrid.fill(0);
    this.activeGrid.fill(0);
  }
}
