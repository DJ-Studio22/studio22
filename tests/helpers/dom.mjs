// tests/helpers/dom.mjs
//
// The smallest DOM that engine/canvas.js will run against.
//
// WHY THIS EXISTS AT ALL, GIVEN tests/README.md SAYS NO DOM
// --------------------------------------------------------
// That rule was written when nothing in engine/ was covered, and engine/ is
// the one directory where a fault takes down all eleven games at once — the
// black-screen bug lived in canvas.js. The parts worth testing there are not
// drawing: they are arithmetic. Screen coordinates to game coordinates,
// letterboxing, backing-store sizing against devicePixelRatio. All of that is
// maths that happens to live behind a canvas, and none of it can be checked
// by looking at a screenshot.
//
// So this stub is deliberately dumb. It records what was asked of it and
// returns plausible values; it does not lay anything out, and no test here
// asserts on how anything looks. If a test needs more DOM than this, that is
// a sign it has wandered into rendering and belongs in a browser instead.

/** A canvas 2D context that remembers nothing and refuses nothing. */
function stubContext() {
  const noop = () => {};
  return new Proxy(
    {
      canvas: null,
      imageSmoothingEnabled: true,
      setTransform: noop,
      scale: noop,
      translate: noop,
      save: noop,
      restore: noop,
      measureText: () => ({ width: 0 }),
      createLinearGradient: () => ({ addColorStop: noop }),
      createRadialGradient: () => ({ addColorStop: noop }),
    },
    {
      // Anything else a draw call reaches for is a no-op rather than a crash.
      get: (target, key) => (key in target ? target[key] : noop),
      set: (target, key, value) => { target[key] = value; return true; },
    },
  );
}

function makeElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    // A style object that answers setProperty as well as plain assignment;
    // canvas.js uses both, and a bare {} only supports one of them.
    style: (() => {
      const props = new Map();
      return {
        setProperty(name, value) { props.set(name, String(value)); this[name] = value; },
        removeProperty(name) { props.delete(name); delete this[name]; },
        getPropertyValue(name) { return props.get(name) ?? ""; },
      };
    })(),
    dataset: {},
    children: [],
    parentNode: null,
    textContent: '',
    attributes: new Map(),
    // The rect a test wants to control. Defaults to something non-zero so
    // screenToGame does not take its hidden-canvas early return by accident.
    _rect: { left: 0, top: 0, width: 800, height: 450 },

    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      return child;
    },
    // engine/loop.js's fatal-error panel uses append(), which takes any number
    // of nodes or strings. appendChild alone is not enough for it.
    append(...nodes) {
      for (const n of nodes) {
        if (n && typeof n === "object") { this.children.push(n); n.parentNode = this; }
        else this.textContent += String(n);
      }
    },
    prepend(...nodes) {
      for (const n of nodes.reverse()) {
        if (n && typeof n === "object") { this.children.unshift(n); n.parentNode = this; }
        else this.textContent = String(n) + this.textContent;
      }
    },
    removeChild(child) {
      this.children = this.children.filter((c) => c !== child);
      child.parentNode = null;
      return child;
    },
    remove() { this.parentNode?.removeChild(this); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; },
    removeAttribute(name) { this.attributes.delete(name); },
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() {
      const r = this._rect;
      return { ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top };
    },
    // The layout in engine/canvas.js measures its container with these, so a
    // stub without them makes every sum in it NaN -- quietly, because NaN
    // compares false against the cached size and the code carries on.
    get clientWidth() { return this._rect.width; },
    get clientHeight() { return this._rect.height; },
    getContext() {
      this._ctx ??= stubContext();
      this._ctx.canvas = this;
      return this._ctx;
    },
  };
  if (el.tagName === 'CANVAS') { el.width = 300; el.height = 150; }
  return el;
}

/**
 * Installs the stub on globalThis and returns a function that removes it.
 *
 * Call this BEFORE importing any engine module that touches the DOM, and
 * import that module dynamically — a static import is hoisted above this and
 * would run against a bare Node global.
 */
export function installDom({
  innerWidth = 1280, innerHeight = 720, devicePixelRatio = 1,
  // Hands the test the clock and the frame pump instead of real timers.
  // engine/loop.js is a fixed-timestep accumulator, and every property worth
  // asserting about it -- how many steps a frame drains, that a long stall is
  // clamped rather than spiralling, that time never runs backwards -- is a
  // statement about specific millisecond values. setTimeout cannot express
  // those. With this on, the returned uninstall function carries a `clock`
  // with now/advance/frame on it; see the bottom of this file.
  manualClock = false,
  // Pretend this is a touchscreen. engine/input.js decides ONCE, at module
  // load, whether to attach its touch listeners at all -- a desktop should not
  // pay for a virtual joystick -- so a test about touch has to say so before
  // it imports the module, and cannot switch it on afterwards.
  touch = false,
} = {}) {
  const saved = {};
  const keys = ['window', 'document', 'navigator', 'ResizeObserver', 'requestAnimationFrame',
    'cancelAnimationFrame', 'matchMedia', 'sessionStorage', 'CSS', 'performance',
    'getComputedStyle'];
  for (const k of keys) saved[k] = globalThis[k];

  const body = makeElement('body');
  const documentElement = makeElement('html');

  const document = {
    body,
    documentElement,
    title: 'Test Game — Studio 22',
    createElement: (tag) => makeElement(tag),
    createElementNS: (_ns, tag) => makeElement(tag),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    getElementById: () => null,
    visibilityState: 'visible',
    activeElement: null,
  };

  // A real sessionStorage, so session.js exercises its storage path rather
  // than silently falling back to memory. This is the versioning under test.
  const store = new Map();
  const sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
    _store: store,
  };

  const listeners = new Map();
  const win = {
    innerWidth,
    innerHeight,
    devicePixelRatio,
    document,
    sessionStorage,
    location: { search: '', href: 'http://localhost/', reload() {} },
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener: (type, fn) => {
      listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn));
    },
    // Takes a payload so a test can send a real-shaped event. engine/input.js
    // reads event.code off keydown, and a bare { type } would silently do
    // nothing at all.
    dispatch: (type, payload = {}) => {
      const event = { type, preventDefault() {}, stopPropagation() {}, target: null, ...payload };
      for (const fn of [...(listeners.get(type) ?? [])]) fn(event);
      return event;
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: (fn) => setTimeout(() => fn(performance.now()), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    visualViewport: null,
  };

  // Assignment is not enough: Node defines some of these (navigator) as
  // getter-only on globalThis, so they have to be redefined rather than set.
  const define = (key, value) => {
    Object.defineProperty(globalThis, key, {
      value, writable: true, configurable: true, enumerable: false,
    });
  };

  define("window", win);
  define("document", document);
  if (touch) win.ontouchstart = null;      // the capability check reads 'in window'
  define("navigator", {
    maxTouchPoints: touch ? 5 : 0,
    userAgent: "node",
    vibrate: () => false,
    getGamepads: () => [],
  });
  define("sessionStorage", sessionStorage);
  define("matchMedia", win.matchMedia);
  define("requestAnimationFrame", win.requestAnimationFrame);
  define("cancelAnimationFrame", win.cancelAnimationFrame);
  define("CSS", { supports: () => false });
  // engine/ui.js resolves the palette with a bare getComputedStyle(), so it
  // has to exist as a global and not only on window.
  define("getComputedStyle", win.getComputedStyle);
  define("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

  // --- The manual clock ---------------------------------------------------
  //
  // Off by default so every existing test keeps the real timers it was
  // written against. When on, nothing advances unless a test says so.
  //
  // engine/loop.js is a fixed-timestep accumulator, and everything worth
  // asserting about it is a statement about specific millisecond values: how
  // many steps a frame drains, that a long stall is clamped rather than
  // spiralling, that time never runs backwards. setTimeout cannot express
  // any of that.
  let clock = null;
  if (manualClock) {
    let nowMs = 0;
    const queue = [];
    let nextId = 1;

    const raf = (fn) => { const id = nextId++; queue.push({ id, fn }); return id; };
    const caf = (id) => {
      const i = queue.findIndex((e) => e.id === id);
      if (i >= 0) queue.splice(i, 1);
    };

    win.requestAnimationFrame = raf;
    win.cancelAnimationFrame = caf;
    define("requestAnimationFrame", raf);
    define("cancelAnimationFrame", caf);
    define("performance", { now: () => nowMs });

    clock = {
      now: () => nowMs,
      set: (ms) => { nowMs = ms; },
      pending: () => queue.length,

      // Advances the clock and runs exactly ONE scheduled frame at the new
      // time. One, not all: the loop reschedules itself from inside the
      // callback, so draining the queue would recurse forever.
      frame(ms) {
        nowMs += ms;
        const next = queue.shift();
        if (next) next.fn(nowMs);
        return next !== undefined;
      },

      frames(count, ms) {
        for (let i = 0; i < count; i++) this.frame(ms);
      },

      /**
       * Advances every callback queued RIGHT NOW by one frame, rather than
       * just the oldest one.
       *
       * A page can have more than one thing on rAF at a time — the game loop
       * plus the shell's overlay loop, and in a test file that builds several
       * shells, one loop per shell. frame() would service the oldest and
       * leave the one under test untouched, which reads exactly like the
       * feature being broken.
       */
      tick(ms) {
        const batch = queue.splice(0, queue.length);
        nowMs += ms;
        for (const entry of batch) entry.fn(nowMs);
        return batch.length;
      },
    };
  }

  function uninstall() {
    for (const k of keys) {
      if (saved[k] === undefined) { delete globalThis[k]; continue; }
      Object.defineProperty(globalThis, k, {
        value: saved[k], writable: true, configurable: true, enumerable: false,
      });
    }
  }

  // The clock rides on the uninstall function rather than changing the return
  // type, so every test written before this still reads installDom() as "give
  // me a teardown".
  uninstall.clock = clock;
  return uninstall;
}
