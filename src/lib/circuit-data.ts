export type CircuitData = {
  name: string;
  turns: number;
  lengthKM: number;
  lapRecord: string;
  imageUrl: string;
  firstGrandPrix?: number;
  laps?: number;
  raceDistance?: number;
};

// Generic fallback image (using F1 logo or just a placeholder)
const genericImageUrl = "https://media.formula1.com/image/upload/f_auto/q_auto/v1677244985/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Bahrain_Circuit.png.transform/8col/image.png";

// Base URL for F1 images
const getF1ImageUrl = (name: string) => `https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/${name}_Circuit.png`;

// Mapping by Country or Race Name to handle missing circuit names
export const CIRCUITS: Record<string, CircuitData> = {
  "Bahrain": {
    name: "Bahrain International Circuit",
    turns: 15,
    lengthKM: 5.412,
    lapRecord: "1:31.447 (Pedro de la Rosa, 2005)",
    imageUrl: getF1ImageUrl("Bahrain"),
    firstGrandPrix: 2004,
    laps: 57,
    raceDistance: 308.238
  },
  "Saudi Arabia": {
    name: "Jeddah Corniche Circuit",
    turns: 27,
    lengthKM: 6.174,
    lapRecord: "1:30.734 (Lewis Hamilton, 2021)",
    imageUrl: getF1ImageUrl("Saudi_Arabia"),
    firstGrandPrix: 2021,
    laps: 50,
    raceDistance: 308.450
  },
  "Australia": {
    name: "Albert Park Grand Prix Circuit",
    turns: 14,
    lengthKM: 5.278,
    lapRecord: "1:19.813 (Charles Leclerc, 2024)",
    imageUrl: getF1ImageUrl("Australia"),
    firstGrandPrix: 1996,
    laps: 58,
    raceDistance: 306.124
  },
  "Japan": {
    name: "Suzuka Circuit",
    turns: 18,
    lengthKM: 5.807,
    lapRecord: "1:30.983 (Lewis Hamilton, 2019)",
    imageUrl: getF1ImageUrl("Japan"),
    firstGrandPrix: 1987,
    laps: 53,
    raceDistance: 307.471
  },
  "Miami Grand Prix": {
    name: "Miami International Autodrome",
    turns: 19,
    lengthKM: 5.412,
    lapRecord: "1:29.708 (Max Verstappen, 2023)",
    imageUrl: getF1ImageUrl("Miami"),
    firstGrandPrix: 2022,
    laps: 57,
    raceDistance: 308.326
  },
  "Italy": {
    name: "Autodromo Enzo e Dino Ferrari",
    turns: 19,
    lengthKM: 4.909,
    lapRecord: "1:15.484 (Lewis Hamilton, 2020)",
    imageUrl: getF1ImageUrl("Emilia_Romagna"),
    firstGrandPrix: 1980,
    laps: 63,
    raceDistance: 309.049
  },
  "Emilia Romagna Grand Prix": {
    name: "Autodromo Enzo e Dino Ferrari",
    turns: 19,
    lengthKM: 4.909,
    lapRecord: "1:15.484 (Lewis Hamilton, 2020)",
    imageUrl: getF1ImageUrl("Emilia_Romagna"),
    firstGrandPrix: 1980,
    laps: 63,
    raceDistance: 309.049
  },
  "Monaco": {
    name: "Circuit de Monaco",
    turns: 19,
    lengthKM: 3.337,
    lapRecord: "1:12.909 (Lewis Hamilton, 2021)",
    imageUrl: getF1ImageUrl("Monaco"),
    firstGrandPrix: 1950,
    laps: 78,
    raceDistance: 260.286
  },
  "Canada": {
    name: "Circuit Gilles Villeneuve",
    turns: 14,
    lengthKM: 4.361,
    lapRecord: "1:13.078 (Valtteri Bottas, 2019)",
    imageUrl: getF1ImageUrl("Canada"),
    firstGrandPrix: 1978,
    laps: 70,
    raceDistance: 305.270
  },
  "Spain": {
    name: "Circuit de Barcelona-Catalunya",
    turns: 14,
    lengthKM: 4.657,
    lapRecord: "1:16.330 (Max Verstappen, 2023)",
    imageUrl: getF1ImageUrl("Spain"),
    firstGrandPrix: 1991,
    laps: 66,
    raceDistance: 307.236
  },
  "Austria": {
    name: "Red Bull Ring",
    turns: 10,
    lengthKM: 4.318,
    lapRecord: "1:05.619 (Carlos Sainz, 2020)",
    imageUrl: getF1ImageUrl("Austria"),
    firstGrandPrix: 1970,
    laps: 71,
    raceDistance: 306.452
  },
  "United Kingdom": {
    name: "Silverstone Circuit",
    turns: 18,
    lengthKM: 5.891,
    lapRecord: "1:27.097 (Max Verstappen, 2020)",
    imageUrl: getF1ImageUrl("Great_Britain"),
    firstGrandPrix: 1950,
    laps: 52,
    raceDistance: 306.198
  },
  "Hungary": {
    name: "Hungaroring",
    turns: 14,
    lengthKM: 4.381,
    lapRecord: "1:16.627 (Lewis Hamilton, 2020)",
    imageUrl: getF1ImageUrl("Hungary"),
    firstGrandPrix: 1986,
    laps: 70,
    raceDistance: 306.630
  },
  "Belgium": {
    name: "Circuit de Spa-Francorchamps",
    turns: 19,
    lengthKM: 7.004,
    lapRecord: "1:46.286 (Valtteri Bottas, 2018)",
    imageUrl: getF1ImageUrl("Belgium"),
    firstGrandPrix: 1950,
    laps: 44,
    raceDistance: 308.052
  },
  "Netherlands": {
    name: "Circuit Zandvoort",
    turns: 14,
    lengthKM: 4.259,
    lapRecord: "1:11.097 (Lewis Hamilton, 2021)",
    imageUrl: getF1ImageUrl("Netherlands"),
    firstGrandPrix: 1952,
    laps: 72,
    raceDistance: 306.587
  },
  "Italian Grand Prix": {
    name: "Autodromo Nazionale Monza",
    turns: 11,
    lengthKM: 5.793,
    lapRecord: "1:21.046 (Rubens Barrichello, 2004)",
    imageUrl: getF1ImageUrl("Italy"),
    firstGrandPrix: 1950,
    laps: 53,
    raceDistance: 306.720
  },
  "Azerbaijan": {
    name: "Baku City Circuit",
    turns: 20,
    lengthKM: 6.003,
    lapRecord: "1:43.009 (Charles Leclerc, 2019)",
    imageUrl: getF1ImageUrl("Baku"),
    firstGrandPrix: 2016,
    laps: 51,
    raceDistance: 306.049
  },
  "Singapore": {
    name: "Marina Bay Street Circuit",
    turns: 19,
    lengthKM: 4.94,
    lapRecord: "1:35.867 (Lewis Hamilton, 2023)",
    imageUrl: getF1ImageUrl("Singapore"),
    firstGrandPrix: 2008,
    laps: 62,
    raceDistance: 306.143
  },
  "United States": {
    name: "Circuit of The Americas",
    turns: 20,
    lengthKM: 5.513,
    lapRecord: "1:36.169 (Charles Leclerc, 2019)",
    imageUrl: getF1ImageUrl("USA"),
    firstGrandPrix: 2012,
    laps: 56,
    raceDistance: 308.405
  },
  "Mexico": {
    name: "Autódromo Hermanos Rodríguez",
    turns: 17,
    lengthKM: 4.304,
    lapRecord: "1:17.774 (Valtteri Bottas, 2021)",
    imageUrl: getF1ImageUrl("Mexico"),
    firstGrandPrix: 1963,
    laps: 71,
    raceDistance: 305.354
  },
  "Brazil": {
    name: "Autódromo José Carlos Pace",
    turns: 15,
    lengthKM: 4.309,
    lapRecord: "1:10.540 (Valtteri Bottas, 2018)",
    imageUrl: getF1ImageUrl("Brazil"),
    firstGrandPrix: 1973,
    laps: 71,
    raceDistance: 305.879
  },
  "Las Vegas Grand Prix": {
    name: "Las Vegas Strip Circuit",
    turns: 17,
    lengthKM: 6.201,
    lapRecord: "1:35.490 (Oscar Piastri, 2023)",
    imageUrl: getF1ImageUrl("Las_Vegas"),
    firstGrandPrix: 2023,
    laps: 50,
    raceDistance: 309.958
  },
  "Qatar": {
    name: "Lusail International Circuit",
    turns: 16,
    lengthKM: 5.419,
    lapRecord: "1:24.319 (Max Verstappen, 2023)",
    imageUrl: getF1ImageUrl("Qatar"),
    firstGrandPrix: 2021,
    laps: 57,
    raceDistance: 308.611
  },
  "United Arab Emirates": {
    name: "Yas Marina Circuit",
    turns: 16,
    lengthKM: 5.281,
    lapRecord: "1:26.103 (Max Verstappen, 2021)",
    imageUrl: getF1ImageUrl("Abu_Dhabi"),
    firstGrandPrix: 2009,
    laps: 58,
    raceDistance: 306.183
  },
  "China": {
    name: "Shanghai International Circuit",
    turns: 16,
    lengthKM: 5.451,
    lapRecord: "1:32.238 (Michael Schumacher, 2004)",
    imageUrl: getF1ImageUrl("China"),
    firstGrandPrix: 2004,
    laps: 56,
    raceDistance: 305.066
  }
};

// Fallback logic tries exact match, then tries matching country, then race name
export function getCircuitData(circuitName: string | null, country: string | null, raceName: string | null): CircuitData {
  if (circuitName && CIRCUITS[circuitName]) return CIRCUITS[circuitName];
  if (country && CIRCUITS[country]) return CIRCUITS[country];
  if (raceName && CIRCUITS[raceName]) return CIRCUITS[raceName];
  
  // Fallback
  return {
    name: circuitName || country || raceName || "Grand Prix Circuit",
    turns: 15,
    lengthKM: 5.0,
    lapRecord: "N/A",
    imageUrl: genericImageUrl,
    firstGrandPrix: 1950,
    laps: 50,
    raceDistance: 250.0
  };
}
