/* ============================================================
   VISUALIZER â€” generic engine.
   Reads BRANDING (branding.js), LANES/NODES/FLOWS (process.js),
   and SUBMISSIONS (samples.js).
   No domain-specific copy lives here.
   ============================================================ */

/* ============================================================
   APPLY BRANDING TO DOM
   ============================================================ */
(function applyBranding(){
  document.title = `${BRANDING.app.name} Â· ${BRANDING.app.subtitle}`;
  document.getElementById('brand-app-name').textContent = BRANDING.app.name;
  document.getElementById('brand-subtitle').textContent = BRANDING.app.subtitle;
  document.getElementById('brand-header-status').textContent = BRANDING.app.headerStatus;
  const bm = document.getElementById('brand-mark');
  bm.style.background = BRANDING.app.brandMarkGradient;
  bm.style.boxShadow = BRANDING.app.brandMarkGlow;
  document.getElementById('brand-footer-org').textContent = BRANDING.footer.org;
  const fl = document.getElementById('brand-footer-link');
  fl.textContent = BRANDING.footer.linkText;
  fl.href = BRANDING.footer.linkHref;
  document.getElementById('tb-label-sample').textContent = BRANDING.copy.sampleNoun;
  document.getElementById('sample-list-title').textContent = BRANDING.copy.sampleListTitle;
})();

/* Build help modal from BRANDING.help */
(function buildHelpModal(){
  const mc = document.getElementById('help-modal-content');
  const closeBtn = mc.querySelector('.close-x');
  const h = BRANDING.help;
  let html = '';
  html += `<h2>${h.title}</h2>`;
  html += `<div style="color:var(--ink-2); font-size:12px;">${h.subtitle}</div>`;
  for (const sec of h.sections) {
    html += `<h3>${sec.title}</h3>`;
    html += `<div style="font-size:12.5px; color:var(--ink-1); line-height:1.6;">${sec.body}</div>`;
  }
  html += `<h3>${h.shortcutsTitle}</h3>`;
  for (const [k,v] of h.shortcuts) html += `<div class="row"><span>${k}</span><span>${v}</span></div>`;
  html += `<h3>${h.playbackTitle}</h3>`;
  for (const [k,v] of h.playback) html += `<div class="row"><span>${k}</span><span>${v}</span></div>`;
  html += `<h3>${h.togglesTitle}</h3>`;
  for (const [k,v] of h.toggles) html += `<div class="row"><span>${k}</span><span>${v}</span></div>`;
  mc.innerHTML = html;
  // Re-add close button
  const x = document.createElement('button');
  x.className = 'close-x'; x.id = 'help-close'; x.textContent = 'Ã—';
  mc.insertBefore(x, mc.firstChild);
})();

/* ============================================================
   LAYOUT
   ============================================================ */
const COL_W = 130, LANE_H = 100, LANE_LBL = 160, PAD_L = 24, PAD_T = 28;
const TASK_W = 118, TASK_H = 70;
const TASK_FONT = 14;
const LINE_H = 16;
const SVG_W = LANE_LBL + (Math.max(...NODES.map(n=>n.col))+1) * COL_W + PAD_L*2 + 20;
const SVG_H = LANE_H * LANES.length + PAD_T*2;

function laneIndex(id){ return LANES.findIndex(l=>l.id===id); }
function nodeXY(node){
  return {
    x: PAD_L + LANE_LBL + node.col * COL_W + COL_W/2,
    y: PAD_T + laneIndex(node.lane) * LANE_H + LANE_H/2
  };
}

/* ============================================================
   RENDER MAIN SVG
   ============================================================ */
const svg = document.getElementById('bpmn');
const root = document.getElementById('bpmn-root');
svg.setAttribute('viewBox', `0 0 ${SVG_W} ${SVG_H}`);

function el(tag, attrs={}, children=[]){
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k,v] of Object.entries(attrs)) e.setAttribute(k,v);
  for (const c of children) e.appendChild(c);
  return e;
}

const lanesG = el('g',{id:'lanes'});
LANES.forEach((lane, i) => {
  const y = PAD_T + i*LANE_H;
  lanesG.appendChild(el('rect',{
    x: PAD_L, y, width: SVG_W - PAD_L*2, height: LANE_H,
    fill: 'url(#g-lane-shelf)', 'data-lane': lane.id, class:'lane-shelf'
  }));
  lanesG.appendChild(el('line',{
    x1: PAD_L, x2: SVG_W - PAD_L, y1: y+LANE_H, y2: y+LANE_H,
    stroke: 'rgba(80,100,140,0.18)', 'stroke-width': 1
  }));
  lanesG.appendChild(el('rect',{
    x: PAD_L, y, width: LANE_LBL, height: LANE_H,
    fill: 'rgba(10,16,32,0.7)'
  }));
  lanesG.appendChild(el('rect',{
    x: PAD_L, y, width: 4, height: LANE_H, fill: lane.accent
  }));
  const t = el('text',{
    x: PAD_L + 16, y: y + LANE_H/2 - 4,
    fill: '#e5ecf7', 'font-size': 18, 'font-weight': 700,
    'letter-spacing': '0.01em'
  }); t.textContent = lane.name; lanesG.appendChild(t);
  const t2 = el('text',{
    x: PAD_L + 16, y: y + LANE_H/2 + 18,
    fill: '#7c8db5', 'font-size': 11.5, 'letter-spacing': '0.18em',
    'font-weight': 500
  }); t2.textContent = lane.id.toUpperCase(); lanesG.appendChild(t2);
});
lanesG.appendChild(el('line',{
  x1: PAD_L, x2: SVG_W - PAD_L, y1: PAD_T, y2: PAD_T,
  stroke: 'rgba(80,100,140,0.18)', 'stroke-width': 1
}));
root.appendChild(lanesG);

const flowsG = el('g',{id:'flows'});
function flowPath(from, to){
  const a = nodeXY(from), b = nodeXY(to);
  const dx = b.x - a.x, dy = b.y - a.y;
  const fromIsCircle = ['start','end','endTerminate','eventMessage'].includes(from.type);
  const toIsCircle = ['start','end','endTerminate','eventMessage'].includes(to.type);
  const fromIsGw = from.type.startsWith('gateway');
  const toIsGw = to.type.startsWith('gateway');
  const sx = a.x + (fromIsGw ? 26 : (fromIsCircle ? 22 : TASK_W/2));
  const ex = b.x - (toIsGw ? 26 : (toIsCircle ? 22 : TASK_W/2));
  const fromVertEdge = fromIsGw ? 26 : (fromIsCircle ? 22 : TASK_H/2);
  const toVertEdge   = toIsGw   ? 26 : (toIsCircle   ? 22 : TASK_H/2);
  if (Math.abs(dy) < 5) {
    return `M ${sx} ${a.y} L ${ex} ${b.y}`;
  } else if (Math.abs(dx) < 5) {
    const y1 = a.y + (dy>0 ? fromVertEdge : -fromVertEdge);
    const y2 = b.y - (dy>0 ? toVertEdge : -toVertEdge);
    return `M ${a.x} ${y1} L ${b.x} ${y2}`;
  } else {
    const midX = (a.x + b.x) / 2;
    return `M ${sx} ${a.y} C ${midX} ${a.y}, ${midX} ${b.y}, ${ex} ${b.y}`;
  }
}

FLOWS.forEach(f => {
  const from = NODE_BY_ID[f.from], to = NODE_BY_ID[f.to];
  const g = el('g',{class:'flow', 'data-flow': f.id, 'data-from':f.from, 'data-to':f.to});
  const p = el('path',{
    d: flowPath(from,to), fill:'none',
    stroke:'#3a4a6e', 'stroke-width': 1.5,
    'marker-end': 'url(#arrow)',
    'stroke-linecap':'round'
  });
  g.appendChild(p);
  if (f.label) {
    const a = nodeXY(from), b = nodeXY(to);
    const lx = (a.x + b.x)/2, ly = (a.y + b.y)/2 - 6;
    const lblW = f.label.length > 5 ? 60 : 48;
    const lblBg = el('rect',{
      x: lx-lblW/2, y: ly-10, width: lblW, height: 16, rx: 8,
      fill:'rgba(10,16,32,0.85)', stroke:'rgba(80,100,140,0.4)', 'stroke-width':0.5,
      class:'flow-label-bg'
    });
    const lbl = el('text',{
      x: lx, y: ly+2, 'text-anchor':'middle', 'font-size':11,
      fill:'#aab4c8', class:'flow-label', 'font-weight':500
    });
    lbl.textContent = f.label;
    g.appendChild(lblBg); g.appendChild(lbl);
  }
  flowsG.appendChild(g);
});
root.appendChild(flowsG);

const nodesG = el('g',{id:'nodes'});
function renderNode(n){
  const {x,y} = nodeXY(n);
  const g = el('g',{
    class:`node node-${n.type}`,
    'data-node': n.id,
    transform: `translate(${x},${y})`,
    style:'cursor:pointer;'
  });

  if (['start','end','endTerminate','eventMessage'].includes(n.type)) {
    const r = 22;
    const stroke = n.type === 'start' ? '#7c8db5'
                 : n.type === 'endTerminate' ? '#f87171'
                 : n.type === 'eventMessage' ? '#fbbf24'
                 : '#4ade80';
    const sw = (n.type === 'end' || n.type === 'endTerminate') ? 3 : 1.5;
    g.appendChild(el('circle',{cx:0,cy:0,r,fill:'rgba(20,28,48,0.85)',stroke,'stroke-width':sw,class:'shape'}));
    if (n.type === 'eventMessage') {
      g.appendChild(el('rect',{x:-9,y:-6,width:18,height:12,rx:1,fill:'none',stroke:'#fbbf24','stroke-width':1.2}));
      g.appendChild(el('path',{d:'M-9,-6 L0,2 L9,-6',fill:'none',stroke:'#fbbf24','stroke-width':1.2}));
    } else if (n.type === 'endTerminate') {
      g.appendChild(el('circle',{cx:0,cy:0,r:10,fill:'#f87171'}));
    }
    if (n.label) {
      const lines = n.label.split('\n');
      lines.forEach((line,i) => {
        const t = el('text',{
          x:0, y: r + 16 + i*14, 'text-anchor':'middle', 'font-size':12.5,
          fill: '#aab4c8', 'font-weight': 600
        });
        t.textContent = line; g.appendChild(t);
      });
    }
  } else if (n.type.startsWith('gateway')) {
    const r = 26;
    const stroke = n.type==='gatewayP' ? '#a78bfa' : '#7dd3fc';
    g.appendChild(el('path',{
      d: `M 0,-${r} L ${r},0 L 0,${r} L -${r},0 Z`,
      fill: 'rgba(20,28,48,0.9)', stroke, 'stroke-width': 1.5, class:'shape'
    }));
    if (n.type === 'gatewayX') {
      g.appendChild(el('path',{d:'M -8,-8 L 8,8 M -8,8 L 8,-8',stroke:'#7dd3fc','stroke-width':2.5,'stroke-linecap':'round'}));
    } else if (n.type === 'gatewayP') {
      g.appendChild(el('path',{d:'M -10,0 L 10,0 M 0,-10 L 0,10',stroke:'#a78bfa','stroke-width':2.5,'stroke-linecap':'round'}));
    }
    if (n.label) {
      const lines = n.label.split('\n');
      lines.forEach((line,i) => {
        const t = el('text',{
          x:0, y: r + 14 + i*13, 'text-anchor':'middle', 'font-size':12,
          fill: '#aab4c8', 'font-weight': 600
        });
        t.textContent = line; g.appendChild(t);
      });
    }
  } else {
    const w = TASK_W, h = TASK_H;
    const rect = el('rect',{
      x:-w/2,y:-h/2,width:w,height:h,rx:9,
      fill:'url(#g-task)', stroke:'#3a4a6e', 'stroke-width':1.5,
      class:'shape'
    });
    g.appendChild(rect);
    const ic = el('g',{transform:`translate(${-w/2+8},${-h/2+8})`, class:'task-icon'});
    if (n.type==='taskUser') {
      ic.appendChild(el('circle',{cx:4,cy:3,r:2.8,fill:'none',stroke:'#7c8db5','stroke-width':1.3}));
      ic.appendChild(el('path',{d:'M 0,12 Q 4,7 8,12',fill:'none',stroke:'#7c8db5','stroke-width':1.3}));
    } else if (n.type==='taskService') {
      ic.appendChild(el('circle',{cx:4,cy:5,r:3.2,fill:'none',stroke:'#56c2a3','stroke-width':1.3}));
      ic.appendChild(el('circle',{cx:4,cy:5,r:1.1,fill:'#56c2a3'}));
      [0,90,180,270].forEach(a=>{
        const rad = a*Math.PI/180; const x1 = 4+Math.cos(rad)*4.2, y1 = 5+Math.sin(rad)*4.2;
        const x2 = 4+Math.cos(rad)*5.8, y2 = 5+Math.sin(rad)*5.8;
        ic.appendChild(el('line',{x1,y1,x2,y2,stroke:'#56c2a3','stroke-width':1.3}));
      });
    } else if (n.type==='taskScript') {
      ic.appendChild(el('path',{d:'M 1,2 L 8,2 L 8,10 L 1,10 Z',fill:'none',stroke:'#a78bfa','stroke-width':1.3}));
      ic.appendChild(el('path',{d:'M 2,4.5 L 7,4.5 M 2,6.5 L 6,6.5 M 2,8.5 L 7,8.5',stroke:'#a78bfa','stroke-width':0.9}));
    }
    g.appendChild(ic);
    const lines = (n.label||'').split('\n');
    const totalTextH = (lines.length - 1) * LINE_H;
    const startY = -totalTextH/2 + 1;
    lines.forEach((line,i) => {
      const t = el('text',{
        x:0, y: startY + i*LINE_H + 4, 'text-anchor':'middle', 'font-size':TASK_FONT,
        fill:'#e5ecf7', 'font-weight':600,
        'letter-spacing': '0.005em'
      });
      t.textContent = line; g.appendChild(t);
    });
    const slaBg = el('rect',{
      x:-w/2+10, y: h/2-7, width:w-20, height:3.5, rx:1.75,
      fill:'rgba(60,80,120,0.4)', class:'sla-bg'
    });
    const slaFill = el('rect',{
      x:-w/2+10, y: h/2-7, width:0, height:3.5, rx:1.75,
      fill:'#4ade80', class:'sla-fill'
    });
    g.appendChild(slaBg); g.appendChild(slaFill);
  }
  return g;
}
NODES.forEach(n => nodesG.appendChild(renderNode(n)));
root.appendChild(nodesG);

const effectsG = el('g',{id:'effects'});
root.appendChild(effectsG);

/* ============================================================
   STATE
   ============================================================ */
const STATE = {
  selected: 0,
  simT: 0,
  playing: true,
  speed: 1,
  lastTick: performance.now(),
  selectedNode: null,
  showHeat: false,
  showMetrics: true,
  showLabels: true,
  showStars: false,
  zoom: 1.0, panX: 0, panY: 0,
  _vbW: SVG_W, _vbH: SVG_H,
};

const SIM_RATE = 8;

function currentSub(){ return SUBMISSIONS[STATE.selected]; }
function maxT(sub){ const last = sub.path[sub.path.length-1]; return last.t + last.dur; }

/* ============================================================
   SIMULATION
   ============================================================ */
function nodeStateAt(nodeId, simT, sub){
  const visits = sub.path.filter(p=>p.nodeId===nodeId);
  if (visits.length===0) return {state:'pending', visited:false};
  const v = visits[0];
  if (simT < v.t) return {state:'pending', visited:false};
  if (v.dur === 0) {
    return {state: simT >= v.t ? 'complete' : 'pending', visited: simT >= v.t, entry: v};
  }
  if (simT < v.t + v.dur) {
    const elapsed = simT - v.t;
    const node = NODE_BY_ID[nodeId];
    const slaPct = node.sla ? elapsed / node.sla : 0;
    return {state: slaPct > 1 ? 'breach' : (slaPct > 0.9 ? 'warn' : 'active'), visited:true, elapsed, slaPct, entry:v};
  }
  return {state:'complete', visited:true, entry:v};
}
function flowVisited(flow, simT, sub){
  return nodeStateAt(flow.to, simT, sub).visited;
}
function flowJustFired(flow, simT, sub){
  const visits = sub.path.filter(p=>p.nodeId===flow.to);
  if (!visits.length) return false;
  const v = visits[0];
  const delta = simT - v.t;
  return delta >= 0 && delta < 8;
}
function flowFeedingActive(flow, simT, sub){
  const targetSt = nodeStateAt(flow.to, simT, sub);
  if (!['active','warn','breach'].includes(targetSt.state)) return false;
  const sourceSt = nodeStateAt(flow.from, simT, sub);
  return sourceSt.visited;
}

/* ============================================================
   UPDATE MAIN VISUALS
   ============================================================ */
function updateNodeVisuals(){
  const sub = currentSub();
  const nowMs = Date.now();

  for (const n of NODES) {
    const g = root.querySelector(`[data-node="${n.id}"]`);
    if (!g) continue;
    const st = nodeStateAt(n.id, STATE.simT, sub);
    const shape = g.querySelector('.shape');
    const slaFill = g.querySelector('.sla-fill');
    const slaBg = g.querySelector('.sla-bg');

    if (shape && shape.tagName === 'rect') {
      let fill = 'url(#g-task)', stroke = '#3a4a6e', sw = 1.5;
      if (st.state==='active') { fill='url(#g-task-active)'; stroke='#7dd3fc'; sw=2.5; }
      else if (st.state==='warn' || st.state==='breach') { fill='url(#g-task-stuck)'; stroke=st.state==='breach'?'#f87171':'#fbbf24'; sw=2.5; }
      else if (st.state==='complete') { fill='url(#g-task-done)'; stroke='#4ade80'; sw=1.5; }
      shape.setAttribute('fill', fill);
      shape.setAttribute('stroke', stroke);
      shape.setAttribute('stroke-width', sw);
      if (['active','warn','breach'].includes(st.state)) {
        const phase = (nowMs/700) % 1;
        const opacity = 0.85 + 0.15 * Math.abs(Math.sin(phase * Math.PI * 2));
        shape.setAttribute('fill-opacity', opacity.toFixed(2));
      } else {
        shape.removeAttribute('fill-opacity');
      }
      if (slaFill && slaBg) {
        const showM = STATE.showMetrics && n.sla;
        slaBg.setAttribute('opacity', showM ? '1' : '0');
        if (showM && st.visited) {
          const elapsed = st.elapsed != null ? st.elapsed : (st.entry ? st.entry.dur : 0);
          const pct = Math.min(1.5, elapsed / n.sla);
          const fullW = TASK_W-20;
          slaFill.setAttribute('width', Math.min(fullW, fullW*pct));
          slaFill.setAttribute('opacity','1');
          let c = '#4ade80';
          if (pct >= 0.9 && pct < 1) c = '#fbbf24';
          else if (pct >= 1) c = '#f87171';
          slaFill.setAttribute('fill', c);
        } else {
          slaFill.setAttribute('width', 0);
          slaFill.setAttribute('opacity','0');
        }
      }
    } else if (shape) {
      if (st.state === 'complete' && (n.type==='end' || n.type==='endTerminate')) {
        shape.setAttribute('stroke-width', 4);
      }
      if (n.type.startsWith('gateway')) {
        const visits = sub.path.filter(p=>p.nodeId===n.id);
        if (visits.length && STATE.simT >= visits[0].t && STATE.simT < visits[0].t + 6) {
          shape.setAttribute('filter','url(#glow-strong)');
          shape.setAttribute('stroke-width', 3);
        } else {
          shape.removeAttribute('filter');
          shape.setAttribute('stroke-width', st.visited ? 2 : 1.5);
        }
      } else if (n.type === 'eventMessage') {
        if (['active','warn','breach'].includes(st.state)) {
          shape.setAttribute('filter','url(#glow)');
          shape.setAttribute('stroke-width', 3);
        } else {
          shape.removeAttribute('filter');
        }
      }
    }
  }

  for (const f of FLOWS) {
    const g = root.querySelector(`[data-flow="${f.id}"]`);
    if (!g) continue;
    const path = g.querySelector('path');
    const visited = flowVisited(f, STATE.simT, sub);
    const feeding = flowFeedingActive(f, STATE.simT, sub);
    const fromVisits = sub.path.filter(p=>p.nodeId===f.from);
    const toVisits = sub.path.filter(p=>p.nodeId===f.to);
    const inPath = fromVisits.length && toVisits.length;

    if (feeding && inPath) {
      path.setAttribute('stroke','#7dd3fc');
      path.setAttribute('stroke-width', 3);
      path.setAttribute('marker-end','url(#arrow-active)');
      path.setAttribute('opacity', 1);
      path.setAttribute('stroke-dasharray', '10 5');
      path.setAttribute('stroke-dashoffset', String(-((nowMs/35) % 15)));
      path.setAttribute('filter','url(#glow)');
    } else if (visited && inPath) {
      path.setAttribute('stroke', '#4ade80');
      path.setAttribute('stroke-width', 2.2);
      path.setAttribute('marker-end','url(#arrow-done)');
      path.setAttribute('opacity', 0.85);
      path.removeAttribute('stroke-dasharray');
      path.removeAttribute('stroke-dashoffset');
      if (flowJustFired(f, STATE.simT, sub)) {
        path.setAttribute('stroke','#7dd3fc');
        path.setAttribute('marker-end','url(#arrow-active)');
        path.setAttribute('stroke-width', 3);
        path.setAttribute('filter','url(#glow)');
      } else {
        path.removeAttribute('filter');
      }
    } else {
      path.setAttribute('stroke','#3a4a6e');
      path.setAttribute('stroke-width', 1.2);
      path.setAttribute('marker-end','url(#arrow)');
      path.setAttribute('opacity', 0.55);
      path.removeAttribute('filter');
      path.removeAttribute('stroke-dasharray');
      path.removeAttribute('stroke-dashoffset');
    }
    const lbl = g.querySelector('.flow-label');
    const lblBg = g.querySelector('.flow-label-bg');
    if (lbl) { lbl.style.opacity = STATE.showLabels ? 1 : 0; lblBg.style.opacity = STATE.showLabels ? 1 : 0; }
  }

  while (effectsG.firstChild) effectsG.removeChild(effectsG.firstChild);
  for (const n of NODES) {
    if (n.type.startsWith('gateway')) continue;
    const st = nodeStateAt(n.id, STATE.simT, sub);
    if (!['active','warn','breach'].includes(st.state)) continue;
    const {x,y} = nodeXY(n);
    const isCircle = ['start','end','endTerminate','eventMessage'].includes(n.type);
    const baseW = isCircle ? 50 : TASK_W + 8;
    const baseH = isCircle ? 50 : TASK_H + 8;
    const baseRx = isCircle ? 25 : 11;
    const color = st.state==='breach' ? '#f87171' : st.state==='warn' ? '#fbbf24' : '#7dd3fc';

    for (let i = 0; i < 2; i++) {
      const t = ((nowMs/1400) + i*0.5) % 1;
      const expand = t * 36;
      const op = (1 - t) * 0.55;
      effectsG.appendChild(el('rect',{
        x: x - baseW/2 - expand,
        y: y - baseH/2 - expand,
        width: baseW + expand*2,
        height: baseH + expand*2,
        rx: baseRx + expand,
        fill: 'none',
        stroke: color,
        'stroke-width': 2,
        opacity: op.toFixed(2)
      }));
    }
    const haloPhase = (nowMs/600) % 1;
    const haloOp = 0.6 + 0.3 * Math.abs(Math.sin(haloPhase * Math.PI * 2));
    effectsG.appendChild(el('rect',{
      x: x - baseW/2 - 3,
      y: y - baseH/2 - 3,
      width: baseW + 6,
      height: baseH + 6,
      rx: baseRx + 3,
      fill: 'none', stroke: color, 'stroke-width': 2.2,
      opacity: haloOp.toFixed(2),
      filter: 'url(#glow)'
    }));
  }

  const heatByLane = {};
  for (const lane of LANES) heatByLane[lane.id] = 0;
  for (const n of NODES) {
    const st = nodeStateAt(n.id, STATE.simT, sub);
    if (st.state==='active' || st.state==='warn') heatByLane[n.lane] += 1;
    else if (st.state==='breach') heatByLane[n.lane] += 2.5;
  }
  document.querySelectorAll('.lane-shelf').forEach(shelf => {
    const lane = shelf.getAttribute('data-lane');
    const heat = heatByLane[lane] || 0;
    if (STATE.showHeat && heat > 0) {
      const intensity = Math.min(0.55, heat * 0.18);
      shelf.setAttribute('fill', `rgba(248,113,113,${intensity})`);
    } else {
      shelf.setAttribute('fill', 'url(#g-lane-shelf)');
    }
  });
}

/* ============================================================
   MINIMAP
   ============================================================ */
const miniSvg = document.getElementById('minimap-svg');
miniSvg.setAttribute('viewBox', `0 0 ${SVG_W} ${SVG_H}`);

function renderMinimap(){
  while (miniSvg.firstChild) miniSvg.removeChild(miniSvg.firstChild);
  const sub = currentSub();

  LANES.forEach((lane, i) => {
    const y = PAD_T + i*LANE_H;
    miniSvg.appendChild(el('rect',{
      x: PAD_L, y, width: SVG_W - PAD_L*2, height: LANE_H,
      fill: 'rgba(20,30,55,0.4)', stroke:'none'
    }));
    miniSvg.appendChild(el('rect',{
      x: PAD_L, y, width: 6, height: LANE_H, fill: lane.accent, opacity: 0.7
    }));
    miniSvg.appendChild(el('line',{
      x1:PAD_L, x2: SVG_W-PAD_L, y1: y+LANE_H, y2: y+LANE_H,
      stroke:'rgba(80,100,140,0.35)','stroke-width':1, 'vector-effect':'non-scaling-stroke'
    }));
  });

  for (const f of FLOWS) {
    const from = NODE_BY_ID[f.from], to = NODE_BY_ID[f.to];
    const a = nodeXY(from), b = nodeXY(to);
    const visited = flowVisited(f, STATE.simT, sub);
    miniSvg.appendChild(el('line',{
      x1:a.x, y1:a.y, x2:b.x, y2:b.y,
      stroke: visited ? '#4ade80' : 'rgba(80,100,140,0.7)',
      'stroke-width': visited ? 3 : 2,
      'vector-effect':'non-scaling-stroke',
      opacity: visited ? 0.85 : 0.4
    }));
  }

  for (const n of NODES) {
    const {x,y} = nodeXY(n);
    const st = nodeStateAt(n.id, STATE.simT, sub);
    let color = '#3a4a6e', r = 18;
    if (st.state === 'active') { color = '#7dd3fc'; r = 26; }
    else if (st.state === 'warn') { color = '#fbbf24'; r = 26; }
    else if (st.state === 'breach') { color = '#f87171'; r = 28; }
    else if (st.state === 'complete') { color = '#4ade80'; r = 18; }

    if (['active','warn','breach'].includes(st.state)) {
      const phase = (Date.now()/600) % 1;
      const ringExtra = 22 + Math.sin(phase*Math.PI*2)*14;
      miniSvg.appendChild(el('circle',{
        cx:x, cy:y, r: r + ringExtra,
        fill:'none', stroke: color, 'stroke-width': 2,
        'vector-effect':'non-scaling-stroke', opacity: 0.55
      }));
    }
    miniSvg.appendChild(el('circle',{
      cx:x, cy:y, r,
      fill: color, opacity: st.visited ? 0.95 : 0.55
    }));
  }

  const vbW = STATE._vbW;
  const vbH = STATE._vbH;
  const cx = SVG_W/2 + STATE.panX;
  const cy = SVG_H/2 + STATE.panY;
  const vx = cx - vbW/2, vy = cy - vbH/2;
  miniSvg.appendChild(el('rect',{
    x: vx, y: vy, width: vbW, height: vbH,
    fill: 'rgba(125,211,252,0.10)',
    stroke: '#7dd3fc', 'stroke-width': 2.5,
    'vector-effect':'non-scaling-stroke',
    rx: 4, id:'mini-vp'
  }));
  const cornerLen = Math.min(vbW, vbH) * 0.08;
  const corners = [
    [vx, vy, vx+cornerLen, vy, vx, vy+cornerLen],
    [vx+vbW, vy, vx+vbW-cornerLen, vy, vx+vbW, vy+cornerLen],
    [vx, vy+vbH, vx+cornerLen, vy+vbH, vx, vy+vbH-cornerLen],
    [vx+vbW, vy+vbH, vx+vbW-cornerLen, vy+vbH, vx+vbW, vy+vbH-cornerLen],
  ];
  corners.forEach(c => {
    miniSvg.appendChild(el('path',{
      d:`M ${c[2]} ${c[3]} L ${c[0]} ${c[1]} L ${c[4]} ${c[5]}`,
      fill:'none', stroke:'#7dd3fc','stroke-width':3.5,
      'vector-effect':'non-scaling-stroke'
    }));
  });

  let frontierX = PAD_L + LANE_LBL;
  let frontierFound = false;
  for (const n of NODES) {
    const st = nodeStateAt(n.id, STATE.simT, sub);
    if (['active','warn','breach'].includes(st.state)) {
      const xy = nodeXY(n);
      if (xy.x > frontierX) { frontierX = xy.x; frontierFound = true; }
    }
  }
  if (!frontierFound) {
    let bestX = -Infinity;
    for (const n of NODES) {
      const st = nodeStateAt(n.id, STATE.simT, sub);
      if (st.visited) { const xy = nodeXY(n); if (xy.x > bestX) { bestX = xy.x; } }
    }
    if (bestX > -Infinity) frontierX = bestX;
  }
  miniSvg.appendChild(el('line',{
    x1: frontierX, x2: frontierX, y1: 4, y2: SVG_H-4,
    stroke: '#fff', 'stroke-width': 1.5, 'vector-effect':'non-scaling-stroke',
    opacity: 0.5, 'stroke-dasharray':'4 4'
  }));
  miniSvg.appendChild(el('circle',{
    cx: frontierX, cy: 18, r: 16,
    fill:'#fff', opacity: 0.85
  }));
  const nowLabel = el('text',{
    x: frontierX, y: 23, 'text-anchor':'middle', 'font-size': 36,
    fill:'#0a1020','font-weight':700
  });
  nowLabel.textContent = 'NOW';
  miniSvg.appendChild(nowLabel);

  const total = maxT(sub);
  const pct = Math.min(1, STATE.simT / total);
  document.getElementById('mini-progress').textContent =
    `${Math.round(pct*100)}% Â· ${fmtMin(STATE.simT)}`;
}

/* ============================================================
   FORMATTING + SCRUBBER
   ============================================================ */
function fmtMin(m){
  if (m == null) return 'â€”';
  if (m < 60) return `${Math.round(m)}m`;
  if (m < 60*24) return `${Math.floor(m/60)}h ${Math.round(m%60)}m`;
  const d = Math.floor(m/(60*24)); const h = Math.floor((m%(60*24))/60);
  return `${d}d ${h}h`;
}
function updateScrubber(){
  const sub = currentSub();
  const total = maxT(sub);
  const pct = Math.min(1, STATE.simT / total);
  document.getElementById('scrubber-fill').style.width = (pct*100)+'%';
  document.getElementById('scrubber-thumb').style.left = (pct*100)+'%';
  document.getElementById('scrubber-time').textContent = `${fmtMin(STATE.simT)} / ${fmtMin(total)}`;
}

/* ============================================================
   EVENT LOG
   ============================================================ */
function rebuildLog(){
  const sub = currentSub();
  const evs = [];
  for (const p of sub.path) {
    const n = NODE_BY_ID[p.nodeId];
    if (!n) continue;
    if (p.t > STATE.simT) break;
    if (n.type === 'start') {
      evs.push({t:p.t, tag:'START', cls:'start', text:`${BRANDING.copy.startEventLabel} Â· ${sub.engagement}`});
    } else if (n.type === 'end' || n.type === 'endTerminate') {
      if (p.t <= STATE.simT) evs.push({t:p.t, tag: n.type==='endTerminate'?'STOP':'END', cls: n.type==='endTerminate'?'alert':'end', text: n.label.replace('\n',' ')});
    } else if (n.type.startsWith('gateway')) {
      if (p.t <= STATE.simT) {
        const out = FLOWS.filter(f=>f.from===n.id);
        const taken = out.find(f=> sub.path.some(pp=>pp.nodeId===f.to && pp.t === p.t));
        const lbl = (n.label||'Gateway').replace('\n',' ');
        const tgtLabel = taken ? (taken.label || NODE_BY_ID[taken.to].label.replace('\n',' ')) : '?';
        evs.push({t:p.t, tag:'GW', cls:'gw', text: `${lbl} â†’ ${tgtLabel}`});
      }
    } else {
      evs.push({t:p.t, tag:'STRT', cls:'start', text: n.label.replace('\n',' ')});
      const endT = p.t + p.dur;
      if (endT <= STATE.simT) {
        const slaBreach = n.sla && p.dur > n.sla;
        evs.push({t:endT, tag: slaBreach?'SLA!':'DONE', cls: slaBreach?'alert':'end', text: `${n.label.replace('\n',' ')} (${fmtMin(p.dur)})`});
      } else {
        const elapsed = STATE.simT - p.t;
        if (n.sla && elapsed > n.sla) {
          evs.push({t:p.t + n.sla, tag:'SLA!', cls:'alert', text: `${n.label.replace('\n',' ')} past SLA`});
        }
      }
    }
  }
  evs.sort((a,b)=>b.t - a.t);
  const log = document.getElementById('event-log');
  log.innerHTML = '';
  for (const e of evs.slice(0, 40)) {
    const div = document.createElement('div');
    div.className = `ev-row ${e.cls}`;
    div.innerHTML = `<span class="t">${fmtMin(e.t)}</span><span class="tag">${e.tag}</span><span>${e.text}</span>`;
    log.appendChild(div);
  }
}

/* ============================================================
   SIDEBAR
   ============================================================ */
function renderSubList(){
  const list = document.getElementById('sub-list');
  list.innerHTML = '';
  SUBMISSIONS.forEach((sub, i) => {
    const card = document.createElement('div');
    card.className = 'sub-card' + (i===STATE.selected ? ' selected' : '');
    const total = maxT(sub);
    const pct = Math.min(100, Math.round((Math.min(sub.pauseAt, total) / total) * 100));
    const barColor = sub.status==='disputed'?'#f87171':sub.status==='completed'?'#4ade80':sub.status==='stuck'?'#fbbf24':'#7dd3fc';
    card.innerHTML = `
      <div class="row">
        <div class="name">${sub.name}</div>
        <span class="chip ${sub.status}">${sub.status.replace('-',' ')}</span>
      </div>
      <div class="meta">${sub.engagement} Â· ${sub.fees} Â· ${sub.partner}</div>
      <div class="micro-bar"><div style="width:${pct}%; background: ${barColor};"></div></div>
    `;
    card.addEventListener('click', () => selectSubmission(i));
    list.appendChild(card);
  });
  const sel = document.getElementById('sub-select');
  sel.innerHTML = SUBMISSIONS.map((s,i)=>`<option value="${i}" ${i===STATE.selected?'selected':''}>${s.name}</option>`).join('');
  document.getElementById('sample-list-count').textContent =
    `${SUBMISSIONS.length} ${BRANDING.copy.sampleListUnit}`;
}

function selectSubmission(i, opts={}){
  STATE.selected = i;
  if (opts.fromBeginning) {
    STATE.simT = 0;
    setPlaying(true);
  } else {
    STATE.simT = Math.min(SUBMISSIONS[i].pauseAt, maxT(SUBMISSIONS[i]));
    setPlaying(false);
  }
  STATE.selectedNode = null;
  renderDetail();
  renderSubList();
  updateNodeVisuals();
  updateScrubber();
  rebuildLog();
}

/* ============================================================
   DETAIL PANEL
   ============================================================ */
function renderDetail(){
  const panel = document.getElementById('detail-panel');
  const src = document.getElementById('detail-source');
  const sub = currentSub();
  if (!STATE.selectedNode) {
    src.textContent = sub.name;
    panel.innerHTML = `
      <h3>${sub.name}</h3>
      <div style="color:#6e7895; font-size:11.5px; margin-bottom:10px;">${sub.summary}</div>
      <div class="kv-grid">
        <div class="k">Client</div><div class="v">${sub.client}</div>
        <div class="k">Engagement</div><div class="v">${sub.engagement}</div>
        <div class="k">Fees</div><div class="v">${sub.fees}</div>
        <div class="k">Partner</div><div class="v">${sub.partner}</div>
        <div class="k">Office</div><div class="v">${sub.office}</div>
        <div class="k">Cycle time</div><div class="v">${fmtMin(STATE.simT)}</div>
        <div class="k">Total est.</div><div class="v">${fmtMin(maxT(sub))}</div>
      </div>
    `;
    return;
  }
  const n = NODE_BY_ID[STATE.selectedNode];
  if (!n) return;
  const st = nodeStateAt(n.id, STATE.simT, sub);
  const lane = LANES.find(l=>l.id===n.lane);
  src.textContent = (n.label||n.id).replace('\n',' ');
  let stateChip = '<span class="chip">PENDING</span>';
  if (st.state==='active') stateChip = `<span class="chip in-progress">ACTIVE Â· ${fmtMin(st.elapsed)}</span>`;
  else if (st.state==='warn') stateChip = `<span class="chip stuck">NEAR SLA Â· ${fmtMin(st.elapsed)}</span>`;
  else if (st.state==='breach') stateChip = `<span class="chip disputed">SLA BREACH Â· ${fmtMin(st.elapsed)}</span>`;
  else if (st.state==='complete') stateChip = `<span class="chip completed">COMPLETE Â· ${fmtMin(st.entry?st.entry.dur:0)}</span>`;
  const slaRow = n.sla ? `
    <div class="kv-grid">
      <div class="k">Avg duration</div><div class="v">${fmtMin(n.avg)}</div>
      <div class="k">SLA target</div><div class="v">${fmtMin(n.sla)}</div>
      ${st.visited && st.entry ? `<div class="k">Actual</div><div class="v">${fmtMin(st.elapsed != null ? st.elapsed : st.entry.dur)}</div>` : ''}
    </div>` : '';
  panel.innerHTML = `
    <span class="lane-pill" style="background: ${lane.accent}33; color: ${lane.accent};">${lane.name}</span>
    <h3>${(n.label||n.id).replace('\n',' ')}</h3>
    <div style="margin-bottom:8px;">${stateChip}</div>
    <div style="color:#6e7895; font-size:11.5px; margin-bottom:10px;">${n.desc||'BPMN '+n.type}</div>
    ${slaRow}
  `;
}

/* ============================================================
   PAN / ZOOM
   ============================================================ */
const tip = document.getElementById('tip');
const wrap = document.getElementById('canvas-wrap');
let dragging = false, lastX=0, lastY=0, dragMoved = false;

function getCanvasAspect(){
  const cw = wrap.clientWidth || 1200;
  const ch = wrap.clientHeight || 700;
  return cw / ch;
}
function getBaseVbH(){
  const aspect = getCanvasAspect();
  return Math.max(SVG_H, SVG_W / aspect);
}

function applyView(){
  const aspect = getCanvasAspect();
  const baseVbH = getBaseVbH();
  const vbH = baseVbH / STATE.zoom;
  const vbW = vbH * aspect;
  const cx = SVG_W/2 + STATE.panX;
  const cy = SVG_H/2 + STATE.panY;
  svg.setAttribute('viewBox', `${cx - vbW/2} ${cy - vbH/2} ${vbW} ${vbH}`);
  STATE._vbW = vbW;
  STATE._vbH = vbH;
}

function setDefaultView(){
  const aspect = getCanvasAspect();
  const baseVbH = getBaseVbH();
  STATE.zoom = baseVbH / SVG_H;
  STATE.panY = 0;
  const vbW = SVG_H * aspect;
  STATE.panX = vbW/2 - SVG_W/2;
  applyView();
}

function setFitAllView(){
  STATE.zoom = 1; STATE.panX = 0; STATE.panY = 0;
  applyView();
}

svg.addEventListener('mousedown', (e) => {
  if (e.target.closest('.node')) return;
  dragging = true; dragMoved = false; lastX = e.clientX; lastY = e.clientY;
  svg.classList.add('dragging');
});
window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved = true;
  const scale = STATE._vbW / svg.clientWidth;
  STATE.panX -= dx * scale;
  STATE.panY -= dy * scale;
  lastX = e.clientX; lastY = e.clientY;
  applyView();
});
window.addEventListener('mouseup', () => { dragging=false; svg.classList.remove('dragging'); });

svg.addEventListener('wheel', (e) => {
  e.preventDefault();
  const factor = e.deltaY > 0 ? 0.9 : 1.1;
  STATE.zoom = Math.min(8, Math.max(0.4, STATE.zoom * factor));
  applyView();
}, {passive:false});

svg.addEventListener('mouseover', (e) => {
  const g = e.target.closest('.node');
  if (!g) { tip.classList.remove('show'); return; }
  const id = g.getAttribute('data-node');
  const n = NODE_BY_ID[id]; if (!n) return;
  const sub = currentSub();
  const st = nodeStateAt(id, STATE.simT, sub);
  const lane = LANES.find(l=>l.id===n.lane);
  let html = `<div class="h-title">${(n.label||n.id).replace('\n',' ')}</div>`;
  html += `<div class="h-row"><span>Lane</span><span class="v" style="color:${lane.accent}">${lane.name}</span></div>`;
  html += `<div class="h-row"><span>Type</span><span class="v">${n.type}</span></div>`;
  if (n.sla) {
    html += `<div class="h-sla"></div>`;
    html += `<div class="h-row"><span>State</span><span class="v">${st.state}</span></div>`;
    html += `<div class="h-row"><span>Avg / SLA</span><span class="v">${fmtMin(n.avg)} / ${fmtMin(n.sla)}</span></div>`;
    if (st.entry) {
      const actual = st.elapsed != null ? st.elapsed : st.entry.dur;
      html += `<div class="h-row"><span>${st.state==='complete'?'Took':'Elapsed'}</span><span class="v">${fmtMin(actual)}</span></div>`;
    }
  }
  if (n.desc) html += `<div style="margin-top:6px; padding-top:6px; border-top:1px solid rgba(80,100,140,0.2); color:#aab4c8; font-size:10.5px;">${n.desc}</div>`;
  html += `<div style="margin-top:6px; color:#3d4660; font-size:10px;">Click to select Â· double-click to zoom in</div>`;
  tip.innerHTML = html;
  tip.classList.add('show');
});
svg.addEventListener('mousemove', (e) => {
  if (!tip.classList.contains('show')) return;
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + 300 > window.innerWidth) x = e.clientX - 300;
  if (y + 200 > window.innerHeight) y = e.clientY - 200;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
});
svg.addEventListener('mouseout', (e) => {
  if (!e.target.closest('.node')) tip.classList.remove('show');
});
svg.addEventListener('click', (e) => {
  if (dragMoved) return;
  const g = e.target.closest('.node');
  if (g) {
    STATE.selectedNode = g.getAttribute('data-node');
    renderDetail();
  } else {
    STATE.selectedNode = null;
    renderDetail();
    setPlaying(!STATE.playing);
  }
});
svg.addEventListener('dblclick', (e) => {
  const g = e.target.closest('.node');
  if (g) {
    STATE.selectedNode = g.getAttribute('data-node');
    const n = NODE_BY_ID[STATE.selectedNode];
    const {x,y} = nodeXY(n);
    STATE.panX = x - SVG_W/2;
    STATE.panY = y - SVG_H/2;
    STATE.zoom = Math.max(STATE.zoom, 3);
    applyView();
    renderDetail();
  }
});

/* ============================================================
   MINIMAP NAVIGATION
   ============================================================ */
const miniWrap = document.querySelector('.minimap-svg-wrap');
let miniDrag = false;
function miniNav(e) {
  const rect = miniSvg.getBoundingClientRect();
  const xPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const yPct = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
  const tx = xPct * SVG_W;
  const ty = yPct * SVG_H;
  STATE.panX = tx - SVG_W/2;
  STATE.panY = ty - SVG_H/2;
  applyView();
}
miniWrap.addEventListener('mousedown', (e) => {
  miniDrag = true; miniNav(e);
  e.stopPropagation(); e.preventDefault();
});
window.addEventListener('mousemove', (e) => { if (miniDrag) miniNav(e); });
window.addEventListener('mouseup', () => { miniDrag = false; });

/* ============================================================
   PLAYBACK
   ============================================================ */
function speedLabel(s){ return s === 1 ? '1Ã— speed (slow-mo)' : `${s}Ã— speed`; }
function setPlaying(p){
  STATE.playing = p;
  const btn = document.getElementById('btn-play');
  btn.textContent = p ? 'âšâš' : 'â–¶';
  btn.classList.toggle('active', p);
  STATE.lastTick = performance.now();
  const hint = document.getElementById('play-hint');
  const hintText = document.getElementById('play-hint-text');
  hintText.textContent = p ? `Live Â· ${STATE.speed === 1 ? 'slow-mo' : STATE.speed+'Ã—'} Â· click canvas or press Space to pause` : 'Paused Â· click canvas or press Space to resume';
  hint.classList.remove('fade');
  clearTimeout(setPlaying._t);
  setPlaying._t = setTimeout(()=>hint.classList.add('fade'), 2500);
}
document.getElementById('btn-play').addEventListener('click', ()=>setPlaying(!STATE.playing));
document.getElementById('btn-restart').addEventListener('click', ()=>{
  STATE.simT = 0; setPlaying(true);
});
document.getElementById('btn-end').addEventListener('click', ()=>{
  STATE.simT = Math.min(currentSub().pauseAt, maxT(currentSub()));
  setPlaying(false);
});
document.getElementById('speed-pill').addEventListener('click', ()=>{
  const speeds = [1,4,16,64];
  const idx = (speeds.indexOf(STATE.speed) + 1) % speeds.length;
  STATE.speed = speeds[idx];
  document.getElementById('speed-pill').textContent = speedLabel(STATE.speed);
  if (STATE.playing) setPlaying(true);
});
document.getElementById('speed-pill').textContent = speedLabel(STATE.speed);

const scrubber = document.getElementById('scrubber');
scrubber.addEventListener('click', (e)=>{
  const rect = scrubber.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  STATE.simT = Math.max(0, Math.min(1, pct)) * maxT(currentSub());
});

function setupToggle(id, key){
  const b = document.getElementById(id);
  b.addEventListener('click', ()=>{
    STATE[key] = !STATE[key];
    b.classList.toggle('active', STATE[key]);
    if (key === 'showStars') document.getElementById('starfield').style.display = STATE[key]?'block':'none';
  });
}
setupToggle('t-heat','showHeat');
setupToggle('t-metrics','showMetrics');
setupToggle('t-labels','showLabels');
setupToggle('t-stars','showStars');

document.getElementById('z-in').addEventListener('click', ()=>{ STATE.zoom = Math.min(8, STATE.zoom*1.2); applyView(); });
document.getElementById('z-out').addEventListener('click', ()=>{ STATE.zoom = Math.max(0.4, STATE.zoom/1.2); applyView(); });
document.getElementById('z-fit').addEventListener('click', setFitAllView);
document.getElementById('btn-reset').addEventListener('click', ()=>{
  setDefaultView();
  selectSubmission(0, {fromBeginning:true});
});

const helpModal = document.getElementById('help-modal');
document.getElementById('btn-help').addEventListener('click', ()=>helpModal.classList.add('show'));
helpModal.addEventListener('click', (e)=>{
  if(e.target===helpModal) helpModal.classList.remove('show');
  if(e.target.id==='help-close') helpModal.classList.remove('show');
});

document.getElementById('sub-select').addEventListener('change', (e)=>{
  selectSubmission(parseInt(e.target.value));
});

window.addEventListener('keydown', (e)=>{
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === ' ') { e.preventDefault(); setPlaying(!STATE.playing); }
  else if (e.key === '+' || e.key === '=' || (e.shiftKey && e.key === 'ArrowUp')) { STATE.zoom = Math.min(8, STATE.zoom*1.15); applyView(); }
  else if (e.key === '-' || e.key === '_' || (e.shiftKey && e.key === 'ArrowDown')) { STATE.zoom = Math.max(0.4, STATE.zoom/1.15); applyView(); }
  else if (e.key === '0') { setDefaultView(); }
  else if (e.key === 'f' || e.key === 'F') { setFitAllView(); }
  else if (e.key === '?' || e.key === '/') { helpModal.classList.toggle('show'); }
  else if (e.key === 'Escape') { helpModal.classList.remove('show'); STATE.selectedNode = null; renderDetail(); }
  else if (e.key === 'r' || e.key === 'R') { STATE.simT = 0; setPlaying(true); }
  else if (e.key === 'e' || e.key === 'E') { STATE.simT = Math.min(currentSub().pauseAt, maxT(currentSub())); setPlaying(false); }
});

window.addEventListener('resize', () => {
  setupStars();
  applyView();
});

/* ============================================================
   STARFIELD
   ============================================================ */
const sCanvas = document.getElementById('starfield');
function setupStars(){
  sCanvas.width = wrap.clientWidth;
  sCanvas.height = wrap.clientHeight;
  const ctx = sCanvas.getContext('2d');
  ctx.clearRect(0,0,sCanvas.width,sCanvas.height);
  for (let i=0;i<140;i++){
    const x = Math.random()*sCanvas.width;
    const y = Math.random()*sCanvas.height;
    const r = Math.random()*1.2 + 0.2;
    const a = Math.random()*0.6 + 0.2;
    ctx.fillStyle = `rgba(180,200,240,${a})`;
    ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
  }
}

/* ============================================================
   MAIN LOOP
   ============================================================ */
function tick(now){
  const dt = (now - STATE.lastTick) / 1000;
  STATE.lastTick = now;
  if (STATE.playing) {
    STATE.simT += dt * STATE.speed * SIM_RATE;
    const cap = maxT(currentSub());
    if (STATE.simT >= cap) { STATE.simT = cap; setPlaying(false); }
  }
  updateNodeVisuals();
  renderMinimap();
  updateScrubber();
  if (Math.floor(now/250) !== tick._last) {
    tick._last = Math.floor(now/250);
    rebuildLog();
    if (STATE.selectedNode) renderDetail();
    document.getElementById('hdr-clock').textContent = new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    document.getElementById('portfolio-clock').textContent = `T+${fmtMin(STATE.simT)}`;
  }
  requestAnimationFrame(tick);
}

/* ============================================================
   INIT
   ============================================================ */
renderSubList();
STATE.selected = 0;
STATE.simT = 0;
renderDetail();
rebuildLog();
requestAnimationFrame(() => {
  setDefaultView();
  setupStars();
  setPlaying(true);
  requestAnimationFrame(tick);
});
