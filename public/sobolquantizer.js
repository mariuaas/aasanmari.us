const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_LUMA_BITS = 8;
const MAX_CHROMA_BITS = 8;
const SOBOL_SEED = 3385;

// ── Sobol engine (2D, Owen-scrambled) ───────────────────────────

function makeSobolEngine2D(seed) {
    const BITS = 32;

    const dirs0 = new Uint32Array(BITS);
    for (let i = 0; i < BITS; i++) dirs0[i] = 1 << (BITS - 1 - i);

    // Dimension 1: primitive polynomial x+1
    const dirs1 = new Uint32Array(BITS);
    dirs1[0] = 1 << (BITS - 1);
    for (let i = 1; i < BITS; i++) {
        dirs1[i] = dirs1[i - 1] ^ (dirs1[i - 1] >>> 1);
    }

    function hashSeed(s, dim) {
        let h = (s ^ 0xdeadbeef) + dim * 0x9e3779b9;
        h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
        h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
        return h ^ (h >>> 16);
    }

    function scramble(val, dim) {
        let result = 0;
        for (let bit = BITS - 1; bit >= 0; bit--) {
            const inputBit = (val >>> bit) & 1;
            const rng = hashSeed(seed * 131 + dim * 997 + bit * 31, bit);
            const flipBit = (rng >>> (bit & 31)) & 1;
            result |= ((inputBit ^ flipBit) << bit);
        }
        return result;
    }

    return {
        draw(n) {
            const out = new Float64Array(n * 2);
            let gray0 = 0, gray1 = 0;
            const norm = 2 ** -BITS;
            for (let i = 0; i < n; i++) {
                out[i * 2] = (scramble(gray0, 0) >>> 0) * norm;
                out[i * 2 + 1] = (scramble(gray1, 1) >>> 0) * norm;
                const c = ctz(i + 1);
                gray0 ^= dirs0[c];
                gray1 ^= dirs1[c];
            }
            return out;
        }
    };
}

function ctz(x) {
    if (x === 0) return 32;
    let n = 0;
    while ((x & 1) === 0) { x >>>= 1; n++; }
    return n;
}

// ── Chroma palette generation ───────────────────────────────────

const RAT = 2;
const SINH_SCALE = Math.SQRT2 / 2 / Math.sinh(RAT);
const COS45 = Math.cos(Math.PI / 4);
const SIN45 = Math.sin(Math.PI / 4);

const ANCHORS = [
    [0.5, 0.5],
    [0.0, 0.0],
    [0.0, 1.0],
    [1.0, 0.0],
    [1.0, 1.0],
];

function generateFullSobolPalette(maxBits) {
    const n = 1 << maxBits;
    const sobol = makeSobolEngine2D(SOBOL_SEED);
    const raw = sobol.draw(n);

    // Snap nearest Sobol points to anchors (greedy), then swap into first positions
    const claimed = new Uint8Array(n);
    const anchorIndices = new Array(ANCHORS.length);
    for (let a = 0; a < ANCHORS.length; a++) {
        const [ax, ay] = ANCHORS[a];
        let bestIdx = -1, bestDist = Infinity;
        for (let i = 0; i < n; i++) {
            if (claimed[i]) continue;
            const dx = raw[i * 2] - ax;
            const dy = raw[i * 2 + 1] - ay;
            const d = dx * dx + dy * dy;
            if (d < bestDist) { bestDist = d; bestIdx = i; }
        }
        raw[bestIdx * 2] = ax;
        raw[bestIdx * 2 + 1] = ay;
        claimed[bestIdx] = 1;
        anchorIndices[a] = bestIdx;
    }
    // Swap anchors into positions [0..4]
    for (let a = 0; a < ANCHORS.length; a++) {
        const src = anchorIndices[a];
        if (src === a) continue;
        // Swap raw values
        const tmpX = raw[a * 2], tmpY = raw[a * 2 + 1];
        raw[a * 2] = raw[src * 2];
        raw[a * 2 + 1] = raw[src * 2 + 1];
        raw[src * 2] = tmpX;
        raw[src * 2 + 1] = tmpY;
        // Update any later anchor that was pointing at position a
        for (let b = a + 1; b < ANCHORS.length; b++) {
            if (anchorIndices[b] === a) anchorIndices[b] = src;
        }
    }

    // Warp + rotate
    const co = new Float64Array(n);
    const cg = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const sx = SINH_SCALE * Math.sinh(RAT * (2 * raw[i * 2] - 1));
        const sy = SINH_SCALE * Math.sinh(RAT * (2 * raw[i * 2 + 1] - 1));
        co[i] = COS45 * sx - SIN45 * sy;
        cg[i] = SIN45 * sx + COS45 * sy;
    }

    return { co, cg, n };
}

// ── YCoCg conversion ────────────────────────────────────────────

function ycocgToRgb(Y, co, cg) {
    const r = Y - cg / 2 + co / 2;
    const g = Y + cg / 2;
    const b = Y - cg / 2 - co / 2;
    return [
        Math.round(Math.max(0, Math.min(1, r)) * 255),
        Math.round(Math.max(0, Math.min(1, g)) * 255),
        Math.round(Math.max(0, Math.min(1, b)) * 255),
    ];
}

// ── Luminance binary tree ───────────────────────────────────────

function lphi(L) { return Math.log1p(L); }
function lphiInv(y) { return Math.expm1(y); }

function luminanceBinaryTree(maxBits) {
    const palette = new Set([0, 255]);
    const insertionIdx = new Map([[0, 0], [255, 1]]);

    const heap = [];
    const push = (item) => {
        heap.push(item);
        let i = heap.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (heap[p][0] <= heap[i][0]) break;
            [heap[p], heap[i]] = [heap[i], heap[p]];
            i = p;
        }
    };
    const pop = () => {
        const top = heap[0];
        const last = heap.pop();
        if (heap.length > 0) {
            heap[0] = last;
            let i = 0;
            while (true) {
                let s = i;
                const l = 2 * i + 1, r = 2 * i + 2;
                if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
                if (r < heap.length && heap[r][0] < heap[s][0]) s = r;
                if (s === i) break;
                [heap[i], heap[s]] = [heap[s], heap[i]];
                i = s;
            }
        }
        return top;
    };

    push([-(lphi(255) - lphi(0)), 0, 255]);

    while (palette.size < (1 << maxBits)) {
        const [, a, b] = pop();
        let L = Math.round(lphiInv((lphi(a) + lphi(b)) / 2));
        L = Math.max(a + 1, Math.min(b - 1, L));
        if (palette.has(L)) continue;
        insertionIdx.set(L, palette.size);
        palette.add(L);
        push([-(lphi(L) - lphi(a)), a, L]);
        push([-(lphi(b) - lphi(L)), L, b]);
    }

    const sorted = [...palette].sort((a, b) => a - b);
    const result = {};
    for (let bits = 1; bits <= maxBits; bits++) {
        const n = 1 << bits;
        result[bits] = sorted
            .filter((v) => insertionIdx.get(v) < n)
            .map((v) => v / 255);
    }
    return result;
}

// ── DOM helpers ─────────────────────────────────────────────────

function svgEl(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
}

function dom(tag, styles = {}, attrs = {}) {
    const el = document.createElement(tag);
    Object.assign(el.style, styles);
    for (const [k, v] of Object.entries(attrs)) el[k] = v;
    return el;
}

function diamondPath(radius, cx, cy, scale) {
    const r = radius * scale;
    return `M ${cx + r} ${cy} L ${cx} ${cy - r} L ${cx - r} ${cy} L ${cx} ${cy + r} Z`;
}

function syncPool(parent, pool, count, create) {
    while (pool.length < count) {
        const el = create();
        parent.appendChild(el);
        pool.push(el);
    }
    while (pool.length > count) parent.removeChild(pool.pop());
}

// ── Visualizer ──────────────────────────────────────────────────

export function mount(container) {
    let chromaBits = 4;
    let lumaBits = 6;
    let lumaIdx = 51;
    let hoveredPoint = null;

    const lumaTrees = luminanceBinaryTree(MAX_LUMA_BITS);
    const sobolPalette = generateFullSobolPalette(MAX_CHROMA_BITS);

    const SVG_SIZE = 500;
    const PADDING = 40;
    const PLOT_SIZE = SVG_SIZE - 2 * PADDING;
    const CX = SVG_SIZE / 2;
    const CY = SVG_SIZE / 2;
    const SCALE = PLOT_SIZE / 2;
    const theme = {
        fg: 'var(--fg)',
        muted: 'var(--muted)',
        muted2: 'var(--muted-2)',
        border: 'var(--border)',
        panel: 'var(--panel)',
        panelHover: 'var(--panel-hover)',
        surface: 'color-mix(in srgb, var(--panel) 72%, transparent)',
        plot: 'color-mix(in srgb, var(--panel) 92%, transparent)',
        axis: 'color-mix(in srgb, var(--fg) 16%, transparent)',
        diamond: 'color-mix(in srgb, var(--fg) 26%, transparent)',
        diamondStrong: 'color-mix(in srgb, var(--fg) 48%, transparent)',
        shadow: '0 18px 40px color-mix(in srgb, var(--fg) 8%, transparent)',
        swatchBorder: 'color-mix(in srgb, var(--fg) 8%, transparent)',
        pointStroke: 'color-mix(in srgb, var(--fg) 22%, transparent)',
    };

    container.innerHTML = '';
    Object.assign(container.style, {
        width: '100%',
        color: theme.fg,
        margin: '1.5rem 0',
    });

    const frame = dom('section', {
        width: '100%',
        border: `1px solid ${theme.border}`,
        borderRadius: '1rem',
        background: theme.surface,
        boxShadow: theme.shadow,
        padding: '1.25rem',
    });
    container.appendChild(frame);

    const intro = dom('div', { marginBottom: '1.25rem' });
    frame.appendChild(intro);

    const eyebrow = dom('div', {
        fontSize: '0.7rem',
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        color: theme.muted2,
        marginBottom: '0.4rem',
    });
    eyebrow.textContent = 'Interactive Figure';
    intro.appendChild(eyebrow);

    const title = dom('h1', {
        fontSize: '1.2rem',
        fontWeight: '400',
        lineHeight: '1.2',
        letterSpacing: '-0.02em',
        color: theme.fg,
        marginBottom: '0.5rem',
    });
    title.textContent = 'YCoCg Chroma Palette — Sobol Quasi-Random';
    intro.appendChild(title);

    const description = dom('p', {
        margin: '0',
        maxWidth: '62ch',
        color: theme.muted,
        fontSize: '0.95rem',
        lineHeight: '1.65',
    });
    description.textContent = 'Explore a Sobol-based chroma layout under changing luminance and bit-budget constraints while keeping the figure aligned with the site theme.';
    intro.appendChild(description);

    const layout = dom('div', {
        width: '100%',
        display: 'flex',
        gap: '2rem',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
    });
    frame.appendChild(layout);

    // ── Left column ──

    const leftCol = dom('div', {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        flex: '1 1 30rem',
        minWidth: 'min(100%, 18rem)',
        gap: '0.85rem',
    });
    layout.appendChild(leftCol);

    const svgRoot = svgEl('svg', {
        viewBox: `0 0 ${SVG_SIZE} ${SVG_SIZE}`,
        style: `display:block; width:100%; height:auto; max-width:${SVG_SIZE}px; margin:0 auto; background:${theme.plot}; border-radius:0.85rem; border:1px solid ${theme.border}`,
    });
    leftCol.appendChild(svgRoot);

    svgRoot.appendChild(svgEl('line', {
        x1: CX, y1: PADDING, x2: CX, y2: SVG_SIZE - PADDING,
        stroke: theme.axis, 'stroke-width': '1',
    }));
    svgRoot.appendChild(svgEl('line', {
        x1: PADDING, y1: CY, x2: SVG_SIZE - PADDING, y2: CY,
        stroke: theme.axis, 'stroke-width': '1',
    }));

    svgRoot.appendChild(svgEl('path', {
        d: diamondPath(1.0, CX, CY, SCALE),
        fill: 'none', stroke: theme.diamond, 'stroke-width': '1', opacity: '0.4',
    }));

    const maxDiamond = svgEl('path', {
        fill: 'none', stroke: theme.diamondStrong, 'stroke-width': '1.5', opacity: '0.7',
    });
    svgRoot.appendChild(maxDiamond);

    const circleGroup = svgEl('g');
    svgRoot.appendChild(circleGroup);

    for (const a of [
        { text: '+Cg', x: CX + 4, y: PADDING + 12 },
        { text: '−Cg', x: CX + 4, y: SVG_SIZE - PADDING - 4 },
        { text: '+Co', x: SVG_SIZE - PADDING - 20, y: CY - 4 },
        { text: '−Co', x: PADDING + 2, y: CY - 4 },
    ]) {
        const t = svgEl('text', { x: a.x, y: a.y, fill: theme.muted2, 'font-size': '10' });
        t.textContent = a.text;
        svgRoot.appendChild(t);
    }

    const tooltip = dom('div', {
        fontSize: '11px',
        color: theme.muted,
        fontVariantNumeric: 'tabular-nums',
        minHeight: '1.2em',
        textAlign: 'center',
    });
    leftCol.appendChild(tooltip);

    // ── Right column ──

    const rightCol = dom('div', {
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        flex: '0 1 18rem',
        minWidth: 'min(100%, 16rem)',
    });
    layout.appendChild(rightCol);

    function makeSlider(labelText, min, max, value, accent) {
        const wrap = dom('div');
        const label = dom('label', {
            fontSize: '10px', letterSpacing: '2px',
            textTransform: 'uppercase', color: theme.muted2,
        });
        label.textContent = labelText;
        wrap.appendChild(label);

        const input = dom('input', {
            width: '100%', marginTop: '8px', accentColor: accent,
        }, {
            type: 'range', min: String(min), max: String(max),
            step: '1', value: String(value),
        });
        wrap.appendChild(input);

        const ticks = dom('div', {
            display: 'flex', justifyContent: 'space-between',
            fontSize: '9px', color: theme.muted2, marginTop: '2px',
        });
        const tL = dom('span'); tL.textContent = String(min);
        const tR = dom('span'); tR.textContent = String(max);
        ticks.appendChild(tL);
        ticks.appendChild(tR);
        wrap.appendChild(ticks);
        rightCol.appendChild(wrap);
        return { label, input };
    }

    const chromaSlider = makeSlider(
        `Chroma Bits — ${chromaBits}`, 1, MAX_CHROMA_BITS, chromaBits, '#ff8800'
    );
    const lumaSlider = makeSlider(
        `Luminance Bits — ${lumaBits}`, 1, MAX_LUMA_BITS, lumaBits, '#00ccaa'
    );

    const lumaLevelWrap = dom('div');
    const lumaLevelLabel = dom('label', {
        fontSize: '10px', letterSpacing: '2px',
        textTransform: 'uppercase', color: theme.muted2,
    });
    lumaLevelWrap.appendChild(lumaLevelLabel);

    const lumaLevelSwatch = dom('span', {
        display: 'inline-block', width: '10px', height: '10px',
        borderRadius: '2px', marginLeft: '6px', verticalAlign: 'middle',
        border: `1px solid ${theme.border}`,
    });

    const lumaLevelInput = dom('input', {
        width: '100%', marginTop: '8px', accentColor: '#00ccaa',
    }, { type: 'range', min: '0', step: '1' });
    lumaLevelWrap.appendChild(lumaLevelInput);

    const lumaLevelTicks = dom('div', {
        display: 'flex', justifyContent: 'space-between',
        fontSize: '9px', color: theme.muted2, marginTop: '2px',
    });
    const tB = dom('span'); tB.textContent = 'black';
    const tW = dom('span'); tW.textContent = 'white';
    lumaLevelTicks.appendChild(tB);
    lumaLevelTicks.appendChild(tW);
    lumaLevelWrap.appendChild(lumaLevelTicks);
    rightCol.appendChild(lumaLevelWrap);

    function panel() {
        return dom('div', {
            background: theme.panel, border: `1px solid ${theme.border}`,
            borderRadius: '0.85rem', padding: '1rem',
        });
    }

    const budgetPanel = panel();
    rightCol.appendChild(budgetPanel);

    const seqPanel = panel();
    rightCol.appendChild(seqPanel);

    const swatchSection = dom('div');
    const swatchTitle = dom('div', {
        fontSize: '10px', letterSpacing: '2px',
        textTransform: 'uppercase', color: theme.muted2, marginBottom: '8px',
    });
    swatchSection.appendChild(swatchTitle);

    const swatchGrid = dom('div', {
        display: 'flex', flexWrap: 'wrap', gap: '2px', maxWidth: '240px',
    });
    swatchSection.appendChild(swatchGrid);
    rightCol.appendChild(swatchSection);

    const circles = [];
    const swatches = [];

    // ── Render ──

    function render() {
        const lumaLevels = lumaTrees[lumaBits];
        const clampedIdx = Math.min(lumaIdx, lumaLevels.length - 1);
        const activeLuma = lumaLevels[clampedIdx];
        const maxRadius = 2 * Math.min(activeLuma, 1 - activeLuma);
        const chromaCount = 1 << chromaBits;
        const totalColors = lumaLevels.length * chromaCount;

        chromaSlider.label.textContent = `Chroma Bits — ${chromaBits}`;
        lumaSlider.label.textContent = `Luminance Bits — ${lumaBits}`;

        lumaLevelInput.max = String(lumaLevels.length - 1);
        lumaLevelInput.value = String(clampedIdx);

        const lumaGray = Math.round(activeLuma * 255);
        lumaLevelLabel.textContent = '';
        lumaLevelLabel.appendChild(document.createTextNode(
            `Luminance Level — ${clampedIdx + 1} / ${lumaLevels.length}  `
        ));
        const ySpan = dom('span', { marginLeft: '8px', color: '#aaa' });
        ySpan.textContent = `Y = ${activeLuma.toFixed(3)}`;
        lumaLevelLabel.appendChild(ySpan);
        lumaLevelSwatch.style.background = `rgb(${lumaGray},${lumaGray},${lumaGray})`;
        lumaLevelLabel.appendChild(lumaLevelSwatch);

        maxDiamond.setAttribute('d', diamondPath(maxRadius, CX, CY, SCALE));

        const ptR = Math.max(2.5, Math.min(5, 120 / Math.sqrt(chromaCount)));
        syncPool(circleGroup, circles, chromaCount, () => {
            return svgEl('circle', { style: 'cursor:crosshair; transition:r 0.1s' });
        });
        for (let i = 0; i < chromaCount; i++) {
            const sCo = sobolPalette.co[i] * maxRadius;
            const sCg = sobolPalette.cg[i] * maxRadius;
            const [r, g, b] = ycocgToRgb(activeLuma, sCo, sCg);
            const c = circles[i];
            c.setAttribute('cx', CX + sCo * SCALE);
            c.setAttribute('cy', CY - sCg * SCALE);
            c.setAttribute('r', ptR);
            c.setAttribute('fill', `rgb(${r},${g},${b})`);
            c.setAttribute('stroke', theme.pointStroke);
            c.setAttribute('stroke-width', '0.5');
        }

        budgetPanel.innerHTML = `
            <div style="font-size:10px; letter-spacing:2px; text-transform:uppercase; color:${theme.muted2}; margin-bottom:12px">Budget</div>
            <div style="font-size:11px; color:${theme.muted}; line-height:1.8; font-variant-numeric:tabular-nums">
                <div>Luma: <span style="color:#00ccaa">${lumaLevels.length}</span> levels (${lumaBits}b)</div>
                <div>Chroma: <span style="color:#ff8800">${chromaCount}</span> entries (${chromaBits}b)</div>
                <div style="margin-top:4px; padding-top:4px; border-top:1px solid ${theme.border}">
                    Total palette: <span style="color:${theme.fg}">${totalColors.toLocaleString()}</span> colors
                </div>
                <div>Per pixel: <span style="color:${theme.fg}">${lumaBits + chromaBits}</span> bits</div>
                <div>Y = ${activeLuma.toFixed(3)} → |Co|+|Cg| ≤ ${maxRadius.toFixed(3)}</div>
            </div>`;

        let maxNorm = 0, sumNorm = 0;
        for (let i = 0; i < chromaCount; i++) {
            const norm = Math.abs(sobolPalette.co[i]) + Math.abs(sobolPalette.cg[i]);
            if (norm > maxNorm) maxNorm = norm;
            sumNorm += norm;
        }
        seqPanel.innerHTML = `
            <div style="font-size:10px; letter-spacing:2px; text-transform:uppercase; color:${theme.muted2}; margin-bottom:12px">Sobol Sequence</div>
            <div style="font-size:11px; color:${theme.muted}; line-height:1.8; font-variant-numeric:tabular-nums">
                <div>Points: <span style="color:#ff8800">${chromaCount}</span> (prefix of ${sobolPalette.n})</div>
                <div>Seed: <span style="color:${theme.fg}">${SOBOL_SEED}</span></div>
                <div>Anchors: <span style="color:${theme.fg}">5</span> (origin + corners)</div>
                <div style="margin-top:4px; padding-top:4px; border-top:1px solid ${theme.border}">
                    Max ‖·‖₁: <span style="color:${theme.fg}">${maxNorm.toFixed(3)}</span>
                </div>
                <div>Mean ‖·‖₁: <span style="color:${theme.fg}">${(sumNorm / chromaCount).toFixed(3)}</span></div>
            </div>`;

        swatchTitle.textContent = `Chroma at Y = ${activeLuma.toFixed(2)}`;
        const swatchSize = Math.max(4, Math.min(16, Math.floor(220 / Math.sqrt(chromaCount))));
        syncPool(swatchGrid, swatches, chromaCount, () => dom('div', { borderRadius: '1px' }));
        for (let i = 0; i < chromaCount; i++) {
            const sCo = sobolPalette.co[i] * maxRadius;
            const sCg = sobolPalette.cg[i] * maxRadius;
            const [r, g, b] = ycocgToRgb(activeLuma, sCo, sCg);
            const s = swatches[i];
            s.style.width = `${swatchSize}px`;
            s.style.height = `${swatchSize}px`;
            s.style.background = `rgb(${r},${g},${b})`;
            s.style.border = `1px solid ${theme.swatchBorder}`;
        }

        hoveredPoint = null;
        tooltip.textContent = '';
    }

    // ── Hover ──

    function setHover(idx) {
        const lumaLevels = lumaTrees[lumaBits];
        const clampedIdx = Math.min(lumaIdx, lumaLevels.length - 1);
        const activeLuma = lumaLevels[clampedIdx];
        const maxRadius = 2 * Math.min(activeLuma, 1 - activeLuma);
        const chromaCount = 1 << chromaBits;
        const ptR = Math.max(2.5, Math.min(5, 120 / Math.sqrt(chromaCount)));

        const prev = hoveredPoint;
        hoveredPoint = idx;

        if (prev !== null && prev < circles.length) {
            circles[prev].setAttribute('r', ptR);
            circles[prev].setAttribute('stroke', theme.pointStroke);
            circles[prev].setAttribute('stroke-width', '0.5');
        }
        if (prev !== null && prev < swatches.length) {
            swatches[prev].style.border = `1px solid ${theme.swatchBorder}`;
        }

        if (idx !== null && idx < chromaCount) {
            circles[idx].setAttribute('r', ptR + 2);
            circles[idx].setAttribute('stroke', theme.fg);
            circles[idx].setAttribute('stroke-width', '1.5');
            swatches[idx].style.border = `1px solid ${theme.fg}`;

            const sCo = sobolPalette.co[idx] * maxRadius;
            const sCg = sobolPalette.cg[idx] * maxRadius;
            const [r, g, b] = ycocgToRgb(activeLuma, sCo, sCg);
            tooltip.textContent = `Co: ${sCo.toFixed(3)}  Cg: ${sCg.toFixed(3)}  →  rgb(${r}, ${g}, ${b})`;
        } else {
            tooltip.textContent = '';
        }
    }

    // ── Events ──

    chromaSlider.input.addEventListener('input', (e) => {
        chromaBits = +e.target.value;
        render();
    });

    lumaSlider.input.addEventListener('input', (e) => {
        lumaBits = +e.target.value;
        const newLen = 1 << lumaBits;
        if (lumaIdx >= newLen) lumaIdx = newLen - 1;
        render();
    });

    lumaLevelInput.addEventListener('input', (e) => {
        lumaIdx = +e.target.value;
        render();
    });

    circleGroup.addEventListener('pointerenter', (e) => {
        if (e.target.tagName === 'circle') setHover(circles.indexOf(e.target));
    }, true);
    circleGroup.addEventListener('pointerleave', (e) => {
        if (e.target.tagName === 'circle') setHover(null);
    }, true);
    swatchGrid.addEventListener('pointerenter', (e) => {
        const idx = swatches.indexOf(e.target);
        if (idx !== -1) setHover(idx);
    }, true);
    swatchGrid.addEventListener('pointerleave', (e) => {
        if (swatches.indexOf(e.target) !== -1) setHover(null);
    }, true);

    render();

    return {
        destroy() {
            container.innerHTML = '';
            container.removeAttribute('style');
        },
    };
}