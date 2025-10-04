const assert = require('assert');
const { classifyWeather } = require('../lib/weather');

function eq(a,b){
  assert.deepStrictEqual(a.sort(), b.sort());
}

// Happy path
// Note: high temp may also trigger very_uncomfortable via heat index rule, so expect both
eq(classifyWeather({tempC:40, humidity:30, precipMM:0, windKmh:5}), ['very_hot','very_uncomfortable']);
eq(classifyWeather({tempC:0, humidity:60, precipMM:0, windKmh:5}), ['very_cold']);
eq(classifyWeather({tempC:25, humidity:90, precipMM:0, windKmh:5}), ['very_uncomfortable']);
eq(classifyWeather({tempC:25, humidity:50, precipMM:10, windKmh:5}), ['very_wet']);
eq(classifyWeather({tempC:25, humidity:50, precipMM:0, windKmh:30}), ['very_windy']);
eq(classifyWeather({tempC:22, humidity:50, precipMM:0, windKmh:5}), ['comfortable']);

console.log('weather tests passed');
