/**
 * Controls Layout Debugger
 *
 * Drop-in module to diagnose the control bar width bug during maximize.
 * Logs flat string output compatible with Electron's main-process console.
 *
 * Usage:
 *   1. Drop into renderer process after DOM is ready.
 *   2. Open DevTools (Ctrl+Shift+I) and watch the console.
 *   3. Maximize / restore the window.
 */

(function initControlsLayoutDebug() {
  if (window.__controlsLayoutDebugInstalled) return;
  window.__controlsLayoutDebugInstalled = true;

  var PROBE_DELAYS = [0, 16, 33, 50, 66, 100, 150, 250, 400, 600];
  var COMPUTED_PROPS = ['display', 'position', 'width', 'max-width', 'min-width', 'flex-basis', 'box-sizing', 'flex', 'overflow'];

  function fmtRect(el, label) {
    if (!el) return label + ' MISSING';
    var r = el.getBoundingClientRect();
    var parent = el.parentElement;
    var parentRect = parent ? parent.getBoundingClientRect() : null;
    return label
      + ' clientW=' + el.clientWidth
      + ' offsetW=' + el.offsetWidth
      + ' scrollW=' + el.scrollWidth
      + ' scrollLeft=' + el.scrollLeft
      + ' rect(w=' + Math.round(r.width) + ' l=' + Math.round(r.left) + ' r=' + Math.round(r.right) + ')'
      + (parentRect ? ' parentL=' + Math.round(parentRect.left) : '');
  }

  function fmtComputed(el) {
    if (!el) return '';
    var s = getComputedStyle(el);
    var parts = [];
    for (var i = 0; i < COMPUTED_PROPS.length; i++) {
      parts.push(COMPUTED_PROPS[i] + '=' + s.getPropertyValue(COMPUTED_PROPS[i]));
    }
    return ' [' + parts.join(' ') + ']';
  }

  function snapshot(source) {
    var vp = 'vp(inner=' + window.innerWidth + 'x' + window.innerHeight
      + ' outer=' + window.outerWidth + 'x' + window.outerHeight
      + ' dpr=' + window.devicePixelRatio
      + ' screen=' + screen.width + 'x' + screen.height
      + ' avail=' + screen.availWidth + 'x' + screen.availHeight + ')';

    var bodyCls = 'bodyClasses=[' + (document.body.className || '(none)') + ']';

    var bodyEl = document.body;
    var appMain = document.querySelector('.app-main');
    var vc = document.getElementById('videoContainer');
    var cw = document.getElementById('controlsWrapper');
    var cb = document.querySelector('.controls-bar');
    var cl = document.querySelector('.controls-left');
    var cr = document.querySelector('.controls-right');

    var lines = [
      '═══ ' + source + ' ═══',
      vp,
      bodyCls,
      fmtRect(bodyEl, '  body          ') + fmtComputed(bodyEl),
      fmtRect(appMain, '  app-main      ') + fmtComputed(appMain),
      fmtRect(vc,      '  videoContainer') + fmtComputed(vc),
      fmtRect(document.getElementById('sidebarPlaylist'), '  sidebar       ') + fmtComputed(document.getElementById('sidebarPlaylist')),
      fmtRect(cw,      '  controlsWrap  ') + fmtComputed(cw),
      fmtRect(cb,      '  controlsBar   ') + fmtComputed(cb),
      fmtRect(cl,      '  controlsLeft  ') + fmtComputed(cl),
      fmtRect(cr,      '  controlsRight ') + fmtComputed(cr),
      '───',
    ];

    console.log(lines.join('\n'));
  }

  function probe(source) {
    snapshot(source);
    for (var i = 0; i < PROBE_DELAYS.length; i++) {
      (function (s, d) {
        setTimeout(function () { snapshot(s + '+' + d + 'ms'); }, d);
      })(source, PROBE_DELAYS[i]);
    }
  }

  // Window resize
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { probe('resize'); }, 20);
  });

  // IPC window-state
  if (window.hybridAPI) {
    window.hybridAPI.on('window-is-maximized', function (flag) {
      probe('ipc-maximized(' + flag + ')');
    });
    window.hybridAPI.on('window-is-fullscreen', function (flag) {
      probe('ipc-fullscreen(' + flag + ')');
    });
    if (window.hybridAPI.window && window.hybridAPI.window.onStateChanged) {
      window.hybridAPI.window.onStateChanged(function (state) {
        probe('ipc-stateChanged(' + state + ')');
      });
    }
  }

  // MutationObserver: body class changes
  var classObserver = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      if (m.type === 'attributes' && m.attributeName === 'class') {
        var oldVal = m.oldValue || '';
        var nowVal = document.body.className;
        var oldList = oldVal.split(/\s+/);
        var nowList = nowVal.split(/\s+/);
        var added = [];
        var removed = [];
        for (var a = 0; a < nowList.length; a++) { if (oldList.indexOf(nowList[a]) === -1) added.push(nowList[a]); }
        for (var b = 0; b < oldList.length; b++) { if (nowList.indexOf(oldList[b]) === -1) removed.push(oldList[b]); }
        probe('bodyClass +[' + added.join(',') + '] -[' + removed.join(',') + ']');
      }
    }
  });
  classObserver.observe(document.body, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });

  // ResizeObserver on controlsWrapper
  var cwEl = document.getElementById('controlsWrapper');
  if (cwEl && typeof ResizeObserver === 'function') {
    var resizeObserver = new ResizeObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var cr2 = entries[i].contentRect;
        console.log('[CTRL-LAYOUT RO] ResizeObserver controlsWrapper contentRect ' + Math.round(cr2.width) + 'x' + Math.round(cr2.height));
      }
      var cwNow = document.getElementById('controlsWrapper');
      if (cwNow) {
        var r2 = cwNow.getBoundingClientRect();
        console.log('[CTRL-LAYOUT RO] controlsWrapper boundingRect w=' + Math.round(r2.width) + ' l=' + Math.round(r2.left) + ' r=' + Math.round(r2.right));
      }
    });
    resizeObserver.observe(cwEl);
  }

  setTimeout(function () { snapshot('init'); }, 200);

  console.log('[CTRL-LAYOUT] Debugger installed. Maximize/restore and watch the console.');
})();
