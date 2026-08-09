/**
 * San Carlos (KSQL) is where the scope opens.
 *
 * A cold start has to land somewhere with something happening, or the first
 * thing a new user sees is an empty map and a wrong impression of the product.
 * KSQL earns it on four counts:
 *
 *   - Towered Class D, so there is a real controller on a real frequency
 *     rather than the unstructured self-announcing of a CTAF-only field.
 *   - One runway, 12/30, which keeps active-runway logic legible while the
 *     wind-versus-runway readout is being demonstrated.
 *   - Directly beneath the SFO Class B shelf, so airline traffic overhead and
 *     GA pattern work appear in the same view.
 *   - One of the busiest flight-training fields in the Bay Area, which means
 *     student pilots on frequency — the audience this was built for.
 *
 * Coordinates are the airport reference point from OurAirports.
 */
export const DEFAULT_AIRPORT = "KSQL";

export const DEFAULT_CENTER = { lat: 37.51313, lon: -122.250838 };

/**
 * Roughly 33 nm across on a desktop viewport: KSQL centred, with SFO, Palo
 * Alto, Hayward, and Oakland in frame. Wide enough to show that the viewport
 * drives the query, tight enough that individual targets stay legible.
 */
export const DEFAULT_ZOOM = 11;
