import { describe, expect, it } from "vitest";

import { groupNumber, runwaySpokenForms, spellOut, spokenForms } from "./phonetics";

describe("spelling out", () => {
  it("uses the ICAO alphabet", () => {
    expect(spellOut("N5432L")).toBe("november five four three two lima");
    expect(spellOut("KSQL")).toBe("kilo sierra quebec lima");
  });

  it("offers the radio digit forms on request", () => {
    // "niner" exists so nine is not heard as the German "nein"; "tree" and
    // "fife" drop consonants that clip badly over AM.
    expect(spellOut("359", true)).toBe("tree fife niner");
    expect(spellOut("359")).toBe("three five nine");
  });
});

describe("grouping flight numbers", () => {
  it("groups four digits into pairs, the way they are read", () => {
    expect(groupNumber("1334")).toBe("thirteen thirty four");
    expect(groupNumber("2058")).toBe("twenty fifty eight");
    expect(groupNumber("1241")).toBe("twelve forty one");
  });

  it("groups three digits as a digit then a pair", () => {
    expect(groupNumber("679")).toBe("six seventy nine");
  });

  it("reads a leading zero as a digit rather than swallowing it", () => {
    // "0679" is "zero six seventy nine", never "six seventy nine" — the zero
    // is part of the callsign and dropping it matches the wrong aircraft.
    expect(groupNumber("0679")).toBe("zero six seventy nine");
    expect(groupNumber("1305")).toBe("thirteen zero five");
  });

  it("rejects anything that is not digits", () => {
    expect(groupNumber("12A4")).toBeNull();
    expect(groupNumber("")).toBeNull();
  });
});

describe("airline callsigns", () => {
  it("uses the telephony name, not the company name", () => {
    const forms = spokenForms("UAL1334");
    expect(forms).toContain("united thirteen thirty four");
    expect(forms).toContain("united one three three four");
  });

  it("knows the telephony names that are nothing like the operator", () => {
    // These are the ones that make or break matching an airliner.
    expect(spokenForms("RPA4521").join(" ")).toContain("brickyard");
    expect(spokenForms("BAW2")).toEqual(
      expect.arrayContaining([expect.stringContaining("speedbird")]),
    );
    expect(spokenForms("QXE2058").join(" ")).toContain("horizon air");
  });

  it("still produces a form for an operator it does not know", () => {
    const forms = spokenForms("ZZZ123");
    expect(forms.length).toBeGreaterThan(0);
    expect(forms.join(" ")).toContain("zulu zulu zulu");
  });
});

describe("registrations", () => {
  const forms = spokenForms("N5432L", "Cessna");

  it("gives the full form", () => {
    expect(forms).toContain("november five four three two lima");
  });

  it("drops the november, as a controller does after first contact", () => {
    expect(forms).toContain("five four three two lima");
  });

  it("abbreviates to the last three, spelled and grouped", () => {
    // A tower says "three two lima" or "thirty-two lima" — almost never the
    // whole registration once it has the aircraft.
    expect(forms).toContain("three two lima");
    expect(forms).toContain("thirty two lima");
  });

  it("prefixes the aircraft type, the way a tower addresses light aircraft", () => {
    expect(forms).toContain("cessna three two lima");
    expect(forms).toContain("cessna five four three two lima");
  });

  it("works without a known type", () => {
    expect(spokenForms("N123AB")).toContain("november one two three alfa bravo");
  });

  it("translates the ICAO type designator ADS-B actually reports", () => {
    // A controller says "Cessna", never "C172". This is the form that gets
    // used, so getting it from the designator is the whole point.
    expect(spokenForms("N5432L", "C172")).toContain("cessna three two lima");
    expect(spokenForms("N5432L", "SR22")).toContain("cirrus three two lima");
    expect(spokenForms("N5432L", "P28A")).toContain("piper three two lima");
  });

  it("offers no type form at all for a designator it cannot name", () => {
    // "b seven three eight three two lima" is not something anyone says, and a
    // wrong candidate is a chance to match the wrong aircraft.
    expect(spokenForms("N5432L", "B738").join(" ")).not.toContain("b738");
    expect(spokenForms("N5432L", "B738")).toContain("three two lima");
  });

  it("returns nothing for an empty callsign", () => {
    expect(spokenForms("")).toEqual([]);
    expect(spokenForms("   ")).toEqual([]);
  });
});

describe("runways", () => {
  it("says the side out in full", () => {
    expect(runwaySpokenForms("28R")).toContain("two eight right");
    expect(runwaySpokenForms("10L")).toContain("one zero left");
    expect(runwaySpokenForms("17C")).toContain("seventeen center");
  });

  it("offers the grouped form controllers also use", () => {
    expect(runwaySpokenForms("28R")).toContain("twenty eight right");
    expect(runwaySpokenForms("30")).toContain("thirty");
    expect(runwaySpokenForms("30")).toContain("three zero");
  });

  it("handles a single-digit runway", () => {
    expect(runwaySpokenForms("9")).toContain("nine");
  });
});
