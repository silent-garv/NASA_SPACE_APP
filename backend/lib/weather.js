function classifyWeather({tempC, humidity, precipMM, windKmh, heatIndexC}){
  const categories = [];
  if (tempC != null && tempC >= 35) categories.push('very_hot');
  if (tempC != null && tempC <= 5) categories.push('very_cold');
  if ((precipMM || 0) >= 5) categories.push('very_wet');
  if ((windKmh || 0) >= 20) categories.push('very_windy');
  if ((heatIndexC || tempC) != null && ((heatIndexC || tempC) >= 32 || (humidity || 0) >= 80)) categories.push('very_uncomfortable');
  if (categories.length === 0) categories.push('comfortable');
  return categories;
}

module.exports = { classifyWeather };
