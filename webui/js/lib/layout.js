/*
 * AIxRay layout: node placement and orthogonal connector routing.
 *
 * Ported from the v2 comparison renderer. Nodes sit in swimlane rows and
 * column slots; several nodes that share a lane and column get their own
 * sub-column, so nothing is drawn on top of another step. When two models are
 * shown together they share one column map to stay horizontally aligned.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./schema.js"));
  else { const B = root.AIxRay = root.AIxRay || {}; B.layout = factory(B.schema); }
})(typeof globalThis !== "undefined" ? globalThis : this, function (schema) {
  "use strict";

  const G = Object.freeze({
    column: 224, firstX: 110, taskW: 184, taskH: 64,
    gatewayR: 24, eventR: 22, pad: 4, corridor: 104,
    laneTop: 8, laneHeight: 88
  });

  function shapeOf(node) {
    return schema.typeInfo(node.semanticType).shape;
  }

  /*
   * Column positions for nodes without presentation data: longest-path
   * layering from the start events, ignoring edges that close a loop.
   */
  function autoColumns(model) {
    const ids = model.nodes.map(n => n.id);
    const out = new Map(ids.map(id => [id, []]));
    const indeg = new Map(ids.map(id => [id, 0]));
    model.edges.forEach(e => {
      if (out.has(e.from) && out.has(e.to)) out.get(e.from).push(e.to);
    });
    // Remove back edges with an iterative DFS.
    const color = new Map(), back = new Set();
    ids.forEach(start => {
      if (color.get(start)) return;
      const stack = [[start, 0]];
      color.set(start, 1);
      while (stack.length) {
        const top = stack[stack.length - 1];
        const next = out.get(top[0])[top[1]++];
        if (next === undefined) { color.set(top[0], 2); stack.pop(); continue; }
        const c = color.get(next);
        if (c === 1) back.add(top[0] + ">" + next);
        else if (!c) { color.set(next, 1); stack.push([next, 0]); }
      }
    });
    model.edges.forEach(e => {
      if (!back.has(e.from + ">" + e.to) && indeg.has(e.to) && out.has(e.from)) indeg.set(e.to, indeg.get(e.to) + 1);
    });
    const col = new Map(ids.map(id => [id, 0]));
    const queue = ids.filter(id => indeg.get(id) === 0);
    while (queue.length) {
      const id = queue.shift();
      out.get(id).forEach(next => {
        if (back.has(id + ">" + next)) return;
        col.set(next, Math.max(col.get(next), col.get(id) + 1));
        indeg.set(next, indeg.get(next) - 1);
        if (indeg.get(next) === 0) queue.push(next);
      });
    }
    return col;
  }

  function columnMap(model) {
    const pres = (model.presentation && model.presentation.nodes) || {};
    const missing = model.nodes.some(n => !pres[n.id] || !Number.isFinite(pres[n.id].x));
    const auto = missing ? autoColumns(model) : null;
    return new Map(model.nodes.map(n => {
      const p = pres[n.id];
      return [n.id, p && Number.isFinite(p.x) ? p.x : auto.get(n.id)];
    }));
  }

  /**
   * Lays out one or more models that are displayed together.
   * Returns { worldWidth, models: { [modelId]: { lanes, laneTop, laneHeight, width, height, pos } } }.
   */
  function computeLayout(models) {
    const colMaps = models.map(columnMap);
    const columns = [...new Set(colMaps.flatMap(m => [...m.values()]))].sort((a, b) => a - b);
    const capacity = new Map(columns.map(c => [c, 1]));
    const slots = models.map((model, i) => {
      const counts = new Map(), slot = new Map();
      model.nodes.forEach(n => {
        const c = colMaps[i].get(n.id);
        const key = n.laneId + "|" + c;
        const s = counts.get(key) || 0;
        slot.set(n.id, s);
        counts.set(key, s + 1);
        capacity.set(c, Math.max(capacity.get(c), s + 1));
      });
      return slot;
    });
    let total = 0;
    const offsets = new Map();
    columns.forEach(c => { offsets.set(c, total); total += capacity.get(c); });
    const worldWidth = G.firstX + Math.max(0, total - 1) * G.column + G.taskW / 2 + 40;
    const result = { worldWidth, models: {} };
    models.forEach((model, i) => {
      const laneIndex = new Map(model.lanes.map((l, j) => [l.id, j]));
      const laneHeight = (model.presentation && model.presentation.laneHeight) || G.laneHeight;
      const pos = new Map();
      model.nodes.forEach(n => {
        const c = colMaps[i].get(n.id);
        pos.set(n.id, {
          x: G.firstX + (offsets.get(c) + slots[i].get(n.id)) * G.column,
          y: G.laneTop + ((laneIndex.has(n.laneId) ? laneIndex.get(n.laneId) : 0) + 0.5) * laneHeight,
          shape: shapeOf(n)
        });
      });
      result.models[model.id] = {
        lanes: model.lanes, laneTop: G.laneTop, laneHeight, width: worldWidth,
        height: G.laneTop + model.lanes.length * laneHeight + 4, pos
      };
    });
    return result;
  }

  /** Pairs of node IDs drawn at the same coordinates (should always be empty). */
  function collisions(layoutModel) {
    const seen = new Map(), hits = [];
    layoutModel.pos.forEach((p, id) => {
      const key = Math.round(p.x) + "," + Math.round(p.y);
      if (seen.has(key)) hits.push([seen.get(key), id, { x: p.x, y: p.y }]);
      else seen.set(key, id);
    });
    return hits;
  }

  /* ---------------- Orthogonal routing ---------------- */

  function halfHeight(shape) {
    return shape === "task" ? G.taskH / 2 : shape === "gateway" ? G.gatewayR : G.eventR;
  }

  function obstacle(p) {
    return {
      x1: p.x - G.taskW / 2 - G.pad, x2: p.x + G.taskW / 2 + G.pad,
      y1: p.y - halfHeight(p.shape) - G.pad,
      y2: p.y + (p.shape === "task" ? G.taskH / 2 : 40) + G.pad
    };
  }

  function segmentClear(a, b, boxes) {
    return !boxes.some(o => Math.abs(a.x - b.x) < 0.01 ?
      a.x > o.x1 && a.x < o.x2 && Math.max(a.y, b.y) > o.y1 && Math.min(a.y, b.y) < o.y2 :
      a.y > o.y1 && a.y < o.y2 && Math.max(a.x, b.x) > o.x1 && Math.min(a.x, b.x) < o.x2);
  }

  function port(p, side, offset) {
    const off = offset || 0;
    const half = p.shape === "task" ? G.taskW / 2 :
      p.shape === "gateway" ? G.gatewayR - Math.abs(off) :
        Math.sqrt(Math.max(0, G.eventR * G.eventR - off * off));
    return { x: p.x + side * half, y: p.y + off };
  }

  function simplify(points) {
    const out = [];
    points.forEach(p => {
      const last = out[out.length - 1];
      if (last && last.x === p.x && last.y === p.y) return;
      out.push(p);
      while (out.length >= 3) {
        const [a, b, c] = out.slice(-3);
        if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) out.splice(out.length - 2, 1);
        else break;
      }
    });
    return out;
  }

  class MinHeap {
    constructor() { this.items = []; }
    push(item) {
      const a = this.items; a.push(item); let i = a.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p].f <= item.f) break;
        a[i] = a[p]; i = p;
      }
      a[i] = item;
    }
    pop() {
      const a = this.items;
      if (!a.length) return null;
      const top = a[0], end = a.pop();
      if (a.length) {
        let i = 0;
        for (;;) {
          let c = i * 2 + 1;
          if (c >= a.length) break;
          if (c + 1 < a.length && a[c + 1].f < a[c].f) c++;
          if (a[c].f >= end.f) break;
          a[i] = a[c]; i = c;
        }
        a[i] = end;
      }
      return top;
    }
  }

  function elbow(start, end, a, b) {
    const midX = (a.x + b.x) / 2;
    return simplify([start, a, { x: midX, y: a.y }, { x: midX, y: b.y }, b, end]);
  }

  /**
   * Routes one connector around the other nodes. `lm` is the layout model,
   * `used` a Map shared across the model's edges to spread parallel routes.
   */
  function routeEdge(from, to, lm, offset, used) {
    const positions = [...lm.pos.values()];
    const boxes = positions.map(obstacle);
    const direction = to.x >= from.x ? 1 : -1;
    const sourceSide = direction;
    const targetSide = from === to ? -direction : from.x === to.x ? direction : -direction;
    const start = port(from, sourceSide, offset), end = port(to, targetSide, offset);
    const a = { x: from.x + sourceSide * G.corridor, y: start.y };
    const b = { x: to.x + targetSide * G.corridor, y: end.y };
    const xs = new Set([4, lm.width - 4, a.x, b.x]);
    const ys = new Set([3, lm.height - 3, a.y, b.y]);
    positions.forEach(p => { xs.add(p.x - G.corridor); xs.add(p.x + G.corridor); ys.add(p.y); });
    boxes.forEach(o => { ys.add(Math.max(2, o.y1 - 1)); ys.add(Math.min(lm.height - 2, o.y2 + 1)); });
    const X = [...xs].sort((p, q) => p - q), Y = [...ys].sort((p, q) => p - q);
    const nx = X.length, count = nx * Y.length;
    const point = i => ({ x: X[i % nx], y: Y[Math.floor(i / nx)] });
    const valid = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      const p = point(i);
      valid[i] = boxes.some(o => p.x > o.x1 && p.x < o.x2 && p.y > o.y1 && p.y < o.y2) ? 0 : 1;
    }
    const source = Y.indexOf(a.y) * nx + X.indexOf(a.x);
    const target = Y.indexOf(b.y) * nx + X.indexOf(b.x);
    if (source < 0 || target < 0) return elbow(start, end, a, b);
    const dist = new Float64Array(count).fill(Infinity);
    const prev = new Int32Array(count).fill(-1), heap = new MinHeap();
    const key = (p, q) => {
      const s = p.x + "," + p.y, t = q.x + "," + q.y;
      return s < t ? s + "|" + t : t + "|" + s;
    };
    const heuristic = p => Math.abs(p.x - b.x) + Math.abs(p.y - b.y);
    dist[source] = 0; heap.push({ id: source, g: 0, f: heuristic(a) });
    while (heap.items.length) {
      const c = heap.pop();
      if (c.g !== dist[c.id]) continue;
      if (c.id === target) break;
      const ix = c.id % nx, iy = Math.floor(c.id / nx), p = point(c.id), neighbors = [];
      if (ix > 0) neighbors.push(c.id - 1);
      if (ix < nx - 1) neighbors.push(c.id + 1);
      if (iy > 0) neighbors.push(c.id - nx);
      if (iy < Y.length - 1) neighbors.push(c.id + nx);
      neighbors.forEach(next => {
        if (!valid[next]) return;
        const q = point(next);
        if (!segmentClear(p, q, boxes)) return;
        const g = c.g + Math.abs(p.x - q.x) + Math.abs(p.y - q.y) + (used.get(key(p, q)) || 0) * 24;
        if (g < dist[next]) {
          dist[next] = g; prev[next] = c.id;
          heap.push({ id: next, g, f: g + heuristic(q) });
        }
      });
    }
    if (!Number.isFinite(dist[target])) return elbow(start, end, a, b);
    const points = [];
    for (let i = target; i !== -1; i = prev[i]) points.push(point(i));
    points.reverse();
    for (let i = 1; i < points.length; i++) {
      const k = key(points[i - 1], points[i]);
      used.set(k, (used.get(k) || 0) + 1);
    }
    return simplify([start, ...points, end]);
  }

  /** Routes every edge of a model. Returns Map edgeId -> points. */
  function routeAll(model, lm) {
    const used = new Map(), totals = new Map(), seen = new Map(), routes = new Map();
    model.edges.forEach(e => {
      const k = e.from + ":" + e.to;
      totals.set(k, (totals.get(k) || 0) + 1);
    });
    model.edges.forEach(e => {
      const from = lm.pos.get(e.from), to = lm.pos.get(e.to);
      if (!from || !to) return;
      const k = e.from + ":" + e.to, ordinal = seen.get(k) || 0, count = totals.get(k);
      seen.set(k, ordinal + 1);
      const offset = count > 1 ? Math.max(-10, Math.min(10, (ordinal - (count - 1) / 2) * 14)) : 0;
      routes.set(e.id, routeEdge(from, to, lm, offset, used));
    });
    return routes;
  }

  return { G, shapeOf, autoColumns, computeLayout, collisions, routeEdge, routeAll };
});
