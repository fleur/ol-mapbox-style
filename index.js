/*
ol-mapbox-style - Use Mapbox Style objects with OpenLayers
Copyright 2016-present Boundless Spatial, Inc.
License: https://raw.githubusercontent.com/boundlessgeo/ol-mapbox-gl-style/master/LICENSE
*/

import mb2css from 'mapbox-to-css-font';
import applyStyleFunction, {getValue} from './stylefunction';
import googleFonts from 'webfont-matcher/lib/fonts/google';
import {fromLonLat} from 'ol/proj';
import {createXYZ} from 'ol/tilegrid';
import Map from 'ol/Map';
import GeoJSON from 'ol/format/GeoJSON';
import MVT from 'ol/format/MVT';
import {unByKey} from 'ol/Observable';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorTileLayer from 'ol/layer/VectorTile';
import TileJSON from 'ol/source/TileJSON';
import VectorSource from 'ol/source/Vector';
import VectorTileSource from 'ol/source/VectorTile';
import XYZ from 'ol/source/XYZ';
import {Color} from '@mapbox/mapbox-gl-style-spec';

const fontFamilyRegEx = /font-family: ?([^;]*);/;
const stripQuotesRegEx = /("|')/g;
let loadedFontFamilies;
function hasFontFamily(family) {
  if (!loadedFontFamilies) {
    loadedFontFamilies = {};
    const styleSheets = document.styleSheets;
    for (let i = 0, ii = styleSheets.length; i < ii; ++i) {
      const styleSheet = styleSheets[i];
      try {
        const cssRules = styleSheet.rules || styleSheet.cssRules;
        if (cssRules) {
          for (let j = 0, jj = cssRules.length; j < jj; ++j) {
            const cssRule = cssRules[j];
            if (cssRule.type == 5) {
              const match = cssRule.cssText.match(fontFamilyRegEx);
              loadedFontFamilies[match[1].replace(stripQuotesRegEx, '')] = true;
            }
          }
        }
      } catch (e) {
        // empty catch block
      }
    }
  }
  return family in loadedFontFamilies;
}

const fontFamilies = {};
const googleFamilies = googleFonts.getNames();
function getFonts(fonts) {
  if (fonts in fontFamilies) {
    return fontFamilies[fonts];
  }
  const families = fonts.map(function(font) {
    return mb2css(font, 1).split(' 1px ')[1].replace(/"/g, '');
  });
  const family = families[0];
  if (!hasFontFamily(family) && googleFamilies.indexOf(family) !== -1) {
    const fontUrl = 'https://fonts.googleapis.com/css?family=' + family.replace(/ /g, '+');
    if (!document.querySelector('link[href="' + fontUrl + '"]')) {
      const markup = document.createElement('link');
      markup.href = fontUrl;
      markup.rel = 'stylesheet';
      document.getElementsByTagName('head')[0].appendChild(markup);
    }
  }
  return fonts;
}

const spriteRegEx = /^(.*)(\?.*)$/;

function withPath(url, path) {
  if (path && url.indexOf('http') != 0) {
    url = path + url;
  }
  return url;
}

function toSpriteUrl(url, path, extension) {
  url = withPath(url, path);
  const parts = url.match(spriteRegEx);
  return parts ?
    parts[1] + extension + (parts.length > 2 ? parts[2] : '') :
    url + extension;
}

/**
 * Applies a style function to an `ol.layer.VectorTile` or `ol.layer.Vector`
 * with an `ol.source.VectorTile` or an `ol.source.Vector`. The style function
 * will render all layers from the `glStyle` object that use the specified
 * `source`, or a subset of layers from the same source. The source needs to be
 * a `"type": "vector"` or `"type": "geojson"` source.
 *
 * Two additional properties will be set on the provided layer:
 *
 *  * `mapbox-source`: The `id` of the Mapbox Style document's source that the
 *    OpenLayers layer was created from. Usually `apply()` creates one
 *    OpenLayers layer per Mapbox Style source, unless the layer stack has
 *    layers from different sources in between.
 *  * `mapbox-layers`: The `id`s of the Mapbox Style document's layers that are
 *    included in the OpenLayers layer.
 *
 * @param {ol.layer.VectorTile|ol.layer.Vector} layer OpenLayers layer.
 * @param {string|Object} glStyle Mapbox Style object.
 * @param {string|Array<string>} source `source` key or an array of layer `id`s from the
 * Mapbox Style object. When a `source` key is provided, all layers for the
 * specified source will be included in the style function. When layer `id`s
 * are provided, they must be from layers that use the same source.
 * @param {string} [path=undefined] Path of the style file. Only required when
 * a relative path is used with the `"sprite"` property of the style.
 * @param {Array<number>} [resolutions=undefined] Resolutions for mapping resolution to zoom level.
 * @return {Promise} Promise which will be resolved when the style can be used
 * for rendering.
 */
export function applyStyle(layer, glStyle, source, path, resolutions) {
  return new Promise(function(resolve, reject) {

    // TODO: figure out where best place to check source type is
    // Note that the source arg is an array of gl layer ids and each must be
    // dereferenced to get source type to validate
    if (typeof glStyle != 'object') {
      glStyle = JSON.parse(glStyle);
    }
    if (glStyle.version != 8) {
      return reject(new Error('glStyle version 8 required.'));
    }
    if (!(layer instanceof VectorLayer || layer instanceof VectorTileLayer)) {
      return reject(new Error('Can only apply to VectorLayer or VectorTileLayer'));
    }

    let spriteScale, spriteData, spriteImageUrl, style;
    function onChange() {
      if (!style && (!glStyle.sprite || spriteData)) {
        style = applyStyleFunction(layer, glStyle, source, resolutions, spriteData, spriteImageUrl, getFonts);
        if (!layer.getStyle()) {
          reject(new Error(`Nothing to show for source [${source}]`));
        } else {
          resolve();
        }
      } else if (style) {
        layer.setStyle(style);
        resolve();
      } else {
        reject(new Error('Something went wrong trying to apply style.'));
      }
    }

    if (glStyle.sprite) {
      spriteScale = window.devicePixelRatio >= 1.5 ? 0.5 : 1;
      const sizeFactor = spriteScale == 0.5 ? '@2x' : '';
      let spriteUrl = toSpriteUrl(glStyle.sprite, path, sizeFactor + '.json');

      fetch(spriteUrl, {credentials: 'same-origin'})
        .then(function(response) {
          if (!response.ok && (sizeFactor !== '')) {
            spriteUrl = toSpriteUrl(glStyle.sprite, path, '.json');
            return fetch(spriteUrl, {credentials: 'same-origin'});
          } else {
            return response;
          }
        })
        .then(function(response) {
          if (response.ok) {
            return response.json();
          } else {
            reject(new Error(`Problem fetching sprite from ${spriteUrl}: ${response.statusText}`));
          }
        })
        .then(function(spritesJson) {
          if ((spritesJson === undefined) || (Object.keys(spritesJson).length === 0)) {
            return reject(new Error('No sprites found.'));
          }
          spriteData = spritesJson;
          spriteImageUrl = toSpriteUrl(glStyle.sprite, path, sizeFactor + '.png');
          onChange();
        })
        .catch(function(err) {
          reject(new Error(`Sprites cannot be loaded: ${spriteUrl}: ${err.message}`));
        });
    } else {
      onChange();
    }

  });
}

const emptyObj = {};

function setBackground(map, layer) {
  const background = {
    type: layer.type
  };
  function updateStyle() {
    const element = map.getTargetElement();
    if (!element) {
      return;
    }
    const layout = layer.layout || {};
    const paint = layer.paint || {};
    background['paint'] = paint;
    background.id = 'olms-bg-' + paint['background-opacity'] + paint['background-color'];
    const zoom = map.getView().getZoom();
    if (paint['background-color'] !== undefined) {
      const bg = getValue(background, 'paint', 'background-color', zoom, emptyObj);
      element.style.backgroundColor = Color.parse(bg).toString();
    }
    if (paint['background-opacity'] !== undefined) {
      element.style.backgroundOpacity =
        getValue(background, 'paint', 'background-opacity', zoom, emptyObj);
    }
    if (layout.visibility == 'none') {
      element.style.backgroundColor = '';
      element.style.backgroundOpacity = '';
    }
  }
  if (map.getTargetElement()) {
    updateStyle();
  }
  map.on(['change:resolution', 'change:target'], updateStyle);
}

/**
 * ```js
 * import {applyBackground} from 'ol-mapbox-style';
 * ```
 * Applies properties of the Mapbox Style's first `background` layer to the map.
 * @param {ol.Map} map OpenLayers Map.
 * @param {Object} glStyle Mapbox Style object.
 */
export function applyBackground(map, glStyle) {
  glStyle.layers.some(function(l) {
    if (l.type == 'background') {
      setBackground(map, l);
      return true;
    }
  });
}

function getSourceIdByRef(layers, ref) {
  let sourceId;
  layers.some(function(layer) {
    if (layer.id == ref) {
      sourceId = layer.source;
      return true;
    }
  });
  return sourceId;
}

function setupVectorLayer(glSource, accessToken, url) {
  let tiles = glSource.tiles;
  if (url) {
    if (url.indexOf('mapbox://') == 0) {
      const mapid = url.replace('mapbox://', '');
      tiles = ['a', 'b', 'c', 'd'].map(function(host) {
        return 'https://' + host + '.tiles.mapbox.com/v4/' + mapid +
            '/{z}/{x}/{y}.' +
            (glSource.type == 'vector' ? 'vector.pbf' : 'png') +
            accessToken;
      });
    }
  }
  return tiles ? (function() {
    const tileGrid = createXYZ({
      tileSize: 512,
      maxZoom: 'maxzoom' in glSource ? glSource.maxzoom : 22,
      minZoom: glSource.minzoom
    });
    return new VectorTileLayer({
      declutter: true,
      maxResolution: tileGrid.getMinZoom() > 0 ?
        tileGrid.getResolution(tileGrid.getMinZoom()) : undefined,
      source: new VectorTileSource({
        attributions: glSource.attribution,
        format: new MVT(),
        tileGrid: tileGrid,
        urls: tiles
      }),
      visible: false
    });
  })() : (function() {
    const layer = new VectorTileLayer({
      declutter: true,
      visible: false
    });
    const tilejson = new TileJSON({
      url: url
    });
    const key = tilejson.on('change', function() {
      if (tilejson.getState() == 'ready') {
        const tileJSONDoc = tilejson.getTileJSON();
        const tiles = Array.isArray(tileJSONDoc.tiles) ? tileJSONDoc.tiles : [tileJSONDoc.tiles];
        for (let i = 0, ii = tiles.length; i < ii; ++i) {
          const tile = tiles[i];
          if (tile.indexOf('http') != 0) {
            tiles[i] = glSource.url + tile;
          }
        }
        const tileGrid = tilejson.getTileGrid();
        layer.setSource(new VectorTileSource({
          attributions: tilejson.getAttributions() || tileJSONDoc.attribution,
          format: new MVT(),
          tileGrid: createXYZ({
            minZoom: tileGrid.getMinZoom(),
            maxZoom: tileGrid.getMaxZoom(),
            tileSize: 512
          }),
          urls: tiles
        }));
        if (tileGrid.getMinZoom() > 0) {
          layer.setMaxResolution(
            tileGrid.getResolution(tileGrid.getMinZoom()));
        }
        unByKey(key);
      } else if (tilejson.getState() == 'error') {
        layer.setSource(undefined);
        unByKey(key);
      }
    });
    return layer;
  })();
}

function setupRasterLayer(glSource, url) {
  const layer = new TileLayer();
  let source;
  if (!glSource.tiles) {
    source = new TileJSON({
      transition: 0,
      url: url,
      crossOrigin: 'anonymous'
    });
    const key = source.on('change', function() {
      const state = source.getState();
      if (state === 'ready' || state === 'error') {
        unByKey(key);
        layer.setSource(source);
      }
    });
  } else {
    source = new XYZ({
      transition: 0,
      attributions: glSource.attribution,
      minZoom: glSource.minzoom,
      maxZoom: 'maxzoom' in glSource ? glSource.maxzoom : 22,
      tileSize: glSource.tileSize || 512,
      url: url,
      urls: glSource.tiles,
      crossOrigin: 'anonymous'
    });
  }
  source.setTileLoadFunction(function(tile, src) {
    if (src.indexOf('{bbox-epsg-3857}') != -1) {
      const bbox = source.getTileGrid().getTileCoordExtent(tile.getTileCoord());
      src = src.replace('{bbox-epsg-3857}', bbox.toString());
    }
    tile.getImage().src = src;
  });
  layer.setSource(source);
  return layer;
}

const geoJsonFormat = new GeoJSON();
function setupGeoJSONLayer(glSource, path) {
  const data = glSource.data;
  let features, geoJsonUrl;
  if (typeof data == 'string') {
    geoJsonUrl = withPath(data, path);
  } else {
    features = geoJsonFormat.readFeatures(data, {featureProjection: 'EPSG:3857'});
  }
  return new VectorLayer({
    source: new VectorSource({
      attributions: glSource.attribution,
      features: features,
      format: geoJsonFormat,
      url: geoJsonUrl
    }),
    visible: false
  });
}

function processStyle(glStyle, map, baseUrl, host, path, accessToken) {
  const promises = [];
  const view = map.getView();
  if ('center' in glStyle && !view.getCenter()) {
    view.setCenter(fromLonLat(glStyle.center));
  }
  if ('zoom' in glStyle && view.getZoom() === undefined) {
    view.setZoom(glStyle.zoom);
  }
  if (!view.getCenter() || view.getZoom() === undefined) {
    view.fit(view.getProjection().getExtent(), {
      nearest: true,
      size: map.getSize()
    });
  }
  if (glStyle.sprite) {
    if (glStyle.sprite.indexOf('mapbox://') == 0) {
      glStyle.sprite = baseUrl + '/sprite' + accessToken;
    } else if (glStyle.sprite.indexOf('http') != 0) {
      glStyle.sprite = (host ? (host + path) : '') + glStyle.sprite + accessToken;
    }
  }

  const glLayers = glStyle.layers;
  let layerIds = [];

  let glLayer, glSource, glSourceId, id, layer, url;
  for (let i = 0, ii = glLayers.length; i < ii; ++i) {
    glLayer = glLayers[i];
    if (glLayer.type == 'background') {
      setBackground(map, glLayer);
    } else {
      id = glLayer.source || getSourceIdByRef(glLayers, glLayer.ref);
      // this technique assumes gl layers will be in a particular order
      if (id != glSourceId) {
        if (layerIds.length) {
          promises.push(finalizeLayer(layer, layerIds, glStyle, path, map));
          layerIds = [];
        }
        glSource = glStyle.sources[id];
        url = glSource.url;

        if (glSource.type == 'vector') {
          layer = setupVectorLayer(glSource, accessToken, url);
        } else if (glSource.type == 'raster') {
          layer = setupRasterLayer(glSource, url);
          layer.setVisible(glLayer.layout ? glLayer.layout.visibility !== 'none' : true);
        } else if (glSource.type == 'geojson') {
          layer = setupGeoJSONLayer(glSource, path);
        }
        glSourceId = id;
      }
      layerIds.push(glLayer.id);
      if (layer) {
        layer.setZIndex(i);
        layer.set('mapbox-source', glSourceId);
        layer.set('mapbox-layers', layerIds);
      }
    }
  }
  promises.push(finalizeLayer(layer, layerIds, glStyle, path, map));
  map.set('mapbox-style', glStyle);
  return Promise.all(promises);
}

/**
 * ```js
 * import olms from 'ol-mapbox-style';
 * ```
 *
 * Loads and applies a Mapbox Style object to an OpenLayers Map. This includes
 * the map background, the layers, the center and the zoom.
 *
 * The center and zoom will only be set if present in the Mapbox Style document,
 * and if not already set on the OpenLayers map.
 *
 * Layers will be added to the OpenLayers map, without affecting any layers that
 * might already be set on the map.
 *
 * Layers added by `apply()` will have two additional properties:
 *
 *  * `mapbox-source`: The `id` of the Mapbox Style document's source that the
 *    OpenLayers layer was created from. Usually `apply()` creates one
 *    OpenLayers layer per Mapbox Style source, unless the layer stack has
 *    layers from different sources in between.
 *  * `mapbox-layers`: The `id`s of the Mapbox Style document's layers that are
 *    included in the OpenLayers layer.
 *
 * This function sets an additional `mapbox-style` property on the OpenLayers
 * map instance, which holds the Mapbox Style object.
 *
 * @param {ol.Map|HTMLElement|string} map Either an existing OpenLayers Map
 * instance, or a HTML element, or the id of a HTML element that will be the
 * target of a new OpenLayers Map.
 * @param {string|Object} style JSON style object or style url pointing to a
 * Mapbox Style object. When using Mapbox APIs, the url must contain an access
 * token and look like
 * `https://api.mapbox.com/styles/v1/mapbox/bright-v9?access_token=[your_access_token_here]`.
 * When passed as JSON style object, all OpenLayers layers created by `apply()`
 * will be immediately available, but they may not have a source yet (i.e. when
 * they are defined by a TileJSON url in the Mapbox Style document). When passed
 * as style url, layers will be added to the map when the Mapbox Style document
 * is loaded and parsed.
 * @return {Promise} A promise that resolves after all layers have been added to
 * the OpenLayers Map instance, their sources set, and their styles applied. the
 * `resolve` callback will be called with the OpenLayers Map instance as
 * argument.
 */
export default function olms(map, style) {

  let accessToken, baseUrl, host, path, promise;
  accessToken = baseUrl = host = path = '';

  if (!(map instanceof Map)) {
    map = new Map({
      target: map
    });
  }

  if (typeof style === 'string') {
    const parts = style.match(spriteRegEx);
    if (parts) {
      baseUrl = parts[1];
      accessToken = parts.length > 2 ? parts[2] : '';
    }
    promise = new Promise(function(resolve, reject) {
      fetch(style, {
        credentials: 'same-origin'
      })
        .then(function(response) {
          return response.json();
        })
        .then(function(glStyle) {
          const a = document.createElement('A');
          a.href = style;
          path = a.pathname.split('/').slice(0, -1).join('/') + '/';
          host = style.substr(0, style.indexOf(path));

          processStyle(glStyle, map, baseUrl, host, path, accessToken)
            .then(function() {
              resolve(map);
            })
            .catch(reject);
        })
        .catch(function(err) {
          reject(new Error(`Could not load ${style}: ${err.message}`));
        });
    });
  } else {
    promise = new Promise(function(resolve, reject) {
      processStyle(style, map)
        .then(function() {
          resolve(map);
        })
        .catch(reject);
    });
  }

  return promise;
}

/**
 * ```js
 * import {apply} from 'ol-mapbox-style';
 * ```
 * Like `olms`, but returns an `ol.Map` instance instead of a `Promise`.
 *
 * @param {ol.Map|HTMLElement|string} map Either an existing OpenLayers Map
 * instance, or a HTML element, or the id of a HTML element that will be the
 * target of a new OpenLayers Map.
 * @param {string|Object} style JSON style object or style url pointing to a
 * Mapbox Style object. When using Mapbox APIs, the url must contain an access
 * token and look like
 * `https://api.mapbox.com/styles/v1/mapbox/bright-v9?access_token=[your_access_token_here]`.
 * When passed as JSON style object, all OpenLayers layers created by `apply()`
 * will be immediately available, but they may not have a source yet (i.e. when
 * they are defined by a TileJSON url in the Mapbox Style document). When passed
 * as style url, layers will be added to the map when the Mapbox Style document
 * is loaded and parsed.
 * @return {ol.Map} The OpenLayers Map instance that will be populated with the
 * contents described in the Mapbox Style object.
 */
export function apply(map, style) {
  if (!(map instanceof Map)) {
    map = new Map({
      target: map
    });
  }
  setTimeout(function() {
    olms(map, style);
  }, 0);
  return map;
}


/**
 * @private
 * If layerIds is not empty, applies the style specified in glStyle to the layer,
 * and adds the layer to the map.
 *
 * The layer may not yet have a source when the function is called.  If so, the style
 * is applied to the layer via a once listener on the 'change:source' event.
 *
 * @param {ol.layer.Layer} layer An OpenLayers layer instance.
 * @param {Array<string>} layerIds Array containing layer ids of already-processed layers.
 * @param {Object} glStyle Style as a JSON object.
 * @param {string|undefined} path The path part of the style URL. Only required
 * when a relative path is used with the `"sprite"` property of the style.
 * @param {ol.Map} map OpenLayers Map.
 * @return {Promise} Returns a promise that resolves after the source has
 * been set on the specified layer, and the style has been applied.
 */
function finalizeLayer(layer, layerIds, glStyle, path, map) {
  return new Promise(function(resolve, reject) {
    const setStyle = function() {
      const source = layer.getSource();
      if (source instanceof VectorSource || source instanceof VectorTileSource) {
        applyStyle(layer, glStyle, layerIds, path).then(function() {
          layer.setVisible(true);
          resolve();
        }, function(e) {
          reject(e);
        });
      } else {
        if (!source || source.getState() === 'error') {
          reject(new Error('Error accessing data for source ' + layer.get('mapbox-source')));
        } else {
          resolve();
        }
      }
    };

    if (map.getLayers().getArray().indexOf(layer) === -1) {
      map.addLayer(layer);
    }

    if (layer.getSource()) {
      setStyle();
    } else {
      layer.once('change:source', setStyle);
    }
  });
}


/**
 * ```js
 * import {getLayer} from 'ol-mapbox-style';
 * ```
 * Get the OpenLayers layer instance that contains the provided Mapbox Style
 * `layer`. Note that multiple Mapbox Style layers are combined in a single
 * OpenLayers layer instance when they use the same Mapbox Style `source`.
 * @param {ol.Map} map OpenLayers Map.
 * @param {string} layerId Mapbox Style layer id.
 * @return {ol.layer.Layer} layer OpenLayers layer instance.
 */
export function getLayer(map, layerId) {
  const layers = map.getLayers().getArray();
  for (let i = 0, ii = layers.length; i < ii; ++i) {
    if (layers[i].get('mapbox-layers').indexOf(layerId) !== -1) {
      return layers[i];
    }
  }
}

/**
 * ```js
 * import {getSource} from 'ol-mapbox-style';
 * ```
 * Get the OpenLayers source instance for the provided Mapbox Style `source`.
 * @param {ol.Map} map OpenLayers Map.
 * @param {string} sourceId Mapbox Style source id.
 * @return {ol.layer.Layer} layer OpenLayers layer instance.
 */
export function getSource(map, sourceId) {
  const layers = map.getLayers().getArray();
  for (let i = 0, ii = layers.length; i < ii; ++i) {
    const source = layers[i].getSource();
    if (layers[i].get('mapbox-source').indexOf(sourceId) !== -1) {
      return source;
    }
  }
}
