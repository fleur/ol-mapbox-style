/* eslint import/no-unresolved: [2, { ignore: [ol-mapbox-style] }] */

import 'ol/ol.css';
import {apply} from 'ol-mapbox-style';

apply('map', 'data/geojson-inline.json');
