/*
 * Copy of Google's Chicago Bears easter egg, ported from Google's own (minified) code:
 *   - animation engine        module Fmb0ac / T8njDe   (classes Gfh, EXg, Sgh)
 *   - movement                module cMVxNb            (class uhh)
 *   - bear sprite renderer    module N0fzcf            (class ejh)
 *   - claw-trail renderer     module rAv22
 *   - buttons                 module BKZQWb            (class bR)
 *   - "Celebrated N times"    module VBjstb
 *   - ripple                  module pfdHGb
 *   - spotlight               module wf7j4c
 *   - share panel             modules Wct42 / uLYJpc / HPGtmd
 * All numbers come from the "chicago_bears" config Google sends with the results page.
 */
'use strict';

/* ======================================================================
 * Config (decoded from Google's config arrays)
 * ==================================================================== */

const DARK = matchMedia('(prefers-color-scheme: dark)').matches;
const ASSETS = 'assets/';

// Field 5: 1 in "chicago_bears_autoplay" (plays on page load), 0 in "chicago_bears_base".
const AUTOPLAY = true;

// Field 12: when the animation is closed early, the whole canvas fades out over this long.
const CLOSE_FADE_MS = 1000;

// Google shows the real worldwide count from its server. This copy starts from the
// count seen on Google's page and adds your own clicks (saved in this browser).
const BASE_COUNT = 12760000;

// Google only shows the spotlight to visitors who arrive from a shared easter-egg link.
// Set this to true to always show it.
const FORCE_SPOTLIGHT = false;

// Movement presets (config field 10 → field 2). Values are percentages of the screen,
// per second; y grows downward. [a] = fixed, [a, b] = random between a and b.
// "clamp" limits the value; "seeded" makes the bear and its claws share the same random x.
const MOTIONS = [
    {   // 0: the bear
        pos: { x: { v: [10, 90] }, y: { v: [-25], clamp: [-25, 140] }, z: { v: [1.01] } },
        vel: { y: { v: [85], clamp: [15, 85] } },
        acc: { y: { v: [-30] } },
        seeded: true,
    },
    {   // 1: the claw marks
        pos: { x: { v: [10, 90] }, y: { v: [-25], clamp: [-100, 200] }, z: { v: [0.99] } },
        vel: { y: { v: [85], clamp: [15, 85] } },
        acc: { y: { v: [-30] } },
        seeded: true,
    },
];

// Particles spawned on every play (config field 10 → field 1). One of each.
const PARTICLES = [
    {   // claw marks: a texture stamped along the path the particle travels
        renderer: 'trail',
        image: ASSETS + (DARK ? 'claws_v2.png' : 'claws_v3.png'),
        scale: 0.8,
        fadeOut: { delay: 5000, duration: 1000 },
        motion: 1,
        exits: [0],                 // never removed for leaving the screen, only after fading out
    },
    {   // the bear
        renderer: 'sprite',
        image: ASSETS + 'bear.png',
        width: 250,
        height: 397,
        scale: 0.8,
        fadeOut: { delay: 5600, duration: 200 },
        anchor: { x: 125, y: 20 },  // the point of the image that sits on the particle position
        motion: 0,
        exits: [1, 3, 4, 2],        // default: may be removed after leaving any edge
    },
];

/* ======================================================================
 * Small helpers
 * ==================================================================== */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
const toRad = deg => deg * Math.PI / 180;
// Perspective factor: things with a larger z are drawn bigger and move faster.
const depth = z => (z < -100 ? 0 : 1 + z / 100);

// Pick a value from [a] or [a, b] (random in range).
function pick(values) {
    if (values.length === 0) return 0;
    if (values.length === 1) return values[0];
    return values[0] + Math.random() * (values[1] - values[0]);
}
// Same, but "random" from a seed, so two particles with the same seed get the same value.
function pickSeeded(values, seed) {
    if (values.length === 0) return 0;
    if (values.length === 1) return values[0];
    const s = Math.sin(seed) * 1000;
    return values[0] + (s - Math.floor(s)) * (values[1] - values[0]);
}

function makeVec(cfg, seed) {
    const v = { x: 0, y: 0, z: 0 };
    if (!cfg) return v;
    ['x', 'y', 'z'].forEach((axis, i) => {
        if (!cfg[axis]) return;
        v[axis] = seed !== undefined ? pickSeeded(cfg[axis].v, seed + i) : pick(cfg[axis].v);
    });
    return v;
}
function clampVec(v, cfg) {
    if (!cfg) return;
    for (const axis of ['x', 'y', 'z']) {
        const c = cfg[axis] && cfg[axis].clamp;
        if (c) v[axis] = clamp(v[axis], c[0], c[1]);
    }
}

// Opacity over time with an optional fade-in and fade-out ({delay, duration}).
function fadeAlpha(now, start, opacity, fadeIn, fadeOut) {
    if (fadeIn && !fadeIn.done) {
        const from = start + fadeIn.delay;
        if (now < from) return 0;
        if (now <= from + fadeIn.duration) return (now - from) / fadeIn.duration * opacity;
        fadeIn.done = true;
    }
    if (fadeOut && now > start + fadeOut.delay) {
        const t = (now - start - fadeOut.delay) / fadeOut.duration;
        if (t > 1) fadeOut.done = true;
        return (1 - Math.min(t, 1)) * opacity;
    }
    return opacity;
}

const imageCache = new Map();
function loadImage(src) {
    if (!imageCache.has(src)) {
        imageCache.set(src, new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Could not load ' + src));
            img.src = src;
        }));
    }
    return imageCache.get(src);
}

/* ======================================================================
 * Movement (Google's uhh class)
 * ==================================================================== */

class Motion {
    constructor(index, engine) {
        this.cfg = MOTIONS[index];
        // The seed is the play count plus the start time of the current run.
        this.seed = this.cfg.seeded ? engine.playCount + (engine.startTime ?? 0) : undefined;
    }
    initialState() {
        const s = this.seed;
        const at = n => (s === undefined ? undefined : s + n * 1000);
        const state = {
            pos: makeVec(this.cfg.pos, at(1)),
            vel: makeVec(this.cfg.vel, at(2)),
            acc: makeVec(this.cfg.acc, at(3)),
        };
        clampVec(state.pos, this.cfg.pos);
        clampVec(state.vel, this.cfg.vel);
        clampVec(state.acc, this.cfg.acc);
        return state;
    }
    // dt is in seconds
    update(dt, { pos, vel, acc }) {
        const k = depth(pos.z);
        pos.x += k * vel.x * dt;
        pos.y += k * vel.y * dt;
        pos.z += k * vel.z * dt;
        clampVec(pos, this.cfg.pos);
        vel.x += acc.x * dt;
        vel.y += acc.y * dt;
        vel.z += acc.z * dt;
        clampVec(vel, this.cfg.vel);
        clampVec(acc, this.cfg.acc);
    }
}

/* ======================================================================
 * Renderers
 * ==================================================================== */

// The bear: one image, positioned by its anchor point (Google's ejh class).
class SpriteRenderer {
    constructor(cfg) {
        this.cfg = cfg;
        this.startTime = -1;
        this.fadeOut = { ...cfg.fadeOut, done: false };
    }
    async init() {
        this.image = await loadImage(this.cfg.image);
        this.frameW = this.cfg.width || this.image.naturalWidth;
        this.frameH = this.cfg.height || this.image.naturalHeight;
        this.drawW = this.frameW * this.cfg.scale;
        this.drawH = this.frameH * this.cfg.scale;
    }
    render(now, ctx, { pos }, canvas) {
        ctx.translate(pos.x / 100 * canvas.width, pos.y / 100 * canvas.height);
        if (this.startTime === -1) this.startTime = now;
        ctx.globalAlpha = fadeAlpha(now, this.startTime, 1, null, this.fadeOut);
        const k = depth(pos.z);
        const w = this.frameW * this.cfg.scale * k;
        const h = this.frameH * this.cfg.scale * k;
        this.drawW = w;
        this.drawH = h;
        const dx = -this.cfg.anchor.x / this.frameW * w;
        const dy = -this.cfg.anchor.y / this.frameH * h;
        ctx.drawImage(this.image, 0, 0, this.frameW, this.frameH, dx, dy, w, h);
    }
    size() { return { width: this.drawW || 0, height: this.drawH || 0 }; }
    done() { return this.fadeOut.done; }
}

// The claw marks: as the particle moves, the claw texture is stamped along its path
// onto an offscreen canvas, which is then drawn over the page (Google's rAv22 module).
class TrailRenderer {
    constructor(cfg) {
        this.cfg = cfg;
        this.startTime = -1;
        this.offset = 0;           // how far into the texture the next stamp starts
        this.last = null;          // previous particle position, in pixels
        this.w = this.h = -1;
        this.fadeOut = { ...cfg.fadeOut, done: false };
    }
    async init() {
        this.image = await loadImage(this.cfg.image);
        this.frameW = this.image.naturalWidth;
        this.frameH = this.image.naturalHeight;
    }
    render(now, ctx, { pos }, canvas) {
        const W = canvas.width, H = canvas.height;
        if (W <= 0 || H <= 0) return;
        if (this.startTime === -1) this.startTime = now;
        if (this.w !== W || this.h !== H) {
            this.w = W;
            this.h = H;
            this.buffer = this.buffer || document.createElement('canvas');
            this.buffer.width = W;
            this.buffer.height = H;
            this.bctx = this.buffer.getContext('2d');
            this.bctx.clearRect(0, 0, W, H);
            this.last = null;
            this.offset = 0;
        }
        const p = { x: pos.x / 100 * W, y: pos.y / 100 * H };
        if (this.last) {
            const dx = p.x - this.last.x, dy = p.y - this.last.y;
            let dist = Math.hypot(dx, dy);
            if (dist > 0) {
                const along = this.frameW * this.cfg.scale;   // texture length along the path
                const across = this.frameH * this.cfg.scale;  // texture width across the path
                const b = this.bctx;
                b.save();
                b.translate(this.last.x, this.last.y);
                b.rotate(Math.atan2(dy, dx));
                for (let x = 0; dist > 0;) {
                    const seg = Math.min(dist, along - this.offset);
                    b.drawImage(this.image,
                        this.offset / along * this.frameW, 0, seg / along * this.frameW, this.frameH,
                        x, -across / 2, seg, across);
                    x += seg;
                    dist -= seg;
                    this.offset = (this.offset + seg) % along;
                }
                b.restore();
            }
        } else {
            this.offset = 0;
        }
        this.last = p;
        ctx.save();
        ctx.globalAlpha = fadeAlpha(now, this.startTime, 1, null, this.fadeOut);
        ctx.drawImage(this.buffer, 0, 0);
        ctx.restore();
    }
    size() {
        return this.frameW ? { width: this.frameW * this.cfg.scale, height: this.frameH * this.cfg.scale } : { width: 0, height: 0 };
    }
    done() { return this.fadeOut.done; }
}

/* ======================================================================
 * Particle (Google's Sgh class)
 * ==================================================================== */

class Particle {
    constructor(cfg, engine) {
        this.cfg = cfg;
        this.engine = engine;
        this.motion = new Motion(cfg.motion, engine);
        this.renderer = cfg.renderer === 'trail' ? new TrailRenderer(cfg) : new SpriteRenderer(cfg);
        this.started = false;
        this.exits = new Set(cfg.exits);
    }
    async init() {
        await this.renderer.init();
        this.state = this.motion.initialState();
    }
    update(dtMs) {
        this.started = true;
        this.motion.update(dtMs / 1000, this.state);
    }
    render(now, ctx) {
        if (this.started) this.renderer.render(now, ctx, this.state, this.engine.canvas);
    }
    // Finished: left the screen in its direction of travel, or faded out.
    isDone() {
        const { width, height } = this.renderer.size();
        const margin = Math.max(width, height) * 0.75 + 10;
        const { pos, vel, acc } = this.state;
        const W = this.engine.canvas.width, H = this.engine.canvas.height;
        const x = pos.x * W / 100, y = pos.y * H / 100;
        return (this.exits.has(4) && x > W + margin && vel.x > 0 && acc.x >= 0) ||
            (this.exits.has(3) && x < -margin && vel.x < 0 && acc.x <= 0) ||
            (this.exits.has(1) && y > H + margin && vel.y > 0 && acc.y >= 0) ||
            (this.exits.has(2) && y < -margin && vel.y < 0 && acc.y <= 0) ||
            this.renderer.done();
    }
    zIndex() { return this.state && this.state.pos.z ? this.state.pos.z : 0; }
}

/* ======================================================================
 * Animation engine (Google's Gfh / EXg classes)
 * ==================================================================== */

const IDLE = 0, PLAYING = 1, CLOSING = 2;

class Engine {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.state = IDLE;
        this.particles = [];
        this.playCount = 0;
        this.startTime = undefined;
        this.spawning = false;
        this.buttonsLocked = false;   // after the first full run, the engine stops changing the buttons
        this.closeFadeStart = -1;
        this.clock = Date.now();
        this.raf = 0;
        this.resize();
        addEventListener('resize', () => setTimeout(() => this.resize(), 0));
        setInterval(() => this.resize(), 1000);
    }

    resize() {
        // Google uses the window size in CSS pixels (no devicePixelRatio scaling).
        const w = innerWidth, h = innerHeight;
        if (this.canvas.width === w && this.canvas.height === h) return;
        this.canvas.width = w;
        this.canvas.height = h;
        if (this.state === PLAYING || this.state === CLOSING) this.render(this.clock);
    }

    // Called on page load and on every paw click.
    async play() {
        if (this.state === CLOSING) return;
        if (this.state === IDLE) {
            this.state = PLAYING;
            this.clock = Date.now();
            this.startLoop();
            buttons.loadIcons();
        }
        if (this.spawning) return;
        this.spawning = true;
        const fresh = PARTICLES.map(cfg => new Particle(cfg, this));
        if (this.state === PLAYING) {
            await Promise.all(fresh.map(p => p.init()));
            this.particles.push(...fresh);
            this.sortParticles();
        }
        this.startTime = this.startTime || Date.now();
        this.playCount++;
        this.spawning = false;
    }

    // Exit button / Escape key: fade the canvas out, then clean up.
    close() {
        this.state = CLOSING;
    }

    startLoop() {
        cancelAnimationFrame(this.raf);
        const tick = () => {
            this.step(Date.now());
            if (this.state !== IDLE) this.raf = requestAnimationFrame(tick);
        };
        this.raf = requestAnimationFrame(tick);
    }

    // Fixed-size update steps (at least 20ms), then one render.
    step(now) {
        const dt = Math.max(20, (now - this.clock) / 4);
        while (this.clock + dt <= now) {
            this.clock += dt;
            if (this.update(dt) === 'finished') return;
        }
        this.render(this.clock);
    }

    update(dt) {
        for (const p of this.particles) p.update(dt);
        for (let i = 0; i < this.particles.length; i++) {
            if (this.particles[i].isDone()) {
                this.particles.splice(i, 1);
                i--;
            }
            if (this.state !== IDLE && this.particles.length === 0) {
                this.finish();
                return 'finished';
            }
        }
        // As soon as the animation is running, show all three buttons (once).
        this.showButtons([]);
    }

    render(now) {
        const { ctx, canvas } = this;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        this.sortParticles();
        for (const p of this.particles) {
            ctx.save();
            p.render(now, ctx);
            ctx.restore();
        }
        if (this.state === CLOSING) {
            if (this.closeFadeStart === -1) this.closeFadeStart = now;
            const t = (now - this.closeFadeStart) / CLOSE_FADE_MS;
            if (t > 1) {
                this.finish();
            } else {
                ctx.save();
                ctx.globalCompositeOperation = 'destination-in';
                ctx.globalAlpha = 1 - Math.min(t, 1);
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.restore();
            }
        }
    }

    // Everything has faded out (or was closed): reset.
    finish() {
        this.closeFadeStart = -1;
        this.startTime = undefined;
        this.particles.length = 0;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        cancelAnimationFrame(this.raf);
        const wasClosing = this.state !== PLAYING;
        this.state = IDLE;
        if (wasClosing) this.hideButtons([]);
        else this.showButtons([]);
    }

    sortParticles() {
        this.particles.sort((a, b) => a.zIndex() - b.zIndex());
    }

    showButtons(which) {
        if (this.buttonsLocked || this.state === CLOSING) return;
        buttons.show(which);
        if (which.length === 0) this.buttonsLocked = true;
    }
    hideButtons(which) {
        buttons.hide(which);
        this.buttonsLocked = false;
    }
}

/* ======================================================================
 * "Celebrated N times" bubble (Google's VBjstb module)
 * ==================================================================== */

class Counter {
    constructor(bubble) {
        this.bubble = bubble;
        this.text = bubble.querySelector('.counter-text');
        this.heart = bubble.querySelector('.counter-heart');
        this.visible = false;
        this.pending = false;
        this.colored = false;
        this.hearts = [];
        let saved = 0;
        try { saved = Number(localStorage.getItem('bearsClicks')) || 0; } catch (e) { /* storage blocked */ }
        this.count = BASE_COUNT + saved;
        this.localClicks = saved;
        this.format = new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 4 });
    }
    show() {
        if (this.pending) return;
        this.pending = true;
        if (!this.visible && this.count > 0) this.reveal();
    }
    reveal() {
        if (!this.colored) { this.applyColors(); this.colored = true; }
        this.updateText();
        this.pending = false;
        this.bubble.classList.remove('is-faded');
        this.visible = true;
    }
    hide() {
        this.pending = false;
        if (!this.visible) return;
        this.bubble.classList.add('is-faded');
        this.visible = false;
        for (const h of this.hearts) h.remove();
        this.hearts.length = 0;
    }
    add(n) {
        this.count += n;
        this.localClicks += n;
        try { localStorage.setItem('bearsClicks', String(this.localClicks)); } catch (e) { /* storage blocked */ }
        this.spawnHeart();
        this.updateText();
    }
    updateText() {
        const label = this.format.format(this.count);
        this.text.textContent = label;
        this.bubble.setAttribute('aria-label', 'Celebrated ' + label + ' times');
    }
    // Border/text use the button colour; the background matches the page.
    applyColors() {
        const color = getComputedStyle(document.documentElement).getPropertyValue('--fab-color').trim() || '#000000';
        let bg = getComputedStyle(document.body).backgroundColor;
        if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') bg = '#ffffff';
        Object.assign(this.bubble.style, { borderColor: color, color, backgroundColor: bg });
        this.bubble.querySelector('.tail-inner').style.borderColor = `${bg} transparent transparent`;
        this.bubble.querySelector('.tail-outer').style.borderColor = `${color} transparent transparent`;
    }
    // A copy of the heart floats up, swaying, and is removed after one second.
    spawnHeart() {
        if (!this.visible) return;
        const h = this.heart.cloneNode(true);
        h.classList.add('heart-float');
        h.style.opacity = String(Math.random() * 0.25 + 0.75);
        h.style.color = this.bubble.style.color;
        Object.assign(h.querySelector('svg').style, {
            animationName: Math.random() > 0.5 ? 'iconSway' : 'iconSwayFlipped',
            animationDuration: `${Math.random() + 0.5}s`,
            animationDirection: 'alternate',
            animationIterationCount: 'infinite',
            animationTimingFunction: 'ease-in-out',
        });
        this.hearts.push(h);
        this.heart.parentElement.appendChild(h);
        setTimeout(() => {
            this.hearts = this.hearts.filter(x => x !== h);
            h.remove();
        }, 1000);
    }
}

/* ======================================================================
 * Ripple on the paw and share buttons (Google's pfdHGb module)
 * ==================================================================== */

function addRipple(button) {
    const layer = button.querySelector('.ripple-layer');
    const ripple = document.createElement('div');
    ripple.className = 'ripple';
    layer.append(ripple);
    button.addEventListener('click', e => {
        const w = layer.clientWidth, h = layer.clientHeight;
        const size = Math.hypot(w, h) + 20;
        const startScale = Math.max(w, h) * 0.6 / size;
        Object.assign(ripple.style, {
            width: `${size}px`, height: `${size}px`,
            left: `${(w - size) / 2}px`, top: `${(h - size) / 2}px`,
        });
        const r = layer.getBoundingClientRect();
        const fromX = e.clientX ? e.clientX - (r.left + w / 2) : 0;
        const fromY = e.clientY ? e.clientY - (r.top + h / 2) : 0;
        layer.getAnimations().forEach(a => a.cancel());
        ripple.getAnimations().forEach(a => a.cancel());
        ripple.animate(
            [{ transform: `translate(${fromX}px, ${fromY}px) scale(${startScale})` }, { transform: 'translate(0, 0) scale(1)' }],
            { duration: 500, easing: 'cubic-bezier(.4, 0, .2, 1)' });
        ripple.animate([{ opacity: 0.001 }, { opacity: 0.1 }], { duration: 133, easing: 'linear', fill: 'forwards' });
        const fade = layer.animate([{ opacity: 0.999 }, { opacity: 0 }], { duration: 250, delay: 250, easing: 'linear', fill: 'forwards' });
        fade.onfinish = () => {
            fade.cancel();
            ripple.getAnimations().forEach(a => a.cancel());
        };
    });
}

/* ======================================================================
 * Spotlight shown once, 1s after the buttons first appear (Google's wf7j4c module)
 * ==================================================================== */

const spotlight = {
    done: false,
    pending: false,
    eligible() {
        if (FORCE_SPOTLIGHT) return true;
        const p = new URLSearchParams(location.search);
        const src = p.get('source');
        return p.get('shndl') === '18' || !!(src && /^sh\/.*\/kp\/ee($|\/.*)/.test(src)) || p.get('csf') === 'b';
    },
    trigger(paw) {
        if (this.done || this.pending || !this.eligible()) return;
        this.pending = true;
        setTimeout(() => this.run(paw), 1000);
    },
    run(paw) {
        const r = paw.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || r.right < 0 || r.left > innerWidth || r.bottom < 0 || r.top > innerHeight) {
            this.pending = false;
            return;
        }
        this.done = true;
        const overlay = document.createElement('div');
        overlay.className = 'spotlight';
        const glow = document.createElement('div');
        glow.className = 'spotlight-glow';
        overlay.append(glow);
        document.body.insertBefore(overlay, document.body.firstElementChild);
        const place = () => {
            const b = paw.getBoundingClientRect();
            const de = document.documentElement;
            const w = Math.max(de.clientWidth, de.offsetWidth, de.scrollWidth);
            const h = Math.max(de.scrollHeight, innerHeight);
            Object.assign(overlay.style, { width: `${w}px`, height: `${h}px` });
            Object.assign(glow.style, { width: `${w + 200}px`, height: `${h + 200}px`, left: '-100px', top: '-100px' });
            const cx = scrollX + b.left + b.width / 2 + 100;
            const cy = scrollY + b.top + b.height / 2 + 100;
            const inner = Math.round(b.width * 0.625), outer = Math.round(b.width * 1.25);
            glow.style.backgroundImage = DARK
                ? `radial-gradient(circle at ${cx}px ${cy}px, rgb(255, 255, 255) ${inner}px, rgb(0, 0, 0) ${outer}px)`
                : `radial-gradient(circle at ${cx}px ${cy}px, transparent ${inner}px, rgb(0, 0, 0) ${outer}px)`;
        };
        place();
        addEventListener('resize', place);
        addEventListener('scroll', place);
        overlay.getBoundingClientRect();          // start the opacity transition from 0
        overlay.style.opacity = '0.7';
        if (DARK) paw.style.zIndex = '1002';
        setTimeout(() => {
            overlay.style.opacity = '0';
            setTimeout(() => {
                overlay.remove();
                removeEventListener('resize', place);
                removeEventListener('scroll', place);
                if (DARK) paw.style.zIndex = 'auto';
            }, 2000);
        }, 2000);
    },
};

/* ======================================================================
 * Buttons (Google's bR class)
 * ==================================================================== */

class Buttons {
    constructor() {
        this.bar = document.querySelector('.paw-bar');
        this.paw = document.querySelector('.paw-btn');
        this.exit = document.querySelector('.exit-btn');
        this.share = document.querySelector('.share-btn');
        this.counter = new Counter(document.querySelector('.counter-bubble'));
        this.active = false;          // bar is in use (Google: Ka)
        this.iconsLoaded = false;     // (Bc)
        this.clicks = 0;              // paw clicks since the last exit (Ca)
        this.lastY = 0;
        this.scrollDelta = 0;
        this.timers = [];
        this.showTimer = null;
        this.iconsRequested = false;

        this.paw.addEventListener('click', () => this.onPawClick());
        this.exit.addEventListener('click', () => this.onExitClick());
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && this.active && this.exit.classList.contains('is-shown') && !sharePanel.isOpen()) {
                this.stopAnimation();
            }
        });
        addRipple(this.paw);
        addRipple(this.share);
    }

    // Wait until the button icons have loaded before showing the bar.
    loadIcons() {
        if (this.iconsRequested) return;
        this.iconsRequested = true;
        const imgs = [this.paw, this.exit].map(b => b.querySelector('img'));
        let left = imgs.length;
        const ready = () => {
            if (--left > 0) return;
            this.iconsLoaded = true;
            if (this.active) {
                this.showBar();
                if (this.showTimer === null) spotlight.trigger(this.paw);
            }
        };
        for (const img of imgs) {
            if (img.complete) ready();
            else {
                img.addEventListener('load', ready, { once: true });
                img.addEventListener('error', ready, { once: true });
            }
        }
    }

    showButton(btn) {
        if (btn.classList.contains('is-shown')) return;
        btn.classList.add('is-shown');
        if (!this.bar.classList.contains('is-hidden')) this.setReachable(btn, true);
    }
    hideButton(btn) {
        if (!btn.classList.contains('is-shown')) return;
        btn.classList.remove('is-shown');
        if (!this.bar.classList.contains('is-hidden')) {
            this.setReachable(btn, false);
            if (btn === this.paw) this.counter.hide();
        }
    }
    setReachable(btn, yes) {
        btn.setAttribute('aria-hidden', String(!yes));
        btn.tabIndex = yes ? 0 : -1;
    }
    clearTimers() {
        this.timers.forEach(clearTimeout);
        this.timers = [];
    }

    showBar() {
        if (!this.bar.classList.contains('is-hidden')) return;
        this.clearTimers();
        this.bar.classList.remove('is-hidden');
        for (const b of [this.paw, this.share, this.exit]) {
            if (b.classList.contains('is-shown')) this.setReachable(b, true);
        }
        if (this.clicks > 0) this.counter.show();
    }
    hideBar() {
        if (this.bar.classList.contains('is-hidden')) return;
        this.clearTimers();
        this.bar.classList.add('is-hidden');
        for (const b of [this.paw, this.share, this.exit]) {
            this.timers.push(setTimeout(() => this.setReachable(b, false), 250));
        }
        this.counter.hide();
    }

    // Called by the engine. [] = paw now, X and share 75ms later.
    show(which) {
        if (!this.active) {
            this.active = true;
            this.lastY = scrollY;
            this.scrollDelta = 0;
            addEventListener('scroll', () => this.onScroll(), { passive: true });
        }
        let pawFirst = false;
        if (which.length) {
            if (which.includes('share')) this.showButton(this.share);
            if (which.includes('exit')) this.showButton(this.exit);
            if (which.includes('retrigger')) this.showButton(this.paw);
        } else {
            this.showButton(this.paw);
            pawFirst = true;
            clearTimeout(this.showTimer);
            this.showTimer = setTimeout(() => {
                this.showTimer = null;
                this.showButton(this.share);
                this.showButton(this.exit);
                if (this.iconsLoaded) spotlight.trigger(this.paw);
            }, 75);
        }
        if (this.iconsLoaded) {
            this.showBar();
            if (!pawFirst) spotlight.trigger(this.paw);
        } else {
            this.loadIcons();
        }
    }

    hide(which) {
        if (which.length) {
            if (which.includes('retrigger')) this.hideButton(this.paw);
            if (which.includes('share')) this.showButton(this.share);   // (sic) Google's code shows it here
            if (which.includes('exit')) this.hideButton(this.exit);
        } else {
            this.active = false;
            this.hideBar();
            [this.paw, this.exit, this.share].forEach(b => this.hideButton(b));
        }
    }

    // Scrolling down 150px hides the bar; scrolling back up 150px (or to the top) shows it.
    onScroll() {
        if (!this.active || sharePanel.isOpen()) return;
        const y = scrollY, d = y - this.lastY;
        if (d === 0) return;
        this.lastY = y;
        this.scrollDelta = Math.sign(d) === Math.sign(this.scrollDelta) ? this.scrollDelta + d : d;
        if (this.scrollDelta < -150 || (d < 0 && y === 0)) {
            this.scrollDelta = 0;
            this.showBar();
        } else if (this.scrollDelta > 150) {
            this.scrollDelta = 0;
            this.hideBar();
        }
    }

    onPawClick() {
        engine.play();
        // Press effect: shrink instantly, spring back on the next tick.
        const c = this.paw.classList;
        c.remove('is-pressed', 'is-released');
        c.add('is-pressed');
        setTimeout(() => c.add('is-released'), 0);
        this.clicks++;
        this.counter.add(1);       // no heart on the very first click: the bubble isn't showing yet
        this.counter.show();
    }

    onExitClick() {
        this.hideBar();
        setTimeout(() => this.stopAnimation(), 250);
    }

    stopAnimation() {
        engine.close();
        this.clicks = 0;
    }
}

/* ======================================================================
 * Share panel (Google's Wct42 / uLYJpc / HPGtmd modules)
 * ==================================================================== */

const sharePanel = {
    el: document.querySelector('.share-panel'),
    isOpen() { return !this.el.hidden; },
    url() { return location.href; },
    open() {
        this.el.querySelector('.share-url').textContent = this.url();
        this.el.hidden = false;
        this.place();
    },
    close() { this.el.hidden = true; },
    // Centered over the share button, 15px above it, kept 25px inside the window.
    place() {
        const btn = buttons.share.getBoundingClientRect();
        const w = this.el.offsetWidth, h = this.el.offsetHeight;
        const viewW = document.documentElement.clientWidth;
        const left = clamp(btn.left + btn.width / 2 - w / 2, 25, viewW - 25 - w);
        this.el.style.left = `${left}px`;
        this.el.style.top = `${btn.top - 15 - h}px`;
    },
    targets: {
        facebook: u => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(u)}`,
        gmail: u => `https://mail.google.com/mail?view=cm&fs=1&tf=1&body=${encodeURIComponent(u)}&su=${encodeURIComponent(document.title)}`,
        x: u => `https://www.twitter.com/share?url=${encodeURIComponent(u)}`,
        threads: u => `https://www.threads.net/intent/post?url=${encodeURIComponent(u)}`,
        reddit: u => `https://www.reddit.com/submit?url=${encodeURIComponent(u)}`,
        whatsapp: u => `https://api.whatsapp.com/send?text=${encodeURIComponent(u)}`,
    },
    init() {
        buttons.share.addEventListener('click', e => {
            e.stopPropagation();
            this.isOpen() ? this.close() : this.open();
        });
        this.el.querySelector('.share-close').addEventListener('click', () => this.close());
        this.el.addEventListener('click', e => e.stopPropagation());
        document.addEventListener('click', () => { if (this.isOpen()) this.close(); });
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && this.isOpen()) this.close(); });
        addEventListener('resize', () => { if (this.isOpen()) this.place(); });

        const copyBtn = this.el.querySelector('.share-copy');
        const copyLabel = this.el.querySelector('.share-copy-label');
        const copiedLabel = this.el.querySelector('.share-copied-label');
        let copiedTimer;
        copyBtn.addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(this.url()); } catch (err) { /* clipboard blocked */ }
            copyLabel.hidden = true;
            copiedLabel.hidden = false;
            clearTimeout(copiedTimer);
            copiedTimer = setTimeout(() => { copyLabel.hidden = false; copiedLabel.hidden = true; }, 3000);
        });

        for (const b of this.el.querySelectorAll('[data-share]')) {
            b.addEventListener('click', () => {
                window.open(this.targets[b.dataset.share](this.url()), '_blank', 'noopener');
                this.close();
            });
        }
    },
};

/* ======================================================================
 * Start
 * ==================================================================== */

const engine = new Engine(document.getElementById('bears-canvas'));
const buttons = new Buttons();
sharePanel.init();

if (AUTOPLAY) {
    engine.play();
    engine.showButtons(['share', 'exit']);
} else {
    engine.showButtons(['retrigger']);
}