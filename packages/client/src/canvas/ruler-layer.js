import { Container, Graphics, Text } from "pixi.js";

/**
 * PF2e distance ruler with Foundry-style waypoints.
 *
 * Hold LMB to measure, then click RMB to drop an intermediate waypoint. The
 * ruler walks a broken path (Bresenham through every waypoint, not a straight
 * line from start to end) and sums the PF2e 5-10-5 distance of each segment.
 * The path lives in world space; stroke width and label scale compensate for
 * camera zoom.
 */
export class RulerLayer extends Container {
  constructor(app, viewport, grid) {
    super();
    this.label = "ruler";
    this.app = app;
    this.viewport = viewport;
    this.grid = grid;
    this.visible = false;
    this.dragging = false;
    this.startCell = null;
    this.endCell = null;
    this.startPoint = null;
    this.endPoint = null;
    /** @type {Array<{cell:{col:number,row:number}, point:{x:number,y:number}}>} */
    this.waypoints = [];

    this.graphics = new Graphics();
    this.labelText = new Text({
      text: "",
      style: {
        fill: 0xffffff,
        fontSize: 16,
        fontWeight: "600",
        fontFamily: "system-ui, sans-serif",
        stroke: { color: 0x10141c, width: 4 },
      },
    });
    this.labelText.anchor.set(0.5);
    this.labelText.visible = false;

    this.addChild(this.graphics, this.labelText);
  }

  get _zoom() {
    return this.viewport && this.viewport.zoom ? this.viewport.zoom : 1;
  }

  begin(worldPoint) {
    this.dragging = true;
    this.visible = true;
    this.startCell = this.grid.cellFromWorld(worldPoint);
    this.endCell = this.startCell;
    this.startPoint = this.grid.cellCenter(this.startCell);
    this.endPoint = this.startPoint;
    this.waypoints = [];
    this._render();
  }

  /**
   * Drop an intermediate waypoint (RMB while the LMB measurement is held).
   * Returns true when a new point was added.
   */
  addWaypoint(worldPoint) {
    if (!this.dragging) {
      return false;
    }
    const cell = this.grid.cellFromWorld(worldPoint);
    const point = this.grid.cellCenter(cell);
    const previous = this.waypoints.length
      ? this.waypoints[this.waypoints.length - 1].point
      : this.startPoint;
    if (
      previous &&
      Math.abs(point.x - previous.x) < 1e-6 &&
      Math.abs(point.y - previous.y) < 1e-6
    ) {
      return false;
    }
    this.waypoints.push({ cell, point });
    this.endCell = cell;
    this.endPoint = point;
    this._render();
    return true;
  }

  update(worldPoint) {
    if (!this.dragging) {
      return;
    }
    this.endCell = this.grid.cellFromWorld(worldPoint);
    this.endPoint = this.grid.cellCenter(this.endCell);
    this._render();
  }

  end(worldPoint) {
    if (!this.dragging) {
      return;
    }
    if (worldPoint) {
      this.endCell = this.grid.cellFromWorld(worldPoint);
      this.endPoint = this.grid.cellCenter(this.endCell);
    }
    this.dragging = false;
    this._render();
  }

  cancel() {
    this.dragging = false;
    this.visible = false;
    this.startCell = null;
    this.endCell = null;
    this.startPoint = null;
    this.endPoint = null;
    this.waypoints = [];
    this.graphics.clear();
    this.labelText.text = "";
    this.labelText.visible = false;
  }

  /**
   * Anchors of the measured path: start, every waypoint, then the live end.
   * Consecutive duplicate cells are collapsed before the walk.
   */
  _anchors() {
    const anchors = [];
    if (this.startCell) {
      anchors.push(this.startCell);
    }
    for (const waypoint of this.waypoints) {
      const last = anchors[anchors.length - 1];
      if (
        last &&
        last.col === waypoint.cell.col &&
        last.row === waypoint.cell.row
      ) {
        continue;
      }
      anchors.push(waypoint.cell);
    }
    if (this.endCell) {
      const last = anchors[anchors.length - 1];
      if (
        !last ||
        last.col !== this.endCell.col ||
        last.row !== this.endCell.row
      ) {
        anchors.push(this.endCell);
      }
    }
    return anchors;
  }

  /** Walk every segment, collecting the crossed cell centers and the 5-10-5 total. */
  _buildPath() {
    const anchors = this._anchors();
    const points = [];
    let cells = 0;

    for (let index = 0; index < anchors.length - 1; index += 1) {
      const from = anchors[index];
      const to = anchors[index + 1];
      cells += this.grid.measureCells(from, to).cells;
      for (const cell of this.grid.cellsBetween(from, to)) {
        const point = this.grid.cellCenter(cell);
        const last = points[points.length - 1];
        if (
          !last ||
          Math.abs(last.x - point.x) > 1e-6 ||
          Math.abs(last.y - point.y) > 1e-6
        ) {
          points.push(point);
        }
      }
    }

    if (points.length === 0 && anchors.length > 0) {
      points.push(this.grid.cellCenter(anchors[0]));
    }

    const feetPerCell = this.grid.feetPerCell || 5;
    return { points, cells, feet: cells * feetPerCell };
  }

  _render() {
    const g = this.graphics;
    g.clear();

    if (!this.startPoint || !this.endPoint || !this.startCell || !this.endCell) {
      this.labelText.visible = false;
      return;
    }

    const zoom = this._zoom;
    const width = Math.max(1, 2 / zoom);
    const handleRadius = Math.max(2, 5 / zoom);
    const path = this._buildPath();
    const points = path.points;

    if (points.length > 0) {
      g.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index += 1) {
        g.lineTo(points[index].x, points[index].y);
      }
      g.stroke({ color: 0xff6400, width, alpha: 0.95 });

      for (const point of points) {
        g.circle(point.x, point.y, Math.max(1, width * 0.9)).fill({
          color: 0xff9a4d,
          alpha: 0.85,
        });
      }
    }

    // Intermediate waypoints get their own marker so the broken path is
    // readable, Foundry-style.
    for (const waypoint of this.waypoints) {
      g.circle(waypoint.point.x, waypoint.point.y, handleRadius * 0.9)
        .fill({ color: 0xffd166, alpha: 1 })
        .stroke({
          color: 0x10141c,
          width: Math.max(1, 1.5 / zoom),
          alpha: 0.85,
        });
    }

    g.circle(this.startPoint.x, this.startPoint.y, handleRadius).fill({
      color: 0xff6400,
      alpha: 0.95,
    });
    g.circle(this.endPoint.x, this.endPoint.y, handleRadius).fill({
      color: 0xffd166,
      alpha: 1,
    });

    this.labelText.text =
      path.feet + " ft" + (path.cells > 0 ? " (" + path.cells + " кл.)" : "");
    // The badge sits above the end of the path, not at the midpoint.
    this.labelText.position.set(
      this.endPoint.x,
      this.endPoint.y - 20 / zoom,
    );
    this.labelText.scale.set(1 / zoom);
    this.labelText.visible = true;
    this.visible = true;
  }
}
