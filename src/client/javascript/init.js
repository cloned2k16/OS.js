/*!
 * OS.js - JavaScript Cloud/Web Desktop Platform
 *
 * Copyright (c) 2011-2016, Anders Evenrud <andersevenrud@gmail.com>
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
 * ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * @author  Anders Evenrud <andersevenrud@gmail.com>
 * @licence Simplified BSD License
 */
(function() {
  'use strict';

  window.OSjs = window.OSjs || {};

  var handler    = null;
  var loaded     = false;
  var inited     = false;
  var signingOut = false;

  /////////////////////////////////////////////////////////////////////////////
  // COMPABILITY
  /////////////////////////////////////////////////////////////////////////////

  // Make sure these namespaces exist
  (['API', 'GUI', 'Core', 'Dialogs', 'Helpers', 'Applications', 'Locales', 'VFS', 'Extensions']).forEach(function(ns) {
    OSjs[ns] = OSjs[ns] || {};
  });

  // For browsers without "console" for some reason
  (function() {
    window.console    = window.console    || {};
    console.log       = console.log       || function() {};
    console.debug     = console.debug     || console.log;
    console.error     = console.error     || console.log;
    console.warn      = console.warn      || console.log;
    console.group     = console.group     || console.log;
    console.groupEnd  = console.groupEnd  || console.log;
  })();

  // Compability
  (function() {
    var compability = ['forEach', 'every', 'map'];

    compability.forEach(function(n) {
      if ( window.HTMLCollection ) {
        window.HTMLCollection.prototype[n] = Array.prototype[n];
      }

      if ( window.NodeList ) {
        window.NodeList.prototype[n] = Array.prototype[n];
      }

      if ( window.FileList ) {
        window.FileList.prototype[n] = Array.prototype[n];
      }
    });

    (function() {
      function CustomEvent(event, params) {
        params = params || { bubbles: false, cancelable: false, detail: undefined };
        var evt = document.createEvent( 'CustomEvent' );
        evt.initCustomEvent( event, params.bubbles, params.cancelable, params.detail );
        return evt;
      }

      if ( window.navigator.userAgent.match(/MSIE|Edge|Trident/) ) {
        CustomEvent.prototype = window.Event.prototype;
        window.CustomEvent = CustomEvent;
      }
    })();
  })();

  /////////////////////////////////////////////////////////////////////////////
  // GLOBAL EVENTS
  /////////////////////////////////////////////////////////////////////////////

  var events = {
    body_contextmenu: function(ev) {
      ev.stopPropagation();
      if ( !OSjs.Utils.$isInput(ev) ) {
        ev.preventDefault();
        return false;
      }
      return true;
    },
    body_mousedown: function(ev) {
      ev.preventDefault();
      OSjs.API.blurMenu();
    },

    message: function(ev) {
      if ( ev && ev.data && typeof ev.data.wid !== 'undefined' && typeof ev.data.pid !== 'undefined' ) {
        console.debug('window::message()', ev.data);
        var proc = OSjs.API.getProcess(ev.data.pid);
        if ( proc ) {
          if ( typeof proc.onPostMessage === 'function' ) {
            proc.onPostMessage(ev.data.message, ev);
          }

          var win  = proc._getWindow(ev.data.wid, 'wid');
          if ( win ) {
            win.onPostMessage(ev.data.message, ev);
          }
        }
      }
    },

    fullscreen: function(ev) {
      var notif = OSjs.Core.getWindowManager().getNotificationIcon('_FullscreenNotification');
      if ( notif ) {
        if ( !document.fullScreen && !document.mozFullScreen && !document.webkitIsFullScreen && !document.msFullscreenElement ) {
          notif.opts._isFullscreen = false;
          notif.setImage(OSjs.API.getIcon('actions/gtk-fullscreen.png', '16x16'));
        } else {
          notif.opts._isFullscreen = true;
          notif.setImage(OSjs.API.getIcon('actions/gtk-leave-fullscreen.png', '16x16'));
        }
      }
    },

    mousedown: function(ev) {
      var wm = OSjs.Core.getWindowManager();
      var win = wm ? wm.getCurrentWindow() : null;
      if ( win ) {
        win._blur();
      }
    },

    keydown: function(ev) {
      var wm  = OSjs.Core.getWindowManager();
      var win = wm ? wm.getCurrentWindow() : null;

      function sendKey(special) {
        if ( wm ) {
          wm.onKeyDown(ev, win, special);
          if ( win ) {
            return win._onKeyEvent(ev, 'keydown', special);
          }
        }
      }

      function checkPrevent() {
        var d = ev.srcElement || ev.target;
        var doPrevent = d.tagName === 'BODY' ? true : false;

        // We don't want backspace and tab triggering default browser events
        if ( (ev.keyCode === OSjs.Utils.Keys.BACKSPACE) && !OSjs.Utils.$isInput(ev) ) {
          doPrevent = true;
        } else if ( (ev.keyCode === OSjs.Utils.Keys.TAB) && OSjs.Utils.$isFormElement(ev) ) {
          doPrevent = true;
        }

        // Only prevent default event if current window is not set up to capture them by force
        if ( doPrevent && (!win || !win._properties.key_capture) ) {
          return true;
        }

        return false;
      }

      function checkShortcut() {
        if ( ((ev.keyCode === 115 || ev.keyCode === 83) && ev.ctrlKey) || ev.keyCode === 19 ) {
          if ( ev.shiftKey ) {
            return 'saveas';
          } else {
            return 'save';
          }
        } else if ( (ev.keyCode === 79 || ev.keyCode === 83) && ev.ctrlKey ) {
          return 'open';
        }
        return false;
      }

      var shortcut = checkShortcut();
      if ( checkPrevent() || shortcut ) {
        ev.preventDefault();
      }

      // WindowManager and Window must always recieve events
      sendKey(shortcut);

      return true;
    },
    keypress: function(ev) {
      var wm = OSjs.Core.getWindowManager();

      if ( wm ) {
        var win = wm.getCurrentWindow();
        if ( win ) {
          return win._onKeyEvent(ev, 'keypress');
        }
      }
      return true;
    },
    keyup: function(ev) {
      var wm = OSjs.Core.getWindowManager();
      if ( wm ) {
        wm.onKeyUp(ev, wm.getCurrentWindow());

        var win = wm.getCurrentWindow();
        if ( win ) {
          return win._onKeyEvent(ev, 'keyup');
        }
      }
      return true;
    },

    beforeunload: function(ev) {
      if ( signingOut ) { return; }

      try {
        if ( OSjs.API.getConfig('ShowQuitWarning') ) {
          return OSjs.API._('MSG_SESSION_WARNING');
        }
      } catch ( e ) {}
    },

    resize: (function() {
      var _timeout;

      function _resize(ev, wasInited) {
        var wm = OSjs.Core.getWindowManager();
        if ( !wm ) { return; }
        wm.resize(ev, wm.getWindowSpace(), wasInited);
      }

      return function(ev, wasInited) {
        if ( _timeout ) {
          clearTimeout(_timeout);
          _timeout = null;
        }

        var self = this;
        _timeout = setTimeout(function() {
          _resize.call(self, ev, wasInited);
        }, 100);
      };
    })(),

    scroll: function(ev) {
      if ( ev.target === document || ev.target === document.body ) {
        ev.preventDefault();
        ev.stopPropagation();
        return false;
      }

      document.body.scrollTop = 0;
      document.body.scrollLeft = 0;
      return true;
    },

    hashchange: function(ev) {
      var hash = window.location.hash.substr(1);
      var spl = hash.split(/^([\w\.\-_]+)\:(.*)/);

      function getArgs(q) {
        var args = {};
        q.split('&').forEach(function(a) {
          var b = a.split('=');
          var k = decodeURIComponent(b[0]);
          args[k] = decodeURIComponent(b[1] || '');
        });
        return args;
      }

      if ( spl.length === 4 ) {
        var root = spl[1];
        var args = getArgs(spl[2]);

        if ( root ) {
          OSjs.API.getProcess(root).forEach(function(p) {
            p._onMessage(null, 'hashchange', {
              source: null,
              hash: hash,
              args: args
            });
          });
        }
      }
    }
  };

  /////////////////////////////////////////////////////////////////////////////
  // INITIALIZERS
  /////////////////////////////////////////////////////////////////////////////

  /**
   * When an error occurs
   */
  function onError(msg) {
    OSjs.API.error(OSjs.API._('ERR_CORE_INIT_FAILED'), OSjs.API._('ERR_CORE_INIT_FAILED_DESC'), msg, null, true);
  }

  /**
   * Initialized some layout stuff
   */
  function initLayout() {
    console.debug('initLayout()');

    var append = OSjs.API.getConfig('VersionAppend');

    var ver = OSjs.API.getConfig('Version', 'unknown version');
    var cop = 'Copyright © 2011-2016 ';
    var lnk = document.createElement('a');
    lnk.setAttribute('aria-hidden', 'true');
    lnk.href = 'mailto:andersevenrud@gmail.com';
    lnk.appendChild(document.createTextNode('Anders Evenrud'));

    var el = document.createElement('div');
    el.id = 'DebugNotice';
    el.setAttribute('aria-hidden', 'true');
    el.appendChild(document.createTextNode(OSjs.Utils.format('OS.js {0}', ver)));
    el.appendChild(document.createElement('br'));
    el.appendChild(document.createTextNode(cop));
    el.appendChild(lnk);
    if ( append ) {
      el.appendChild(document.createElement('br'));
      el.innerHTML += append;
    }

    document.getElementById('LoadingScreen').style.display = 'none';

    document.body.appendChild(el);
  }

  /**
   * Initializes handler
   */
  function initHandler(config, callback) {
    console.debug('initHandler()');

    handler = new OSjs.Core.Handler();
    handler.init(function(error) {
      if ( inited ) {
        return;
      }
      inited = true;

      if ( error ) {
        onError(error);
        return;
      }

      callback();
    });
  }

  /**
   * Initializes events
   */
  function initEvents() {
    console.debug('initEvents()');

    document.body.addEventListener('contextmenu', events.body_contextmenu, false);
    document.body.addEventListener('mousedown', events.body_mousedown, false);
    document.addEventListener('keydown', events.keydown, true);
    document.addEventListener('keypress', events.keypress, true);
    document.addEventListener('keyup', events.keyup, true);
    document.addEventListener('mousedown', events.mousedown, false);
    window.addEventListener('hashchange', events.hashchange, false);
    window.addEventListener('resize', events.resize, false);
    window.addEventListener('scroll', events.scroll, false);
    window.addEventListener('fullscreenchange', events.fullscreen, false);
    window.addEventListener('mozfullscreenchange', events.fullscreen, false);
    window.addEventListener('webkitfullscreenchange', events.fullscreen, false);
    window.addEventListener('msfullscreenchange', events.fullscreen, false);
    window.addEventListener('message', events.message, false);
    window.onbeforeunload = events.beforeunload;

    window.onerror = function(message, url, linenumber, column, exception) {
      if ( typeof exception === 'string' ) {
        exception = null;
      }
      console.warn('window::onerror()', arguments);
      OSjs.API.error(OSjs.API._('ERR_JAVASCRIPT_EXCEPTION'),
                    OSjs.API._('ERR_JAVACSRIPT_EXCEPTION_DESC'),
                    OSjs.API._('BUGREPORT_MSG'),
                    exception || {name: 'window::onerror()', fileName: url, lineNumber: linenumber + ':' + column, message: message},
                    true );

      return false;
    };
  }

  /**
   * Preloads configured files
   */
  function initPreload(config, callback) {
    console.debug('initPreload()');

    var preloads = config.Preloads;
    preloads.forEach(function(val, index) {
      val.src = OSjs.Utils.checkdir(val.src);
    });

    OSjs.Utils.preload(preloads, function(total, failed) {
      if ( failed.length ) {
        console.warn('doInitialize()', 'some preloads failed to load:', failed);
      }

      setTimeout(function() {
        callback();
      }, 0);
    });
  }

  /**
   * Loads all extensions
   */
  function initExtensions(config, callback) {
    var exts = Object.keys(OSjs.Extensions);
    var manifest =  OSjs.Core.getMetadata();

    console.group('initExtensions()', exts);
    OSjs.Utils.asyncs(exts, function(entry, idx, next) {
      try {
        var m = manifest[entry];
        OSjs.Extensions[entry].init(m, function() {
          next();
        });
      } catch ( e ) {
        console.warn('Extension init failed', e.stack, e);
        next();
      }
    }, function() {
      console.groupEnd();
      callback();
    });
  }

  /**
   * Initializes the SettingsManager pools
   * from configuration file(s)
   */
  function initSettingsManager(cfg, callback) {
    console.debug('initSettingsManager()');
    var pools = cfg.SettingsManager || {};
    var manager = OSjs.Core.getSettingsManager();

    Object.keys(pools).forEach(function(poolName) {
      console.debug('initSettingsManager()', 'initializes pool', poolName, pools[poolName]);
      manager.instance(poolName, pools[poolName] || {});
    });

    callback();
  }

  /**
   * Initializes the PackageManager
   */
  function initPackageManager(cfg, callback) {
    OSjs.Core.getPackageManager().load(function(result, error) {
      callback(error, result);
    });
  }

  /**
   * Initalizes the VFS
   */
  function initVFS(config, callback) {
    console.debug('initVFS()');
    if ( OSjs.VFS.registerMountpoints ) {
      OSjs.VFS.registerMountpoints();
    }

    callback();
  }

  /**
   * Initializes the Window Manager
   */
  function initWindowManager(config, callback) {
    console.debug('initWindowManager()');
    if ( !config.WM || !config.WM.exec ) {
      onError(OSjs.API._('ERR_CORE_INIT_NO_WM'));
      return;
    }

    OSjs.API.launch(config.WM.exec, (config.WM.args || {}), function(app) {
      app.setup(callback);
    }, function(error, name, args, exception) {
      onError(OSjs.API._('ERR_CORE_INIT_WM_FAILED_FMT', error), exception);
    });
  }

  /**
   * Initializes the Session
   */
  function initSession(config, callback) {
    console.debug('initSession()');
    OSjs.API.playSound('service-login');

    var wm = OSjs.Core.getWindowManager();

    function autostart(cb) {
      var start = [];

      try {
        start = config.AutoStart;
      } catch ( e ) {
        console.warn('initSession()->autostart()', 'exception', e, e.stack);
      }

      console.info('initSession()->autostart()', start);
      OSjs.API.launchList(start, null, null, cb);
    }

    function session() {
      handler.loadSession(function() {
        setTimeout(function() {
          events.resize(null, true);
        }, 500);

        callback();

        wm.onSessionLoaded();
      });
    }

    autostart(function() {
      session();
    });
  }

  /**
   * Wrapper for initializing OS.js
   */
  function init() {
    console.group('init()');

    var config = OSjs.Core.getConfig();
    var splash = document.getElementById('LoadingScreen');
    var loading = OSjs.API.createSplash('OS.js', null, null, splash);

    initLayout();

    initPreload(config, function() {
      OSjs.API.triggerHook('onInitialize');

      initHandler(config, function() {

        initPackageManager(config, function() {
          loading.update(3, 8);

          initExtensions(config, function() {
            loading.update(4, 8);

            initSettingsManager(config, function() {
              loading.update(5, 8);

              initVFS(config, function() {
                loading.update(6, 8);

                OSjs.API.triggerHook('onInited');

                OSjs.GUI.DialogScheme.init(function() {
                  loading.update(7, 8);

                  initWindowManager(config, function() {
                    loading = loading.destroy();
                    splash = OSjs.Utils.$remove(splash);

                    OSjs.API.triggerHook('onWMInited');

                    initEvents();
                    var wm = OSjs.Core.getWindowManager();
                    wm._fullyLoaded = true;

                    console.groupEnd();

                    initSession(config, function() {
                      OSjs.API.triggerHook('onSessionLoaded');
                    });
                  }); // wm
                });

              }); // vfs
            }); // settings
          }); // extensions
        }); // packages
      }); // handler
    }); // preload
  }

  /////////////////////////////////////////////////////////////////////////////
  // EXPORTS
  /////////////////////////////////////////////////////////////////////////////

  /**
   * Shuts down OS.js
   *
   * @api OSjs.API.shutdown()
   */
  OSjs.API.shutdown = function() {
    if ( !inited || !loaded ) {
      return;
    }

    signingOut = true;

    document.body.removeEventListener('contextmenu', events.body_contextmenu, false);
    document.body.removeEventListener('mousedown', events.body_mousedown, false);
    document.removeEventListener('keydown', events.keydown, true);
    document.removeEventListener('keypress', events.keypress, true);
    document.removeEventListener('keyup', events.keyup, true);
    document.removeEventListener('mousedown', events.mousedown, false);
    window.removeEventListener('hashchange', events.hashchange, false);
    window.removeEventListener('resize', events.resize, false);
    window.removeEventListener('scroll', events.scroll, false);
    window.removeEventListener('message', events.message, false);

    window.onerror = null;
    window.onbeforeunload = null;

    OSjs.API.blurMenu();
    OSjs.API.killAll();
    OSjs.GUI.DialogScheme.destroy();

    var ring = OSjs.API.getServiceNotificationIcon();
    if ( ring ) {
      ring.destroy();
    }

    var handler = OSjs.Core.getHandler();
    if ( handler ) {
      handler.destroy();
      handler = null;
    }

    console.warn('OS.js was shut down!');

    if ( OSjs.API.getConfig('Connection.Type') === 'nw' ) {
      try {
        var gui = require('nw.gui');
        var win = gui.Window.get();
        setTimeout(function() {
          win.close();
        }, 500);
      } catch ( e ) {
      }
    } else {
      if ( OSjs.API.getConfig('ReloadOnShutdown') === true ) {
        window.location.reload();
      }
    }
  };

  /////////////////////////////////////////////////////////////////////////////
  // FILLERS
  /////////////////////////////////////////////////////////////////////////////

  /**
   * Get default configured settings
   *
   * THIS IS JUST A PLACEHOLDER. 'settings.js' SHOULD HAVE THIS!
   *
   * You should use 'OSjs.API.getConfig()' to get a setting
   *
   * @return  Object
   *
   * @see     OSjs.API.getConfig()
   * @api     OSjs.Core.getConfig()
   */
  OSjs.Core.getConfig = OSjs.Core.getConfig || function() {
    return {};
  };

  /**
   * Get default configured packages
   *
   * THIS IS JUST A PLACEHOLDER. 'packages.js' SHOULD HAVE THIS!
   *
   * @return  Object
   *
   * @api     OSjs.Core.getMetadata()
   */
  OSjs.Core.getMetadata = OSjs.Core.getMetadata || function() {
    return {};
  };

  /////////////////////////////////////////////////////////////////////////////
  // MAIN
  /////////////////////////////////////////////////////////////////////////////

  (function() {
    function onLoad() {
      if ( loaded ) {
        return;
      }
      loaded = true;
      init();
    }

    function onUnload() {
      OSjs.API.shutdown();
    }

    document.addEventListener('DOMContentLoaded', onLoad);
    document.addEventListener('load', onLoad);
    document.addEventListener('unload', onUnload);
  })();

})();
