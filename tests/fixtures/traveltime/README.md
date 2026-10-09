# TravelTime answers (made up)

Answers in the shape TravelTime documents for its time-filter endpoint (`POST /v4/time-filter`,
https://docs.traveltime.com/api/reference/time-filter, and its error codes,
https://docs.traveltime.com/api/reference/error-codes), for
`tests/unit/travel.provider.test.ts`. No test calls the real service. Written by hand, not fetched
(the overnight build never calls an outside service), with made-up times and distances. "Connect
postcodes.io and TravelTime" in `PLAN.md`'s Parking lot checks them against one live answer
before the service is switched on.

- `car.json`: a driving arrival search: two start points with times (seconds) and distances
  (metres), one out of reach within the ceiling.
- `public-transport.json`: a public-transport search: one with a time, two out of reach.
- `error.json`: an error answer (422).
