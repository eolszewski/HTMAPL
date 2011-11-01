if (typeof HTMAPL === "undefined") var HTMAPL = {};

(function() {

    try {
        var MM = com.modestmaps;
    } catch (e) {
        throw "Couldn't find com.modestmaps; did you include modestmaps.js?";
        return false;
    }

    HTMAPL.Map = function(element, defaults) {
        this.initialize(element, defaults);
    };

    var DEFAULTS = HTMAPL.defaults = {
        "map": {
            "center":       {lat: 37.764, lon: -122.419},
            "zoom":         17,
            "extent":       null,
            "provider":     "toner",
            "interactive":  "true",
            "layers":       ".layer",
            "markers":      ".marker"
        },
        "layer": {
            "type":         null,
            "url":          null,
            "datatype":     "json",
            "template":     null,
            "setextent":    "false"
        }
    };

    var ATTRIBUTES = HTMAPL.dataAttributes = {
        // map option parsers
        "map": {
            "center":       getLatLon,
            "zoom":         getInt,
            "extent":       getExtent,
            "provider":     getProvider,
            "interactive":  getBoolean,
            "layers":       String,
            "markers":      String
        },
        // layer option parsers
        "layer": {
            "type":         String,
            "url":          String,
            "datatype":     String,
            "template":     String,
            "setextent":    getBoolean
        }
    };

    /**
     * The Map looks for options in an element, merges those with any
     * provided in the constructor, builds data and marker layers, and provides
     * an applyOptions() method for setting any post-initialization options.
     */
    HTMAPL.Map.prototype = {

        /**
         * initialize() takes an optional hash of option defaults, which
         * are merged together with HTMAPL.defaults.map to form the set of
         * options before applying any additional ones found in the DOM.
         */
        initialize: function(element, defaults) {

            // Create the map. By default our provider is empty.
            MM.Map.call(this, element, NULL_PROVIDER, null, []);

            var options = {};
            // merge in gobal defaults, then user-provided defaults
            extend(options, DEFAULTS.map, defaults);
            // parse options out of the DOM element and include those
            this.parseOptions(options, this.parent, ATTRIBUTES.map);

            // if the "interactive" option is set, include the MouseHandler
            if (options.interactive) {
                var mouseHandler = new MM.MouseHandler();
                this.eventHandlers.push(mouseHandler);
                mouseHandler.init(this);
            }

            // intialize data and marker layers
            if (options.layers) {
                this.initLayers(options.layers);
            }

            // additionally, intialize markers as their own layer
            if (options.markers) {
                this.initMarkers(options.markers);
            }

            // then apply the runtime options: center, zoom, extent, provider
            this._applyParsedOptions(options);
        },

        /**
         * Initialize markers as their own layer.
         */
        initMarkers: function(filter) {
            var markers = this.getChildren(this.parent, filter);
            // console.log("markers:", markers);
            if (markers.length) {
                var div = document.createElement("div"),
                    markerLayer = new MM.MarkerLayer(this, NULL_PROVIDER, div);
                this.addLayerMarkers(markerLayer, markers);

                this.parent.__htmapl__.markers = markerLayer;
                this.markers = markerLayer;
                return markerLayer;
            }
            return null;
        },

        /**
         * Adds each marker element in a jQuery selection to the provided
         * ModestMaps Layer. Each marker element should have a "location" data
         * that getLatLon() can parse into a Location object.
         *
         * Returns the number of markers added with valid locations.
         */
        addLayerMarkers: function(layer, markers) {
            var added = 0,
                len = markers.length;
            for (var i = 0; i < len; i++) {
                var marker = markers[i],
                    rawLocation = this.getData(marker, "location"),
                    parsedLocation = getLatLon(rawLocation);
                if (parsedLocation) {
                    layer.addMarker(marker, parsedLocation);
                    added++;
                } else {
                    console.warn("invalid marker location:", rawLocation, "; skipping marker:", marker);
                }
            }
            return added;
        },

        initLayers: function(filter) {
            var children = this.getChildren(this.parent, filter),
                len = children.length;
            for (var i = 0; i < len; i++) {
                var layer = children[i],
                    layerOptions = {};
                extend(layerOptions, DEFAULTS.layer);
                console.log("(init) layer options:", JSON.stringify(layerOptions));

                this.parseOptions(layerOptions, layer, ATTRIBUTES.layer);

                console.log("(parsed) layer options:", JSON.stringify(layerOptions));

                var type = layerOptions.type,
                    provider = layerOptions.provider;

                if (!type) {
                    console.warn("no type defined for layer:", layer);
                    continue;
                }

                // console.log("  + layer:", [type, provider], layer);

                var mapLayer;
                switch (type.toLowerCase()) {
                    case "markers":
                        // marker layers ignore the provider
                        mapLayer = new MM.MarkerLayer(this, NULL_PROVIDER, layer);
                        this.addLayerMarkers(mapLayer, this.getChildren(layer));
                        break;

                    case "geojson":
                        var url = layerOptions.url || layerOptions.provider,
                            template = layerOptions.template,
                            tiled = url && url.match(/{(Z|X|Y)}/);

                        if (!url) {
                            console.warn("no URL/provider found for GeoJSON layer:", layer);
                            continue;
                        }

                        // console.log("template:", template);

                        var buildMarker;
                        switch (typeof template) {
                            case "function":
                                buildMarker = template;
                                break;
                            case "string":
                                buildMarker = this.getBuildMarker(template);
                                break;
                        }

                        // console.log("buildMarker:", buildMarker);

                        // XXX: two very different things happen here
                        // depending on whether the data is "tiled":
                        if (tiled) {

                            // if so, we use a GeoJSONProvider and a tiled
                            // layer...
                            var tileProvider = getProvider(url);
                            if (tileProvider) {
                                mapProvider = new MM.GeoJSONProvider(tileProvider, buildMarker);
                                mapLayer = new MM.Layer(this, mapProvider, layer);
                            } else {
                                console.warn("no GeoJSON provider found for:", [url], "on layer:", layer);
                                continue;
                            }

                        } else {

                            // otherwise we create a MarkerLayer, load
                            // data, and add markers on success.
                            mapLayer = new MM.MarkerLayer(this, NULL_PROVIDER, layer);

                            /**
                             * XXX:
                             * The AJAX request options follow jQuery.ajax()
                             * conventions. Currently the only option that we
                             * support is "dataType", which is assumed to be
                             * either "json" (subject to cross-origin security
                             * restrictions) or "jsonp" (which uses callbacks
                             * and is not subject to CORS restrictions).
                             */
                            var requestOptions = {
                                "dataType": layerOptions.datatype
                            };

                            // for the success closure
                            var map = this;

                            this.ajax(url, requestOptions, function(collection) {
                                var features = collection.features,
                                    len = features.length,
                                    locations = [];
                                for (var i = 0; i < len; i++) {
                                    var feature = features[i],
                                        marker = buildMarker.call(mapLayer, feature);
                                    mapLayer.addMarker(marker, feature);
                                    locations.push(marker.location);
                                }
                                if (locations.length && layerOptions.setextent) {
                                    map.setExtent(locations);
                                } else {
                                    console.log("not setting extent:", layerOptions);
                                }
                            });
                        }
                        break;
                        
                    case "image":
                        if (!provider) {
                            console.warn("no provider found for image layer:", layer);
                            break;
                        }
                        var mapProvider = getProvider(provider);
                        mapLayer = new MM.Layer(this, mapProvider, layer);
                        break;
                }

                if (mapLayer) {
                    this.layers.push(mapLayer);
                    layer.__htmapl__ = {layer: mapLayer};
                } else {
                    console.warn("no provider created for layer of type", type, ":", layer);
                }
            }
        },

        /**
         * Get a marker building function. This is assumed to be a symbol in
         * the global scope that can be evaluated with eval(). If the string
         * evaluates to anything other than a function, we return null.
         */
        getBuildMarker: function(name) {
            try {
                var ref;
                // TODO: replace eval() with a safe recursive lookup
                with (window) {
                    ref = eval(name);
                }
                if (typeof ref === "function") {
                    return ref;
                }
            } catch (e) {
                console.warn("unable to eval('" + name + "'):", e);
            }
            return null;
        },

        applyOptions: function(options) {
            this.parseOptions(options, null, ATTRIBUTES.map);
            this._applyParsedOptions(options);
        },

        _applyParsedOptions: function(options) {
            if (options.provider) {
                // console.log("  * base provider:", options.provider);
                var baseLayer = this.layers[0];
                baseLayer.setProvider(options.provider);
                this.parent.insertBefore(baseLayer.parent, this.parent.firstChild);
                // XXX: force the base map layer to the bottom
                baseLayer.parent.style.zIndex = 0;
            }

            // and kick things off by setting the extent, center and zoom
            if (options.extent) {
                this.setExtent(options.extent);
            } else if (options.center) {
                this.setCenter(options.center);
            }
            if (!isNaN(options.zoom)) {
                this.setZoom(options.zoom);
            }
        },

        disassociate: function() {
            var len = this.layers.length;
            for (var i = 0; i < len; i++) {
                var layer = this.layers[i];
                try {
                    delete layer.parent.__htmapl__;
                } catch (e) {
                }
            }
            try {
                delete this.parent.__htmapl__, this.parent;
            } catch (e) {
            }
        },


        /**
         * HTMAPL doesn't know how to load files natively. For now we rely on
         * jQuery.ajax() and fill in support if it's available; otherwise, we throw
         * an exception.
         */
        ajax: function(url, options, success) {
            throw "Not implemented yet; include jQuery for remote file loading via jQuery.ajax()";
        },

        /**
         * DOM data getter. This is monkey patched if jQuery is present.
         */
        getData: function(element, key) {
            if (element.hasOwnProperty("dataset")) {
                key = key.toLowerCase();
                // console.log("looking for data:", [key], "in", element.dataset);
                return element.dataset[key] || element.getAttribute("data-" + key);
            } else {
                return element.getAttribute("data-" + key);
            }
        },

        // XXX: not used anywhere yet
        setData: function(element, key, value) {
            if (!element.hasOwnProperty("dataset")) {
                element.dataset = {};
            }
            element.dataset[key] = value;
        },

        parseOptions: function(options, element, parsers) {
            console.log("parsing:", element, "into:", options, "with:", parsers);
            for (var key in parsers) {
                var value = (element ? this.getData(element, key) : null) || options[key];
                console.log(" +", key, "=", value);
                // if it's a string, parse it
                if (typeof value === "string") {
                    options[key] = parsers[key].call(element, value);
                // if it's not undefined, assign it
                } else if (typeof value !== "undefined") {
                    options[key] = value;
                } else {
                    // console.info("invalid value for", key, ":", value);
                }
            }
        },

        getChildren: function(element, filter) {
            var children = element.childNodes,
                len = children.length,
                matched = [];

            // TODO: just use Sizzle?
            switch (typeof filter) {
                case "string":
                    if (filter.length > 1 && filter.charAt(0) === ".") {
                        var className = filter.substr(1),
                            pattern = new RegExp("\\b" + className + "\\b");
                        filter = function(child) {
                            return child.className && child.className.match(pattern);
                        };
                    } else {
                        // TODO: some other filter here? filter by selector?
                        console.warn("ignoring filter:", filter);
                        filter = null;
                    }
                    break;
                case "function":
                    // legit
                    break;
                default:
                    console.warn("invalid filter:", filter);
                    filter = null;
                    break;
            }

            for (var i = 0; i < len; i++) {
                var child = children[i];
                if (!filter || filter.call(this, child)) {
                    matched.push(child);
                }
            }
            return matched;
        }

    };

    // an HTMAPL.Map is an MM.Map, but better
    MM.extend(HTMAPL.Map, MM.Map);

    /**
     * Static utility functions
     */

    /**
     * HTMAPL.makeMap() takes a DOM node reference and a hash of default
     * options, and returns a new HTMAPL.Map instance, which extends
     * ModestMaps' Map.
     */
    HTMAPL.makeMap = function(element, defaults) {
        return new HTMAPL.Map(element, defaults);
    };

    /**
     * HTMAPL.makeMaps() iterates over a list of DOM nodes and returns a
     * corresponding array of HTMAPL.Map instances. This is kind of like:
     *
     * var nodes = document.querySelectorAll("div.map");
     * var options = { ... };
     * var maps = Array.prototype.slice.call(nodes).map(function(node) {
     *     return new HTMAPL.makeMap(node, options);
     * });
     */
    HTMAPL.makeMaps = function(elements, defaults) {
        var maps = [],
            len = elements.length;
        for (var i = 0; i < len; i++) {
            maps.push(new HTMAPL.Map(elements[i], defaults));
        }
        return maps;
    };

    /**
     * Utility functions (not needed in the global scope)
     */

    /**
     * extend() updates the properties of the object provided as its first
     * argument with the proprties of one or more other arguments. E.g.:
     *
     * var a = {foo: 1};
     * extend(a, {foo: 2, bar: 1});
     * // a.foo === 2, a.bar === 1
     */
    function extend(dest, sources) {
        var argc = arguments.length - 1;
        for (var i = 1; i <= argc; i++) {
            var source = arguments[i];
            if (!source) continue;
            for (var p in source) {
                dest[p] = source[p];
            }
        }
    }

	/**
	 * Parsing Functions
	 *
	 * The following functions are used to parse meaningful values from strings,
	 * and should return null if the provided strings don't match a predefined
	 * format.
	 */

	/**
	 * Parse a {lat,lon} object from a string: "lat,lon", or return null if the
	 * string does not contain a single comma.
	 */
 	function getLatLon(str) {
		if (typeof str === "string" && str.indexOf(",") > -1) {
			var parts = str.split(/\s*,\s*/),
                lat = parseFloat(parts[0]),
                lon = parseFloat(parts[1]);
			return {lon: lon, lat: lat};
		}
		return null;
	}

	/**
	 * Parse an {x,y} object from a string: "x,x", or return null if the string
	 * does not contain a single comma.
	 */
 	function getXY(str) {
		if (typeof str === "string" && str.indexOf(",") > -1) {
			var parts = str.split(/\s*,\s*/),
                x = parseInt(parts[0]),
                y = parseInt(parts[1]);
			return {x: x, y: y};
		}
		return null;
	}

	/**
	 * Parse an extent array [{lat,lon},{lat,lon}] from a string:
	 * "lat1,lon1,lat2,lon2", or return null if the string does not contain a
	 * 4 comma-separated numbers.
	 */
 	function getExtent(str) {
		if (typeof str === "string" && str.indexOf(",") > -1) {
			var parts = str.split(/\s*,\s*/);
			if (parts.length == 4) {
				var lat1 = parseFloat(parts[0]),
                    lon1 = parseFloat(parts[1]),
                    lat2 = parseFloat(parts[2]),
                    lon2 = parseFloat(parts[3]);
                return [{lon: Math.min(lon1, lon2),
                         lat: Math.max(lat1, lat2)},
                        {lon: Math.max(lon1, lon2),
                         lat: Math.min(lat1, lat2)}];
			}
		}
		return null;
	}

	/**
	 * Parse an integer from a string using parseInt(), or return null if the
	 * resulting value is NaN.
	 */
	function getInt(str) {
		var i = parseInt(str);
		return isNaN(i) ? null : i;
	}

	/**
	 * Parse a float from a string using parseFloat(), or return null if the
	 * resulting value is NaN.
	 */
	function getFloat(str) {
		var i = parseFloat(str);
		return isNaN(i) ? null : i;
	}

	/**
	 * Parse a string as a boolean "true" or "false", otherwise null.
	 */
	function getBoolean(str) {
		return (str === "true") ? true : (str === "false") ? false : null;
	}

	/**
	 * Parse a string as an array of at least two comma-separated strings, or
	 * null if it does not contain at least one comma.
	 */
	function getArray(str) {
		return (typeof str === "string" && str.indexOf(",") > -1) ? str.split(",") : null;
	}

    /**
     * CSS pixel value converter.
     */
	function px(n) {
		return ~~(0.5 + n) + "px";
	}

    var PROVIDERS = HTMAPL.providers = {};
    /**
     * Register a named map tile provider. Basic usage:
     *
     * HTMAPL.registerProvider("name", new com.modestmaps.MapProvider(...));
     *
     * You can also register tile provider "generator" prefixes with a colon
     * between the prefix and the generator argument(s). E.g.:
     *
     * HTMAPL.registerProvider("prefix:layer", function(layer) {
     *     var url = "path/to/" + layer + "/{Z}/{X}/{Y}.png";
     *     return new com.modestmaps.TemplatedMapProvider(url);
     * });
     */
    function registerProvider(name, provider) {
        PROVIDERS[name] = provider;
    }

    /**
     * Get a named provider
     */
    function getProvider(str) {
        if (str in PROVIDERS) {
            return PROVIDERS[str];
        } else if (str.indexOf(":") > -1) {
            var parts = str.split(":"),
                prefix = parts.shift();
            if (prefix in PROVIDERS) {
                return PROVIDERS[prefix].apply(null, parts);
            }
        } else {
            return url
                ? new MM.TemplatedMapProvider(url)
                : NULL_PROVIDER;
        }
    }

    /**
     * Built-in providers
     */
    var NULL_PROVIDER = new MM.MapProvider(function(c) { return null; });
    registerProvider("none",        NULL_PROVIDER);
    // TODO: turn bing into a prefix provider (road, aerial, etc.)
    registerProvider("bing",        new MM.TemplatedMapProvider("http://ecn.t{S:0,1,2}.tiles.virtualearth.net/tiles/r{Q}?g=689&mkt=en-us&lbl=l1&stl=h&shading=hill"));
    registerProvider("toner",       new MM.TemplatedMapProvider("http://spaceclaw.stamen.com/toner/{Z}/{X}/{Y}.png"));

    /**
     * Cloudmade style map provider generator.
     */
    PROVIDERS["cloudmade"] = (function() {
        var aliases = {
            "fresh":    997,
            "paledawn": 998,
            "midnight": 999
        };

        var CM = function(styleId) {
            if (styleId in aliases) {
                styleId = aliases[styleId];
            }
            return new MM.TemplatedMapProvider([
                "http://{S}tile.cloudmade.com",
                CM.key,
                styleId,
                "256/{Z}/{X}/{Y}.png"
            ].join("/"), CM.domains);
        };

        CM.key = "1a1b06b230af4efdbb989ea99e9841af";
        CM.domains = ["a.", "b.", "c.", ""];
        CM.registerAlias = function(alias, styleId) {
            aliases[alias] = styleId;
        };

        return CM;
    })();

    /**
     * Acetate layer generator
     */
    PROVIDERS["acetate"] = function(layer) {
        return new MM.TemplatedMapProvider("http://acetate.geoiq.com/tiles/acetate-" + layer + "/{Z}/{X}/{Y}.png");
    };

    // exports
    var exports = HTMAPL;
    exports.registerProvider = registerProvider;
    exports.getProvider = getProvider;
    exports.getArray = getArray;
    exports.getBoolean = getBoolean;
    exports.getExtent = getExtent;
    exports.getFloat = getFloat;
    exports.getInt = getInt;
    exports.getLatLon = getLatLon;
    exports.getXY = getXY;

    // jQuery-specific stuff
    if (typeof jQuery !== "undefined") {

        var $ = jQuery;

        // use jQuery.ajax();
        HTMAPL.Map.prototype.ajax = function(url, options, success) {
            return $.ajax(url, options).done(success);
        };

        /**
         * Use jQuery.data() so that you can set data via the same interface:
         *
         * $("div.map").data("provider", "toner").htmapl();
         */
        HTMAPL.Map.prototype.getData = function(element, key) {
            return $(element).data(key);
        };

        /**
         * Monkey patch Map::getBuildMarker() if jQuery templates are
         * available. This modifies the prototype method to look for a named
         * template
         */
        if (typeof $.fn.tmpl === "function") {
            var oldBuildMarker = HTMAPL.Map.prototype.getBuildMarker;
            HTMAPL.Map.prototype.getBuildMarker = function(name) {
                var existing = oldBuildMarker(name);
                if (existing) {
                    return exiting;
                } else {
                    // check to see if the provided name is a selector
                    var target = $(name);
                    // if there's a matching element, use that as the template
                    // and return a function that uses that template in a closure
                    if (target.length == 1) {
                        var template = target.template();
                        return function(feature) {
                            return $.tmpl(template, feature).get(0);
                        };
                    // otherwise, return a function that passes the name in as
                    // the template identifier
                    } else {
                        return function(feature) {
                            return $.tmp(name, feature).get(0);
                        };
                    }
                }
            };
        }

        // keep a reference around to the plugin object for exporting useful functions
        $.fn.htmapl = function(options, argn) {
            var args = Array.prototype.slice.call(arguments, 1);
            return this.each(function() {
                var $this = $(this),
                    map = $(this).data("map");
                if (map) {
                    if (typeof options === "string") {
                        if (typeof map[options] === "function") {
                            var method = options;
                            // console.log("calling map." + method, "with:", args);
                            map[method].apply(map, args);
                        } else {
                            map[options] = argn;
                        }
                    } else if (typeof options === "object") {
                        map.applyOptions(options);
                    }
                } else {
                    try {
                        map = HTMAPL.makeMap(this, options);
                        var layers = map.layers,
                            len = layers.length;
                        for (var i = 0; i < len; i++) {
                            $(layers[i].parent).data("layer", layers[i]);
                        }
                        $this.data("map", map);
                    } catch (e) {
                        console.error(e);
                    }
                }
            });
        };

        // automatically map-ulate anything with data-htmapl="true"
        $(function() {
            $("*[data-htmapl=true]").htmapl();
        });

    }

})();
