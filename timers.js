import { setTimeout, setInterval, clearTimeout, clearInterval } from 'timers-browserify'

var scope = typeof self !== "undefined" && self || typeof self !== "undefined" && self || window;

scope.setTimeout = setTimeout;
scope.setInterval = setInterval;
scope.clearTimeout = clearTimeout;
scope.clearInterval = clearInterval;
