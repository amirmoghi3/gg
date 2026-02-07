const fallback = [
  "United States",
  "Canada",
  "United Kingdom",
  "Germany",
  "France",
  "Spain",
  "Italy",
  "Netherlands",
  "Sweden",
  "Norway",
  "Denmark",
  "Finland",
  "Poland",
  "Brazil",
  "Mexico",
  "Argentina",
  "Chile",
  "Colombia",
  "Peru",
  "Australia",
  "New Zealand",
  "Japan",
  "South Korea",
  "China",
  "India",
  "Indonesia",
  "Philippines",
  "Thailand",
  "Vietnam",
  "Singapore",
  "Malaysia",
  "South Africa",
  "Nigeria",
  "Kenya",
  "Egypt",
  "Turkey",
  "Israel",
  "Saudi Arabia",
  "United Arab Emirates",
  "Russia",
  "Ukraine",
  "Portugal",
  "Greece",
  "Switzerland",
  "Austria",
  "Belgium",
  "Ireland",
  "Czechia",
  "Romania",
  "Hungary",
  "Bulgaria"
];

export function getCountries() {
  const supported = (Intl as any).supportedValuesOf?.("region") as string[] | undefined;
  if (!supported || supported.length === 0) return fallback;
  const display = new Intl.DisplayNames(["en"], { type: "region" });
  const names = supported
    .map((region) => display.of(region))
    .filter((value): value is string => Boolean(value));
  return Array.from(new Set(names)).sort();
}
