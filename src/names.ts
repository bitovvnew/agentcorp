// Fictional names only. Any resemblance to real people or firms is coincidental.
import { pick, type Rng } from './rng.js';

const FIRST = [
  'Ada', 'Bilal', 'Chen', 'Dara', 'Elif', 'Femi', 'Greta', 'Hiro', 'Imani', 'Jonas', 'Kavya', 'Lior', 'Mateo', 'Nadia',
  'Oskar', 'Priya', 'Quinn', 'Rafael', 'Saoirse', 'Tariq', 'Uma', 'Viktor', 'Wen', 'Ximena', 'Yusuf', 'Zara', 'Amara',
  'Bo', 'Camille', 'Dmitri', 'Esme', 'Farah', 'Gus', 'Hana', 'Ivo', 'Jia', 'Kofi', 'Lena', 'Milo', 'Noor', 'Omar',
  'Paz', 'Rhea', 'Sol', 'Teo', 'Valentina', 'Wiktor', 'Yara', 'Zeke', 'Anouk', 'Bruno', 'Cleo', 'Dev', 'Eun', 'Finn',
  'Gaia', 'Hugo', 'Ines', 'Jun', 'Kai', 'Luca', 'Maya', 'Nico', 'Olu', 'Pia', 'Ravi', 'Sana', 'Tomas', 'Vera', 'Yuki',
];
const LAST = [
  'Okafor', 'Lindqvist', 'Moreau', 'Tanaka', 'Haddad', 'Kowalski', 'Mendes', 'Novak', 'Rahman', 'Silva', 'Sato', 'Weber',
  'Abara', 'Byrne', 'Castillo', 'Dubois', 'Eriksen', 'Fischer', 'Gupta', 'Horvat', 'Ito', 'Jensen', 'Kim', 'Larsen',
  'Mbeki', 'Nakamura', 'Ortiz', 'Petrov', 'Quispe', 'Rossi', 'Schmidt', 'Toure', 'Ueda', 'Varga', 'Wolff', 'Yilmaz', 'Zhou',
];

export function personName(rng: Rng): string {
  return `${pick(rng, FIRST)} ${pick(rng, LAST)}`;
}

export const VCS = [
  'Sandbar Ventures', 'Andromeda Capital', 'Lighthouse Partners', 'Nine Lanterns VC', 'Granite Peak Capital',
  'Tailwind Fund', 'Second Breakfast Ventures', 'Orbital Partners', 'Kestrel Capital', 'Blue Heron Growth',
  'Paper Crane Ventures', 'Northstar Seed', 'Compound Interest Capital', 'Hyperloop Angels', 'Moonshot Mutual',
];

export function vcName(rng: Rng): string {
  return pick(rng, VCS);
}
