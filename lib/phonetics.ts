/**
 * How a callsign is written versus how it is said.
 *
 * This is the translation layer the whole grounding step rests on. ADS-B gives
 * us `N5432L` and `UAL1334`; a controller never says either of those.
 */

/** ICAO spelling alphabet. */
const LETTERS: Record<string, string> = {
  A: "alfa",
  B: "bravo",
  C: "charlie",
  D: "delta",
  E: "echo",
  F: "foxtrot",
  G: "golf",
  H: "hotel",
  I: "india",
  J: "juliett",
  K: "kilo",
  L: "lima",
  M: "mike",
  N: "november",
  O: "oscar",
  P: "papa",
  Q: "quebec",
  R: "romeo",
  S: "sierra",
  T: "tango",
  U: "uniform",
  V: "victor",
  W: "whiskey",
  X: "x-ray",
  Y: "yankee",
  Z: "zulu",
};

const DIGITS: Record<string, string> = {
  "0": "zero",
  "1": "one",
  "2": "two",
  "3": "three",
  "4": "four",
  "5": "five",
  "6": "six",
  "7": "seven",
  "8": "eight",
  "9": "nine",
};

/**
 * Radio-specific digit pronunciations.
 */
const RADIO_DIGITS: Record<string, string> = {
  "3": "tree",
  "5": "fife",
  "9": "niner",
};

const TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];

const TEENS = [
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];

/** 0–99 as spoken English. Used for the grouped forms of flight numbers. */
function twoDigitWords(value: number): string {
  if (value < 10) return DIGITS[String(value)];
  if (value < 20) return TEENS[value - 10];
  const tens = TENS[Math.floor(value / 10)];
  const ones = value % 10;
  return ones === 0 ? tens : `${tens} ${DIGITS[String(ones)]}`;
}

/** Each character spoken individually: "5432L" → "five four three two lima". */
export function spellOut(text: string, radioDigits = false): string {
  return [...text.toUpperCase()]
    .map((char) => {
      if (char in DIGITS) {
        return radioDigits && char in RADIO_DIGITS ? RADIO_DIGITS[char] : DIGITS[char];
      }
      return LETTERS[char] ?? char;
    })
    .filter((word) => word.trim() !== "")
    .join(" ");
}

/**
 * A flight number as controllers group it: 1334 becomes "thirteen thirty-four",
 * 2058 "twenty fifty-eight", 679 "six seventy-nine".
 */
export function groupNumber(digits: string): string | null {
  if (!/^\d+$/.test(digits)) return null;

  if (digits.length === 4) {
    const high = Number(digits.slice(0, 2));
    const low = Number(digits.slice(2));
    // A leading zero is read as a digit — "zero six", never "six".
    const highWords = digits[0] === "0" ? spellOut(digits.slice(0, 2)) : twoDigitWords(high);
    const lowWords = digits[2] === "0" && low < 10 ? spellOut(digits.slice(2)) : twoDigitWords(low);
    return `${highWords} ${lowWords}`;
  }

  if (digits.length === 3) {
    const low = Number(digits.slice(1));
    const lowWords = digits[1] === "0" && low < 10 ? spellOut(digits.slice(1)) : twoDigitWords(low);
    return `${DIGITS[digits[0]]} ${lowWords}`;
  }

  if (digits.length <= 2) return twoDigitWords(Number(digits));
  return null;
}

/**
 * Airline telephony names — what an operator is called on the radio.
 */
const TELEPHONY: Record<string, string> = {
  AAL: "American",
  AAY: "Allegiant",
  ACA: "Air Canada",
  AFR: "Airfrans",
  AMX: "Aeromexico",
  ANA: "All Nippon",
  ASA: "Alaska",
  ASH: "Air Shuttle",
  AWI: "Air Wisconsin",
  BAW: "Speedbird",
  CPA: "Cathay",
  DAL: "Delta",
  DLH: "Lufthansa",
  EDV: "Endeavor",
  EJA: "Execjet",
  ENY: "Envoy",
  FDX: "FedEx",
  FFT: "Frontier",
  GJS: "Lynx",
  GTI: "Giant",
  HAL: "Hawaiian",
  JBU: "JetBlue",
  JIA: "Blue Streak",
  KAL: "Koreanair",
  KLM: "KLM",
  LXJ: "Flexjet",
  MXY: "Breeze",
  NKS: "Spirit",
  PDT: "Piedmont",
  QTR: "Qatari",
  QXE: "Horizon Air",
  RPA: "Brickyard",
  SCX: "Sun Country",
  SIA: "Singapore",
  SKW: "SkyWest",
  SWA: "Southwest",
  UAE: "Emirates",
  UAL: "United",
  UPS: "UPS",
  VIR: "Virgin",
  VOI: "Volaris",
  WJA: "Westjet",
};

/**
 * Manufacturer names for the ICAO type designators seen at a training field.
 */
const TYPE_NAMES: Record<string, string> = {
  AA5: "grumman",
  BE33: "beech",
  BE35: "beech",
  BE36: "beech",
  BE55: "beech",
  BE58: "beech",
  BE76: "beech",
  C152: "cessna",
  C162: "cessna",
  C172: "cessna",
  C175: "cessna",
  C177: "cessna",
  C182: "cessna",
  C206: "cessna",
  C208: "cessna",
  C210: "cessna",
  C310: "cessna",
  C72R: "cessna",
  C82R: "cessna",
  DA20: "diamond",
  DA40: "diamond",
  DA42: "diamond",
  DA62: "diamond",
  M20P: "mooney",
  M20T: "mooney",
  P28A: "piper",
  P28B: "piper",
  P28R: "piper",
  P28T: "piper",
  PA18: "piper",
  PA24: "piper",
  PA28: "piper",
  PA32: "piper",
  PA34: "piper",
  PA44: "piper",
  PA46: "piper",
  S22T: "cirrus",
  SR20: "cirrus",
  SR22: "cirrus",
};

/**
 * What a controller would call this type, or null if we cannot say.
 */
function typeSpokenAs(aircraftType: string): string | null {
  const raw = aircraftType.trim().toUpperCase();
  if (raw === "") return null;
  if (raw in TYPE_NAMES) return TYPE_NAMES[raw];
  return /^[A-Z]+$/.test(raw) ? raw.toLowerCase() : null;
}

/**
 * Every way a callsign might be spoken.
 *
 * Ordered roughly most to least likely, though the model sees the whole list
 * rather than being asked to prefer one. `aircraftType` is used only for the
 * "Cessna three two lima" form, which is how a tower addresses light aircraft
 * whose type it can see.
 */
export function spokenForms(callsign: string, aircraftType?: string | null): string[] {
  const raw = callsign.trim().toUpperCase();
  if (raw === "") return [];

  const typeName = aircraftType ? typeSpokenAs(aircraftType) : null;
  const forms = new Set<string>();

  // Airline: three-letter operator code followed by a flight number.
  const airline = raw.match(/^([A-Z]{3})(\d{1,4}[A-Z]?)$/);
  if (airline) {
    const [, code, flight] = airline;
    const name = TELEPHONY[code];
    const digits = flight.replace(/\D/g, "");
    const suffix = flight.slice(digits.length);
    const spelledSuffix = suffix ? ` ${spellOut(suffix)}` : "";

    if (name) {
      forms.add(`${name} ${spellOut(digits)}${spelledSuffix}`.toLowerCase());
      const grouped = groupNumber(digits);
      if (grouped) forms.add(`${name} ${grouped}${spelledSuffix}`.toLowerCase());
    }
    // Some operators have no telephony name in the table, and controllers do
    // occasionally read the raw code — keep an unnamed form either way.
    forms.add(`${spellOut(code)} ${spellOut(digits)}${spelledSuffix}`.toLowerCase());
    return [...forms];
  }

  // US registration: N followed by digits and up to two letters.
  const registration = raw.match(/^N(\d+)([A-Z]{0,2})$/);
  if (registration) {
    const [, digits, letters] = registration;
    const tail = `${digits}${letters}`;

    forms.add(spellOut(raw).toLowerCase());
    forms.add(spellOut(raw, true).toLowerCase());
    // The "november" is routinely dropped once the controller has the aircraft.
    forms.add(spellOut(tail).toLowerCase());

    // Abbreviated to the last three characters, which is what a tower uses
    // after first contact: "N5432L" becomes "three two lima".
    const short = tail.slice(-3);
    if (short.length === 3) {
      forms.add(spellOut(short).toLowerCase());
      // And the grouped form of that: "thirty-two lima".
      const shortDigits = short.match(/^(\d{2})([A-Z])$/);
      if (shortDigits) {
        const grouped = groupNumber(shortDigits[1]);
        if (grouped) forms.add(`${grouped} ${LETTERS[shortDigits[2]]}`.toLowerCase());
      }
      if (typeName) {
        forms.add(`${typeName} ${spellOut(short)}`);
      }
    }

    if (typeName) {
      forms.add(`${typeName} ${spellOut(tail)}`);
    }
    return [...forms];
  }

  // Anything else — foreign registrations, tactical callsigns — spelled out.
  forms.add(spellOut(raw).toLowerCase());
  return [...forms];
}

/**
 * How a runway is said. "28R" is "two eight right".
 */
export function runwaySpokenForms(designator: string): string[] {
  const raw = designator.trim().toUpperCase();
  const parsed = raw.match(/^(\d{1,2})([LRC]?)$/);
  if (!parsed) return [spellOut(raw).toLowerCase()];

  const [, digits, side] = parsed;
  const sideWord = side === "L" ? " left" : side === "R" ? " right" : side === "C" ? " center" : "";

  const forms = new Set<string>();
  forms.add(`${spellOut(digits)}${sideWord}`.toLowerCase());
  const grouped = groupNumber(digits);
  if (grouped && grouped !== spellOut(digits)) {
    forms.add(`${grouped}${sideWord}`.toLowerCase());
  }
  return [...forms];
}
