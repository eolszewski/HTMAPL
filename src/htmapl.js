(function($) {

 	/**
	 * Parses mustached "variables" in a string and replaces them with property
	 * values from another object. E.g.:
	 *
	 * templatize("Type: {type}", {type: "fish"}) -> "Type: fish"
	 */
 	function templatize(template, obj) {
		return template.replace(/{([^}]+)}/g, function(s, prop) {
			return obj[prop];
		});
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
	 * This is kind of stupid.
	 *
	 * Anyway, parse a string as CSS attributes (like what you'd expect to see
	 * inside the curly braces of a selector or an inline HTML "style"
	 * attribute), liberally allowing for anything that looks like "key: value"
	 * pairs separated by semicolons. The return value is an object map:
	 *
	 * "a: foo; b: bar" -> {a: "foo", b: "bar"}
	 */
 	function parseCSS(str) {
		if (!str) return null;
		var style = {},
				count = 0;
		var rules = str.match(/([-a-z]+\:\s*[^;]+)/g);
		if (rules) {
			for (var i = 0; i < rules.length; i++) {
				var match = rules[i].match(/^([-a-z]+):\s*([^;]+)$/);
				if (match) {
					style[match[1]] = match[2];
					count++;
				}
			}
		}
		return count > 0 ? style : null;
	}

	function applyStyle(layer, source, style, engine) {
		var stylist = engine.stylist();
		for (var name in style) {
			var value = style[name], js;
			if (js = value.match(/^javascript:(.*)$/)) {
				try {
					value = eval(js[1]);
				} catch (e) {
					// console.log("unable to eval('" + js[1] + "'): " + e);
				}
			}
			stylist.attr(name, value);
		}

		var titleTemplate = source.data("title");
		if (titleTemplate) {
			stylist.title(function(feature) {
				return templatize(titleTemplate, feature.properties);
			});
		}

		layer.on("load", stylist);
	}

	function applyLinkTemplate(layer, template, engine) {
		var wrap = function(e) {
			var len = e.features.length;
			for (var i = 0; i < len; i++) {
				var feat = e.features[i],
                    href = templatize(template, feat.data.properties);
				if (href) {
					var o = feat.element,
                        p = o.parentNode,
                        a = engine.anchor();
					p.appendChild(a).appendChild(o);
					// FIXME: do this better
					if (typeof engine.ns != "undefined") {
						a.setAttributeNS(engine.ns.xlink, "href", href);
					} else {
						a.setAttribute("href", href);
					}
				}
			}
		}
		layer.on("load", wrap);
	}

	/**
	 * This function "applies" data from a jQuery object (obj) to a "map-like"
	 * object (map), using key/value data attributes (attr). The basic process is:
	 *
	 * for each (key in attrs):
	 *   transform = attrs[key]
	 *   data = obj.data(key)
	 *   if transform is a function:
	 *     value = transform(data)
	 *     map[key](value)
	 *   else:
	 *     map[key](data)
	 *
	 * In other words, for each key in the attrs object, we get the jQuery
	 * object's corresponding HTML data attribute value and "apply" it to the map
	 * by its correspondingly named function. The data passed to map differs
	 * based on whether or not the value of the named key in the attrs object
	 * (that is, `attrs[key]`) is a function. If it is, the HTML data attribute
	 * value is transformed via that function then, if not null, passed to the
	 * map. Otherwise, it's passed along as a string.
	 *
	 * This is the primary mechanism by which HTML data attributes are
	 * transformed into values appropriate for the corresponding method of the
	 * "map-like" object, which is expected to expose a getter-setter interface
	 * like Polymaps'. So, given this state:
	 *
	 * 	var obj = $('<div class="map" data-center="37.7639,-122.4130"/>');
	 * 	var attrs = {
	 * 	  center: $.htmapl.getLatLon
	 * 	};
	 * 	var map = org.polymaps.map();
	 *
	 * Calling:
	 *
	 * 	applyData(obj, map, attrs);
	 *
	 * would essentially boil down to:
	 *
	 * 	map.center($.htmapl.getLatLon(obj.data("center"));
	 */
	function applyData(obj, map, attrs) {
		for (var key in attrs) {
			var data = attrs[key],
                value = null;
			// call it as transform(data) with the jQuery object as its context
			if (typeof data == "function") {
				var transform = data;
				data = obj.data(key);
				value = transform.call(obj, data);
			// otherwise, just use the string value
			// XXX: could we do something with attrs[key] here?
			} else {
				value = data;
				if (typeof data == "undefined") {
				}
				// console.log(["got value for", key, value]);
			}
			// don't apply null values
			if (value == null) {
				continue;
			}
			// apply as function if it is one
			if (typeof map[key] === "function") {
				// console.log("map." + key + "(" + JSON.stringify(value) + ")");
				map[key](value);
			// or just set the key on the map object
			} else {
				map[key] = value;
			}
		}
	}

	function px(n) {
		return Math.round(n) + "px";
	}

	// keep a reference around to the plugin object for exporting useful functions
	var exports = $.fn.htmapl = function(defaults, overrides) {
		return this.each(function(i, el) {
			htmapl(el, defaults, overrides);
		});
	};

	// exports
	exports.getArray = getArray;
	exports.getBoolean = getBoolean;
	exports.getExtent = getExtent;
	exports.getFloat = getFloat;
	exports.getInt = getInt;
	exports.getLatLon = getLatLon;
	exports.getXY = getXY;
	exports.templatize = templatize;

	/**
	 * The engine is an interface which creates all of the necessary objects.
	 * Initially we're assuming a Polymaps-like interface with the following
	 * generators:
	 *
	 * - map() for the main map object, with the following getter/setters:
	 * 	 center({lat, lon})
	 * 	 zoom(z)
	 * 	 zoomRange([min, max])
	 * 	 extent([{lat, lon}, {lat, lon}])
	 * 	 size({x, y})
	 * 	 tileSize({x, y})
	 * 	 add(layer)
	 *
	 * - image() for image layers, with methods:
	 *   url("template")
	 * - geoJson() for GeoJSON vector layers, with methods:
	 *   url("template")
	 *   scale("scale")
	 *   tile(bool)
	 *   clip(bool)
	 *   zoom(int)
	 * - interact() handlers for panning and zooming directly
	 * - compass() for attaching explict panning and zooming UI
	 *
	 * Note: For parity between HTML (ModestMaps) and non-HTML (Polymaps) renderers,
	 * engines should also implement the following methods to create DOM
	 * elements:
	 *
	 * container() for map element containers (<svg:svg/>, <div/>, etc.)
	 * anchor() for hypertext links (<svg:a/>, <a href=""/>, etc.)
	 *
	 * NB: The Polymaps "engine" also provides the XLink namespace in
	 * engine.ns.xlink, which htmapl uses in the namespace argument to
	 * DOM::setAttributeNS(). If there is no "ns" in the engine object it
	 * defaults to DOM::setAttribute().
	 */
	exports.engine = (function() {
		var engine = {};

		// Polymaps takes priority
		if (typeof org !== "undefined" && typeof org.polymaps !== "undefined") {
			var po = org.polymaps;

			po.container = function() {
				return po.svg("svg");
			};

			po.anchor = function() {
				return po.svg("a");
			};

			return po;
		}

		// Then comes the ModestMaps compatibility layer
		else if (typeof com !== "undefined" && typeof com.modestmaps !== "undefined") {

			var mm = com.modestmaps,
                engine = mm.htmapl = {};

			(function() {
				var NULL_PROVIDER = new mm.MapProvider(function(c) { return null; });

                function swapContainers(previous, current) {
                    // move the children over
                    $(previous).children().appendTo(current);

                    // copy style attributes
                    current.style.cssText = previous.style.cssText;

                    $(current).insertBefore(previous);
                    $(previous).remove();
                }

				engine.map = function(container) {
					/**
					 * FIXME: we might need to defer initialization here, because it's
					 * non-trivial to add/remove event handlers after the Map instance has been
					 * created.
					 */
					// Our initial contianer is a detached <div>
					var modest = new mm.Map(container, NULL_PROVIDER, null, []),
                        map = {modest: modest};

					// just so we can make sure this doesn't stick around
					$(container).addClass("modestmap");

					// expose all of the normal stuff
					map.locationPoint = function(loc) { return modest.locationPoint(loc); };
					map.pointLocation = function(p) { return modest.pointLocation(p); };
					map.coordinatePoint = function(c) { return modest.coordinatePoint(c); };
					map.pointCoordinate = function(p) { return modest.pointCoordinate(p); };

                    function tryToDraw() {
                        try {
                            modest.draw();
                        } catch (e) {
                        }
                    }

                    var url;
                    map.url = function(x) {
                        if (arguments.length) {
                            url = x;
                            if (typeof url === "function") {
                                modest.setProviderAt(0, new mm.MapProvider(url));
                            } else {
                                modest.setProviderAt(0, new mm.TemplatedMapProvider(x));
                            }
                            return map;
                        } else {
                            return url;
                        }
                    };

					// size getter/setter
					map.size = function(dims) {
						if (arguments.length) {
							modest.dimensions = dims;
							tryToDraw();
							return map;
						} else {
							return modest.dimensions;
						}
					};

					map.center = function(x) {
						if (arguments.length) {
							modest.setCenter(x);
							return map;
						} else {
							return modest.getCenter();
						}
					};

					map.zoom = function(x) {
						if (arguments.length) {
							modest.setZoom(x);
							return map;
						} else {
							return modest.getZoom();
						}
					};

					map.zoomIn = function() { modest.zoomIn(); };
					map.zoomOut = function() { modest.zoomOut(); };
					map.zoomBy = function(x) { modest.zoomBy(x); }

					map.zoomRange = function(range) {
						if (arguments.length) {
							modest.setMinZoom(range[0]);
							modest.setMaxZoom(range[1]);
							tryToDraw();
							return map;
						} else {
							return [modest.minZoom, modest.maxZoom];
						}
					};

					map.extent = function(e) {
						if (arguments.length) {
							modest.setExtent(e);
							return map;
						} else {
							return modest.getExtent();
						}
					};

					// add a layer
					map.add = function(layer) {
                        layer.map(modest);
						return map;
					};

					// remove a layer
					map.remove = function(layer) {
                        modest.removeProvider(layer);
						return map;
					};

					var eMap = {
						move: "drawn"
					};
					// event dispatch wrappers
					map.on = function(e, handler) {
						modest.addCallback(eMap[e] || e, handler);
						return map;
					};
					map.off = function(e, handler) {
						modest.removeCallback(eMap[e] || e, handler);
						return map;
					};

					return map;
				};

				/**
				 * The image() generator wraps com.modestmaps.MapProvider with Polymaps-like
				 * functionality.
				 *
				 * TODO: This also needs a po.dispatch()-like interface with "load" and
				 * "unload" event handlers.
				 */
				engine.image = function() {
					var provider = NULL_PROVIDER,
                        container = null,
                        url = null,
                        domains = null,
                        image = {};

                    function updateProvider() {
                        switch (typeof url) {
                            case "function":
                                provider = new mm.MapProvider(url);
                                break;
                            case "string":
                                provider = new mm.TemplatedMapProvider(url, domains);
                                break;
                            case "undefined":
                            default:
                                provider = NULL_PROVIDER;
                                break;
                        }
                    }

                    image.container = function(x) {
                        if (arguments.length) {
                            container = x;
                            return image;
                        } else {
                            return container;
                        }
                    };

					image.url = function(x) {
                        if (arguments.length) {
                            url = x;
                            updateProvider();
                            return image;
                        } else {
                            return provider;
                        }
					};

                    image.domains = function(x) {
                        if (arguments.length) {
                            domains = x;
                            updateProvider();
                            return image;
                        } else {
                            return provider;
                        }
                    };

                    image.map = function(map) {
                        var layer = new mm.Layer(map, provider, container);
                        map.layers.push(layer);
                        map.draw();
                        return image;
                    };

					return image;
				};

				/**
                 * Experimental GeoJSON support.
				 */
				engine.geoJson = function(cue) {
					var container = null,
                        _layer = null,
                        provider = NULL_PROVIDER,
                        marker = $("<a>{id}</a>"),
                        url = null,
                        tile = true,
                        layer = {};

                    if (!cue) cue = engine.queue.json;

                    function updateProvider() {
                        switch (typeof url) {
                            case "function":
                                provider = new mm.MapProvider(url);
                                break;
                            case "string":
                                if (url.match(/{.+}/)) {
                                    provider = new mm.TemplatedMapProvider(url, domains);
                                    tile = true;
                                } else {
                                    tile = false;
                                }
                                break;
                            case "undefined":
                            default:
                                provider = NULL_PROVIDER;
                                break;
                        }
                    }

                    function buildMarker(feature) {
                        var clone = marker.clone();
                        clone.text(templatize(clone.text(), feature.properties));
                        return clone[0];
                    }

                    layer.container = function(x) {
                        if (arguments.length) {
                            container = x;
                            return layer;
                        } else {
                            return container;
                        }
                    };

                    layer.template = function(x) {
                        if (arguments.length) {
                            marker = $(x).first().remove().attr("id", null);
                            return layer;
                        } else {
                            return marker;
                        }
                    };

					layer.tile = function(x) {
                        if (arguments.length) {
                            console.log("layer.tile()", x);
                            tile = x;
                            return layer;
                        } else {
                            return tile;
                        }
					};

					layer.url = function(x) {
                        if (arguments.length) {
                            console.log("layer.url()", x);
                            url = x;
                            updateProvider();
                            return layer;
                        } else {
                            return layer.template_provider;
                        }
					};

                    function onload(collection) {
                        var features = collection.features,
                            len = features.length;
                        console.log("+ loaded! " + len + " features");
                        for (var i = 0; i < len; i++) {
                            var feature = features[i],
                                marker = buildMarker(feature);
                            _layer.addMarker(marker, feature);
                        }
                    }

                    layer.map = function(map) {
                        if (tile) {
                            var json = new mm.GeoJSONProvider(provider, buildMarker);
                            _layer = new mm.Layer(map, json, container);
                            _layer.load = function(url, success, error) {
                                return cue(url,
                                    function(collection) {
                                        success.call(layer, collection);
                                    }
                                );
                            };
                        } else {
                            console.log("creating marker layer...");
                            _layer = new mm.MarkerLayer(map, provider, container);
                            // console.log("cueing", url, "...");
                            cue(typeof url === "function" ? url.call(_layer) : url, onload);
                        }
                        if (_layer) {
                            map.layers.push(_layer);
                            map.draw();
                        }
                        return layer;
                    };

					var eMap = {
						load: "load",
                        unload: "unload"
					};
					// event dispatch wrappers
					layer.on = function(e, handler) {
						provider.addCallback(eMap[e] || e, handler);
						return map;
					};
					layer.off = function(e, handler) {
						provider.removeCallback(eMap[e] || e, handler);
						return map;
					};

					return layer;
				};

				/**
				 * This is a layer "generator" for ModestMaps event handlers.
				 *
				 * I know, this is lame.
				 */
				function handler(cls) {
					return function() {
						var wrapper = {},
                            handler = new cls(),
                            map = null;
						
						wrapper.map = function(x) {
							if (arguments.length) {
								// remove old event listeners if they have any
								if (map && typeof handler.teardown == "function") handler.teardown(map);
								map = x;
								// add new event listeners
								if (map && typeof handler.init == "function") handler.init(map);
								return wrapper;
							} else {
								return map;
							}
						};

						return wrapper;
					};
				}

				engine.drag = handler(mm.MouseHandler);
				// TODO: integrate some of Tom's other handlers, or write them here?
				// engine.arrow = handler(mm.KeyboardHandler);
				// engine.gesture = handler(mm.GestureHandler);

                engine.queue = {};
                engine.queue.json = function(url, success, error) {
                    return $.ajax(url, {
                        dataType: "json",
                        success: success,
                        error: error
                    });
                };
                engine.queue.jsonp = function(url, success, error) {
                    return $.ajax(url, {
                        dataType: "jsonp",
                        success: success,
                        error: error
                    });
                };

			})();
			return engine;
		}

		// If Polymaps is missing we can still provide an abstract interface to be
		// filled in at runtime. TODO: provide an example!
		return {
			map: function() {
				var map = {};
				map.add = function(layer) {
					layer.map(map);
					return map;
				};
				map.remove = function(layer) {
					layer.map(null);
					return map;
				};
				return map;
			},
			image: function() {
				return {};
			},
			geoJson: function() {
				return {};
			},
			compass: function() {
				return {};
			},
			interact: function() {
				return {};
			}
		};
	})();

	function htmapl(el, defaults, overrides) {

		var engine = $.fn.htmapl.engine;
		if (!engine.map) throw new Error("No map() generator in engine");

		// the root element
		var root = $(el),
            container;

        if (typeof engine.container === "function") {
            container = engine.container();
            if (container) {
                el.insertBefore(container, null);
            }
        } else {
            container = el;
        }
        console.log("container:", container);

		var map = engine.map(container);
        if (typeof map.container === "function") {
            map.container(container);
        }

		// always do relative positioning in the container
		root.css("position", "relative");

		if (defaults) {
			applyData(root, map, defaults);
		}

		applyData(root, map, {
            // base tile provider in XYZ format
            url:        String,
			// extent comes in "lon,lat,lon,lat" format
			extent: 	getExtent,
			// center comes in "lon,lat" format
			center: 	getLatLon,
			// zoom is a float
			zoom: 		getFloat,
			// zoom is a float
			zoomRange: getArray,
			// size comes in "x,y"
			size: 		getXY,
			// tileSize comes in "x,y"
			tileSize: getXY,
			// angle is a float
			angle:		getFloat
		});

		if (overrides) {
			applyData(root, map, overrides);
		}

		// Interaction! We don't do the wheel by default here;
		// in order to enable it, you need to explicitly set the
		// "wheel" class on the containing element.
		if (root.hasClass("interact")) {
			if (engine.interact) {
				map.add(engine.interact());
			} else {
				if (engine.dblclick) map.add(engine.dblclick());
				if (engine.drag) map.add(engine.drag());
				if (engine.arrow && !root.hasClass("no-kybd")) map.add(engine.arrow());
				if (engine.wheel && root.hasClass("wheel")) {
					map.add(engine.wheel().smooth(root.hasClass("smooth")));
				}
			}
		} else {
			if (root.hasClass("drag") && engine.drag) {
				map.add(engine.drag());
			}
			if (engine.wheel && root.hasClass("wheel")) {
				map.add(engine.wheel().smooth(root.hasClass("smooth")));
			}
		}

		// hash stashing
		if (engine.hash && root.hasClass("hash")) {
			map.add(engine.hash());
		}

		root.find(".layer").each(function(j, subel) {
			var source = $(subel),
                layer,
                attrs = {},
                type = source.data("type");
			switch (type) {
				case "image":
					if (!engine.image) return false;

					layer = engine.image();
					attrs.url = String;
					attrs.domains = getArray;
					break;

				case "geoJson":
				case "geoJson-p":
					if (!engine.geoJson) return false;

					layer = (type == "geoJson-p")
						? engine.geoJson(engine.queue.jsonp)
						: engine.geoJson();
					attrs.url = String;
                    attrs.template = String;
					// attrs.visible = getBoolean;
					attrs.scale = String;
					attrs.tile = getBoolean;
					attrs.clip = getBoolean;
					attrs.zoom = getFloat;

					// allow string parsing of JSON features?
                    /*
					if (typeof JSON !== "undefined" && typeof JSON.parse === "function") {
						attrs.features = JSON.parse;
					}
                    */

					var str = source.data("style"),
                        style = parseCSS(str);
					if (style && engine.stylist) {
						applyStyle(layer, source, style, engine);
					}

					var linkTemplate = source.data("href");
					if (linkTemplate && engine.anchor) {
						applyLinkTemplate(layer, linkTemplate, engine);
					}

					break;

				case "compass":
					if (!engine.compass) return false;
					layer = engine.compass();
					attrs.radius = getFloat;
					attrs.speed = getFloat;
					attrs.position = String;
					attrs.pan = String;
					attrs.zoom = String;
					break;

				case "grid":
					if (!engine.grid) return false;
					layer = engine.grid();
					break;
			}

			if (layer) {
				applyData(source, layer, attrs);
				if (source.id) layer.id(source.id);
				map.add(layer);
			}
		}).remove();

		var markers = root.find(".marker").filter(function(i, m) {
			var marker = $(this),
                loc = getLatLon(marker.data("location"));
			if (loc) {
				marker.data("location", loc);
				marker.css("position", "absolute");
				return true;
			}
			return false;
		});

		if (markers.length) {
			var markerLayer = $("<div/>")
				.attr("class", "markers")
				.css({
					position: "absolute",
					left: 0, top: 0
				})
				.appendTo(root);

			markers.appendTo(markerLayer);

			map.on("move", function() {
				var size = map.size();
				markers.each(function() {
					var marker = $(this),
							loc = marker.data("location"),
							pos = map.locationPoint(loc);
					if (pos.x >= 0 && pos.x <= size.x && pos.y >= 0 && pos.y <= size.y) {
						marker.css("left", px(pos.x)).css("top", px(pos.y));
						marker.css("display", "");
					} else {
						marker.css("display", "none");
					}
				});
			});
		}

		// force a move
		map.center(map.center());

		/**
		 * XXX: The deferred initialization does a resize based on the element's
		 * innerWidth and innerHeight. This is a workaround for a Chrome bug (I
		 * think) that prevents us from knowing what the dimensions of the
		 * container are at this stage.
		 */
		function deferredInit() {
			clearTimeout(deferredInit.timeout);
			var size = {x: root.innerWidth(), y: root.innerHeight()};
			// console.log(["init:", size.x, size.y]);
			map.size(size);
		}
		deferredInit.timeout = setTimeout(deferredInit, 10);

		// stash the map in the jQuery element data for future reference
		return root.data("map", map);
	}

})(jQuery);
