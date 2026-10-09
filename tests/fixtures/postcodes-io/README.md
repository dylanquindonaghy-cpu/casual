# postcodes.io answers (made up)

Answers in the shape postcodes.io documents for `GET /postcodes/{postcode}`
(https://postcodes.io/docs/overview/), for `tests/unit/travel.geocoder.test.ts`. No test calls the
real service. These were written by hand, not fetched (the overnight build never calls an outside
service), with made-up `ZZ` postcodes and values (golden rule 7). "Connect postcodes.io" in
`PLAN.md`'s Parking lot checks them against one live answer before the service is switched on.

- `found.json`: a postcode with its central point (and the many fields the app ignores).
- `not-found.json`: a well-formed postcode it doesn't know.
- `invalid.json`: something that isn't a postcode.
- `no-point.json`: a postcode it knows with no central point (latitude and longitude null).
