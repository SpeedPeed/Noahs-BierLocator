// Englisches Wörterbuch, nach App-Bereichen aufgeteilt (Schlüssel = deutscher Text).
import core from './en-core.js';
import tour from './en-tour.js';
import live from './en-live.js';
import social from './en-social.js';
import app from './en-app.js';
import data from './en-data.js';

export default Object.assign({}, core, tour, live, social, app, data);
