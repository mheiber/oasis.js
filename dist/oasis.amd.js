define("oasis",
  ["oasis/util","oasis/xhr","oasis/connect","rsvp","oasis/logger","oasis/version","oasis/config","oasis/sandbox","oasis/sandbox_init","oasis/events","oasis/service","oasis/iframe_adapter","oasis/webworker_adapter","oasis/inline_adapter"],
  function(__dependency1__, __dependency2__, __dependency3__, RSVP, logger, Version, OasisConfiguration, Sandbox, autoInitializeSandbox, Events, Service, IframeAdapter, WebworkerAdapter, InlineAdapter) {
    "use strict";
    var assert = __dependency1__.assert;
    var delegate = __dependency1__.delegate;
    var xhr = __dependency2__.xhr;
    var connect = __dependency3__.connect;
    var connectCapabilities = __dependency3__.connectCapabilities;
    var portFor = __dependency3__.portFor;



    function Oasis() {
      // Data structures used by Oasis when creating sandboxes
      this.packages = {};
      this.requestId = 0;
      this.oasisId = 'oasis' + (+new Date());

      this.consumers = {};
      this.services = [];

      // Data structures used when connecting to a parent sandbox
      this.ports = {};
      this.handlers = {};

      this.receivedPorts = false;

      this.configuration = new OasisConfiguration();
      this.events = new Events();

      this.didCreate();
    }

    Oasis.Version = Version;
    Oasis.Service = Oasis.Consumer = Service;
    Oasis.RSVP = RSVP;

    Oasis.reset = function () {
      Oasis.adapters = {
        iframe: new IframeAdapter(),
        webworker: new WebworkerAdapter(),
        inline: new InlineAdapter()
      };
    };

    Oasis.reset();

    Oasis.prototype = {
      logger: logger,
      log: function () {
        this.logger.log.apply(this.logger, arguments);
      },

      on: delegate('events', 'on'),
      off: delegate('events', 'off'),
      trigger: delegate('events', 'trigger'),

      didCreate: function() {},

      xhr: xhr,

      /**
        This is the entry point that allows the containing environment to create a
        child sandbox.

        Options:

        * `capabilities`: an array of registered services
        * `url`: a registered URL to a JavaScript file that will initialize the
          sandbox in the sandboxed environment
        * `adapter`: a reference to an adapter that will handle the lifecycle
          of the sandbox. Right now, there are iframe and web worker adapters.

        @param {Object} options
      */
      createSandbox: function (options) {
        return new Sandbox(this, options);
      },

      /**
        This registers a sandbox type inside of the containing environment so that
        it can be referenced by URL in `createSandbox`.

        Options:

        * `capabilities`: An array of service names that will be supplied when calling
          `createSandbox`
        * `url`: The URL of the JavaScript file that contains the sandbox code

        @param {Object} options
      */
      register: function (options) {
        assert(options.capabilities, "You are trying to register a package without any capabilities. Please provide a list of requested capabilities, or an empty array ([]).");

        this.packages[options.url] = options;
      },

      configure: function(name, value) { this.configuration[name] = value; },
      autoInitializeSandbox: autoInitializeSandbox,

      connect: connect,
      connectCapabilities: connectCapabilities,
      portFor: portFor
    };



    return Oasis;
  });
define("oasis/base_adapter",
  ["oasis/util","oasis/shims","oasis/connect","oasis/message_channel","rsvp","oasis/logger"],
  function(__dependency1__, __dependency2__, __dependency3__, __dependency4__, RSVP, Logger) {
    "use strict";
    var mustImplement = __dependency1__.mustImplement;
    var addEventListener = __dependency2__.addEventListener;
    var removeEventListener = __dependency2__.removeEventListener;
    var a_indexOf = __dependency2__.a_indexOf;
    var a_filter = __dependency2__.a_filter;
    var connectCapabilities = __dependency3__.connectCapabilities;
    var PostMessageMessageChannel = __dependency4__.PostMessageMessageChannel;



    function BaseAdapter() {
      this._unsupportedCapabilities = [];
    }

    BaseAdapter.prototype = {
      initializeSandbox: mustImplement('BaseAdapter', 'initializeSandbox'),
      name: mustImplement('BaseAdapter', 'name'),

      unsupportedCapabilities: function () {
        return this._unsupportedCapabilities;
      },

      addUnsupportedCapability: function (capability) {
        this._unsupportedCapabilities.push(capability);
      },

      filterCapabilities: function(capabilities) {
        var unsupported = this._unsupportedCapabilities;
        return a_filter.call(capabilities, function (capability) {
          var index = a_indexOf.call(unsupported, capability);
          return index === -1;
        });
      },

      createChannel: function(oasis) {
        var channel = new PostMessageMessageChannel(oasis);
        channel.port1.start();
        return channel;
      },

      environmentPort: function(sandbox, channel) {
        return channel.port1;
      },

      sandboxPort: function(sandbox, channel) {
        return channel.port2;
      },

      proxyPort: function(sandbox, port) {
        return port;
      },

      connectSandbox: function (receiver, oasis) {
        var adapter = this;

        Logger.log("Sandbox listening for initialization message");

        function initializeOasisSandbox(event) {
          if (!event.data.isOasisInitialization) { return; }

          removeEventListener(receiver, 'message', initializeOasisSandbox);
          adapter.initializeOasisSandbox(event, oasis);
        }
        addEventListener(receiver, 'message', initializeOasisSandbox);

        adapter.oasisLoaded(oasis);
      },

      initializeOasisSandbox: function (event, oasis) {
        var adapter = this;
        oasis.configuration.eventCallback(function () {
          Logger.log("sandbox: received initialization message.");

          oasis.connectCapabilities(event.data.capabilities, event.ports);

          adapter.didConnect(oasis);
        });
      },

      createInitializationMessage: function (sandbox) {
        return {
          isOasisInitialization: true,
          capabilities: sandbox._capabilitiesToConnect,
        };
      },

      oasisLoadedMessage: "oasisSandboxLoaded",
      sandboxInitializedMessage:  "oasisSandboxInitialized"
    };


    return BaseAdapter;
  });
define("oasis/config",
  [],
  function() {
    "use strict";
    /**
      Stores Oasis configuration.  Options include:

      - `eventCallback` - a function that wraps `message` event handlers.  By
        default the event hanlder is simply invoked.
      - `allowSameOrigin` - a card can be hosted on the same domain
      - `reconnect` - the default reconnect options for iframe sandboxes.  Possible values are:
        - "none" - do not allow sandbox reconnection
        - "verify" - only allow reconnections from the original origin of the sandbox
        - "any" - allow any sandbox reconnections.  Only use this setting if you are
          using Oasis strictly for isolation of trusted applications or if it's safe
          to connect your sandbox to arbitrary origins.  This is an advanced setting
          and should be used with care.
    */
    function OasisConfiguration() {
      this.eventCallback = function (callback) { callback(); };
      this.allowSameOrigin = false;
      this.reconnect = 'verify';
    }


    return OasisConfiguration;
  });
define("oasis/connect",
  ["oasis/util","oasis/shims","oasis/message_channel","rsvp","oasis/logger","exports"],
  function(__dependency1__, __dependency2__, __dependency3__, RSVP, Logger, __exports__) {
    "use strict";
    var assert = __dependency1__.assert;
    var a_forEach = __dependency2__.a_forEach;
    var PostMessagePort = __dependency3__.PostMessagePort;


    function registerHandler(oasis, capability, options) {
      var port = oasis.ports[capability];

      if (port) {
        Logger.log(oasis.oasisId, "sandbox: found port, setting up '" + capability + "'");
        options.setupCapability(port);

        if (options.promise) {
          options.promise.then(function() {
            port.start();
          })['catch'](RSVP.rethrow);
        } else {
          port.start();
        }
      } else if (!oasis.receivedPorts) {
        Logger.log("No port found, saving handler for '" + capability + "'");
        oasis.handlers[capability] = options;
      } else {
        Logger.log("No port was sent for capability '" + capability + "'");
        options.rejectCapability();
      }
    }

    /**
      This is the main entry point that allows sandboxes to connect back
      to their containing environment.

      It can be called either with a set of named consumers, with callbacks, or using promises.

      Example

        // Using promises
        Oasis.connect('foo').then( function (port) {
          port.send('hello');
        }, function () {
          // error
        });


        // using callbacks
        Oasis.connect('foo', function (port) {
          port.send('hello');
        }, errorHandler);


        // connecting several consumers at once.
        var ConsumerA = Oasis.Consumer.extend({
          initialize: function (port) { this.port = port; },

          error: function () { }
        });

        var ConsumerB = Oasis.Consumer.extend({
          initialize: function (port) { this.port = port; },

          error: function () { }
        });

        Oasis.connect({
          consumers: {
            capabilityA: ConsumerA,
            capabilityB: ConsumerB
          }
        });

      @param {String} capability the name of the service to connect to, or an object
        containing named consumers to connect.
      @param {Function?} callback the callback to trigger once the other
        side of the connection is available.
      @param {Function?} errorCallback the callback to trigger if the capability is
        not provided by the environment.
      @return {Promise} a promise that will be resolved once the other
        side of the connection is available. You can use this instead
        of the callbacks.
    */
    function connect(capability, callback, errorCallback) {
      if (typeof capability === 'object') {
        return connectConsumers(this, capability.consumers);
      } else if (callback) {
        return connectCallbacks(this, capability, callback, errorCallback);
      } else {
        return connectPromise(this, capability);
      }
    }

    function connectCapabilities(capabilities, eventPorts) {
      var oasis = this;
      a_forEach.call(capabilities, function(capability, i) {
        var handler = oasis.handlers[capability],
            port = new PostMessagePort(oasis, eventPorts[i]);

        if (handler) {
          Logger.log("Invoking handler for '" + capability + "'");

          RSVP.resolve(handler.setupCapability(port)).then(function () {
            port.start();
          })['catch'](RSVP.rethrow);
        }

        oasis.ports[capability] = port;
      });

      // for each handler w/o capability, reject
      for( var prop in oasis.handlers ) {
        if( ! oasis.ports[prop] ) {
          oasis.handlers[prop].rejectCapability();
        }
      }

      this.receivedPorts = true;
    }

    function portFor(capability) {
      var port = this.ports[capability];
      assert(port, "You asked for the port for the '" + capability + "' capability, but the environment did not provide one.");
      return port;
    }


    function connectConsumers(oasis, consumers) {
      function setupCapability(Consumer, name) {
        return function(port) {
          var consumer = new Consumer(port);
          oasis.consumers[name] = consumer;
          consumer.initialize(port, name);
        };
      }

      function rejectCapability(prop) {
        return function () {
          consumers[prop].prototype.error();
        };
      }

      for (var prop in consumers) {
        registerHandler(oasis, prop, {
          setupCapability: setupCapability(consumers[prop], prop),
          rejectCapability: rejectCapability(prop)
        });
      }
    }

    function connectCallbacks(oasis, capability, callback, errorCallback) {
      Logger.log("Connecting to '" + capability + "' with callback.");

      registerHandler(oasis, capability, {
        setupCapability: function(port) {
          callback(port);
        },
        rejectCapability: function () {
          if (errorCallback) {
            errorCallback();
          }
        }
      });
    }

    function connectPromise(oasis, capability) {
      Logger.log("Connecting to '" + capability + "' with promise.");

      var defered = RSVP.defer();
      registerHandler(oasis, capability, {
        promise: defered.promise,
        setupCapability: function(port) {
          defered.resolve(port);
          return defered.promise;
        },
        rejectCapability: function () {
          defered.reject();
        }
      });
      return defered.promise;
    }

    __exports__.registerHandler = registerHandler;
    __exports__.connect = connect;
    __exports__.connectCapabilities = connectCapabilities;
    __exports__.portFor = portFor;
  });
define("oasis/events",
  [],
  function() {
    "use strict";
    var a_slice = Array.prototype.slice;

    function Events() {
      this.listenerArrays = {};
    }

    Events.prototype = {
      on: function (eventName, listener) {
        var listeners = this.listenerArrays[eventName] = this.listenerArrays[eventName] || [];

        listeners.push(listener);
      },

      off: function (eventName, listener) {
        var listeners = this.listenerArrays[eventName];
        if (!listeners) { return; }

        for (var i=0; i<listeners.length; ++i) {
          if (listeners[i] === listener) {
            listeners.splice(i, 1);
            break;
          }
        }
      },

      clear: function(eventName) {
        delete this.listenerArrays[eventName];
      },

      trigger: function(eventName) {
        var listeners = this.listenerArrays[eventName];
        if (!listeners) { return; }

        var args = a_slice.call(arguments, 1);

        for (var i=0; i<listeners.length; ++i) {
          listeners[i].apply(null, args);
        }
      }
    };


    return Events;
  });
define("oasis/iframe_adapter",
  ["oasis/util","oasis/shims","rsvp","oasis/logger","oasis/base_adapter"],
  function(__dependency1__, __dependency2__, RSVP, Logger, BaseAdapter) {
    "use strict";
    var assert = __dependency1__.assert;
    var extend = __dependency1__.extend;
    var a_forEach = __dependency2__.a_forEach;
    var addEventListener = __dependency2__.addEventListener;
    var removeEventListener = __dependency2__.removeEventListener;
    var a_map = __dependency2__.a_map;
    /*global Window, UUID */



    function verifySandbox(oasis, sandboxUrl) {
      var iframe = document.createElement('iframe'),
          link;

      if( (oasis.configuration.allowSameOrigin && iframe.sandbox !== undefined) ||
          (iframe.sandbox === undefined) ) {
        // The sandbox attribute isn't supported (IE8/9) or we want a child iframe
        // to access resources from its own domain (youtube iframe),
        // we need to make sure the sandbox is loaded from a separate domain
        link = document.createElement('a');
        link.href = sandboxUrl;

        if( !link.host || (link.protocol === window.location.protocol && link.host === window.location.host) ) {
          throw new Error("Security: iFrames from the same host cannot be sandboxed in older browsers and is disallowed.  " +
                          "For HTML5 browsers supporting the `sandbox` attribute on iframes, you can add the `allow-same-origin` flag" +
                          "only if you host the sandbox on a separate domain.");
        }
      }
    }

    function verifyCurrentSandboxOrigin(sandbox, event) {
      var linkOriginal, linkCurrent;

      if (sandbox.firstLoad || sandbox.options.reconnect === "any") {
        return true;
      }

      if (!sandbox.oasis.configuration.allowSameOrigin || event.origin === "null") {
        fail();
      } else {
        linkOriginal = document.createElement('a');
        linkCurrent = document.createElement('a');

        linkOriginal.href = sandbox.options.url;
        linkCurrent.href = event.origin;

        if (linkCurrent.protocol === linkOriginal.protocol &&
            linkCurrent.host === linkOriginal.host) {
          return true;
        }

        fail();
      }

      function fail() {
        sandbox.onerror(
          new Error("Cannot reconnect null origins unless `reconnect` is set to " +
                    "'any'.  `reconnect: 'verify' requires `allowSameOrigin: " +
                    "true`"));
      }
    }

    function isUrl(s) {
      var regexp = /(ftp|http|https):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!\-\/]))?/;
      return regexp.test(s);
    }

    var IframeAdapter = extend(BaseAdapter, {
      //-------------------------------------------------------------------------
      // Environment API

      initializeSandbox: function(sandbox) {
        var options = sandbox.options,
            iframe = document.createElement('iframe'),
            sandboxAttributes = ['allow-scripts'];

        if( sandbox.oasis.configuration.allowSameOrigin ) {
          sandboxAttributes.push('allow-same-origin');
        }
        if( options && options.sandbox && options.sandbox.popups ) {
          sandboxAttributes.push('allow-popups');
        }

        iframe.name = sandbox.options.url + '?uuid=' + UUID.generate();
        iframe.sandbox = sandboxAttributes.join(' ');
        iframe.seamless = true;

        // rendering-specific code
        if (options.width) {
          iframe.width = options.width;
        } else if (options.height) {
          iframe.height = options.height;
        }

        // Error handling inside the iFrame
        iframe.errorHandler = function(event) {
          if(!event.data.sandboxException) {return;}
          try {
            // verify this message came from the expected sandbox; try/catch
            // because ie8 will disallow reading contentWindow in the case of
            // another sandbox's message
            if( event.source !== iframe.contentWindow ) {return;}
          } catch(e) {
            return;
          }

          sandbox.onerror( event.data.sandboxException );
        };
        addEventListener(window, 'message', iframe.errorHandler);

        verifySandbox( sandbox.oasis, sandbox.options.url );
        iframe.src = sandbox.options.url;

        Logger.log('Initializing sandbox ' + iframe.name);

        // Promise that sandbox has loaded and capabilities connected at least once.
        // This does not mean that the sandbox will be loaded & connected in the
        // face of reconnects (eg pages that navigate)
        sandbox._waitForLoadDeferred().resolve(new RSVP.Promise( function(resolve, reject) {
          iframe.initializationHandler = function (event) {
            if( event.data !== sandbox.adapter.sandboxInitializedMessage ) {return;}
            try {
              // verify this message came from the expected sandbox; try/catch
              // because ie8 will disallow reading contentWindow in the case of
              // another sandbox's message
              if( event.source !== iframe.contentWindow ) {return;}
            } catch(e) {
              return;
            }
            removeEventListener(window, 'message', iframe.initializationHandler);

            sandbox.oasis.configuration.eventCallback(function () {
              Logger.log("container: iframe sandbox has initialized (capabilities connected)");
              resolve(sandbox);
            });
          };
          addEventListener(window, 'message', iframe.initializationHandler);
        }));

        sandbox.el = iframe;

        iframe.oasisLoadHandler = function (event) {
          if( event.data !== sandbox.adapter.oasisLoadedMessage ) {return;}
          try {
            // verify this message came from the expected sandbox; try/catch
            // because ie8 will disallow reading contentWindow in the case of
            // another sandbox's message
            if( event.source !== iframe.contentWindow ) {return;}
          } catch(e) {
            return;
          }

          Logger.log("container: iframe sandbox has loaded Oasis");


          if (verifyCurrentSandboxOrigin(sandbox, event)) {
            sandbox.createAndTransferCapabilities();
          }

          if (sandbox.options.reconnect === "none") {
            removeEventListener(window, 'message', iframe.oasisLoadHandler);
          }
        };
        addEventListener(window, 'message', iframe.oasisLoadHandler);
      },

      startSandbox: function(sandbox) {
        var head = document.head || document.documentElement.getElementsByTagName('head')[0];
        head.appendChild(sandbox.el);
      },

      terminateSandbox: function(sandbox) {
        var el = sandbox.el;

        sandbox.terminated = true;

        if (el.loadHandler) {
          // no load handler for HTML sandboxes
          removeEventListener(el, 'load', el.loadHandler);
        }
        removeEventListener(window, 'message', el.initializationHandler);
        removeEventListener(window, 'message', el.oasisLoadHandler);

        if (el.parentNode) {
          Logger.log("Terminating sandbox ", sandbox.el.name);
          el.parentNode.removeChild(el);
        }

        sandbox.el = null;
      },

      connectPorts: function(sandbox, ports) {
        var rawPorts = a_map.call(ports, function(port) { return port.port; }),
            message = this.createInitializationMessage(sandbox);

        if (sandbox.terminated) { return; }
        Window.postMessage(sandbox.el.contentWindow, message, '*', rawPorts);
      },

      //-------------------------------------------------------------------------
      // Sandbox API

      connectSandbox: function(oasis) {
        return BaseAdapter.prototype.connectSandbox.call(this, window, oasis);
      },

      oasisLoaded: function() {
        window.parent.postMessage(this.oasisLoadedMessage, '*', []);
      },

      didConnect: function() {
        window.parent.postMessage(this.sandboxInitializedMessage, '*', []);
      },

      name: function(sandbox) {
        return sandbox.el.name;
      }

    });


    return IframeAdapter;
  });
define("oasis/inline_adapter",
  ["oasis/util","oasis/config","oasis/shims","oasis/xhr","rsvp","oasis/logger","oasis/base_adapter"],
  function(__dependency1__, __dependency2__, __dependency3__, __dependency4__, RSVP, Logger, BaseAdapter) {
    "use strict";
    var assert = __dependency1__.assert;
    var extend = __dependency1__.extend;
    var noop = __dependency1__.noop;
    var configuration = __dependency2__.configuration;
    var a_forEach = __dependency3__.a_forEach;
    var a_map = __dependency3__.a_map;
    var xhr = __dependency4__.xhr;
    /*global self, postMessage, importScripts */



    var InlineAdapter = extend(BaseAdapter, {
      //-------------------------------------------------------------------------
      // Environment API

      initializeSandbox: function(sandbox) {
        sandbox.el = document.createElement('div');

        var oasis = sandbox.sandboxedOasis = new Oasis();
        sandbox.sandboxedOasis.sandbox = sandbox;
        RSVP.async(function () {
          sandbox.createAndTransferCapabilities();
        });
      },
 
      startSandbox: function(sandbox) {
        var body = document.body || document.documentElement.getElementsByTagName('body')[0];
        body.appendChild(sandbox.el);
      },

      terminateSandbox: function(sandbox) {
        var el = sandbox.el;

        if (el.parentNode) {
          Logger.log("Terminating sandbox ", sandbox.el.name);
          el.parentNode.removeChild(el);
        }

        sandbox.el = null;
      },

      connectPorts: function(sandbox, ports) {
        var rawPorts = a_map.call(ports, function(oasisPort){ return oasisPort.port; }),
            message = this.createInitializationMessage(sandbox),
            event = { data: message, ports: rawPorts };

        // Normally `connectSandbox` is called in autoinitialization, but there
        // isn't a real sandbox here.
        this.connectSandbox(sandbox.sandboxedOasis, event);
      },

      fetchResource: function (url, oasis) {
        var adapter = this;

        return xhr(url, {
          dataType: 'text'
        }, oasis).then(function (code) {
          return adapter.wrapResource(code);
        })['catch'](RSVP.rethrow);
      },

      wrapResource: function (code) {
        return new Function("oasis", code);
      },

      //-------------------------------------------------------------------------
      // Sandbox API

      connectSandbox: function(oasis, pseudoEvent) {
        return this.initializeOasisSandbox(pseudoEvent, oasis);
      },

      oasisLoaded: noop,

      didConnect: function(oasis) {
        var adapter = this;

        return oasis.sandbox._waitForLoadDeferred().resolve(loadSandboxJS()['catch'](RSVP.rethrow));

        function applySandboxJS(sandboxFn) {
          Logger.log("sandbox: inline sandbox initialized");
          sandboxFn(oasis);
          return oasis.sandbox;
        }

        function loadSandboxJS() {
          return new RSVP.Promise(function (resolve, reject) {
            resolve(adapter.fetchResource(oasis.sandbox.options.url, oasis).
              then(applySandboxJS));
          });
        }
      },
    });


    return InlineAdapter;
  });
define("oasis/logger",
  [],
  function() {
    "use strict";
    function Logger() {
      this.enabled = false;
    }

    Logger.prototype = {
      enable: function () {
        this.enabled = true;
      },

      disable: function () {
        this.enabled = false;
      },

      log: function () {
        if (logger.enabled) {
          if (typeof console !== 'undefined' && typeof console.log === 'function') {
            console.log.apply(console, arguments);
          } else if (typeof console !== 'undefined' && typeof console.log === 'object') {
            // Log in IE
            try {
              switch (arguments.length) {
                case 1:
                  console.log(arguments[0]);
                  break;
                case 2:
                  console.log(arguments[0], arguments[1]);
                  break;
                default:
                  console.log(arguments[0], arguments[1], arguments[2]);
              }
            } catch(e) {}
          }
        }
      }
    };

    var logger = new Logger();


    return logger;
  });
define("oasis/message_channel",
  ["oasis/util","rsvp","exports"],
  function(__dependency1__, RSVP, __exports__) {
    "use strict";
    var extend = __dependency1__.extend;
    var mustImplement = __dependency1__.mustImplement;

    /**
      OasisPort is an interface that adapters can use to implement ports.
      Ports are passed into the `initialize` method of services and consumers,
      and are available as `this.port` on services and consumers.

      Ports are the low-level API that can be used to communicate with the
      other side of a connection. In general, you will probably want to use
      the `events` and `requests` objects inside your service or consumer
      rather than manually listen for events and requests.

      @constructor
      @param {OasisPort} oasis
      @param {OasisPort} port
    */
    function OasisPort(oasis, port) {}


    function getRequestId(oasis) {
      return oasis.oasisId + '-' + oasis.requestId++;
    }

    OasisPort.prototype = {
      /**
        This allows you to register an event handler for a particular event
        name.

        @param {String} eventName the name of the event
        @param {Function} callback the callback to call when the event occurs
        @param {any?} binding an optional value of `this` inside of the callback
      */
      on: mustImplement('OasisPort', 'on'),

      /**
        Allows you to register an event handler that is called for all events
        that are sent to the port.
      */
      all: mustImplement('OasisPort', 'all'),

      /**
        This allows you to unregister an event handler for an event name
        and callback. You should not pass in the optional binding.

        @param {String} eventName the name of the event
        @param {Function} callback a reference to the callback that was
          passed into `.on`.
      */
      off: mustImplement('OasisPort', 'off'),

      /**
        This method sends an event to the other side of the connection.

        @param {String} eventName the name of the event
        @param {Structured?} data optional data to pass along with the event
      */
      send: mustImplement('OasisPort', 'send'),

      /**
        @private

        Adapters should implement this to start receiving messages from the
        other side of the connection.

        It is up to the adapter to make sure that no messages are dropped if
        they are sent before `start` is called.
      */
      start: mustImplement('OasisPort', 'start'),

      /**
        @private

        Adapters should implement this to stop receiving messages from the
        other side of the connection.
      */
      close: mustImplement('OasisPort', 'close'),

      /**
        This method sends a request to the other side of the connection.

        @param {String} requestName the name of the request
        @return {Promise} a promise that will be resolved with the value
          provided by the other side of the connection, or rejected if the other
          side indicates retrieving the value resulted in an error. The fulfillment
          value must be structured data.
      */
      request: function(eventName) {
        var oasis = this.oasis;
        var port = this;
        var args = [].slice.call(arguments, 1);

        return new RSVP.Promise(function (resolve, reject) {
          var requestId = getRequestId(oasis);

          var clearObservers = function () {
            port.off('@response:' + eventName, observer);
            port.off('@errorResponse:' + eventName, errorObserver);
          };

          var observer = function(event) {
            if (event.requestId === requestId) {
              clearObservers();
              resolve(event.data);
            }
          };

          var errorObserver = function (event) {
            if (event.requestId === requestId) {
              clearObservers();
              reject(event.data);
            }
          };

          port.on('@response:' + eventName, observer, port);
          port.on('@errorResponse:' + eventName, errorObserver, port);
          port.send('@request:' + eventName, { requestId: requestId, args: args });
        });
      },

      /**
        This method registers a callback to be called when a request is made
        by the other side of the connection.

        The callback will be called with any arguments passed in the request.  It
        may either return a value directly, or return a promise if the value must be
        retrieved asynchronously.

        Examples:

          // This completes the request immediately.
          service.onRequest('name', function () {
            return 'David';
          });


          // This completely the request asynchronously.
          service.onRequest('name', function () {
            return new Oasis.RSVP.Promise(function (resolve, reject) {
              setTimeout( function() {
                resolve('David');
              }, 200);
            });
          });

        @param {String} requestName the name of the request
        @param {Function} callback the callback to be called when a request
          is made.
        @param {any?} binding the value of `this` in the callback
      */
      onRequest: function(eventName, callback, binding) {
        var self = this;

        this.on('@request:' + eventName, function(data) {
          var requestId = data.requestId,
              args = data.args,
              getResponse = new RSVP.Promise(function (resolve, reject) {
                var value = callback.apply(binding, data.args);
                if (undefined !== value) {
                  resolve(value);
                } else {
                  reject("@request:" + eventName + " [" + data.requestId + "] did not return a value.  If you want to return a literal `undefined` return `RSVP.resolve(undefined)`");
                }
              });

          getResponse.then(function (value) {
            self.send('@response:' + eventName, {
              requestId: requestId,
              data: value
            });
          }, function (error) {
            var value = error;
            if (error instanceof Error) {
              value = {
                message: error.message,
                stack: error.stack
              };
            }
            self.send('@errorResponse:' + eventName, {
              requestId: requestId,
              data: value
            });
          });
        });
      }
    };


    function OasisMessageChannel(oasis) {}

    OasisMessageChannel.prototype = {
      start: mustImplement('OasisMessageChannel', 'start')
    };


    var PostMessageMessageChannel = extend(OasisMessageChannel, {
      initialize: function(oasis) {
        this.channel = new MessageChannel();
        this.port1 = new PostMessagePort(oasis, this.channel.port1);
        this.port2 = new PostMessagePort(oasis, this.channel.port2);
      },

      start: function() {
        this.port1.start();
        this.port2.start();
      },

      destroy: function() {
        this.port1.close();
        this.port2.close();
        delete this.port1;
        delete this.port2;
        delete this.channel;
      }
    });

    var PostMessagePort = extend(OasisPort, {
      initialize: function(oasis, port) {
        this.oasis = oasis;
        this.port = port;
        this._callbacks = [];
      },

      on: function(eventName, callback, binding) {
        var oasis = this.oasis;

        function wrappedCallback(event) {
          if (event.data.type === eventName) {
            oasis.configuration.eventCallback(function () {
              return callback.call(binding, event.data.data);
            });
          }
        }

        this._callbacks.push([callback, wrappedCallback]);
        this.port.addEventListener('message', wrappedCallback);
      },

      all: function(callback, binding) {
        var oasis = this.oasis;

        function wrappedCallback(event) {
          oasis.configuration.eventCallback(function () {
            callback.call(binding, event.data.type, event.data.data);
          });
        }

        this.port.addEventListener('message', wrappedCallback);
      },

      off: function(eventName, callback) {
        var foundCallback;

        for (var i=0, l=this._callbacks.length; i<l; i++) {
          foundCallback = this._callbacks[i];
          if (foundCallback[0] === callback) {
            this.port.removeEventListener('message', foundCallback[1]);
          }
        }
      },

      send: function(eventName, data) {
        this.port.postMessage({
          type: eventName,
          data: data
        });
      },

      start: function() {
        this.port.start();
      },

      close: function() {
        var foundCallback;

        for (var i=0, l=this._callbacks.length; i<l; i++) {
          foundCallback = this._callbacks[i];
          this.port.removeEventListener('message', foundCallback[1]);
        }
        this._callbacks = [];

        this.port.close();
      }
    });

    __exports__.OasisPort = OasisPort;
    __exports__.PostMessageMessageChannel = PostMessageMessageChannel;
    __exports__.PostMessagePort = PostMessagePort;
  });
define("oasis/sandbox",
  ["oasis/util","oasis/shims","oasis/message_channel","rsvp","oasis/logger"],
  function(__dependency1__, __dependency2__, __dependency3__, RSVP, Logger) {
    "use strict";
    var assert = __dependency1__.assert;
    var uniq = __dependency1__.uniq;
    var reverseMerge = __dependency1__.reverseMerge;
    var a_forEach = __dependency2__.a_forEach;
    var a_reduce = __dependency2__.a_reduce;
    var a_filter = __dependency2__.a_filter;
    var OasisPort = __dependency3__.OasisPort;


    var OasisSandbox = function(oasis, options) {
      options = reverseMerge(options || {}, {
        reconnect: oasis.configuration.reconnect
      });

      var reconnect = options.reconnect;
      assert( reconnect === "none" || reconnect === "verify" || reconnect === "any",
              "`reconnect` must be one of 'none', 'verify' or 'any'.  '" + reconnect + "' is invalid.");

      this.connections = {};
      this.wiretaps = [];

      this.oasis = oasis;

      // Generic capabilities code
      var pkg = oasis.packages[options.url];

      var capabilities = options.capabilities;
      if (!capabilities) {
        assert(pkg, "You are trying to create a sandbox from an unregistered URL without providing capabilities. Please use Oasis.register to register your package or pass a list of capabilities to createSandbox.");
        capabilities = pkg.capabilities;
      }

      pkg = pkg || {};

      this.adapter = options.adapter || Oasis.adapters.iframe;

      this._capabilitiesToConnect = this._filterCapabilities(capabilities);
      this.envPortDefereds = {};
      this.sandboxPortDefereds = {};
      this.channels = {};
      this.capabilities = {};
      this.options = options;
      this.firstLoad = true;

      var sandbox = this;
      this.promisePorts();
      this.adapter.initializeSandbox(this);
    };

    OasisSandbox.prototype = {
      waitForLoad: function () {
        return this._waitForLoadDeferred().promise;
      },

      wiretap: function(callback) {
        this.wiretaps.push(callback);
      },

      connect: function(capability) {
        var portPromise = this.envPortDefereds[capability].promise;

        assert(portPromise, "Connect was called on '" + capability + "' but no such capability was registered.");

        return portPromise;
      },

      createAndTransferCapabilities: function () {
        if (!this.firstLoad) { this.promisePorts(); }

        this.createChannels();
        this.connectPorts();

        // subsequent calls to `createAndTransferCapabilities` requires new port promises
        this.firstLoad = false;
      },

      promisePorts: function () {
        a_forEach.call(this._capabilitiesToConnect, function(capability) {
          this.envPortDefereds[capability] = RSVP.defer();
          this.sandboxPortDefereds[capability] = RSVP.defer();
        }, this);
      },

      createChannels: function () {
        var sandbox = this,
            services = this.options.services || {},
            channels = this.channels;
        a_forEach.call(this._capabilitiesToConnect, function (capability) {

          Logger.log("container: Will create port for '" + capability + "'");
          var service = services[capability],
              channel, port;

          // If an existing port is provided, just
          // pass it along to the new sandbox.

          // TODO: This should probably be an OasisPort if possible
          if (service instanceof OasisPort) {
            port = this.adapter.proxyPort(this, service);
            this.capabilities[capability] = service;
          } else {
            channel = channels[capability] = this.adapter.createChannel(sandbox.oasis);

            var environmentPort = this.adapter.environmentPort(this, channel),
                sandboxPort = this.adapter.sandboxPort(this, channel);

            Logger.log("container: Wiretapping '" + capability + "'");

            environmentPort.all(function(eventName, data) {
              a_forEach.call(this.wiretaps, function(wiretap) {
                wiretap(capability, {
                  type: eventName,
                  data: data,
                  direction: 'received'
                });
              });
            }, this);

            a_forEach.call(this.wiretaps, function(wiretap) {
              var originalSend = environmentPort.send;

              environmentPort.send = function(eventName, data) {
                wiretap(capability, {
                  type: eventName,
                  data: data,
                  direction: 'sent'
                });

                originalSend.apply(environmentPort, arguments);
              };
            });

            if (service) {
              Logger.log("container: Creating service for '" + capability + "'");
              /*jshint newcap:false*/
              // Generic
              service = new service(environmentPort, this);
              service.initialize(environmentPort, capability);
              sandbox.oasis.services.push(service);
              this.capabilities[capability] = service;
            }

            // Law of Demeter violation
            port = sandboxPort;

            this.envPortDefereds[capability].resolve(environmentPort);
          }

          Logger.log("container: Port created for '" + capability + "'");
          this.sandboxPortDefereds[capability].resolve(port);
        }, this);
      },

      destroyChannels: function() {
        for( var prop in this.channels ) {
          this.channels[prop].destroy();
          delete this.channels[prop];
        }
        this.channels = [];
      },

      connectPorts: function () {
        var sandbox = this;

        var allSandboxPortPromises = a_reduce.call(this._capabilitiesToConnect, function (accumulator, capability) {
          return accumulator.concat(sandbox.sandboxPortDefereds[capability].promise);
        }, []);

        RSVP.all(allSandboxPortPromises).then(function (ports) {
          Logger.log("container: All " + ports.length + " ports created.  Transferring them.");
          sandbox.adapter.connectPorts(sandbox, ports);
        })['catch'](RSVP.rethrow);
      },

      start: function(options) {
        this.adapter.startSandbox(this, options);
      },

      terminate: function() {
        var sandbox = this,
            channel,
            environmentPort;

        if( this.isTerminated ) { return; }
        this.isTerminated = true;

        this.adapter.terminateSandbox(this);

        this.destroyChannels();

        for( var index=0 ; index<sandbox.oasis.services.length ; index++) {
          sandbox.oasis.services[index].destroy();
          delete sandbox.oasis.services[index];
        }
        sandbox.oasis.services = [];
      },

      onerror: function(error) {
        throw error;
      },

      name: function() {
        return this.adapter.name(this);
      },

      // Oasis internal

      _filterCapabilities: function(capabilities) {
        return uniq.call(this.adapter.filterCapabilities(capabilities));
      },

      _waitForLoadDeferred: function () {
        if (!this._loadDeferred) {
          // the adapter will resolve this
          this._loadDeferred = RSVP.defer();
        }

        return this._loadDeferred;
      }
    };


    return OasisSandbox;
  });
define("oasis/sandbox_init",
  [],
  function() {
    "use strict";
    function autoInitializeSandbox () {
      if (typeof window !== 'undefined') {
        if (/PhantomJS/.test(navigator.userAgent)) {
          // We don't support phantomjs for several reasons, including
          //  - window.constructor vs Window
          //  - postMessage must not have ports (but recall in IE postMessage must
          //    have ports)
          //  - because of the above we need to polyfill, but we fail to do so
          //    because we see MessageChannel in global object
          //  - we erroneously try to decode the oasis load message; alternatively
          //    we should just encode the init message
          //  - all the things we haven't noticed yet
          return;
        }

        if (window.parent && window.parent !== window) {
          Oasis.adapters.iframe.connectSandbox(this);
        } 
      } else {
        Oasis.adapters.webworker.connectSandbox(this);
      }
    }


    return autoInitializeSandbox;
  });
define("oasis/service",
  ["oasis/shims"],
  function(__dependency1__) {
    "use strict";
    var o_create = __dependency1__.o_create;

    /**
      This is a base class that services and consumers can subclass to easily
      implement a number of events and requests at once.

      Example:

          var MetadataService = Oasis.Service.extend({
            initialize: function() {
              this.send('data', this.sandbox.data);
            },

            events: {
              changed: function(data) {
                this.sandbox.data = data;
              }
            },

            requests: {
              valueForProperty: function(name, promise) {
                promise.resolve(this.sandbox.data[name]);
              }
            }
          });

      In the above example, the metadata service implements the Service
      API using `initialize`, `events` and `requests`.

      Both services (implemented in the containing environment) and
      consumers (implemented in the sandbox) use the same API for
      registering events and requests.

      In the containing environment, a service is registered in the
      `createSandbox` method. In the sandbox, a consumer is registered
      using `Oasis.connect`.

      ### `initialize`

      Oasis calls the `initialize` method once the other side of the
      connection has initialized the connection.

      This method is useful to pass initial data back to the other side
      of the connection. You can also set up events or requests manually,
      but you will usually want to use the `events` and `requests` sections
      for events and requests.

      ### `events`

      The `events` object is a list of event names and associated callbacks.
      Oasis will automatically set up listeners for each named event, and
      trigger the callback with the data provided by the other side of the
      connection.

      ### `requests`

      The `requests` object is a list of request names and associated
      callbacks. Oasis will automatically set up listeners for requests
      made by the other side of the connection, and trigger the callback
      with the request information as well as a promise that you should
      use to fulfill the request.

      Once you have the information requested, you should call
      `promise.resolve` with the response data.

      @constructor
      @param {OasisPort} port
      @param {OasisSandbox} sandbox in the containing environment, the
        OasisSandbox that this service is connected to.
    */
    function Service (port, sandbox) {
      var service = this, prop, callback;

      this.sandbox = sandbox;
      this.port = port;

      function xform(callback) {
        return function() {
          return callback.apply(service, arguments);
        };
      }

      for (prop in this.events) {
        callback = this.events[prop];
        port.on(prop, xform(callback));
      }

      for (prop in this.requests) {
        callback = this.requests[prop];
        port.onRequest(prop, xform(callback));
      }
    }

    Service.prototype = {
      /**
        This hook is called when the connection is established. When
        `initialize` is called, it is safe to register listeners and
        send data to the other side.

        The implementation of Oasis makes it impossible for messages
        to get dropped on the floor due to timing issues.

        @param {OasisPort} port the port to the other side of the connection
        @param {String} name the name of the service
      */
      initialize: function() {},


      /**
        This hooks is called when an attempt is made to connect to a capability the
        environment does not provide.
      */
      error: function() {},

      /**
        This hook is called when the connection is stopped. When
        `destroy` is called, it is safe to unregister listeners.
      */
      destroy: function() {},

      /**
        This method can be used to send events to the other side of the
        connection.

        @param {String} eventName the name of the event to send to the
          other side of the connection
        @param {Structured} data an additional piece of data to include
          as the data for the event.
      */
      send: function() {
        return this.port.send.apply(this.port, arguments);
      },

      /**
        This method can be used to request data from the other side of
        the connection.

        @param {String} requestName the name of the request to send to
          the other side of the connection.
        @return {Promise} a promise that will be resolved by the other
          side of the connection. Use `.then` to wait for the resolution.
      */
      request: function() {
        return this.port.request.apply(this.port, arguments);
      }
    };

    Service.extend = function extend(object) {
      var superConstructor = this;

      function Service() {
        if (Service.prototype.init) { Service.prototype.init.call(this); }
        superConstructor.apply(this, arguments);
      }

      Service.extend = extend;

      var ServiceProto = Service.prototype = o_create(this.prototype);

      for (var prop in object) {
        ServiceProto[prop] = object[prop];
      }

      return Service;
    };


    return Service;
  });
define("oasis/shims",
  ["exports"],
  function(__exports__) {
    "use strict";
    var K = function() {};

    function o_create(obj, props) {
      K.prototype = obj;
      obj = new K();
      if (props) {
        K.prototype = obj;
        for (var prop in props) {
          K.prototype[prop] = props[prop].value;
        }
        obj = new K();
      }
      K.prototype = null;

      return obj;
    }

    // If it turns out we need a better polyfill we can grab mozilla's at: 
    // https://developer.mozilla.org/en-US/docs/Web/API/EventTarget.removeEventListener?redirectlocale=en-US&redirectslug=DOM%2FEventTarget.removeEventListener#Polyfill_to_support_older_browsers
    function addEventListener(receiver, eventName, fn) {
      if (receiver.addEventListener) {
        return receiver.addEventListener(eventName, fn);
      } else if (receiver.attachEvent) {
        return receiver.attachEvent('on' + eventName, fn);
      }
    }

    function removeEventListener(receiver, eventName, fn) {
      if (receiver.removeEventListener) {
        return receiver.removeEventListener(eventName, fn);
      } else if (receiver.detachEvent) {
        return receiver.detachEvent('on' + eventName, fn);
      }
    }

    function isNativeFunc(func) {
      // This should probably work in all browsers likely to have ES5 array methods
      return func && Function.prototype.toString.call(func).indexOf('[native code]') > -1;
    }

    var a_forEach = isNativeFunc(Array.prototype.forEach) ? Array.prototype.forEach : function(fun /*, thisp */) {
      if (this === void 0 || this === null) {
        throw new TypeError();
      }

      var t = Object(this);
      var len = t.length >>> 0;
      if (typeof fun !== "function") {
        throw new TypeError();
      }

      var thisp = arguments[1];
      for (var i = 0; i < len; i++) {
        if (i in t) {
          fun.call(thisp, t[i], i, t);
        }
      }
    };

    var a_reduce = isNativeFunc(Array.prototype.reduce) ? Array.prototype.reduce : function(callback, opt_initialValue){
      if (null === this || 'undefined' === typeof this) {
        // At the moment all modern browsers, that support strict mode, have
        // native implementation of Array.prototype.reduce. For instance, IE8
        // does not support strict mode, so this check is actually useless.
        throw new TypeError(
            'Array.prototype.reduce called on null or undefined');
      }
      if ('function' !== typeof callback) {
        throw new TypeError(callback + ' is not a function');
      }
      var index = 0, length = this.length >>> 0, value, isValueSet = false;
      if (1 < arguments.length) {
        value = opt_initialValue;
        isValueSet = true;
      }
      for ( ; length > index; ++index) {
        if (!this.hasOwnProperty(index)) continue;
        if (isValueSet) {
          value = callback(value, this[index], index, this);
        } else {
          value = this[index];
          isValueSet = true;
        }
      }
      if (!isValueSet) {
        throw new TypeError('Reduce of empty array with no initial value');
      }
      return value;
    };

    var a_map = isNativeFunc(Array.prototype.map) ? Array.prototype.map : function(callback, thisArg) {

        var T, A, k;

        if (this == null) {
          throw new TypeError(" this is null or not defined");
        }

        // 1. Let O be the result of calling ToObject passing the |this| value as the argument.
        var O = Object(this);

        // 2. Let lenValue be the result of calling the Get internal method of O with the argument "length".
        // 3. Let len be ToUint32(lenValue).
        var len = O.length >>> 0;

        // 4. If IsCallable(callback) is false, throw a TypeError exception.
        // See: http://es5.github.com/#x9.11
        if (typeof callback !== "function") {
          throw new TypeError(callback + " is not a function");
        }

        // 5. If thisArg was supplied, let T be thisArg; else let T be undefined.
        if (thisArg) {
          T = thisArg;
        }

        // 6. Let A be a new array created as if by the expression new Array(len) where Array is
        // the standard built-in constructor with that name and len is the value of len.
        A = new Array(len);

        // 7. Let k be 0
        k = 0;

        // 8. Repeat, while k < len
        while(k < len) {

          var kValue, mappedValue;

          // a. Let Pk be ToString(k).
          //   This is implicit for LHS operands of the in operator
          // b. Let kPresent be the result of calling the HasProperty internal method of O with argument Pk.
          //   This step can be combined with c
          // c. If kPresent is true, then
          if (k in O) {

            // i. Let kValue be the result of calling the Get internal method of O with argument Pk.
            kValue = O[ k ];

            // ii. Let mappedValue be the result of calling the Call internal method of callback
            // with T as the this value and argument list containing kValue, k, and O.
            mappedValue = callback.call(T, kValue, k, O);

            // iii. Call the DefineOwnProperty internal method of A with arguments
            // Pk, Property Descriptor {Value: mappedValue, : true, Enumerable: true, Configurable: true},
            // and false.

            // In browsers that support Object.defineProperty, use the following:
            // Object.defineProperty(A, Pk, { value: mappedValue, writable: true, enumerable: true, configurable: true });

            // For best browser support, use the following:
            A[ k ] = mappedValue;
          }
          // d. Increase k by 1.
          k++;
        }

        // 9. return A
        return A;
      };  

    var a_indexOf = isNativeFunc(Array.prototype.indexOf) ? Array.prototype.indexOf : function (searchElement /*, fromIndex */ ) {
      /* jshint eqeqeq:false */
      "use strict";
      if (this == null) {
        throw new TypeError();
      }
      var t = Object(this);
      var len = t.length >>> 0;

      if (len === 0) {
        return -1;
      }
      var n = 0;
      if (arguments.length > 1) {
        n = Number(arguments[1]);
        if (n != n) { // shortcut for verifying if it's NaN
          n = 0;
        } else if (n != 0 && n != Infinity && n != -Infinity) {
          n = (n > 0 || -1) * Math.floor(Math.abs(n));
        }
      }
      if (n >= len) {
        return -1;
      }
      var k = n >= 0 ? n : Math.max(len - Math.abs(n), 0);
      for (; k < len; k++) {
        if (k in t && t[k] === searchElement) {
          return k;
        }
      }
      return -1;
    };

    var a_filter = isNativeFunc(Array.prototype.filter) ? Array.prototype.filter : function(fun /*, thisp*/) {
      'use strict';

      if (!this) {
        throw new TypeError();
      }

      var objects = Object(this);
      var len = objects.length >>> 0;
      if (typeof fun !== 'function') {
        throw new TypeError();
      }

      var res = [];
      var thisp = arguments[1];
      for (var i in objects) {
        if (objects.hasOwnProperty(i)) {
          if (fun.call(thisp, objects[i], i, objects)) {
            res.push(objects[i]);
          }
        }
      }

      return res;
    };

    __exports__.o_create = o_create;
    __exports__.addEventListener = addEventListener;
    __exports__.removeEventListener = removeEventListener;
    __exports__.a_forEach = a_forEach;
    __exports__.a_reduce = a_reduce;
    __exports__.a_map = a_map;
    __exports__.a_indexOf = a_indexOf;
    __exports__.a_filter = a_filter;
  });
define("oasis/util",
  ["oasis/shims","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var o_create = __dependency1__.o_create;
    var a_filter = __dependency1__.a_filter;

    function assert(assertion, string) {
      if (!assertion) {
        throw new Error(string);
      }
    }

    function noop() { }

    function mustImplement(className, name) {
      return function() {
        throw new Error("Subclasses of " + className + " must implement " + name);
      };
    }

    function extend(parent, object) {
      function OasisObject() {
        parent.apply(this, arguments);
        if (this.initialize) {
          this.initialize.apply(this, arguments);
        }
      }

      OasisObject.prototype = o_create(parent.prototype);

      for (var prop in object) {
        if (!object.hasOwnProperty(prop)) { continue; }
        OasisObject.prototype[prop] = object[prop];
      }

      return OasisObject;
    }

    function delegate(delegateeProperty, delegatedMethod) {
      return function () {
        var delegatee = this[delegateeProperty];
        return delegatee[delegatedMethod].apply(delegatee, arguments);
      };
    }

    function uniq() {
      var seen = {};
      return a_filter.call(this, function (item) {
        var _seen = !seen.hasOwnProperty(item);
        seen[item] = true;
        return _seen;
      });
    }

    function reverseMerge(a, b) {
      for (var prop in b) {
        if (!b.hasOwnProperty(prop)) { continue; }

        if (! (prop in a)) {
          a[prop] = b[prop];
        }
      }

      return a;
    }

    __exports__.assert = assert;
    __exports__.noop = noop;
    __exports__.mustImplement = mustImplement;
    __exports__.extend = extend;
    __exports__.delegate = delegate;
    __exports__.uniq = uniq;
    __exports__.reverseMerge = reverseMerge;
  });
define("oasis/version",
  [],
  function() {
    "use strict";

    return '0.4.0';
  });
define("oasis/webworker_adapter",
  ["oasis/util","oasis/shims","rsvp","oasis/logger","oasis/base_adapter"],
  function(__dependency1__, __dependency2__, RSVP, Logger, BaseAdapter) {
    "use strict";
    var assert = __dependency1__.assert;
    var extend = __dependency1__.extend;
    var a_forEach = __dependency2__.a_forEach;
    var addEventListener = __dependency2__.addEventListener;
    var removeEventListener = __dependency2__.removeEventListener;
    /*global self, postMessage, importScripts, UUID */



    var WebworkerAdapter = extend(BaseAdapter, {
      type: 'js',

      //-------------------------------------------------------------------------
      // Environment API

      initializeSandbox: function(sandbox) {
        var worker = new Worker(sandbox.options.url);
        worker.name = sandbox.options.url + '?uuid=' + UUID.generate();
        sandbox.worker = worker;

        // Error handling inside the worker
        worker.errorHandler = function(event) {
          if(!event.data.sandboxException) {return;}

          sandbox.onerror( event.data.sandboxException );
        };
        addEventListener(worker, 'message', worker.errorHandler);

        sandbox._waitForLoadDeferred().resolve(new RSVP.Promise( function(resolve, reject) {
          worker.initializationHandler = function (event) {
            sandbox.oasis.configuration.eventCallback(function () {
              if( event.data !== sandbox.adapter.sandboxInitializedMessage ) {return;}
              removeEventListener(worker, 'message', worker.initializationHandler);

              Logger.log("worker sandbox initialized");
              resolve(sandbox);
            });
          };
          addEventListener(worker, 'message', worker.initializationHandler);
        }));

        worker.loadHandler = function (event) {
          sandbox.oasis.configuration.eventCallback(function () {
            if( event.data !== sandbox.adapter.oasisLoadedMessage ) {return;}
            removeEventListener(worker, 'message', worker.loadHandler);

            Logger.log("worker sandbox initialized");
            sandbox.createAndTransferCapabilities();
          });
        };
        addEventListener(worker, 'message', worker.loadHandler);
      },

      startSandbox: function(sandbox) { },

      terminateSandbox: function(sandbox) {
        var worker = sandbox.worker;

        removeEventListener(worker, 'message', worker.loadHandler);
        removeEventListener(worker, 'message', worker.initializationHandler);
        sandbox.worker.terminate();
      },

      connectPorts: function(sandbox, ports) {
        var rawPorts = ports.map(function(port) { return port.port; }),
            message = this.createInitializationMessage(sandbox);

        Worker.postMessage(sandbox.worker, message, rawPorts);
      },

      connectSandbox: function(oasis) {
        return BaseAdapter.prototype.connectSandbox.call(this, self, oasis);
      },

      //-------------------------------------------------------------------------
      // Sandbox API

      name: function(sandbox) {
        return sandbox.worker.name;
      },

      oasisLoaded: function() {
        postMessage(this.oasisLoadedMessage, []);
      },

      didConnect: function() {
        postMessage(this.sandboxInitializedMessage, []);
      }
    });


    return WebworkerAdapter;
  });
define("oasis/xhr",
  ["oasis/util","rsvp","exports"],
  function(__dependency1__, RSVP, __exports__) {
    "use strict";
    var noop = __dependency1__.noop;
    /*global XDomainRequest */


    var a_slice = Array.prototype.slice;

    function acceptsHeader(options) {
      var dataType = options.dataType;

      if (dataType && accepts[dataType]) {
        return accepts[dataType];
      }

      return accepts['*'];
    }

    function xhrSetRequestHeader(xhr, options) {
      xhr.setRequestHeader("Accepts", acceptsHeader(options));
    }

    function xhrGetLoadStatus(xhr) {
      return xhr.status;
    }

    function xdrGetLoadStatus() {
      return 200;
    }

    var NONE = {};

    function trigger(event, oasis) {
      if (!oasis) { return; }

      var args = a_slice.call(arguments, 2);

      args.unshift(event);
      oasis.trigger.apply(oasis, args);
    }

    var accepts = {
      "*": "*/*",
      text: "text/plain",
      html: "text/html",
      xml: "application/xml, text/xml",
      json: "application/json, text/javascript"
    };

    var XHR, setRequestHeader, getLoadStatus, send;

    try {
      if ('withCredentials' in new XMLHttpRequest()) {
        XHR = XMLHttpRequest;
        setRequestHeader = xhrSetRequestHeader;
        getLoadStatus = xhrGetLoadStatus;
      } else if (typeof XDomainRequest !== 'undefined') {
        XHR = XDomainRequest;
        setRequestHeader = noop;
        getLoadStatus = xdrGetLoadStatus;
      }
    } catch( exception ) {
      if (typeof XDomainRequest !== 'undefined') {
        XHR = XDomainRequest;
        setRequestHeader = noop;
        getLoadStatus = xdrGetLoadStatus;
      }
    }
    // else inline adapter with cross-domain cards is not going to work


    function xhr(url, options, oasis) {
      if (!oasis && this instanceof Oasis) { oasis = this; }
      if (!options) { options = NONE; }

      return new RSVP.Promise(function(resolve, reject){
        var xhr = new XHR();
        xhr.open("get", url, true);
        setRequestHeader(xhr, options);

        if (options.timeout) {
          xhr.timeout = options.timeout;
        }

        xhr.onload = function () {
          trigger('xhr.load', oasis, url, options, xhr);

          var status = getLoadStatus(xhr);
          if (status >= 200 && status < 300) {
            resolve(xhr.responseText);
          } else {
            reject(xhr);
          }
        };

        xhr.onprogress = noop;
        xhr.ontimeout = function () {
          trigger('xhr.timeout', oasis, url, options, xhr);
          reject(xhr);
        };

        xhr.onerror = function () {
          trigger('xhr.error', oasis, url, options, xhr);
          reject(xhr);
        };

        trigger('xhr.send', oasis, url, options, xhr);
        xhr.send();
      });
    }

    __exports__.xhr = xhr;
  });