// The postcode data's attribution (docs/office-v2.md 4.7, 5.4; 12H.3). postcodes.io serves the
// Office for National Statistics' postcode directory (ONSPD), whose licence requires these words
// wherever the data is used (https://ideal-postcodes.co.uk/guides/onspd-licensing): Ordnance Survey,
// Royal Mail and National Statistics data, under the Open Government Licence v3.0. Shown on `/help`.
// The year is the current one: the data is looked up live.
export const postcodeAttribution = (year: number): string =>
  `Postcode locations: Contains OS data © Crown copyright and database right ${year}. ` +
  `Contains Royal Mail data © Royal Mail copyright and database right ${year}. ` +
  `Contains National Statistics data © Crown copyright and database right ${year}. ` +
  `Source: Office for National Statistics, licensed under the Open Government Licence v.3.0.`;
