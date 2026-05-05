import { cellToLatLng } from 'h3-js'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { feature } = require('topojson-client')
const topo = require('world-atlas/countries-50m.json')
const countriesFC = feature(topo, topo.objects.countries)

// ISO 3166-1 numeric → { name, continent }
const ISO = {
  '004': { name: 'Afghanistan',               continent: 'Asia' },
  '008': { name: 'Albania',                   continent: 'Europe' },
  '012': { name: 'Algeria',                   continent: 'Africa' },
  '016': { name: 'American Samoa',            continent: 'Oceania' },
  '020': { name: 'Andorra',                   continent: 'Europe' },
  '024': { name: 'Angola',                    continent: 'Africa' },
  '028': { name: 'Antigua & Barbuda',         continent: 'North America' },
  '031': { name: 'Azerbaijan',                continent: 'Asia' },
  '032': { name: 'Argentina',                 continent: 'South America' },
  '036': { name: 'Australia',                 continent: 'Oceania' },
  '040': { name: 'Austria',                   continent: 'Europe' },
  '044': { name: 'Bahamas',                   continent: 'North America' },
  '048': { name: 'Bahrain',                   continent: 'Asia' },
  '050': { name: 'Bangladesh',                continent: 'Asia' },
  '051': { name: 'Armenia',                   continent: 'Asia' },
  '052': { name: 'Barbados',                  continent: 'North America' },
  '056': { name: 'Belgium',                   continent: 'Europe' },
  '060': { name: 'Bermuda',                   continent: 'North America' },
  '064': { name: 'Bhutan',                    continent: 'Asia' },
  '068': { name: 'Bolivia',                   continent: 'South America' },
  '070': { name: 'Bosnia & Herzegovina',      continent: 'Europe' },
  '072': { name: 'Botswana',                  continent: 'Africa' },
  '076': { name: 'Brazil',                    continent: 'South America' },
  '084': { name: 'Belize',                    continent: 'North America' },
  '086': { name: 'British Indian Ocean Terr.',continent: 'Asia' },
  '090': { name: 'Solomon Islands',           continent: 'Oceania' },
  '092': { name: 'British Virgin Islands',    continent: 'North America' },
  '096': { name: 'Brunei',                    continent: 'Asia' },
  '100': { name: 'Bulgaria',                  continent: 'Europe' },
  '104': { name: 'Myanmar',                   continent: 'Asia' },
  '108': { name: 'Burundi',                   continent: 'Africa' },
  '112': { name: 'Belarus',                   continent: 'Europe' },
  '116': { name: 'Cambodia',                  continent: 'Asia' },
  '120': { name: 'Cameroon',                  continent: 'Africa' },
  '124': { name: 'Canada',                    continent: 'North America' },
  '132': { name: 'Cape Verde',               continent: 'Africa' },
  '136': { name: 'Cayman Islands',            continent: 'North America' },
  '140': { name: 'Central African Republic',  continent: 'Africa' },
  '144': { name: 'Sri Lanka',                 continent: 'Asia' },
  '148': { name: 'Chad',                      continent: 'Africa' },
  '152': { name: 'Chile',                     continent: 'South America' },
  '156': { name: 'China',                     continent: 'Asia' },
  '158': { name: 'Taiwan',                    continent: 'Asia' },
  '170': { name: 'Colombia',                  continent: 'South America' },
  '174': { name: 'Comoros',                   continent: 'Africa' },
  '178': { name: 'Republic of Congo',         continent: 'Africa' },
  '180': { name: 'DR Congo',                  continent: 'Africa' },
  '184': { name: 'Cook Islands',              continent: 'Oceania' },
  '188': { name: 'Costa Rica',               continent: 'North America' },
  '191': { name: 'Croatia',                   continent: 'Europe' },
  '192': { name: 'Cuba',                      continent: 'North America' },
  '196': { name: 'Cyprus',                    continent: 'Europe' },
  '203': { name: 'Czech Republic',            continent: 'Europe' },
  '204': { name: 'Benin',                     continent: 'Africa' },
  '208': { name: 'Denmark',                   continent: 'Europe' },
  '212': { name: 'Dominica',                  continent: 'North America' },
  '214': { name: 'Dominican Republic',        continent: 'North America' },
  '218': { name: 'Ecuador',                   continent: 'South America' },
  '818': { name: 'Egypt',                     continent: 'Africa' },
  '222': { name: 'El Salvador',              continent: 'North America' },
  '226': { name: 'Equatorial Guinea',         continent: 'Africa' },
  '232': { name: 'Eritrea',                   continent: 'Africa' },
  '233': { name: 'Estonia',                   continent: 'Europe' },
  '231': { name: 'Ethiopia',                  continent: 'Africa' },
  '238': { name: 'Falkland Islands',          continent: 'South America' },
  '242': { name: 'Fiji',                      continent: 'Oceania' },
  '246': { name: 'Finland',                   continent: 'Europe' },
  '250': { name: 'France',                    continent: 'Europe' },
  '254': { name: 'French Guiana',             continent: 'South America' },
  '258': { name: 'French Polynesia',          continent: 'Oceania' },
  '266': { name: 'Gabon',                     continent: 'Africa' },
  '270': { name: 'Gambia',                    continent: 'Africa' },
  '268': { name: 'Georgia',                   continent: 'Asia' },
  '276': { name: 'Germany',                   continent: 'Europe' },
  '288': { name: 'Ghana',                     continent: 'Africa' },
  '292': { name: 'Gibraltar',                 continent: 'Europe' },
  '300': { name: 'Greece',                    continent: 'Europe' },
  '304': { name: 'Greenland',                 continent: 'North America' },
  '308': { name: 'Grenada',                   continent: 'North America' },
  '312': { name: 'Guadeloupe',                continent: 'North America' },
  '316': { name: 'Guam',                      continent: 'Oceania' },
  '320': { name: 'Guatemala',                 continent: 'North America' },
  '324': { name: 'Guinea',                    continent: 'Africa' },
  '328': { name: 'Guyana',                    continent: 'South America' },
  '332': { name: 'Haiti',                     continent: 'North America' },
  '340': { name: 'Honduras',                  continent: 'North America' },
  '344': { name: 'Hong Kong',                 continent: 'Asia' },
  '348': { name: 'Hungary',                   continent: 'Europe' },
  '352': { name: 'Iceland',                   continent: 'Europe' },
  '356': { name: 'India',                     continent: 'Asia' },
  '360': { name: 'Indonesia',                 continent: 'Asia' },
  '364': { name: 'Iran',                      continent: 'Asia' },
  '368': { name: 'Iraq',                      continent: 'Asia' },
  '372': { name: 'Ireland',                   continent: 'Europe' },
  '376': { name: 'Israel',                    continent: 'Asia' },
  '380': { name: 'Italy',                     continent: 'Europe' },
  '384': { name: 'Ivory Coast',               continent: 'Africa' },
  '388': { name: 'Jamaica',                   continent: 'North America' },
  '392': { name: 'Japan',                     continent: 'Asia' },
  '400': { name: 'Jordan',                    continent: 'Asia' },
  '398': { name: 'Kazakhstan',                continent: 'Asia' },
  '404': { name: 'Kenya',                     continent: 'Africa' },
  '408': { name: 'North Korea',               continent: 'Asia' },
  '410': { name: 'South Korea',               continent: 'Asia' },
  '414': { name: 'Kuwait',                    continent: 'Asia' },
  '417': { name: 'Kyrgyzstan',                continent: 'Asia' },
  '418': { name: 'Laos',                      continent: 'Asia' },
  '422': { name: 'Lebanon',                   continent: 'Asia' },
  '426': { name: 'Lesotho',                   continent: 'Africa' },
  '430': { name: 'Liberia',                   continent: 'Africa' },
  '434': { name: 'Libya',                     continent: 'Africa' },
  '438': { name: 'Liechtenstein',             continent: 'Europe' },
  '440': { name: 'Lithuania',                 continent: 'Europe' },
  '442': { name: 'Luxembourg',                continent: 'Europe' },
  '446': { name: 'Macau',                     continent: 'Asia' },
  '450': { name: 'Madagascar',                continent: 'Africa' },
  '454': { name: 'Malawi',                    continent: 'Africa' },
  '458': { name: 'Malaysia',                  continent: 'Asia' },
  '462': { name: 'Maldives',                  continent: 'Asia' },
  '466': { name: 'Mali',                      continent: 'Africa' },
  '470': { name: 'Malta',                     continent: 'Europe' },
  '478': { name: 'Mauritania',                continent: 'Africa' },
  '480': { name: 'Mauritius',                 continent: 'Africa' },
  '484': { name: 'Mexico',                    continent: 'North America' },
  '496': { name: 'Mongolia',                  continent: 'Asia' },
  '498': { name: 'Moldova',                   continent: 'Europe' },
  '504': { name: 'Morocco',                   continent: 'Africa' },
  '508': { name: 'Mozambique',                continent: 'Africa' },
  '516': { name: 'Namibia',                   continent: 'Africa' },
  '524': { name: 'Nepal',                     continent: 'Asia' },
  '528': { name: 'Netherlands',               continent: 'Europe' },
  '540': { name: 'New Caledonia',             continent: 'Oceania' },
  '554': { name: 'New Zealand',               continent: 'Oceania' },
  '558': { name: 'Nicaragua',                 continent: 'North America' },
  '562': { name: 'Niger',                     continent: 'Africa' },
  '566': { name: 'Nigeria',                   continent: 'Africa' },
  '578': { name: 'Norway',                    continent: 'Europe' },
  '512': { name: 'Oman',                      continent: 'Asia' },
  '586': { name: 'Pakistan',                  continent: 'Asia' },
  '591': { name: 'Panama',                    continent: 'North America' },
  '598': { name: 'Papua New Guinea',          continent: 'Oceania' },
  '600': { name: 'Paraguay',                  continent: 'South America' },
  '604': { name: 'Peru',                      continent: 'South America' },
  '608': { name: 'Philippines',               continent: 'Asia' },
  '616': { name: 'Poland',                    continent: 'Europe' },
  '620': { name: 'Portugal',                  continent: 'Europe' },
  '630': { name: 'Puerto Rico',               continent: 'North America' },
  '634': { name: 'Qatar',                     continent: 'Asia' },
  '642': { name: 'Romania',                   continent: 'Europe' },
  '643': { name: 'Russia',                    continent: 'Europe' },
  '646': { name: 'Rwanda',                    continent: 'Africa' },
  '659': { name: 'Saint Kitts & Nevis',       continent: 'North America' },
  '662': { name: 'Saint Lucia',               continent: 'North America' },
  '670': { name: 'Saint Vincent',             continent: 'North America' },
  '678': { name: 'São Tomé & Príncipe',       continent: 'Africa' },
  '682': { name: 'Saudi Arabia',              continent: 'Asia' },
  '686': { name: 'Senegal',                   continent: 'Africa' },
  '688': { name: 'Serbia',                    continent: 'Europe' },
  '694': { name: 'Sierra Leone',              continent: 'Africa' },
  '703': { name: 'Slovakia',                  continent: 'Europe' },
  '705': { name: 'Slovenia',                  continent: 'Europe' },
  '706': { name: 'Somalia',                   continent: 'Africa' },
  '710': { name: 'South Africa',              continent: 'Africa' },
  '716': { name: 'Zimbabwe',                  continent: 'Africa' },
  '724': { name: 'Spain',                     continent: 'Europe' },
  '728': { name: 'South Sudan',               continent: 'Africa' },
  '729': { name: 'Sudan',                     continent: 'Africa' },
  '740': { name: 'Suriname',                  continent: 'South America' },
  '748': { name: 'Eswatini',                  continent: 'Africa' },
  '752': { name: 'Sweden',                    continent: 'Europe' },
  '756': { name: 'Switzerland',               continent: 'Europe' },
  '760': { name: 'Syria',                     continent: 'Asia' },
  '762': { name: 'Tajikistan',                continent: 'Asia' },
  '764': { name: 'Thailand',                  continent: 'Asia' },
  '768': { name: 'Togo',                      continent: 'Africa' },
  '776': { name: 'Tonga',                     continent: 'Oceania' },
  '780': { name: 'Trinidad & Tobago',         continent: 'North America' },
  '788': { name: 'Tunisia',                   continent: 'Africa' },
  '792': { name: 'Turkey',                    continent: 'Europe' },
  '795': { name: 'Turkmenistan',              continent: 'Asia' },
  '800': { name: 'Uganda',                    continent: 'Africa' },
  '804': { name: 'Ukraine',                   continent: 'Europe' },
  '784': { name: 'United Arab Emirates',      continent: 'Asia' },
  '826': { name: 'United Kingdom',            continent: 'Europe' },
  '840': { name: 'United States',             continent: 'North America' },
  '858': { name: 'Uruguay',                   continent: 'South America' },
  '860': { name: 'Uzbekistan',                continent: 'Asia' },
  '862': { name: 'Venezuela',                 continent: 'South America' },
  '704': { name: 'Vietnam',                   continent: 'Asia' },
  '887': { name: 'Yemen',                     continent: 'Asia' },
  '894': { name: 'Zambia',                    continent: 'Africa' },
  '010': { name: 'Antarctica',                continent: 'Antarctica' },
  '074': { name: 'Bouvet Island',             continent: 'Antarctica' },
  '334': { name: 'Heard Island',              continent: 'Antarctica' },
  '239': { name: 'South Georgia',             continent: 'Antarctica' },
}

// ─── Pre-process country polygons with bounding boxes ────────────────────────

function pointInRing(pt, ring) {
  const [x, y] = pt
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function pointInPolygonCoords(pt, coords) {
  if (!pointInRing(pt, coords[0])) return false
  for (let i = 1; i < coords.length; i++) {
    if (pointInRing(pt, coords[i])) return false
  }
  return true
}

const countryPolygons = []

for (const feature of countriesFC.features) {
  if (!feature.geometry) continue
  const id = String(feature.id).padStart(3, '0')
  const info = ISO[id] || { name: `Territory ${id}`, continent: 'Unknown' }

  const geom = feature.geometry
  const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates]

  for (const poly of polys) {
    const outer = poly[0]
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
    for (const [lng, lat] of outer) {
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
    }
    countryPolygons.push({ coords: poly, minLng, maxLng, minLat, maxLat, info })
  }
}

console.log(`[countries] Loaded ${countriesFC.features.length} countries (${countryPolygons.length} polygons)`)

// ─── Public API ───────────────────────────────────────────────────────────────

const cache = new Map()

export function getCountry(h3Index) {
  if (cache.has(h3Index)) return cache.get(h3Index)

  const [lat, lng] = cellToLatLng(h3Index)
  let result = null

  for (const { coords, minLng, maxLng, minLat, maxLat, info } of countryPolygons) {
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) continue
    if (pointInPolygonCoords([lng, lat], coords)) {
      result = info
      break
    }
  }

  cache.set(h3Index, result)
  return result
}
